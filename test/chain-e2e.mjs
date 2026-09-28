// G13: the whole real-prize loop against a local fork of Robinhood Chain
// testnet, using the real stock token contracts. An agent plays over the
// public HTTP API exactly as an outside agent would.
//   node test/chain-e2e.mjs
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { VAULT_ABI } from '../src/shared/chain.js';
import { startFork } from './fork.mjs';

const GAME = 'http://127.0.0.1:5295';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fork, srv, n = 0;
const done = (code) => { srv?.close(); fork?.close(); process.exit(code); };
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); done(1); } };

fork = await startFork();
const { pub, fundEth, wallet, guardian, signerKey, vault, balanceOf, RPC } = fork;

// ---- game server wired to the fork
process.env.JOINS_PER_MIN = '100';
const { startServer } = await import('../server/index.mjs');
const { openDb } = await import('../server/db.mjs');
const { PrizePool } = await import('../server/prizes.mjs');
const store = openDb(join(mkdtempSync(join(tmpdir(), 'dbi-e2e-')), 'island.db'));
const prizes = new PrizePool({ store, mode: 'testnet', signerKey, vault, rpc: RPC, dailyPrizes: 5 });
srv = startServer({ port: 5295, vite: false, secret: 'e2e', store, prizes });
await wait(200);
const post = async (path, body) => (await fetch(GAME + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

async function agentWinsPrize(name) {
  const key = privateKeyToAccount(generatePrivateKey());
  await fundEth(key.address); // gas for collecting
  const j = await post('/api/join', { name });
  const act = (action, args) => post('/api/act', { token: j.token, action, args });
  const ch = await act('link_wallet_challenge');
  const linked = await act('link_wallet', { address: key.address, signature: await key.signMessage({ message: ch.message }) });
  assert.equal(linked.ok, true, JSON.stringify(linked));
  const me = (await act('state')).you;
  srv.game.chests.push({ id: `gold-${name}`, x: me.x, z: me.z, rarity: 'legendary', loot: { MOON: 70 } }); // a legendary at its feet
  const dug = await act('dig');
  assert.equal(dug.realPrize?.won, true, JSON.stringify(dug.realPrize));
  const list = await act('prizes');
  return { key, act, prize: list.prizes[0] };
}

let first;
await test('an agent links its wallet, digs a legendary chest and collects a real stock token on-chain', async () => {
  first = await agentWinsPrize('agent-one');
  const { key, prize } = first;
  const before = await balanceOf(prize.ticker, key.address);
  const hash = await wallet(key).sendTransaction({ to: prize.tx.to, data: prize.tx.data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  assert.equal(rc.status, 'success');
  assert.equal(await balanceOf(prize.ticker, key.address) - before, 10n ** 18n, `got 1 ${prize.ticker}`);
  const after = await first.act('prizes');
  assert.equal(after.prizes[0].status, 'claimed', 'prize list reads collection status from the chain');
});

await test('collecting the same voucher again fails', async () => {
  await assert.rejects(wallet(first.key).sendTransaction({ to: first.prize.tx.to, data: first.prize.tx.data }), /AlreadyUsed|revert/i);
});

await test('a voucher changed to pay someone else fails', async () => {
  const second = await agentWinsPrize('agent-two');
  const thief = privateKeyToAccount(generatePrivateKey());
  await fundEth(thief.address);
  const v = second.prize.voucher;
  await assert.rejects(wallet(thief).writeContract({ address: vault, abi: VAULT_ABI, functionName: 'claim', args: [{ to: thief.address, token: v.token, amount: BigInt(v.amount), id: BigInt(v.id), expiry: BigInt(v.expiry) }, second.prize.signature] }), /BadSignature|revert/i);
  // and anyone may still submit the real voucher: it pays the winner, not the sender
  const before = await balanceOf(second.prize.ticker, second.key.address);
  const h = await wallet(thief).sendTransaction({ to: second.prize.tx.to, data: second.prize.tx.data });
  await pub.waitForTransactionReceipt({ hash: h });
  assert.equal(await balanceOf(second.prize.ticker, second.key.address) - before, 10n ** 18n);
});

await test('an MCP agent (as Claude would use it) links its wallet and collects its prize with the MCP tools', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const key = generatePrivateKey(), acct = privateKeyToAccount(key);
  await fundEth(acct.address);
  const client = new Client({ name: 'e2e-prize', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: 'node', args: ['scripts/mcp.mjs'], env: { ...process.env, DBI_URL: GAME, DBI_NAME: 'mcp-winner', DBI_WALLET_KEY: key, DBI_CHAIN_RPC: RPC } }));
  const tool = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  try {
    assert.equal((await tool('link_wallet')).ok, true);
    const me = (await tool('get_state')).you;
    assert.equal(me.wallet, acct.address);
    srv.game.chests.push({ id: 'gold-mcp', x: me.x, z: me.z, rarity: 'legendary', loot: { MOON: 70 } });
    const dug = await tool('dig');
    assert.equal(dug.realPrize.won, true, JSON.stringify(dug.realPrize));
    const ticker = dug.realPrize.prize.ticker;
    const before = await balanceOf(ticker, acct.address);
    const c = await tool('collect_prize');
    assert.equal(c.ok, true, JSON.stringify(c));
    await pub.waitForTransactionReceipt({ hash: c.sent[0].tx });
    assert.equal(await balanceOf(ticker, acct.address) - before, 10n ** 18n);
    assert.equal((await tool('collect_prize')).ok, false, 'nothing left to collect');
  } finally { await client.close(); }
});

await test('when the guardian pauses the vault, collections fail', async () => {
  const third = await agentWinsPrize('agent-three');
  const h = await wallet(guardian).writeContract({ address: vault, abi: VAULT_ABI, functionName: 'pause' });
  await pub.waitForTransactionReceipt({ hash: h });
  await assert.rejects(wallet(third.key).sendTransaction({ to: third.prize.tx.to, data: third.prize.tx.data }), /EnforcedPause|revert/i);
});

console.log(`${n} tests\nCHAIN E2E OK`);
done(0);
