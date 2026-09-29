// G33: the council can only change the world through the validated genome, and what it
// builds really changes the game.
//   node test/council-genome.mjs  -> GENOME OK
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
import { CATALOG } from '../server/council.mjs';
import { canStep, findPath, groundAt, PIER, SPAWN } from '../src/shared/world.js';

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n`, e); } };
const O = { propose: 5, debate: 3, vote: 3 };
const run = (g, s) => { for (let t = 0; t < s; t += 0.05) g.tick(0.05); };
const fresh = (seed) => { const g = new Game({ secret: seed, council: O }); const ps = ['A', 'B', 'C'].map((n) => g.join({ name: n })); ps.forEach((p) => { p.portfolio.MOON = 2000; }); return { g, c: g.council, ps }; };
/** pitch -> everyone votes yes and backs it -> close the epoch -> finish construction */
function enact({ g, c, ps }, args) {
  while (c.phase !== 'propose') run(g, 1);
  const r = g.act(ps[0].id, 'propose', args);
  if (!r.ok) return r;
  run(g, c.left + 0.1);
  for (const p of ps) g.act(p.id, 'council_vote', { id: r.id, vote: 'yes' });
  g.act(ps[1].id, 'pledge', { id: r.id, amount: r.cost + 50 });
  run(g, c.left + 0.1); run(g, c.left + 0.1);
  for (const s of c.structures) s.progress = 1;
  c.sync();
  return { ...r, status: c.proposals.find((q) => q.id === r.id)?.status };
}
const pitch = ({ g, ps }, args) => g.act(ps[2].id, 'propose', args);

await test('pitches outside the genome are refused with a reason an agent can act on', () => {
  const w = fresh('g1');
  assert.match(pitch(w, { kind: 'build', type: 'casino', x: 0, z: 0 }).error, /unknown building type.*town-hall/);
  assert.match(pitch(w, { kind: 'build', type: 'plaza', x: 0, z: 175 }).error, /outside the island|water/);
  assert.match(pitch(w, { kind: 'build', type: 'plaza', x: PIER.x, z: PIER.z0 + 10 }).error, /water|pier/);
  assert.match(pitch(w, { kind: 'build', type: 'plaza', x: SPAWN.x + 2, z: SPAWN.z - 2 }).error, /spawn|path|water|steep/);
  assert.match(pitch(w, { kind: 'build', type: 'exchange', x: 0, z: -96 }).error, /steep/); // a company hill
  assert.match(pitch(w, { kind: 'teleport', to: 'moon' }).error, /kind must be one of/);
  assert.match(pitch(w, { kind: 'rule', rule: 'legendaryRate', value: 1 }).error, /unknown rule/);
  assert.match(pitch(w, { kind: 'listing', ticker: 'NOPE', name: 'Nope Inc' }).error, /exchange first/);
});

await test('rules move one clamped step per pitch, inside their bounds', () => {
  const w = fresh('g2');
  const r = enact(w, { kind: 'rule', rule: 'chestCount', value: 999 });
  assert.equal(r.status, 'enacted'); assert.equal(w.c.rules.chestCount, 30, '24 + one step of 6, not 999');
  run(w.g, 1);
  assert.ok(w.g.chests.filter((c) => c.rarity !== 'bag').length >= 30, 'the island buries more chests right away');
});

await test('unique buildings, overlap and walls: the island stays connected', () => {
  const w = fresh('g3');
  const [s0, s1] = w.c.sites(2);
  assert.equal(enact(w, { kind: 'build', type: 'town-hall', x: s0.x, z: s0.z }).status, 'enacted');
  assert.match(pitch(w, { kind: 'build', type: 'town-hall', x: s1.x, z: s1.z }).error, /only one allowed/);
  assert.match(pitch(w, { kind: 'build', type: 'market', x: s0.x + 4, z: s0.z }).error, /too close/);
  // ring a meadow with shelters, leaving one gap: plugging the gap would wall it off
  const w2 = fresh('g3b'), C = w2.c.sites(1)[0], R = 17;
  for (let k = 1; k < 18; k++) w2.c.structures.push({ id: `r${k}`, type: 'shelter', x: C.x + Math.sin((k / 18) * 6.283) * R, z: C.z + Math.cos((k / 18) * 6.283) * R, rot: 0, level: 1, progress: 1 });
  w2.c.sync();
  const gap = pitch(w2, { kind: 'build', type: 'shelter', x: C.x, z: C.z + R });
  assert.match(gap.error ?? '', /wall off|too close/, JSON.stringify(gap));
});

await test('buildings are walls once placed; walkers path around them', () => {
  const w = fresh('g4');
  const s = w.c.sites(1)[0];
  enact(w, { kind: 'build', type: 'bank', x: s.x, z: s.z });
  const b = w.c.structures[0], r = CATALOG.bank.r;
  assert.equal(canStep(b.x - r - 0.3, b.z, b.x - r + 0.1, b.z), false, 'cannot step into the walls');
  assert.equal(canStep(b.x - r - 3, b.z, b.x - r - 2.6, b.z), true, 'free to walk up to them');
  const path = findPath(b.x - r - 4, b.z, b.x + r + 4, b.z);
  assert.ok(path && path.every((pt) => Math.hypot(pt.x - b.x, pt.z - b.z) > r - 0.5), 'the path goes around');
});

await test('a town hall moves the meeting circle off the beach', () => {
  const w = fresh('g5');
  const before = { ...w.g.insider.spot };
  const s = w.c.sites(1)[0];
  enact(w, { kind: 'build', type: 'town-hall', x: s.x, z: s.z, name: 'Council Hall' });
  const spot = w.g.insider.spot;
  assert.ok(Math.hypot(spot.x - before.x, spot.z - before.z) > 20, 'moved');
  assert.ok(Math.hypot(spot.x - s.x, spot.z - s.z) < 20 && groundAt(spot.x, spot.z) > 1, 'in front of the hall, on land');
  assert.ok(w.g.landmarks().some((l) => l.name === 'Council Hall'), 'the hall is a landmark agents can walk to');
});

await test('a survey tower stretches the detector; a beacon draws chests; a market recycles junk; roads are faster', async () => {
  const w = fresh('g6');
  const [a, b, c2, d] = w.c.sites(4);
  enact(w, { kind: 'build', type: 'survey-tower', x: a.x, z: a.z });
  const p = w.ps[0];
  p.x = a.x + 6; p.z = a.z; w.g.chests = [{ id: 'far', x: p.x + 33, z: p.z, rarity: 'common', loot: { MOON: 5 } }];
  const withTower = w.g.act(p.id, 'detect').bars;
  w.c.structures.length = 0; w.c.sync(); w.g.t += 1;
  assert.equal(w.g.act(p.id, 'detect').bars, 0, 'out of range without the tower');
  assert.ok(withTower >= 1, `in range with the tower (${withTower} bars)`);

  enact(w, { kind: 'build', type: 'beacon', x: b.x, z: b.z });
  w.g.chests = [];
  for (let k = 0; k < 200; k++) w.g.spawnChest();
  const near = w.g.chests.filter((ch) => Math.hypot(ch.x - b.x, ch.z - b.z) < 45).length;
  assert.ok(near / 200 > 0.25, `beacon draws chests (${near}/200 within 45m)`);

  enact(w, { kind: 'build', type: 'market', x: c2.x, z: c2.z });
  const q = w.ps[1]; q.x = c2.x + 12; q.z = c2.z; w.g.chests = []; w.g.rnd = () => 0.01; w.c.rules.junkChance = 0.7;
  const dig = w.g.act(q.id, 'dig'); run(w.g, 3);
  const res = await dig;
  assert.ok(res.junk && res.recycled, `junk recycled into stock (${JSON.stringify(res)})`);

  enact(w, { kind: 'build', type: 'road', x: d.x - 30, z: d.z, x2: d.x + 30, z2: d.z });
  const t = w.ps[2];
  const time = (onRoad) => { t.x = d.x - 25; t.z = onRoad ? d.z : d.z + 8; t.path = null; t.move = { dx: 1, dz: 0 }; const x0 = t.x; run(w.g, 2); t.move = null; return t.x - x0; };
  const on = time(true), off = time(false);
  assert.ok(on > off * 1.2, `faster on the road (${on.toFixed(1)}m vs ${off.toFixed(1)}m)`);
});

await test('listings need an exchange, never real tickers, and then show up in chests', () => {
  const w = fresh('g7');
  const s = w.c.sites(1)[0];
  enact(w, { kind: 'build', type: 'exchange', x: s.x, z: s.z });
  assert.match(pitch(w, { kind: 'listing', ticker: 'TSLA', name: 'Tesla' }).error, /real company/);
  const r = enact(w, { kind: 'listing', ticker: 'BEAN', name: 'Bean Holdings', price: 3 });
  assert.equal(r.status, 'enacted');
  assert.ok(w.g.market.some((m) => m.ticker === 'BEAN'));
  w.g.chests = []; for (let k = 0; k < 120; k++) w.g.spawnChest();
  assert.ok(w.g.chests.some((c) => c.loot.BEAN), 'chests can hold the new stock');
});

await test('ideas go on the wishlist (never into code); upgrades and demolitions work; events run', async () => {
  const w = fresh('g8');
  const r = enact(w, { kind: 'idea', text: 'let us build boats and race around the island' });
  assert.equal(r.status, 'passed');
  assert.match(w.c.wishlist[0].text, /boats/);
  const s = w.c.sites(1)[0];
  enact(w, { kind: 'build', type: 'plaza', x: s.x, z: s.z });
  const id = w.c.structures[0].id;
  enact(w, { kind: 'upgrade', target: id });
  assert.equal(w.c.structures[0].level, 2);
  enact(w, { kind: 'demolish', target: id });
  assert.equal(w.c.structures.length, 0);
  enact(w, { kind: 'event', event: 'festival' });
  assert.ok(w.c.eventOn('festival'));
  const p = w.ps[0]; w.c.rules.lootTax = 0;
  w.g.chests = [{ id: 'f', x: p.x, z: p.z, rarity: 'common', loot: { MOON: 10 } }];
  const dig = w.g.act(p.id, 'dig'); run(w.g, 3);
  assert.equal((await dig).loot.MOON, 20, 'festival doubles loot');
  const before = w.g.chests.length;
  enact(w, { kind: 'event', event: 'treasure-rush', x: s.x, z: s.z });
  assert.ok(w.g.chests.filter((c) => Math.hypot(c.x - s.x, c.z - s.z) < 32).length >= 6, 'a treasure rush buries chests nearby');
  assert.ok(w.g.chests.length >= before);
});

console.log(failed ? `GENOME FAILED (${failed})` : 'GENOME OK');
process.exit(failed ? 1 : 0);
