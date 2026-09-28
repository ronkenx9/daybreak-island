// G12: real-prize rules on the server (no chain needed).
//   node test/prizes.mjs
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData, recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { openDb } from '../server/db.mjs';
import { PrizePool } from '../server/prizes.mjs';
import { Game } from '../server/game.mjs';
import { VAULT_ABI, VOUCHER_TYPES, voucherDomain } from '../src/shared/chain.js';

const dbPath = join(mkdtempSync(join(tmpdir(), 'dbi-prizes-')), 'island.db');
let clock = Date.UTC(2026, 8, 28, 12);
const now = () => clock;
const signerKey = generatePrivateKey();
const signer = privateKeyToAccount(signerKey).address;
const vault = privateKeyToAccount(generatePrivateKey()).address;
const opts = { mode: 'testnet', signerKey, vault, rpc: 'http://127.0.0.1:9', dailyPrizes: 5, now };
let store = openDb(dbPath);
let pool = new PrizePool({ store, ...opts });
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); process.exit(1); } };
const player = (name) => ({ id: `id-${name}`, name, wallet: null });
const linkWith = async (p, account = privateKeyToAccount(generatePrivateKey())) => {
  const message = pool.challenge(p);
  const signature = await account.signMessage({ message });
  return { r: await pool.link(p, { address: account.address, signature }), account };
};

await test('no linked wallet means no real prize', async () => {
  const r = await pool.award(player('nowallet'));
  assert.equal(r.won, false); assert.match(r.reason, /link a wallet/);
});

await test('linking needs a fresh challenge signed by that wallet, and each challenge works once', async () => {
  const p = player('linker');
  const a = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
  assert.equal((await pool.link(p, { address: a.address, signature: '0x00' })).ok, false, 'no challenge');
  let message = pool.challenge(p);
  assert.equal((await pool.link(p, { address: a.address, signature: await other.signMessage({ message }) })).ok, false, 'signed by another wallet');
  assert.equal((await pool.link(p, { address: a.address, signature: await a.signMessage({ message }) })).ok, false, 'challenge was used up by the failed try');
  message = pool.challenge(p);
  clock += 11 * 60_000;
  assert.equal((await pool.link(p, { address: a.address, signature: await a.signMessage({ message }) })).ok, false, 'expired challenge');
  message = pool.challenge(p);
  const sig = await a.signMessage({ message });
  const ok = await pool.link(p, { address: a.address, signature: sig });
  assert.equal(ok.ok, true); assert.equal(p.wallet, a.address);
  assert.equal((await pool.link(p, { address: a.address, signature: sig })).ok, false, 'replayed signature');
});

const winners = [];
await test('the daily pool pays at most 5 prizes, one per wallet', async () => {
  for (let i = 0; i < 6; i++) { const p = player(`w${i}`); await linkWith(p); winners.push(p); }
  const results = [];
  for (const p of winners) results.push(await pool.award(p));
  assert.equal(results.filter((r) => r.won).length, 5);
  assert.match(results[5].reason, /pool is empty/);
  const again = await pool.award(winners[0]);
  assert.equal(again.won, false);
});

await test('a second prize for the same wallet on the same day is refused', async () => {
  const s2 = openDb(join(mkdtempSync(join(tmpdir(), 'dbi-prizes-')), 'x.db'));
  const p2 = new PrizePool({ store: s2, ...opts });
  const p = player('greedy');
  const acct = privateKeyToAccount(generatePrivateKey());
  const m = p2.challenge(p); await p2.link(p, { address: acct.address, signature: await acct.signMessage({ message: m }) });
  assert.equal((await p2.award(p)).won, true);
  const r = await p2.award(p);
  assert.equal(r.won, false); assert.match(r.reason, /already won today/);
});

