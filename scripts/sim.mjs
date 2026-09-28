// Headless agents playing Treasure Hunt over the public HTTP API, exactly as
// an AI agent would. No browser, no humans.
//   node scripts/sim.mjs --agents 6 --seconds 60 [--url http://localhost:5180] [--assert]
import { startServer } from '../server/index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const AGENTS = Number(arg('agents', 6)), SECONDS = Number(arg('seconds', 60));
let BASE = arg('url', null), local = null;
if (!BASE) { local = startServer({ port: 5290, vite: false, secret: 'sim' }); BASE = 'http://localhost:5290'; await new Promise((r) => setTimeout(r, 300)); }

const post = async (path, body) => (await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

// A simple treasure-hunting brain: sweep toward new ground, climb the
// detector signal, dig when it maxes out.
// If the server restarts (dev reloads, a stopped preview), the bot waits and
// rejoins instead of crashing.
async function bot(i, deadline) {
  const tally = { found: 0, digs: 0 };
  let token = null;
  while (Date.now() < deadline) {
    try {
      token = null;
      await play(i, deadline, tally, (t) => { token = t; });
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (token) await post('/api/leave', { token }).catch(() => {});
  return tally;
}

async function play(i, deadline, tally, setToken) {
  const j = await post('/api/join', { name: `bot-${i}` });
  if (!j.token) throw new Error('join failed');
  setToken(j.token);
  const act = async (action, args) => {
    const r = await post('/api/act', { token: j.token, action, args });
    if (r.error && /token|unknown player/i.test(r.error)) throw new Error(r.error); // server forgot us
    return r;
  };
  let heading = Math.random() * Math.PI * 2;
  await act('say', { text: `bot-${i} reporting for digging` });
  while (Date.now() < deadline) {
    const s = await act('state');
    const me = s.you;
    const d = await act('detect');
    if (d.bars >= 5) {
      tally.digs++;
      const r = await act('dig');
      if (r.found) { tally.found++; await act('emote', { name: 'cheer' }); }
      continue;
    }
    if (d.bars === 0) {
      // roam: pick a far point in the current heading
      heading += (Math.random() - 0.5) * 1.6;
      const tx = me.x + Math.sin(heading) * 30, tz = me.z + Math.cos(heading) * 30;
      const w = await act('walk_to', { target: { x: tx, z: tz } });
      if (!w.ok) heading += Math.PI / 2;
      continue;
    }
    // climb the signal: probe 4 directions with short steps
    const step = d.bars >= 4 ? 1.6 : d.bars >= 2 ? 3.5 : 6;
    let best = { sig: d.signal, x: me.x, z: me.z };
    for (let k = 0; k < 4; k++) {
      const a = heading + (k * Math.PI) / 2;
      const w = await act('walk_to', { target: { x: me.x + Math.sin(a) * step, z: me.z + Math.cos(a) * step } });
      if (!w.ok) continue;
      const p = await act('detect');
      const st = await act('state');
      if (p.signal > best.sig) best = { sig: p.signal, x: st.you.x, z: st.you.z, a };
    }
    if (best.a !== undefined) heading = best.a;
    await act('walk_to', { target: { x: best.x, z: best.z } });
  }
}

const deadline = Date.now() + SECONDS * 1000;
const t0 = Date.now();
const results = await Promise.all([...Array(AGENTS)].map((_, i) => bot(i, deadline)));
const total = results.reduce((a, r) => a + r.found, 0);
const board = await (await fetch(BASE + '/api/leaderboard')).json();
console.log(`agents=${AGENTS} seconds=${Math.round((Date.now() - t0) / 1000)} chests=${total} digs=${results.reduce((a, r) => a + r.digs, 0)}`);
results.forEach((r, i) => console.log(`  bot-${i}: ${r.found} chests, ${r.digs} digs`));
local?.close();
if (process.argv.includes('--assert')) {
  if (total >= Math.max(3, Math.floor(AGENTS / 2))) console.log('SIM OK');
  else { console.log(`SIM FAILED: only ${total} chests found`); process.exit(1); }
}
process.exit(0);
