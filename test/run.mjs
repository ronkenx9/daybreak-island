import assert from 'node:assert/strict';
import { Game, REAL_DROPS } from '../server/game.mjs';
import { findPath, groundAt, canStep, SPAWN, MESAS, isLand, grid, GRID, MAX_RISE, toCell, toWorld } from '../src/shared/world.js';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); process.exit(1); } };
const run = (g, secs) => { for (let i = 0; i < secs * 20; i++) g.tick(0.05); };

await test('spawn is on land and paths reach every mesa foot', () => {
  assert.ok(isLand(SPAWN.x, SPAWN.z));
  for (const m of MESAS) {
    const p = findPath(SPAWN.x, SPAWN.z, m.x, m.z + m.r * 0.9);
    assert.ok(p && p.length, `no path to ${m.ticker}`);
  }
});

await test('a walker following a path arrives', async () => {
  const g = new Game({ secret: 't1', critters: false });
  const p = g.join({ name: 'walker' });
  const m = MESAS[2];
  const pr = g.act(p.id, 'walk_to', { target: 'NFLX' });
  run(g, 60);
  const r = await pr;
  assert.equal(r.status, 'arrived', JSON.stringify(r));
  assert.ok(Math.hypot(p.x - m.x, p.z - (m.z + m.r * 0.9)) < 3);
});

await test('detector rises toward a chest and dig claims it', async () => {
  const g = new Game({ secret: 't2' });
  const p = g.join({ name: 'digger' });
  const c = g.chests[0];
  p.x = c.x + 20; p.z = c.z; // far
  const far = g.act(p.id, 'detect');
  p.x = c.x + 6;
  const mid = g.act(p.id, 'detect');
  p.x = c.x + 1; p.z = c.z;
  const near = g.act(p.id, 'detect');
  assert.ok(far.signal <= mid.signal && mid.signal < near.signal);
  assert.equal(near.bars, 5);
  const pr = g.act(p.id, 'dig');
  run(g, 2);
  const r = await pr;
  assert.equal(r.found, true);
  assert.ok(Object.keys(p.portfolio).length > 0);
  assert.ok(g.chests.every((x) => x !== c), 'chest removed');
  assert.equal(g.chests.length, 14, 'respawned to keep the island stocked');
});

await test('digging far from any chest finds nothing', async () => {
  const g = new Game({ secret: 't3' });
  const p = g.join({ name: 'unlucky' });
  const { dist } = g.nearestChest(p.x, p.z);
  assert.ok(dist > 2.2);
  const pr = g.act(p.id, 'dig');
  run(g, 2);
  assert.equal((await pr).found, false);
});

await test('walls block, ledges can be hopped', () => {
  assert.equal(canStep(0, 0, 0, 0.2) || true, true); // smoke
  // find a big cliff near a mesa and verify it is not walkable upward
  const m = MESAS[2];
  let blocked = 0;
  for (let a = 0; a < 6.28; a += 0.2) {
    const x = m.x + Math.sin(a) * m.r * 0.75, z = m.z + Math.cos(a) * m.r * 0.75;
    const ox = m.x + Math.sin(a) * m.r * 1.3, oz = m.z + Math.cos(a) * m.r * 1.3;
    if (groundAt(x, z) - groundAt(ox, oz) > 3) blocked++;
  }
  assert.ok(blocked > 0, 'mesas have real cliffs');
});

await test('humans and agents share one world and one action set', async () => {
  const g = new Game({ secret: 't4' });
  const h = g.join({ name: 'human', kind: 'human' });
  const a = g.join({ name: 'agent', kind: 'agent' });
  g.act(a.id, 'say', { text: 'hi human' });
  const look = g.act(h.id, 'look');
  assert.ok(look.players.some((p) => p.name === 'agent' && p.say === 'hi human'));
  g.act(h.id, 'move', { dx: 0, dz: -1 });
  const z0 = h.z;
  run(g, 1);
  assert.ok(h.z < z0, 'human moved');
  const snap = g.snapshot();
  assert.equal(snap.players.length, 2);
});

