#!/usr/bin/env node
// MCP server: an AI agent joins Daybreak Island as its own character and plays.
//   DBI_URL (default http://localhost:5180), DBI_NAME (default "claude")
//   DBI_WALLET_KEY (optional) the agent's own wallet private key, used to link
//     the wallet and collect real-stock prizes. Keep it in a secret store; it
//     needs a little Robinhood Chain testnet ETH for gas.
//   DBI_CHAIN_RPC (optional) override the chain RPC
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN } from '../src/shared/chain.js';

const BASE = (process.env.DBI_URL ?? 'http://localhost:5180').replace(/\/$/, '');
let session = null;

async function call(action, args = {}) {
  if (!session) await join({});
  let r = await fetch(`${BASE}/api/act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: session.token, action, args }) });
  if (r.status === 401) { await join({}); r = await fetch(`${BASE}/api/act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: session.token, action, args }) }); }
  return r.json();
}
async function join({ name, look }) {
  const r = await fetch(`${BASE}/api/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name ?? process.env.DBI_NAME ?? 'claude', look }) });
  session = await r.json();
  return session;
}
// the agent's own wallet (never sent to the game server; only signatures are)
const walletKey = process.env.DBI_WALLET_KEY;
const account = walletKey ? privateKeyToAccount(walletKey) : null;
const chainRpc = process.env.DBI_CHAIN_RPC || CHAIN.rpc;
const walletClient = (chainId) => createWalletClient({ account, chain: { id: chainId, name: CHAIN.name, nativeCurrency: CHAIN.currency, rpcUrls: { default: { http: [chainRpc] } } }, transport: http(chainRpc) });
const noWallet = { ok: false, error: 'set DBI_WALLET_KEY (your agent wallet key) in the MCP server env to link a wallet and collect real stock' };
const out = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }], isError: o?.ok === false });

const server = new McpServer({ name: 'daybreak-island', version: '0.1.0' }, {
  instructions: `You are a Daybreak character on Daybreak Island playing Treasure Hunt with humans and other agents.
Chests of made-up stocks ($BLUP, $MOON, $FROG, $DIGG, $PUMP, $WAGMI) are buried around the island. Legendary chests also win a real tokenized stock (TSLA, AMZN, NFLX, PLTR, AMD on Robinhood Chain) from a small daily pool if you linked a wallet: call link_wallet once, then collect_prize after a win.
Loop: detect (bars 0-5 rise as you get closer) -> move toward rising bars -> dig when bars = 5. Use walk_to for longer trips (it pathfinds around cliffs).
Be social: say things, emote, check the leaderboard. Portfolio value moves with the made-up market.`,
});

server.registerTool('join', { description: 'Join the island as a new character (optional name and look: racer, midnight, electric, cloud, orbit, afterhours).', inputSchema: { name: z.string().max(20).optional(), look: z.string().optional() } }, async (a) => out(await join(a)));
server.registerTool('get_state', { description: 'Your position, detector, portfolio, the made-up stock market, nearby players and recent events.' }, async () => out(await call('state')));
server.registerTool('look', { description: 'Nearby players, recently dug holes and landmarks.' }, async () => out(await call('look')));
server.registerTool('landmarks', { description: 'Named places: spawn and the five company mesas (TSLA, AMZN, NFLX, PLTR, AMD).' }, async () => out(await call('landmarks')));
server.registerTool('walk_to', { description: 'Pathfind to a landmark name, a player name, or {x, z}. Waits until you arrive or get blocked.', inputSchema: { target: z.union([z.string(), z.object({ x: z.number(), z: z.number() })]) } }, async ({ target }) => out(await call('walk_to', { target })));
server.registerTool('step', { description: 'Take a short step in a compass direction (for fine searching). distance in metres, default 3.', inputSchema: { direction: z.enum(['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest']), distance: z.number().min(0.5).max(20).optional() } }, async ({ direction, distance = 3 }) => {
  const v = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [0.707, -0.707], northwest: [-0.707, -0.707], southeast: [0.707, 0.707], southwest: [-0.707, 0.707] }[direction];
  const s = await call('state');
  return out(await call('walk_to', { target: { x: s.you.x + v[0] * distance, z: s.you.z + v[1] * distance } }));
});
server.registerTool('detect', { description: 'Use the metal detector. Returns signal 0-1 and bars 0-5 (5 = dig here).' }, async () => out(await call('detect')));
server.registerTool('dig', { description: 'Dig where you stand (takes ~1s). Finds the chest if one is within reach.' }, async () => out(await call('dig')));
server.registerTool('say', { description: 'Speech bubble above your character, seen by everyone.', inputSchema: { text: z.string().max(140) } }, async (a) => out(await call('say', a)));
server.registerTool('emote', { description: 'Emote: wave, cheer, sad, dance, shrug.', inputSchema: { name: z.enum(['wave', 'cheer', 'sad', 'dance', 'shrug']) } }, async (a) => out(await call('emote', a)));
server.registerTool('link_wallet', { description: 'Link your agent wallet (from DBI_WALLET_KEY) so legendary chests can win real tokenized stock. Signs a one-time message; moves no funds.' }, async () => {
  if (!account) return out(noWallet);
  const ch = await call('link_wallet_challenge');
  if (!ch.ok) return out(ch);
  return out(await call('link_wallet', { address: account.address, signature: await account.signMessage({ message: ch.message }) }));
});
server.registerTool('prizes', { description: 'Your real-stock prizes (issued, claimed or expired).' }, async () => {
  const r = await call('prizes');
  if (r.ok) r.prizes = r.prizes.map(({ tx, signature, voucher, ...p }) => p); // keep the listing short
  return out(r);
});
server.registerTool('collect_prize', { description: 'Collect a won real-stock prize to your wallet on Robinhood Chain (sends one transaction, needs a little testnet ETH for gas). Omit id to collect every uncollected prize.', inputSchema: { id: z.string().optional() } }, async ({ id }) => {
  if (!account) return out(noWallet);
  const r = await call('prizes');
  if (!r.ok) return out(r);
  const todo = r.prizes.filter((p) => p.status === 'issued' && (!id || p.id === id));
  if (!todo.length) return out({ ok: false, error: id ? 'no uncollected prize with that id' : 'nothing to collect' });
  const sent = [];
  for (const p of todo) {
    try { sent.push({ id: p.id, ticker: p.ticker, tx: await walletClient(p.tx.chainId).sendTransaction({ to: p.tx.to, data: p.tx.data }) }); }
    catch (e) { sent.push({ id: p.id, ticker: p.ticker, error: e.shortMessage ?? e.message }); }
  }
  return out({ ok: sent.some((s) => s.tx), sent, explorer: CHAIN.explorer });
});
server.registerTool('leaderboard', { description: 'Top portfolios on the island.' }, async () => out(await call('leaderboard')));

await server.connect(new StdioServerTransport());
