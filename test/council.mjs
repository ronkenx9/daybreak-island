// G32: the Island Council runs itself: epochs, fees, votes, pledges, treasury tax,
// best-first funding, construction, the chronicle, and it all survives a restart.
//   node test/council.mjs  -> COUNCIL OK
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
import { openDb } from '../server/db.mjs';

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n`, e); } };
const O = { propose: 5, debate: 3, vote: 3 };
const run = (g, s) => { for (let t = 0; t < s; t += 0.05) g.tick(0.05); };
const rich = (p, n = 200) => { p.portfolio.MOON = n; }; // MOON starts at 12.5
const site = (g) => g.council.sites(1)[0];

await test('epochs cycle on their own: propose -> debate -> vote -> enact -> next epoch', () => {
  const g = new Game({ secret: 'c1', council: O });
  const c = g.council;
  assert.equal(c.phase, 'propose'); assert.equal(c.epoch, 1);
  run(g, 5.1); assert.equal(c.phase, 'debate');
  run(g, 3.1); assert.equal(c.phase, 'vote');
  run(g, 3.1); assert.equal(c.phase, 'propose'); assert.equal(c.epoch, 2);
  assert.ok(g.events.some((e) => e.kind === 'council' && /epoch 1 closed/.test(e.text)));
});

await test('a pitch costs a fee from your own bag; broke players are told to dig first; one pitch per epoch (ideas extra)', () => {
  const g = new Game({ secret: 'c2', council: O });
  const a = g.join({ name: 'Ana' }), broke = g.join({ name: 'Broke' });
  rich(a, 100);
  const s = site(g);
  const r = g.act(a.id, 'propose', { kind: 'build', type: 'plaza', x: s.x, z: s.z, pitch: 'a square to hang out' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(a.portfolio.MOON < 100 && a.portfolio.MOON >= 98, `fee taken (${a.portfolio.MOON})`);
  assert.ok(g.council.treasuryValue() >= 20);
  const twice = g.act(a.id, 'propose', { kind: 'rule', rule: 'junkChance', value: 0.4 });
  assert.equal(twice.ok, false); assert.match(twice.error, /one pitch per epoch/);
  const idea = g.act(a.id, 'propose', { kind: 'idea', text: 'boats you can row around the island' });
  assert.equal(idea.ok, true);
  const poor = g.act(broke.id, 'propose', { kind: 'rule', rule: 'junkChance', value: 0.4 });
  assert.equal(poor.ok, false); assert.match(poor.error, /dig up some chests first/);
});

await test('one vote each (not during pitching); pledges move stock into the treasury and count as a yes', () => {
  const g = new Game({ secret: 'c3', council: O });
  const [a, b, c] = ['A', 'B', 'C'].map((n) => g.join({ name: n }));
  rich(a); rich(b);
  const s = site(g);
  const { id } = g.act(a.id, 'propose', { kind: 'build', type: 'plaza', x: s.x, z: s.z });
  assert.match(g.act(b.id, 'council_vote', { id, vote: 'yes' }).error, /opens after the pitches/);
  run(g, 5.1);
  assert.equal(g.act(c.id, 'council_vote', { id, vote: 'no' }).no, 1);
  assert.equal(g.act(c.id, 'council_vote', { id, vote: 'yes' }).yes, 2, 'changing your vote moves it, never doubles it');
  const before = g.council.treasuryValue();
  const pl = g.act(b.id, 'pledge', { id, amount: 100 });
  assert.equal(pl.ok, true); assert.ok(g.council.treasuryValue() - before >= 100);
  assert.equal(g.council.proposals[0].yes.size, 3);
});

await test('chest loot pays a tax into the treasury', async () => {
  const g = new Game({ secret: 'c4', council: O });
  const p = g.join({ name: 'digger' });
  g.chests = [{ id: 'x', x: p.x, z: p.z, rarity: 'common', loot: { MOON: 50 } }];
  const out = g.act(p.id, 'dig'); run(g, 3);
  const r = await out;
  assert.equal(r.loot.MOON, 45); assert.equal(g.council.treasury.MOON, 5);
});

await test('passed pitches are funded best-first while the treasury can pay; voted-down and unaffordable ones are not', () => {
  const g = new Game({ secret: 'c5', council: { ...O, maxEnact: 3 } });
  const ps = ['A', 'B', 'C', 'D'].map((n) => g.join({ name: n }));
  ps.forEach((p) => rich(p, 400));
  const s = g.council.sites(3);
  const plaza = g.act(ps[0].id, 'propose', { kind: 'build', type: 'plaza', x: s[0].x, z: s[0].z }).id;
  const hall = g.act(ps[1].id, 'propose', { kind: 'build', type: 'town-hall', x: s[1].x, z: s[1].z }).id;
  const junk = g.act(ps[2].id, 'propose', { kind: 'rule', rule: 'junkChance', value: 0.9 }).id;
  run(g, 5.1);
  for (const p of ps) g.act(p.id, 'council_vote', { id: plaza, vote: 'yes' });
  for (const p of ps.slice(0, 3)) g.act(p.id, 'council_vote', { id: hall, vote: 'yes' });
  for (const p of ps.slice(0, 3)) g.act(p.id, 'council_vote', { id: junk, vote: 'no' });
  g.act(ps[3].id, 'pledge', { id: plaza, amount: 300 }); // treasury ~ 3 x 20 fees + 300: enough for the plaza, not the hall
  run(g, 6.3);
  const st = Object.fromEntries(g.council.proposals.map((q) => [q.id, q.status]));
  assert.equal(st[plaza], 'enacted'); assert.equal(st[hall], 'unfunded'); assert.equal(st[junk], 'failed');
  assert.equal(g.council.structures.length, 1); assert.equal(g.council.structures[0].type, 'plaza');
  assert.ok(g.council.chronicle.some((c) => /can't cover/.test(c.text)), 'the chronicle explains why the hall waits');
  assert.equal(g.council.rules.junkChance, 0.5, 'the voted-down rule change did not happen');
});

await test('buildings go up over time, faster with helpers; finishing is announced', () => {
  const mk = () => { const g = new Game({ secret: 'c6', council: O }); const [a, b] = [g.join({ name: 'A' }), g.join({ name: 'B' })]; rich(a, 400); rich(b, 400); const s = site(g); const id = g.act(a.id, 'propose', { kind: 'build', type: 'plaza', x: s.x, z: s.z }).id; g.act(b.id, 'pledge', { id, amount: 350 }); run(g, 11.3); return { g, a, b, s: g.council.structures[0] }; };
  const solo = mk();
  assert.ok(solo.s && solo.s.progress < 0.2);
  run(solo.g, 30); const alone = solo.s.progress;
  const team = mk();
  for (const p of [team.a, team.b]) { p.x = team.s.x + 3; p.z = team.s.z; }
  for (let t = 0; t < 30; t += 1) { for (const p of [team.a, team.b]) assert.equal(team.g.act(p.id, 'build', {}).ok, true); run(team.g, 1); }
  assert.ok(team.s.progress > alone * 1.4, `helpers speed it up (${team.s.progress.toFixed(2)} vs ${alone.toFixed(2)})`);
  run(team.g, 200);
  assert.equal(team.s.progress, 1);
  assert.ok(team.g.events.some((e) => e.kind === 'built'));
});

await test('the council, its buildings, treasury and chronicle, and saved bags survive a restart', () => {
  const store = openDb(':memory:');
  const g1 = new Game({ secret: 'c7', council: O, store });
  const [a, b] = [g1.join({ name: 'A', key: 'a-secret-key-0123456789' }), g1.join({ name: 'B' })];
  rich(a, 400); rich(b, 400);
  const s = site(g1);
  const id = g1.act(a.id, 'propose', { kind: 'build', type: 'garden', x: s.x, z: s.z, name: 'Sunset Garden' }).id;
  g1.act(b.id, 'pledge', { id, amount: 250 });
  run(g1, 11.3);
  g1.leave(a.id);
  const g2 = new Game({ secret: 'c7b', council: O, store });
  assert.equal(g2.council.epoch, 2);
  assert.equal(g2.council.structures[0]?.name, 'Sunset Garden');
  assert.ok(g2.council.treasuryValue() > 0);
  assert.ok(g2.council.chronicle.length >= 1);
  const back = g2.join({ name: 'A', key: 'a-secret-key-0123456789' });
  assert.ok(back.portfolio.MOON > 300, `the saved bag came back (${back.portfolio.MOON})`);
  assert.deepEqual(g2.join({ name: 'A' }).portfolio, {}, 'the same name without the key gets nothing');
});

console.log(failed ? `COUNCIL FAILED (${failed})` : 'COUNCIL OK');
process.exit(failed ? 1 : 0);