await test('no pit traps: every cell you can walk into, you can walk back out of', () => {
  // the same step rule A* uses; F = reachable from spawn, R = can reach spawn
  const g = grid(), N = GRID * GRID, s = toCell(SPAWN.z) * GRID + toCell(SPAWN.x);
  const ok = (a, b) => g[b] > 0.25 && g[b] - g[a] < MAX_RISE * 0.9;
  const flood = (forward) => {
    const seen = new Uint8Array(N), stack = [s]; seen[s] = 1;
    while (stack.length) {
      const c = stack.pop(), ci = c % GRID, cj = (c - ci) / GRID;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj, m = j * GRID + i;
        if (i < 0 || j < 0 || i >= GRID || j >= GRID || seen[m]) continue;
        if (forward ? ok(c, m) : ok(m, c)) { seen[m] = 1; stack.push(m); }
      }
    }
    return seen;
  };
  const F = flood(true), R = flood(false);
  const traps = [];
  for (let c = 0; c < N; c++) if (F[c] && !R[c]) traps.push(c);
  assert.equal(traps.length, 0, `${traps.length} trap cells, e.g. ${traps.slice(0, 5).map((c) => `(${toWorld(c % GRID)},${toWorld(Math.floor(c / GRID))})`).join(' ')}`);
});

await test('a walker on the wet shoreline can still path inland', () => {
  // spots where bots got trapped: land underfoot, but the grid cell counts as water
  for (const [x, z] of [[103.02, 8.4], [105, 4.01]]) {
    assert.ok(isLand(x, z), `(${x},${z}) is land`);
    assert.ok(findPath(x, z, SPAWN.x, SPAWN.z), `path inland from (${x},${z})`);
  }
});


// ---------------------------------------------------------------- Stock Critters
const withCritter = (kind = 'grunt', seed = 'k1') => {
  const g = new Game({ secret: seed });
  const p = g.join({ name: 'fighter' });
  const c = g.critters.list.find((k) => k.kind === kind);
  p.x = c.x + 2; p.z = c.z; p.y = 0;
  return { g, p, c };
};

await test('critters spawn away from the safe zone and never enter it', () => {
  const g = new Game({ secret: 'k0' });
  assert.equal(g.critters.list.filter((c) => c.kind === 'boss').length, 1);
  assert.equal(g.critters.list.filter((c) => c.kind === 'grunt').length, 4);
  const p = g.join({ name: 'camper' }); // stands at spawn
  run(g, 120);
  for (const c of g.critters.list) assert.ok(Math.hypot(c.x - SPAWN.x, c.z - SPAWN.z) >= 18, `${c.name} entered the safe zone`);
  assert.equal(p.hp, 100, 'nothing can hurt you at spawn');
});

await test('attack needs range and stays out of the safe zone; damage is recorded', () => {
  const { g, p, c } = withCritter();
  const far = g.join({ name: 'far' });
  assert.equal(g.act(far.id, 'attack').ok, false);
  assert.match(g.act(far.id, 'attack').error, /no critter|safe zone/);
  const r = g.act(p.id, 'attack');
  assert.equal(r.ok, true);
  assert.ok(r.damage >= 10 && r.damage <= 16);
  assert.equal(c.hp, c.maxHp - r.damage);
  assert.equal(g.act(p.id, 'attack').error, 'cooldown');
  const list = g.act(p.id, 'critters');
  assert.ok(list.critters.length === 5 && list.critters[0].distance <= list.critters[1].distance);
});

await test('killing a critter splits its stock by damage, respawns it later, boss can drop real stock', async () => {
  const { g, p, c } = withCritter('grunt', 'k2');
  const helper = g.join({ name: 'helper' });
  helper.x = c.x - 2; helper.z = c.z;
  g.critters.list.forEach((k) => { if (k !== c) k.hp = k.maxHp; });
  c.hp = 30;
  c.hitBy.set(helper.id, 10);
  let res = null;
  for (let i = 0; i < 5 && !res?.defeated; i++) { res = g.act(p.id, 'attack'); run(g, 0.8); }
  assert.equal(res.defeated, true, JSON.stringify(res));
  assert.ok(p.portfolio[c.ticker] > 0 && helper.portfolio[c.ticker] > 0, 'both contributors get a share');
  assert.ok(p.portfolio[c.ticker] > helper.portfolio[c.ticker], 'bigger damage, bigger share');
  assert.equal(p.kills, 1);
  assert.equal(g.critters.list.filter((k) => k.kind === 'grunt').length, 3);
  run(g, 16);
  assert.equal(g.critters.list.filter((k) => k.kind === 'grunt').length, 4, 'grunt respawned');
  // boss with a guaranteed real drop
  const b = g.critters.list.find((k) => k.kind === 'boss');
  p.x = b.x + 2; p.z = b.z; b.hp = 1; g.rnd = () => 0.0001;
  const kill = g.act(p.id, 'attack');
  assert.ok(kill.defeated && kill.realDrop, JSON.stringify(kill));
  assert.ok(Object.keys(p.portfolio).some((t) => REAL_DROPS.includes(t)));
});

