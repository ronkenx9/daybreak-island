// G28: Insider rounds on the server (fast clock).
//   node test/insider.mjs
import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';

const FAST = { minPlayers: 4, firstDelay: 1, cooldown: 2, hunt: 5, meeting: 4, reveal: 1, clueChance: 1, maxClues: 3 };
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); process.exit(1); } };
const run = (g, s) => { for (let i = 0; i < s * 20; i++) g.tick(0.05); };
const setup = (players = 5, opts = {}) => {
  const g = new Game({ secret: `ins-${players}-${Math.random()}`, insider: { ...FAST, ...opts } });
  const ps = [...Array(players)].map((_, i) => g.join({ name: `p${i}`, look: ['racer', 'midnight', 'electric', 'cloud', 'orbit'][i % 5] }));
  return { g, ps };
};
const roles = (g, ps) => ps.map((p) => g.insider.status(p).role);
async function dig(g, p) { const r = g.act(p.id, 'dig'); run(g, 2); return r; }

await test('no round with fewer than 4 players; a round deals exactly one secret insider', async () => {
  const small = setup(3);
  run(small.g, 3);
  assert.equal(small.g.insider.phase, 'lobby');
  const { g, ps } = setup(5);
  run(g, 1.2);
  assert.equal(g.insider.phase, 'hunt');
  const rs = roles(g, ps);
  assert.equal(rs.filter((r) => r === 'insider').length, 1);
  assert.equal(rs.filter((r) => r === 'crew').length, 4);
  const ins = ps[rs.indexOf('insider')], crew = ps[rs.indexOf('crew')];
  assert.ok(g.insider.status(ins).ticker, 'the insider knows the ticker');
  assert.equal(g.insider.status(crew).ticker, undefined, 'the crew does not');
  // nothing public gives it away
  const snap = JSON.stringify(g.snapshot());
  assert.ok(!snap.includes(g.insider.r.ticker) || g.market.some((m) => m.ticker === g.insider.r.ticker), 'ticker only appears as a normal market row');
  assert.ok(!snap.includes('"insider":"p'), 'no insider name in snapshots');
});

await test('crew digs turn up true private clues; the insider gets none', async () => {
  const { g, ps } = setup(5);
  run(g, 1.2);
  const rs = roles(g, ps);
  const ins = ps[rs.indexOf('insider')], crew = ps.filter((_, i) => rs[i] === 'crew');
  const r = await dig(g, crew[0]);
  assert.ok(r.insiderClue, 'clue with the dig result');
  const all = [];
  for (let i = 0; i < 3; i++) { const c = (await dig(g, crew[1])).insiderClue; if (c) all.push(c); }
  const hatWord = { racer: 'blue', midnight: 'black', electric: 'bright blue', cloud: 'white', orbit: 'white' }[ins.look];
  for (const c of [r.insiderClue, ...all]) {
    if (c.includes('hat')) assert.ok(c.includes(`${hatWord} hat`), `hat clue is true (${c})`);
    if (c.includes('found')) assert.match(c, /found \d+ chest/);
  }
  assert.equal(new Set(all).size, all.length, 'no repeated clue');
  assert.ok(g.insider.status(crew[1]).clues.length >= 1);
  assert.equal((await dig(g, ins)).insiderClue, undefined);
});

await test('the insider can plant one rumour during the hunt; nobody else can', async () => {
  const { g, ps } = setup(4);
  run(g, 1.2);
  const rs = roles(g, ps);
  const ins = ps[rs.indexOf('insider')], crew = ps[rs.indexOf('crew')];
  assert.equal(g.act(crew.id, 'leak', { text: 'x' }).ok, false);
  assert.equal(g.act(ins.id, 'leak', { text: 'the insider wears a white hat' }).ok, true);
  assert.equal(g.act(ins.id, 'leak', { text: 'again' }).ok, false);
  assert.deepEqual(g.insider.status(crew).rumors, ['the insider wears a white hat']);
  assert.ok(g.events.some((e) => e.kind === 'rumor'));
});

