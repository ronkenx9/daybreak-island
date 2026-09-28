// Real-stock prize pool. Legendary chests don't hand out real stock directly;
// instead each UTC day has a fixed number of prizes, at most one per wallet,
// only for players who proved they own a wallet. A win becomes a signed,
// single-use, expiring voucher the winner collects from the PrizeVault
// contract themselves. This process never holds funds; the vault re-checks
// every limit on-chain.
//
// Modes: off (default: no real prizes), testnet (Robinhood Chain testnet).
import { randomBytes } from 'node:crypto';
import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN, STOCK_TOKENS, VAULT_ABI, VOUCHER_TYPES, voucherDomain } from '../src/shared/chain.js';

const DAY = 86_400_000;
const CHALLENGE_TTL = 10 * 60_000;

export class PrizePool {
  constructor({
    store, mode = 'off', signerKey, vault, chainId = CHAIN.id, rpc = CHAIN.rpc,
    dailyPrizes = 5, amount = 10n ** 18n, voucherTtl = DAY, now = () => Date.now(), tickers = Object.keys(STOCK_TOKENS),
  } = {}) {
    this.store = store;
    this.mode = mode;
    this.now = now;
    this.dailyPrizes = dailyPrizes;
    this.amount = BigInt(amount);
    this.voucherTtl = voucherTtl;
    this.tickers = tickers;
    this.challenges = new Map(); // playerId -> { message, expires }
    if (mode !== 'off') {
      if (!signerKey || !isAddress(vault ?? '')) throw new Error('prize mode needs PRIZE_SIGNER_KEY and PRIZE_VAULT');
      this.signer = privateKeyToAccount(signerKey);
      this.vault = getAddress(vault);
      this.chainId = chainId;
      this.rpc = rpc;
      this.chain = { id: chainId, name: CHAIN.name, nativeCurrency: CHAIN.currency, rpcUrls: { default: { http: [rpc] } } };
      this.client = createPublicClient({ chain: this.chain, transport: http(rpc) });
    }
    const { db } = store;
    this.q = {
      today: db.prepare('SELECT COUNT(*) AS n FROM prizes WHERE day = ?'),
      mine: db.prepare('SELECT * FROM prizes WHERE wallet = ? ORDER BY created_at DESC LIMIT 20'),
      insert: db.prepare(`INSERT INTO prizes (id, day, wallet, player, ticker, token, amount, expiry, signature, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      status: db.prepare('UPDATE prizes SET status = ? WHERE id = ?'),
    };
  }

  get enabled() { return this.mode !== 'off'; }
  day(t = this.now()) { return Math.floor(t / DAY); }

  // ---------------------------------------------------------------- wallets
  /** A fresh, single-use message the player's wallet must sign to prove ownership. */
  challenge(player) {
    if (this.challenges.size > 5000) for (const [k, c] of this.challenges) if (c.expires < this.now()) this.challenges.delete(k);
    const nonce = randomBytes(16).toString('hex');
    const message = `Daybreak Island: link this wallet to player "${player.name}".\n\nThis only proves you own the wallet. It costs nothing and moves no funds.\n\nNonce: ${nonce}\nIssued: ${new Date(this.now()).toISOString()}`;
    this.challenges.set(player.id, { message, expires: this.now() + CHALLENGE_TTL });
    return message;
  }

  async link(player, { address, signature } = {}) {
    const c = this.challenges.get(player.id);
    this.challenges.delete(player.id); // single use, success or not
    if (!c || c.expires < this.now()) return { ok: false, error: 'no fresh challenge; call link_wallet_challenge first' };
    if (!isAddress(address ?? '') || typeof signature !== 'string') return { ok: false, error: 'address and signature required' };
    let valid = false;
    try { valid = await verifyMessage({ address, message: c.message, signature }); } catch { valid = false; }
    if (!valid) return { ok: false, error: 'signature does not match that wallet' };
    player.wallet = getAddress(address);
    this.store.log('link', { who: player.name, wallet: player.wallet.toLowerCase() });
    return { ok: true, wallet: player.wallet };
  }

  // ---------------------------------------------------------------- prizes
  /** Called when a player digs a legendary chest. Returns the prize, or why there isn't one. */
  async award(player) {
    if (!this.enabled) return { won: false, reason: 'real prizes are off on this server' };
    if (!player.wallet) return { won: false, reason: 'link a wallet to win real stock from legendary chests' };
    const day = this.day(), wallet = player.wallet.toLowerCase();
    const ticker = this.tickers[randomBytes(1)[0] % this.tickers.length];
    const token = getAddress(STOCK_TOKENS[ticker]);
    const id = BigInt(`0x${randomBytes(16).toString('hex')}`); // unguessable, never reused
    const expiry = BigInt(Math.floor((this.now() + this.voucherTtl) / 1000));
    const voucher = { to: player.wallet, token, amount: this.amount, id, expiry };
    // sign first; if the pool then says no, this signature is dropped and never leaves the server
    const signature = await this.signer.signTypedData({ domain: voucherDomain(this.chainId, this.vault), types: VOUCHER_TYPES, primaryType: 'Voucher', message: voucher });
    // check-and-insert atomically so the day's pool and one-per-wallet can't be raced
    const { db } = this.store;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (this.q.today.get(day).n >= this.dailyPrizes) { db.exec('ROLLBACK'); return { won: false, reason: "today's real-stock pool is empty, back tomorrow" }; }
      try {
        this.q.insert.run(id.toString(), day, wallet, player.name, ticker, token, this.amount.toString(), Number(expiry), signature, this.now());
      } catch (e) {
        db.exec('ROLLBACK');
        if (/UNIQUE/.test(e.message)) return { won: false, reason: 'this wallet already won today, one real prize per wallet per day' };
        throw e;
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    this.store.log('prize', { who: player.name, wallet, ticker, id: id.toString(), amount: this.amount.toString() });
    return { won: true, prize: this.format(this.q.mine.all(wallet).find((r) => r.id === id.toString())) };
  }

  /** A player's prizes with everything needed to collect them. */
  async list(player) {
    if (!player.wallet) return { ok: false, error: 'no wallet linked' };
    const rows = this.q.mine.all(player.wallet.toLowerCase());
    // refresh from the chain: collected vouchers show as claimed
    await Promise.all(rows.filter((r) => r.status === 'issued').map(async (r) => {
      try {
        if (await this.client.readContract({ address: this.vault, abi: VAULT_ABI, functionName: 'used', args: [BigInt(r.id)] })) { r.status = 'claimed'; this.q.status.run('claimed', r.id); }
        else if (r.expiry * 1000 < this.now()) { r.status = 'expired'; this.q.status.run('expired', r.id); }
      } catch { /* chain unreachable: show last known */ }
    }));
    return { ok: true, wallet: player.wallet, prizes: rows.map((r) => this.format(r)) };
  }

  format(r) {
    const voucher = { to: getAddress(r.wallet), token: r.token, amount: r.amount, id: r.id, expiry: r.expiry };
    const out = { id: r.id, ticker: r.ticker, amount: r.amount, amountTokens: Number(BigInt(r.amount) / 10n ** 14n) / 1e4, status: r.status, expiresAt: new Date(r.expiry * 1000).toISOString(), voucher, signature: r.signature };
    if (this.enabled) {
      // ready-to-send transaction: anyone may submit it, the prize always goes to the winner
      out.tx = {
        chainId: this.chainId, to: this.vault,
        data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'claim', args: [{ ...voucher, amount: BigInt(r.amount), id: BigInt(r.id), expiry: BigInt(r.expiry) }, r.signature] }),
      };
    }
    return out;
  }

  stats() {
    return { mode: this.mode, chainId: this.chainId ?? null, vault: this.vault ?? null, dailyPrizes: this.dailyPrizes, wonToday: this.q.today.get(this.day()).n, tickers: this.tickers };
  }
}

/** Build from environment variables (see README "Real-stock prizes"). */
export function prizePoolFromEnv(store) {
  return new PrizePool({
    store,
    mode: process.env.PRIZE_MODE || 'off',
    signerKey: process.env.PRIZE_SIGNER_KEY,
    vault: process.env.PRIZE_VAULT,
    rpc: process.env.CHAIN_RPC || CHAIN.rpc,
    chainId: Number(process.env.CHAIN_ID || CHAIN.id),
    dailyPrizes: Number(process.env.PRIZE_DAILY || 5),
  });
}
