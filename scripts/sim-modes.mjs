// Headless agents playing Stock Critters and Insider over the public HTTP API.
//   node scripts/sim-modes.mjs [--seconds 45] [--url http://localhost:5180] [--assert]
// Local runs shorten the Insider phases so a couple of rounds fit in the window.
import { startServer } from '../server/index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', 45));
let BASE = arg('url', null), local = null;
if (!BASE) {
  local = startServer({ port: 5293, vite: false, secret: 'modes', gameOptions: { insider: { min: 4, lobby: 2, trade: 12, vote: 6, reveal: 2 } } });
  BASE = 'http://localhost:5293';
  await new Promise((r) => setTimeout(r, 300));
}
const post = async (path, body) => (await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + SECONDS * 1000;
const tally = { kills: 0, swings: 0, kos: 0, rounds: 0, trades: 0, votes: 0, insiderWins: 0, traderWins: 0 };

async function join(name) {
  const j = await post('/api/join', { name });
  return (action, args) => post('/api/act', { token: j.token, action, args });
}

// Fighter: walk up to the nearest critter, swing, back off when it winds up.
async function fighter(name) {
  const act = await join(name);
  while (Date.now() < deadline) {
    const { critters, safeZone } = await act('critters');
    const c = critters.filter((k) => k.kind === 'grunt')[0] ?? critters[0];
    if (!c) { await sleep(500); continue; }
    const st = await act('state');
    if (st.you.knockedOut) { tally.kos++; await sleep(4500); continue; }
    if (c.distance > 3) { await act('walk_to', { target: { x: c.x, z: c.z } }); continue; }
    for (let i = 0; i < 12 && Date.now() < deadline; i++) {
      const r = await act('attack', { target: c.id });
      if (r.ok) { tally.swings++; if (r.defeated) { tally.kills++; break; } }
      else if (r.error === 'cooldown') await sleep(r.wait * 1000 + 30);
      else break; // out of range, knocked out, ...
    }
  }
}

// Insider player: stays opted in, trades, votes. The insider buys the move.
async function trader(name) {
  const act = await join(name);
  await act('insider_join');
  const seen = new Set();
  while (Date.now() < deadline) {
    const s = await act('insider_status');
    if (s.phase === 'trading' && s.role) {
      const tk = s.move ? s.move.ticker : ['BLUP', 'MOON', 'FROG', 'DIGG', 'PUMP', 'WAGMI'][Math.floor(Math.random() * 6)];
      const r = await act('insider_trade', { ticker: tk, side: 'buy', shares: s.move ? 60 : 15 + Math.floor(Math.random() * 30) });
      if (r.ok) tally.trades++;
      await sleep(400);
    } else if (s.phase === 'voting' && s.role && !s.yourVote) {
      // suspect whoever put the most shares into a single ticker
      const by = {};
      for (const e of s.tape) if (e.who !== name) by[e.who] = Math.max(by[e.who] ?? 0, e.shares);
      const suspect = Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0] ?? s.members.find((m) => m !== name);
      const r = await act('insider_accuse', { name: suspect });
      if (r.ok) tally.votes++;
    } else if (s.phase === 'reveal' && s.result && !s.result.aborted && !seen.has(s.rounds)) {
      seen.add(s.rounds);
      if (name === 'trader-0') { tally.rounds++; s.result.winners === 'insider' ? tally.insiderWins++ : tally.traderWins++; }
    } else await sleep(300);
  }
}

await Promise.all([fighter('fighter-0'), fighter('fighter-1'), ...[...Array(5)].map((_, i) => trader(`trader-${i}`))]);
console.log(`critters: kills=${tally.kills} swings=${tally.swings} knockouts=${tally.kos} | insider: rounds=${tally.rounds} trades=${tally.trades} votes=${tally.votes} (insider won ${tally.insiderWins}, traders won ${tally.traderWins})`);
local?.close();
if (process.argv.includes('--assert')) {
  const ok = tally.kills >= 1 && tally.rounds >= 1 && tally.votes >= 4 && tally.trades >= 4;
  console.log(ok ? 'MODES OK' : 'MODES FAILED');
  process.exit(ok ? 0 : 1);
}
process.exit(0);