await test('the meeting pulls everyone into a circle and freezes movement; only then can you vote', async () => {
  const { g, ps } = setup(5);
  run(g, 1.2);
  assert.equal(g.act(ps[0].id, 'vote', { who: 'p1' }).ok, false, 'no votes during the hunt');
  run(g, 5.1);
  assert.equal(g.insider.phase, 'meeting');
  const spot = g.insider.spot;
  for (const p of ps) assert.ok(Math.abs(Math.hypot(p.x - spot.x, p.z - spot.z) - 3.4) < 0.01, 'in the circle');
  assert.equal(g.act(ps[0].id, 'move', { dx: 1, dz: 0 }).ok, false);
  assert.equal(g.act(ps[0].id, 'dig').ok, false);
  assert.equal(g.act(ps[0].id, 'say', { text: 'it was p2' }).ok, true, 'talking is allowed');
  assert.equal(g.act(ps[0].id, 'vote', { who: 'nobody' }).ok, false);
  assert.equal(g.act(ps[0].id, 'vote', { who: 'p2' }).ok, true);
  const late = g.join({ name: 'late' });
  assert.equal(g.act(late.id, 'vote', { who: 'p2' }).ok, false, 'spectators cannot vote');
});

await test('catching the insider pays the crew; missing them pumps the stock for the insider', async () => {
  // caught
  let { g, ps } = setup(5);
  run(g, 1.2);
  let rs = roles(g, ps), ins = ps[rs.indexOf('insider')], ticker = g.insider.r.ticker;
  run(g, 5.1);
  for (const p of ps) g.act(p.id, 'vote', { who: p === ins ? ps.find((q) => q !== ins).name : ins.name });
  run(g, 0.1); // everyone voted: reveal right away
  assert.equal(g.insider.phase, 'reveal');
  assert.equal(g.insider.last.outcome, 'caught');
  assert.equal(g.insider.last.insider, ins.name);
  for (const p of ps) if (p !== ins) assert.equal(p.portfolio[ticker], 25);
  assert.ok(!ins.portfolio[ticker]);
  run(g, 1.2);
  assert.equal(g.insider.phase, 'lobby');
  assert.ok(ps.every((p) => !p.meeting), 'everyone free to move again');

  // escaped
  ({ g, ps } = setup(5));
  run(g, 1.2);
  rs = roles(g, ps); ins = ps[rs.indexOf('insider')]; ticker = g.insider.r.ticker;
  const before = g.market.find((m) => m.ticker === ticker).price;
  run(g, 5.1);
  const innocent = ps.find((p) => p !== ins);
  for (const p of ps) g.act(p.id, 'vote', { who: p === innocent ? ins.name : innocent.name });
  run(g, 0.1);
  assert.equal(g.insider.last.outcome, 'escaped');
  assert.equal(g.insider.last.ejected, innocent.name);
  assert.equal(ins.portfolio[ticker], 80);
  assert.ok(g.market.find((m) => m.ticker === ticker).price > before * 1.4, 'the stock pumps');
  assert.ok(g.events.some((e) => e.kind === 'insider-reveal' && e.outcome === 'escaped'));
});

await test('a tie or a skip majority votes nobody out', async () => {
  const { g, ps } = setup(4);
  run(g, 1.2);
  run(g, 5.1);
  g.act(ps[0].id, 'vote', { who: 'p1' }); g.act(ps[1].id, 'vote', { who: 'p0' });
  g.act(ps[2].id, 'vote', { who: 'skip' }); g.act(ps[3].id, 'vote', { who: 'skip' });
  run(g, 0.1);
  assert.equal(g.insider.last.ejected, null);
  assert.equal(g.insider.last.outcome, 'escaped');
});

await test('if the insider leaves, the round is called off cleanly', async () => {
  const { g, ps } = setup(5);
  run(g, 1.2);
  const ins = ps[roles(g, ps).indexOf('insider')];
  g.leave(ins.id);
  run(g, 0.1);
  assert.equal(g.insider.phase, 'lobby');
  assert.equal(g.insider.last.outcome, 'void');
});

console.log(`${n} tests\nINSIDER OK`);
process.exit(0);
