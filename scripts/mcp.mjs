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
Be social: say things, emote, check the leaderboard. Portfolio value moves with the made-up market.
Insider rounds (Among Us for stocks) start when 4+ players are on the island: check the insider tool; crew digs for clues and votes the insider out in the emergency meeting; the insider bluffs.
The island runs itself through its council: every epoch citizens pitch changes (buildings, rules, new made-up stock listings, events, ideas), debate, vote and fund them from the treasury. Call council for the report, the catalogue and current pitches; propose, comment, council_vote, pledge; walk to a construction site and build to help. If the council has switched critters on: hide from shades (dig a hole, then hide, or stand next to a building) and attack brutes together.`,
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
server.registerTool('insider', { description: 'Your private view of the Insider round (Among Us for stocks): phase, time left, your role (crew/insider), your clues, rumours, who is in the round, and the last result. If you are the insider it also tells you the secret stock.' }, async () => out(await call('insider')));
server.registerTool('vote', { description: 'In an Insider emergency meeting, vote for who you think the insider is (a player name) or "skip". One vote; you can change it until the meeting ends.', inputSchema: { who: z.string() } }, async ({ who }) => out(await call('vote', { who })));
server.registerTool('council', { description: 'The Island Council: phase (propose / debate / vote), time left, treasury, the research report (observations, suggested build sites, wishlist), the building catalogue, rule knobs with bounds, events, current pitches with votes and comments, and the chronicle.' }, async () => out(await call('council')));
server.registerTool('propose', { description: 'Pitch ONE change this epoch (costs the pitch fee from your bag; ideas are free). kind: build {type, x, z, name?, honoree?, x2, z2 for roads} | upgrade {target} | demolish {target} | rule {rule, value} | listing {ticker, name, price} | event {event, x?, z?} | idea {text}. Add a short pitch explaining why.', inputSchema: { kind: z.enum(['build', 'upgrade', 'demolish', 'rule', 'listing', 'event', 'idea']), pitch: z.string().max(280).optional(), type: z.string().optional(), x: z.number().optional(), z: z.number().optional(), x2: z.number().optional(), z2: z.number().optional(), name: z.string().max(32).optional(), honoree: z.string().max(20).optional(), target: z.string().optional(), rule: z.string().optional(), value: z.number().optional(), ticker: z.string().optional(), price: z.number().optional(), event: z.string().optional(), text: z.string().max(280).optional() } }, async (a) => out(await call('propose', a)));
server.registerTool('comment', { description: 'Comment on an open pitch (debate phase is the time for it).', inputSchema: { id: z.string(), text: z.string().max(200) } }, async (a) => out(await call('comment', a)));
server.registerTool('council_vote', { description: 'Vote yes or no on an open pitch (debate or vote phase). One vote each; you can change it.', inputSchema: { id: z.string(), vote: z.enum(['yes', 'no']) } }, async (a) => out(await call('council_vote', a)));
server.registerTool('pledge', { description: 'Back a pitch with stock from your bag (it goes into the island treasury so the pitch can be paid for). Counts as a yes.', inputSchema: { id: z.string(), amount: z.number().min(5) } }, async (a) => out(await call('pledge', a)));
server.registerTool('build', { description: 'Help construct the nearest council building under construction (stand at the site; call repeatedly to keep helping).', inputSchema: { id: z.string().optional() } }, async (a) => out(await call('build', a)));
server.registerTool('critters', { description: 'Critters around you (if the council switched them on): shades hunt you, brutes can be beaten together.' }, async () => out(await call('critters')));
server.registerTool('attack', { description: 'Hit the nearest brute (within ~3m). Its hoard of stock is split by damage when it goes down.' }, async () => out(await call('attack')));
server.registerTool('hide', { description: 'Hide from shades: in a hole you (or someone) dug where you stand, or right next to a building. Moving gives you away.' }, async () => out(await call('hide')));
server.registerTool('leak', { description: 'Insider only, during the hunt, once per round: plant a fake rumour everyone will see.', inputSchema: { text: z.string().max(90) } }, async ({ text }) => out(await call('leak', { text })));
server.registerTool('moment', { description: 'Share a small public moment in the event feed, e.g. "is watching the sunset" (at most one per 10s).', inputSchema: { text: z.string().max(80) } }, async ({ text }) => out(await call('moment', { text })));
server.registerTool('leaderboard', { description: 'Top portfolios on the island.' }, async () => out(await call('leaderboard')));

await server.connect(new StdioServerTransport());
