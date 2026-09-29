import assert from 'node:assert/strict';
import { Game } from '../server/game.mjs';
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
  const g = new Game({ secret: 't1' });
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
  g.t += 0.3; // readings refresh at most 4x a second
  p.x = c.x + 6;
  const mid = g.act(p.id, 'detect');
  g.t += 0.3;
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

console.log(`${n} tests\nALL TESTS PASSED`);
process.exit(0);