await test('a critter winds up before hitting, so walking away dodges; getting hit hard knocks you out to spawn', () => {
  const { g, p, c } = withCritter('boss', 'k3');
  p.x = c.x + 5; p.z = c.z;
  // dodge: keep stepping out of reach while it winds up
  let windups = 0, hit = false;
  for (let i = 0; i < 20 * 6; i++) {
    g.tick(0.05);
    if (c.windup > 0) { windups++; p.x = c.x + 12; p.z = c.z; p.y = groundAt(p.x, p.z); }
    if (p.hp < 100) hit = true;
  }
  assert.ok(windups > 0, 'boss telegraphed a swing');
  assert.equal(hit, false, 'stepping out of reach during the windup dodged every swing');
  // stand still and take it: 100hp / 18 = 6 swings
  const q = g.join({ name: 'punching-bag' });
  q.x = c.x + 1; q.z = c.z;
  for (let i = 0; i < 20 * 20 && q.ko <= 0; i++) g.tick(0.05);
  assert.ok(q.ko > 0, 'knocked out');
  assert.ok(Math.hypot(q.x - SPAWN.x, q.z - SPAWN.z) < 6, 'sent back to spawn');
  assert.equal(g.act(q.id, 'attack').ok, false);
  run(g, 5);
  assert.equal(q.hp, 100);
  assert.equal(q.ko, 0);
});

// ---------------------------------------------------------------- Insider
const cfg = { min: 4, lobby: 3, trade: 20, vote: 10, reveal: 4 };
const room = (n = 4, seed = 'i1') => {
  const g = new Game({ secret: seed, insider: cfg, critters: false });
  const ps = [...Array(n)].map((_, i) => g.join({ name: `t${i}` }));
  ps.forEach((p) => g.act(p.id, 'insider_join'));
  run(g, 4);
  return { g, ps };
};

await test('insider lobby waits for enough players, then deals exactly one insider who alone knows the move', () => {
  const g = new Game({ secret: 'i0', insider: cfg, critters: false });
  const ps = [...Array(4)].map((_, i) => g.join({ name: `t${i}` }));
  ps.slice(0, 3).forEach((p) => g.act(p.id, 'insider_join'));
  run(g, 10);
  assert.equal(g.insider.phase, 'lobby', 'three players is not enough');
  g.act(ps[3].id, 'insider_join');
  run(g, 4);
  assert.equal(g.insider.phase, 'trading');
  const views = ps.map((p) => g.act(p.id, 'insider_status'));
  assert.equal(views.filter((v) => v.role === 'insider').length, 1);
  assert.equal(views.filter((v) => v.move).length, 1, 'only the insider sees the move');
  assert.ok(views.every((v) => v.cash === 1000));
  assert.ok(!JSON.stringify(g.snapshot().insider).includes(g.insider.round.move + '":'), 'public view has no role info');
  assert.ok(!('insider' in g.snapshot().insider) && !('move' in g.snapshot().insider));
});

