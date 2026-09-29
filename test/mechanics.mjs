// G20: gameplay mechanics on the server.
//   node test/mechanics.mjs
import assert from 'node:assert/strict';
import { Game, JUNK, streakMultiplier } from '../server/game.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); process.exit(1); } };
const run = (g, s) => { for (let i = 0; i < s * 20; i++) g.tick(0.05); };
async function dig(g, id) { const r = g.act(id, 'dig'); run(g, 2); return r; }
const chestAt = (g, p, rarity = 'common', loot = { MOON: 10 }) => {
  const id = `t${Math.random()}`;
  g.chests.push({ id, x: p.x + Math.sin(p.heading) * 0.5, z: p.z + Math.cos(p.heading) * 0.5, rarity, loot });
  return id;
};
const clearNear = (g, p) => { g.chests = g.chests.filter((c) => Math.hypot(c.x - p.x, c.z - p.z) > 30); };

await test('detector readings refresh at most 4x a second; faster calls get the last reading, not an error', async () => {
  const g = new Game({ secret: 'm1' });
  const p = g.join({ name: 'scanner' });
  const a = await g.act(p.id, 'detect');
  assert.equal(a.ok, true); assert.equal(a.cached, undefined);
  const b = await g.act(p.id, 'detect');
  assert.equal(b.ok, true); assert.equal(b.cached, true); assert.equal(b.bars, a.bars);
  run(g, 0.3);
  assert.equal((await g.act(p.id, 'detect')).cached, undefined);
});

await test('digging where nothing is buried often turns up junk', async () => {
  const g = new Game({ secret: 'm2' });
  const p = g.join({ name: 'unlucky' });
  let junk = 0, nothing = 0;
  for (let i = 0; i < 40; i++) {
    clearNear(g, p);
    const r = await dig(g, p.id);
    assert.equal(r.found, false);
    if (r.junk) { junk++; assert.ok(JUNK[r.junk]); assert.match(r.hint, new RegExp(JUNK[r.junk].slice(0, 8).replace(/[()]/g, '.'))); } else nothing++;
  }
  assert.ok(junk >= 8 && nothing >= 8, `junk ${junk} / nothing ${nothing}`);
  assert.ok(g.events.some((e) => e.kind === 'junk'));
  assert.ok(g.snapshot().holes.some((h) => h[4]), 'junk shows in the hole data for renderers');
});

await test('consecutive finds build a streak that multiplies made-up loot; a miss resets it', async () => {
  const g = new Game({ secret: 'm3' });
  g.council.rules.lootTax = 0; // the treasury tax is covered in test/council.mjs
  const p = g.join({ name: 'streaker' });
  const got = [];
  for (let i = 0; i < 4; i++) { clearNear(g, p); chestAt(g, p, 'common', { MOON: 10 }); const r = await dig(g, p.id); got.push([r.streak, r.multiplier, r.loot.MOON]); }
  assert.deepEqual(got, [[1, 1, 10], [2, 1.5, 15], [3, 2, 20], [4, 2.5, 25]]);
  assert.equal(p.portfolio.MOON, 70);
  clearNear(g, p);
  const miss = await dig(g, p.id);
  assert.equal(miss.lostStreak, 4); assert.equal(p.streak, 0);
  clearNear(g, p); chestAt(g, p);
  assert.equal((await dig(g, p.id)).multiplier, 1, 'back to x1');
  assert.equal(streakMultiplier(99), 3, 'capped at x3');
});

await test('if someone digs your chest first, you are told', async () => {
  const g = new Game({ secret: 'm4' });
  const a = g.join({ name: 'fast' }), b = g.join({ name: 'slow' });
  b.x = a.x + 0.3; b.z = a.z; b.heading = a.heading;
  clearNear(g, a); chestAt(g, a);
  const slow = g.act(b.id, 'dig');
  run(g, 0.5);
  const fast = g.act(a.id, 'dig'); // same chest, but a finishes later... so make a finish first
  a.dig.t = 0.05;
  run(g, 2);
  assert.equal((await fast).found, true);
  const r = await slow;
  assert.equal(r.found, false); assert.equal(r.beaten, true); assert.match(r.hint, /first/);
});

await test('real prizes are not multiplied by streaks (only made-up loot)', async () => {
  const g = new Game({ secret: 'm5' });
  g.council.rules.lootTax = 0;
  const p = g.join({ name: 'legend' });
  p.streak = 9;
  clearNear(g, p); chestAt(g, p, 'legendary', { MOON: 80 });
  const r = await dig(g, p.id);
  assert.equal(r.loot.MOON, 240);
  assert.ok(!Object.keys(r.loot).some((t) => ['TSLA', 'AMZN', 'NFLX', 'PLTR', 'AMD'].includes(t)));
  assert.equal(r.realPrize, undefined, 'no prize pool in this game, so no real prize at all');
});

await test('face turns a standing player on the spot; walking takes over', async () => {
  const g = new Game({ secret: 'm6' });
  const p = g.join({ name: 'turner' });
  assert.equal((await g.act(p.id, 'face', { heading: 1.2 })).ok, true);
  run(g, 1);
  assert.ok(Math.abs(p.heading - 1.2) < 0.02, `heading ${p.heading}`);
  const x0 = p.x, z0 = p.z;
  run(g, 0.5);
  assert.equal(p.x, x0); assert.equal(p.z, z0);
  assert.equal((await g.act(p.id, 'face', { heading: 'north' })).ok, false);
});

console.log(`${n} tests\nMECHANICS OK`);
process.exit(0);