await test('vouchers are signed by the prize signer for this chain and vault, with a ready transaction', async () => {
  const { prizes } = await pool.list(winners[0]);
  assert.equal(prizes.length, 1);
  const v = prizes[0];
  const message = { ...v.voucher, amount: BigInt(v.voucher.amount), id: BigInt(v.voucher.id), expiry: BigInt(v.voucher.expiry) };
  const who = await recoverTypedDataAddress({ domain: voucherDomain(46630, vault), types: VOUCHER_TYPES, primaryType: 'Voucher', message, signature: v.signature });
  assert.equal(who, signer);
  assert.equal(v.tx.to, vault); assert.equal(v.tx.chainId, 46630);
  const { functionName, args } = decodeFunctionData({ abi: VAULT_ABI, data: v.tx.data });
  assert.equal(functionName, 'claim'); assert.equal(args[0].to, winners[0].wallet); assert.equal(args[0].amount, 10n ** 18n);
  assert.ok(BigInt(v.id) > 2n ** 64n, 'voucher ids are random 128-bit, not guessable counters');
});

await test('limits survive a server restart, and reset the next UTC day', async () => {
  store.close();
  store = openDb(dbPath);
  pool = new PrizePool({ store, ...opts });
  assert.equal(pool.stats().wonToday, 5);
  const late = player('late'); await linkWith(late);
  assert.equal((await pool.award(late)).won, false, 'still empty after restart');
  const already = winners[1]; already.wallet = (await pool.list(already)).wallet; // same wallet, new session
  clock += 24 * 3600_000;
  assert.equal((await pool.award(late)).won, true, 'new day, new pool');
  assert.equal((await pool.award(already)).won, true, 'yesterday\'s winner can win again today');
});

await test('the ledger is append-only', async () => {
  const rows = store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE kind = 'prize'").get().n;
  assert.ok(rows >= 7);
  assert.throws(() => store.db.exec("DELETE FROM ledger"), /append-only/);
  assert.throws(() => store.db.exec("UPDATE ledger SET wallet = 'x'"), /append-only/);
});

await test('mode off never issues vouchers or links wallets', async () => {
  const off = new PrizePool({ store: openDb(':memory:'), mode: 'off', now });
  const p = player('offp'); p.wallet = '0x000000000000000000000000000000000000dEaD';
  assert.equal((await off.award(p)).won, false);
  const g = new Game({ secret: 't', prizes: off });
  const me = g.join({ name: 'offp' });
  assert.equal((await g.act(me.id, 'link_wallet_challenge')).ok, false);
  assert.equal((await g.act(me.id, 'prizes')).ok, false);
});

await test('in the game: digging a legendary chest with a linked wallet wins a real prize and announces it', async () => {
  const s3 = openDb(':memory:');
  const pool3 = new PrizePool({ store: s3, ...opts });
  const g = new Game({ secret: 'legend', prizes: pool3, now });
  const me = g.join({ name: 'digger' });
  const acct = privateKeyToAccount(generatePrivateKey());
  const { message } = await g.act(me.id, 'link_wallet_challenge');
  assert.equal((await g.act(me.id, 'link_wallet', { address: acct.address, signature: await acct.signMessage({ message }) })).ok, true);
  g.chests.push({ id: 'gold', x: me.x, z: me.z, rarity: 'legendary', loot: { MOON: 80 } });
  const dug = g.act(me.id, 'dig');
  for (let i = 0; i < 40; i++) g.tick(0.05);
  const r = await dug;
  assert.equal(r.found, true); assert.equal(r.rarity, 'legendary');
  assert.equal(r.realPrize.won, true, JSON.stringify(r.realPrize));
  assert.ok(!Object.keys(r.loot).some((t) => ['TSLA', 'AMZN', 'NFLX', 'PLTR', 'AMD'].includes(t)), 'no real stock in chest loot');
  assert.ok(g.events.some((e) => e.kind === 'prize' && e.who === 'digger'));
  const list = await g.act(me.id, 'prizes');
  assert.equal(list.prizes.length, 1);
});

console.log(`${n} tests\nPRIZES OK`);
process.exit(0);