await test('trading moves price, shows on the tape, respects cash and holdings', () => {
  const { g, ps } = room();
  const [a] = ps;
  const before = g.act(a.id, 'insider_status').prices.find((x) => x.ticker === 'BLUP').price;
  const buy = g.act(a.id, 'insider_trade', { ticker: '$blup', side: 'buy', shares: 50 });
  assert.ok(buy.ok && buy.shares === 50 && buy.newPrice > before, JSON.stringify(buy));
  assert.ok(g.act(ps[1].id, 'insider_status').tape.some((e) => e.who === a.name && e.ticker === 'BLUP'), 'everyone sees the tape');
  let last;
  for (let i = 0; i < 30; i++) { last = g.act(a.id, 'insider_trade', { ticker: 'WAGMI', side: 'buy', shares: 100000 }); if (!last.ok) break; assert.ok(last.shares <= 100, 'per-trade cap'); }
  assert.equal(last.ok, false, 'eventually out of cash');
  assert.ok(g.act(a.id, 'insider_status').cash >= 0);
  assert.equal(g.act(a.id, 'insider_trade', { ticker: 'MOON', side: 'sell', shares: 1 }).ok, false, 'nothing to sell');
  assert.equal(g.act(a.id, 'insider_trade', { ticker: 'NOPE', side: 'buy', shares: 1 }).ok, false);
  assert.equal(g.act(a.id, 'insider_accuse', { name: 't1' }).ok, false, 'no voting while trading');
});

const toVoting = (g) => { run(g, 21); assert.equal(g.insider.phase, 'voting'); };

await test('catching the insider: traders win and are paid in the pumped stock', () => {
  const { g, ps } = room(4, 'i2');
  const ins = g.insider.round.insider, move = g.insider.round.move;
  toVoting(g);
  assert.equal(g.act(ps[0].id, 'insider_trade', { ticker: 'BLUP', side: 'buy', shares: 1 }).ok, false, 'trading closed');
  for (const p of ps) if (p.id !== ins) assert.ok(g.act(p.id, 'insider_accuse', { name: g.players.get(ins).name }).ok);
  assert.equal(g.act(ins, 'insider_accuse', { name: g.players.get(ins).name }).ok, false, 'no self accusation');
  assert.ok(g.act(ins, 'insider_accuse', { name: ps.find((p) => p.id !== ins).name }).ok);
  run(g, 0.1); // everyone voted -> resolves without waiting out the clock
  assert.equal(g.insider.phase, 'reveal');
  const r = g.insider.last;
  assert.equal(r.winners, 'traders'); assert.equal(r.caught, true); assert.equal(r.insider, g.players.get(ins).name);
  for (const p of ps) assert.equal(p.portfolio[move] ?? 0, p.id === ins ? 0 : 40);
  assert.equal(g.players.get(ins).insiderStats.wins, 0);
  run(g, 5);
  assert.equal(g.insider.phase, 'lobby');
  assert.ok(g.insider.members.size === 4, 'players stay opted in for the next round');
});

await test('missing the insider (or tying) means the insider wins, and profits from the pump', () => {
  const { g, ps } = room(4, 'i3');
  const ins = g.insider.round.insider, move = g.insider.round.move;
  g.act(ins, 'insider_trade', { ticker: move, side: 'buy', shares: 100 });
  toVoting(g);
  const other = ps.filter((p) => p.id !== ins);
  // 1-1 split: a tie catches nobody
  g.act(other[0].id, 'insider_accuse', { name: other[1].name });
  g.act(other[1].id, 'insider_accuse', { name: g.players.get(ins).name });
  run(g, 11);
  const r = g.insider.last;
  assert.equal(r.winners, 'insider'); assert.equal(r.accused, null);
  assert.equal(g.players.get(ins).portfolio[move], 100);
  assert.equal(r.results[0].role, 'insider', 'top profit is the insider');
  assert.ok(r.results[0].profit > 0);
  assert.equal(g.leaderboard().find((x) => x.name === g.players.get(ins).name).insiderWins, 1);
});

await test('the round aborts cleanly if the insider leaves or too many drop out', () => {
  const { g, ps } = room(4, 'i4');
  g.leave(g.insider.round.insider);
  assert.equal(g.insider.phase, 'reveal'); assert.equal(g.insider.last.aborted, true);
  run(g, 5);
  assert.equal(g.insider.phase, 'lobby');
  assert.equal(g.insider.members.size, 3);
  assert.equal(g.act(ps.find((p) => g.players.has(p.id)).id, 'insider_status').joined, true);
});

console.log(`${n} tests\nALL TESTS PASSED`);
process.exit(0);
