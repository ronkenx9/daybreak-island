// Soak test: bots play fast-forwarded game-hours against the Game directly (no
// HTTP) and we flag any bot that gets stuck, trapped, or kicked.
//   node scripts/soak.mjs [--bots 12] [--hours 1] [--runs 5]
import { Game } from '../server/game.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const BOTS = arg('bots', 12), SECONDS = arg('hours', 1) * 3600, RUNS = arg('runs', 5), DT = 0.05;
const yieldNow = () => new Promise((r) => setImmediate(r));

async function soak() {
  let clock = 0;
  const g = new Game({ now: () => clock * 1000 });
  const pending = new Map(), problems = [];
  const bots = [...Array(BOTS)].map((_, i) => ({ i, id: g.join({ name: `soak-${i}`, kind: 'agent' }).id, found: 0, failed: 0 }));
  const act = (b, action, args) => {
    pending.set(b.i, { action, t0: clock });
    return Promise.resolve(g.act(b.id, action, args)).then((r) => { pending.delete(b.i); return r; });
  };
  // Insider meetings: vote skip, then wait (in game time) until it's over
  async function meeting(b) {
    g.act(b.id, 'vote', { who: 'skip' });
    while (g.insider.phase === 'meeting' && clock < SECONDS) await yieldNow();
  }
  // same treasure-hunting brain as scripts/sim.mjs
  async function brain(b) {
    let heading = Math.random() * Math.PI * 2;
    while (clock < SECONDS) {
      await yieldNow();
      const s = await act(b, 'state');
      if (!s.ok) { problems.push(`soak-${b.i} was removed from the game: ${s.error}`); return; }
      const me = s.you, d = await act(b, 'detect');
      if (d.bars >= 5) { const r = await act(b, 'dig'); if (r.found) b.found++; if (r.error && /meeting/.test(r.error)) await meeting(b); continue; }
      if (d.bars === 0) {
        heading += (Math.random() - 0.5) * 1.6;
        const target = { x: me.x + Math.sin(heading) * 30, z: me.z + Math.cos(heading) * 30 };
        const w = await act(b, 'walk_to', { target });
        if (w.error && /meeting/.test(w.error)) { await meeting(b); continue; }
        if (w.error && process.env.SOAK_LOG) (await import('node:fs')).appendFileSync(process.env.SOAK_LOG, `${me.x.toFixed(1)},${me.z.toFixed(1)},${target.x.toFixed(1)},${target.z.toFixed(1)},${w.error}\n`);
        // blocked (usually the sea or a cliff): turn back toward the middle of the island
        if (!w.ok) { heading = Math.atan2(-me.x, -me.z) + (Math.random() - 0.5) * 0.8; if (w.error) { b.failed++; b.why = `${w.error} at (${me.x.toFixed(1)}, ${me.z.toFixed(1)})`; } }
        continue;
      }
      const step = d.bars >= 4 ? 1.6 : d.bars >= 2 ? 3.5 : 6;
      let best = { sig: d.signal, x: me.x, z: me.z };
      for (let k = 0; k < 4; k++) {
        const a = heading + (k * Math.PI) / 2;
        const w = await act(b, 'walk_to', { target: { x: me.x + Math.sin(a) * step, z: me.z + Math.cos(a) * step } });
        if (!w.ok) continue;
        const p = await act(b, 'detect'), st = await act(b, 'state');
        if (p.signal > best.sig) best = { sig: p.signal, x: st.you.x, z: st.you.z, a };
      }
      if (best.a !== undefined) heading = best.a;
      await act(b, 'walk_to', { target: { x: best.x, z: best.z } });
    }
  }
  bots.forEach(brain);
  const flagged = new Set();
  for (let k = 0; clock < SECONDS; k++) {
    g.tick(DT); clock += DT;
    if (k % 20) continue;
    await yieldNow();
    for (const [i, p] of pending) if (clock - p.t0 > 60 && !flagged.has(i)) {
      flagged.add(i);
      const pl = g.players.get(bots[i].id);
      problems.push(`soak-${i} stuck on ${p.action} for 60s at (${pl.x.toFixed(1)}, ${pl.z.toFixed(1)})`);
    }
  }
  for (const b of bots) if (b.failed > 100) { const p = g.players.get(b.id); problems.push(`soak-${b.i} trapped: ${b.failed} walks failed at (${p?.x.toFixed(1)}, ${p?.z.toFixed(1)}); last: ${b.why}`); }
  return { chests: bots.reduce((a, b) => a + b.found, 0), low: bots.filter((b) => b.found < 5).length, problems };
}

let bad = 0;
for (let r = 1; r <= RUNS; r++) {
  const { chests, low, problems } = await soak();
  console.log(`run ${r}: ${BOTS} bots, ${SECONDS / 3600}h, ${chests} chests, ${low} bots under 5 chests`);
  for (const p of problems) console.log(`  ${p}`);
  bad += problems.length + low;
}
console.log(bad ? 'SOAK FAILED' : 'SOAK OK');
process.exit(bad ? 1 : 0);
