// G36: critters, the owner's pitch. Off until the council votes them on; then brutes
// you beat together for stock, and shades you hide from (a catch drops part of your
// bag, buried where you fell).
//   node test/critters.mjs  -> CRITTERS OK
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
import { groundAt } from '../src/shared/world.js';

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n`, e); } };
const O = { propose: 5, debate: 3, vote: 3 };
const run = (g, s) => { for (let t = 0; t < s; t += 0.05) g.tick(0.05); };
function world(seed) {
  const g = new Game({ secret: seed, council: O });
  const ps = ['A', 'B', 'C'].map((n) => g.join({ name: n }));
  ps.forEach((p, i) => { p.portfolio.MOON = 100; p.x = -22 + i * 3; p.z = 0; p.y = groundAt(p.x, p.z); });
  return { g, ps };
}
// the council switches them on the way the agents would: pitch, vote, pay
function voteOn({ g, ps }) {
  while (g.council.phase !== 'propose') run(g, 0.5);
  const r = g.act(ps[2].id, 'propose', { kind: 'rule', rule: 'critters', value: 1, pitch: 'monsters you fight or hide from' });
  assert.equal(r.ok, true, JSON.stringify(r));
  run(g, 5.1);
  for (const p of ps) g.act(p.id, 'council_vote', { id: r.id, vote: 'yes' });
  g.act(ps[1].id, 'pledge', { id: r.id, amount: 200 });
  run(g, 6.2);
  assert.equal(g.council.rules.critters, 1);
}

await test('off by default: nothing roams until the council votes them on', () => {
  const w = world('k1');
  run(w.g, 120);
  assert.equal(w.g.critters.list.length, 0);
  assert.match(w.g.act(w.ps[0].id, 'attack').error, /council has not switched them on/);
  voteOn(w);
  run(w.g, 46);
  const kinds = w.g.critters.list.map((c) => c.kind);
  assert.ok(kinds.includes('brute') && kinds.includes('shade'), `a wave came (${kinds})`);
  assert.ok(w.g.events.some((e) => e.kind === 'critters'));
  assert.ok(w.g.snapshot().critters.length >= 2, 'renderers get them');
});

await test('a shade catches someone in the open: part of the bag drops and is buried where they fell; anyone can dig it up', async () => {
  const w = world('k2'); voteOn(w);
  const [victim, finder] = w.ps;
  w.g.critters.list = [{ id: 'k1', kind: 'shade', name: 'a shade', x: victim.x - 8, z: victim.z, h: 0, hp: 1, max: 1, age: 0, cool: 0, life: 60 }];
  w.g.critters.nextWave = 999;
  run(w.g, 3);
  assert.equal(victim.portfolio.MOON, 75, 'a quarter of the bag dropped');
  const bag = w.g.chests.find((c) => c.rarity === 'bag');
  assert.ok(bag && bag.loot.MOON === 25 && bag.bag === 'A');
  finder.x = bag.x; finder.z = bag.z; w.g.critters.list = []; finder.stunT = 0;
  const dig = w.g.act(finder.id, 'dig'); run(w.g, 3);
  const r = await dig;
  assert.equal(r.found, true); assert.equal(r.loot.MOON, 25, 'the dropped bag comes back whole (no tax)');
});

await test('hiding works: in a dug hole, or right next to a building, the shade can\'t see you', async () => {
  const w = world('k3'); voteOn(w);
  const p = w.ps[0];
  w.g.chests = [];
  const dig = w.g.act(p.id, 'dig'); run(w.g, 3); await dig;
  const h = w.g.act(p.id, 'hide');
  assert.equal(h.ok, true, JSON.stringify(h));
  w.g.critters.list = [{ id: 'k1', kind: 'shade', name: 'a shade', x: p.x + 6, z: p.z, h: 0, hp: 1, max: 1, age: 0, cool: 0, life: 60 }];
  w.g.critters.nextWave = 999;
  for (const q of w.ps.slice(1)) { q.x += 80; } // nobody else to chase
  run(w.g, 10);
  assert.equal(p.portfolio.MOON, 100, 'safe in the hole');
  assert.equal(w.g.act(p.id, 'move', { dx: 1, dz: 0 }).ok, true);
  assert.equal(p.hidden, false, 'moving gives the spot away');
  // next to a building
  const s = w.g.council.sites(1)[0];
  w.g.council.structures.push({ id: 'b1', type: 'shelter', x: s.x, z: s.z, rot: 0, level: 1, progress: 1 }); w.g.council.sync();
  p.move = null; p.x = s.x + 4.5; p.z = s.z; p.hidden = false;
  w.g.critters.list = [{ id: 'k2', kind: 'shade', name: 'a shade', x: p.x + 8, z: p.z, h: 0, hp: 1, max: 1, age: 0, cool: 0, life: 60 }];
  run(w.g, 10);
  assert.equal(p.portfolio.MOON, 100, 'sheltered by the building');
});

await test('brutes are beaten together; the hoard is split by damage; their swats knock you back', () => {
  const w = world('k4'); voteOn(w);
  const [a, b] = w.ps;
  const brute = { id: 'k9', kind: 'brute', name: 'the $PUMP brute', ticker: 'PUMP', x: a.x + 2, z: a.z, h: 0, hp: 160, max: 160, age: 0, cool: 0, dmg: {}, life: 200 };
  w.g.critters.list = [brute]; w.g.critters.nextWave = 999;
  b.x = a.x + 3; b.z = a.z + 1;
  const ax0 = a.x;
  run(w.g, 0.2);
  assert.ok(a.x < ax0 - 1 || b.stunT > 0 || a.stunT > 0, 'the brute swats');
  let hits = 0;
  for (let k = 0; k < 60 && brute.hp > 0; k++) {
    for (const [p, every] of [[a, 1], [b, 3]]) { if (k % every) continue; p.stunT = 0; p.x = brute.x - 1.5; p.z = brute.z; const r = w.g.act(p.id, 'attack'); if (r.hit || r.defeated) hits++; }
    w.g.t += 0.7; brute.cool = 5;
  }
  assert.ok(brute.hp <= 0 && w.g.critters.list.length === 0, 'defeated');
  assert.ok(a.portfolio.PUMP > b.portfolio.PUMP && b.portfolio.PUMP > 0, `split by damage (A ${a.portfolio.PUMP}, B ${b.portfolio.PUMP})`);
  assert.ok(w.g.events.some((e) => e.kind === 'critter' && /is down/.test(e.text)));
});

console.log(failed ? `CRITTERS FAILED (${failed})` : 'CRITTERS OK');
process.exit(failed ? 1 : 0);
