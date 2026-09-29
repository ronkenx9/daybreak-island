// The island, shared by the server (walkability, pathing, gameplay) and the
// client (rendering). Pure JS, deterministic, no three.js.
import { makeNoise } from './noise.js';

export const SIZE = 360; // metres across the playable map
export const SEA = 0;
const N = makeNoise(4242);
const ss = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Five company mesas ring the north of the island (bosses live here later).
export const MESAS = ['TSLA', 'AMZN', 'NFLX', 'PLTR', 'AMD'].map((ticker, i) => {
  const a = (-70 + i * 35) * Math.PI / 180;
  return { ticker, x: Math.sin(a) * 98, z: -Math.cos(a) * 98 + 6, h: [9, 12, 14, 11, 9][i], r: [16, 18, 20, 17, 15][i] };
});

export const pathX = (z) => Math.sin(z * 0.04) * 10;
export function pathDist(x, z) { return z < -44 || z > 170 ? 99 : Math.abs(x - pathX(z)); }

function island(x, z) {
  const warp = N.fbm(x * 0.008 + 3, z * 0.008 - 7, 3) * 30;
  return 1 - ss(Math.hypot(x, z * 1.05) + warp, 132, 162);
}

function terrace(h, x, z, step) {
  const jag = N.noise(x * 0.4, z * 0.4) * 0.05;
  const t = h / step, f = t - Math.floor(t);
  return (Math.floor(t) + ss(f, 0.84 + jag, 0.95 + jag)) * step;
}

// ---------------------------------------------------------------- set pieces
// a mountain range along the north edge, behind the company hills
function mountains(x, z, land) {
  const ridgeZ = -132 + N.noise(x * 0.011 + 40, 3.3) * 12;
  const band = 1 - ss(Math.abs(z - ridgeZ), 8, 36);
  if (band <= 0) return 0;
  const peaks = N.ridged(x * 0.022 + 9, z * 0.022 - 4, 5);
  return band * land * (peaks * 30 + 5);
}
// a wooden pier out to sea from the spawn beach, a lighthouse on the south-east headland, beach huts
export const PIER = (() => {
  const x = 14;
  let z = 60;
  while (z < 200 && baseHeight(x, z) > 0.4) z += 0.5; // walk south to the waterline
  return { x, z0: z - 6, z1: z + 30, w: 1.8, deck: 1.35 }; // w 1.8: the deck covers whole grid cells (centres 12.5..15.5)
})();
export const LIGHTHOUSE = (() => {
  // the highest bit of coast in the south-east quadrant
  let best = { x: 90, z: 100, h: -9 };
  for (let a = 0.35; a <= 1.2; a += 0.05) for (let r = 100; r <= 170; r += 2) {
    const x = Math.sin(a) * r, z = Math.cos(a) * r, h = baseHeight(x, z);
    if (h > 1.8 && h < 6 && baseHeight(x + Math.sin(a) * 8, z + Math.cos(a) * 8) < 0.4 && h > best.h) best = { x, z, h };
  }
  return { x: best.x, z: best.z, r: 2.4 };
})();
export const HUTS = [-44, -32, 32, 46, 58].map((dx, i) => {
  const x = dx;
  let z = 60;
  while (z < 200 && baseHeight(x, z) > 1.25) z += 0.5;
  return { x, z: z - 3, rot: (i % 2 ? 0.08 : -0.06), color: ['#f0a3a3', '#9cc3e6', '#f3d38a', '#a9d3b4', '#c9b3e8'][i] };
});

export function height(x, z) {
  let h = baseHeight(x, z);
  // the pier deck is walkable over the water
  if (Math.abs(x - PIER.x) < PIER.w && z > PIER.z0 && z < PIER.z1) h = Math.max(h, PIER.deck);
  // buildings are obstacles (walls taller than a step)
  if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < LIGHTHOUSE.r) h += 6;
  for (const hut of HUTS) if (Math.abs(x - hut.x) < 1.5 && Math.abs(z - hut.z) < 1.5) h += 3;
  return h;
}

function baseHeight(x, z) {
  const land = island(x, z);
  let h;
  if (land < 0.25) h = lerp(-8, -0.6, ss(land, 0, 0.25));
  else if (land < 0.45) h = lerp(-0.6, 1.0, (land - 0.25) / 0.2);
  else h = 1.0 + ss(land, 0.45, 1) * ((N.fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5) * 6 + 0.3);
  for (const m of MESAS) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r + N.noise(x * 0.08, z * 0.08) * 0.12;
    h += m.h * (1 - ss(d, 0.55, 1.05)) * land;
  }
  if (h > 1.4) {
    const gap = ss(N.noise(x * 0.05 + 13, z * 0.05 - 7), 0.2, 0.42);
    const ramp = ss(pathDist(x, z), 2.5, 7) * (1 - gap);
    h = lerp(h, 1.4 + terrace(h - 1.4, x, z, 2.6), ramp);
  }
  return h + mountains(x, z, land);
}

// ---------------------------------------------------------------- walkability
export const CELL = 1;
export const GRID = SIZE / CELL;
export const MAX_RISE = 1.1; // hop-able ledge; bigger drops/rises are walls
let H = null, H0 = null; // H0: the island after pit/trap fixes; H: plus buildings stamped on top
let OBSTACLES = []; // [{ x, z, r }] footprints that block walking (council buildings)
export const toCell = (v) => Math.max(0, Math.min(GRID - 1, Math.floor((v + SIZE / 2) / CELL)));
export const toWorld = (i) => (i + 0.5) * CELL - SIZE / 2;
export function grid() {
  if (!H) {
    H0 = new Float32Array(GRID * GRID);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) H0[j * GRID + i] = height(toWorld(i), toWorld(j));
    fillPits(H0);
    fixTraps(H0);
    H = H0.slice();
    stamp(H, OBSTACLES);
  }
  return H;
}
// buildings are walls: raise their footprint well above a step
function stamp(G, list) {
  for (const o of list) {
    const i0 = toCell(o.x - o.r), i1 = toCell(o.x + o.r), j0 = toCell(o.z - o.r), j1 = toCell(o.z + o.r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(toWorld(i) - o.x, toWorld(j) - o.z) <= o.r) G[j * GRID + i] = H0[j * GRID + i] + 3;
  }
}
/** Replace the set of building footprints that block walking. */
export function setObstacles(list) {
  OBSTACLES = list.map((o) => ({ x: o.x, z: o.z, r: o.r }));
  if (H) { H.set(H0); stamp(H, OBSTACLES); }
}
export const obstacles = () => OBSTACLES;
/** How many cells a walker can reach from spawn (and walk back from), with an optional extra footprint. */
export function reachable(extra = null) {
  grid();
  const G = extra ? H.slice() : H;
  if (extra) stamp(G, [extra]);
  const ok = (a, b) => G[b] > 0.25 && Math.abs(G[b] - G[a]) < MAX_RISE * 0.9;
  const s = toCell(SPAWN.z) * GRID + toCell(SPAWN.x);
  const seen = new Uint8Array(GRID * GRID), stack = [s]; seen[s] = 1;
  let n = 1;
  while (stack.length) {
    const c = stack.pop(), ci = c % GRID, cj = (c - ci) / GRID;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj, m = j * GRID + i;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID || seen[m] || !ok(c, m)) continue;
      seen[m] = 1; n++; stack.push(m);
    }
  }
  return n;
}
/** Is (x, z) a buildable site of radius r? Flat dry land, clear of the path, pier, lighthouse, huts and spawn. */
export function siteCheck(x, z, r, { onPath = false, maxSlope = 2.8 } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'x and z must be numbers' };
  if (Math.abs(x) > SIZE / 2 - r - 6 || Math.abs(z) > SIZE / 2 - r - 6) return { ok: false, reason: 'outside the island' };
  let lo = Infinity, hi = -Infinity;
  // an even world-aligned grid over the footprint, so a smaller building always fits where a bigger one does
  for (let gx = Math.ceil((x - r) / 1.5) * 1.5; gx <= x + r; gx += 1.5) for (let gz = Math.ceil((z - r) / 1.5) * 1.5; gz <= z + r; gz += 1.5) {
    if (Math.hypot(gx - x, gz - z) > r) continue;
    const h = baseHeight(gx, gz);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  if (lo === Infinity) { lo = hi = baseHeight(x, z); }
  if (lo < 1.3) return { ok: false, reason: 'too close to the water (build on the grass)' };
  if (hi - lo > maxSlope) return { ok: false, reason: `too steep here (${(hi - lo).toFixed(1)}m of slope), pick a flatter spot` };
  if (!onPath && pathDist(x, z) < r + 2.5) return { ok: false, reason: 'that would block the main path' };
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < r + 8) return { ok: false, reason: 'too close to spawn' };
  if (Math.abs(x - PIER.x) < r + 4 && z > PIER.z0 - r - 6) return { ok: false, reason: 'in the way of the pier' };
  if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < r + 8) return { ok: false, reason: 'too close to the lighthouse' };
  for (const hut of HUTS) if (Math.hypot(x - hut.x, z - hut.z) < r + 5) return { ok: false, reason: 'too close to the beach huts' };
  return { ok: true, y: (lo + hi) / 2, slope: hi - lo };
}
export const baseHeightAt = (x, z) => baseHeight(x, z);
// Coves between mountains and the sea can still be one-way (drop in, can't climb
// out, the only other exit is water). Raise any cell you can reach from spawn but
// can't walk back to spawn from, until there are none.
function fixTraps(H) {
  const ok = (a, b) => H[b] > 0.25 && H[b] - H[a] < MAX_RISE * 0.9;
  const s = toCell(SPAWN.z) * GRID + toCell(SPAWN.x);
  const flood = (forward) => {
    const seen = new Uint8Array(GRID * GRID), stack = [s]; seen[s] = 1;
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
  for (let pass = 0; pass < 40; pass++) {
    const F = flood(true), R = flood(false);
    let fixed = 0;
    for (let c = 0; c < GRID * GRID; c++) {
      if (!F[c] || R[c]) continue;
      // lift toward the highest neighbour so a step out is possible
      const ci = c % GRID, cj = (c - ci) / GRID;
      let top = H[c];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < GRID && j < GRID) top = Math.max(top, H[j * GRID + i]); }
      H[c] = Math.max(H[c], top - MAX_RISE * 0.8);
      fixed++;
    }
    if (!fixed) return;
  }
}
// Terrace noise leaves small pits a walker can drop into but never climb out
// of. Flood inward from the sea, lowest first, raising any cell that sits more
// than PIT_STEP below the neighbour it drains to, so every cell has a way out.
// Only raises, so mesa cliffs stay walls.
const PIT_STEP = 0.8;
function fillPits(H) {
  const done = new Uint8Array(GRID * GRID), q = new Heap();
  for (let c = 0; c < GRID * GRID; c++) if (H[c] <= 0.25) { done[c] = 1; q.push(H[c], c); }
  while (q.a.length) {
    const [level, c] = q.pop();
    const ci = c % GRID, cj = (c - ci) / GRID;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj, n = j * GRID + i;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID || done[n]) continue;
      done[n] = 1;
      H[n] = Math.max(H[n], level - PIT_STEP);
      q.push(H[n], n);
    }
  }
}
export const groundAt = (x, z) => {
  const g = grid();
  // bilinear sample of the grid (fast, used every tick)
  const fx = (x + SIZE / 2) / CELL - 0.5, fz = (z + SIZE / 2) / CELL - 0.5;
  const i = Math.max(0, Math.min(GRID - 2, Math.floor(fx))), j = Math.max(0, Math.min(GRID - 2, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
  const a = g[j * GRID + i], b = g[j * GRID + i + 1], c = g[(j + 1) * GRID + i], d = g[(j + 1) * GRID + i + 1];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
};
export const isLand = (x, z) => groundAt(x, z) > 0.25 && Math.abs(x) < SIZE / 2 - 2 && Math.abs(z) < SIZE / 2 - 2;

// Can a walker step from (x,z) toward (nx,nz)? Rises over MAX_RISE within 0.6m are walls.
export function canStep(x, z, nx, nz) {
  if (!isLand(nx, nz)) return false;
  const d = Math.hypot(nx - x, nz - z) || 1e-6;
  const ax = x + ((nx - x) / d) * 0.6, az = z + ((nz - z) / d) * 0.6;
  return groundAt(ax, az) - groundAt(x, z) < MAX_RISE;
}

// ---------------------------------------------------------------- A* pathing
class Heap {
  constructor() { this.a = []; }
  push(f, v) { const a = this.a; a.push([f, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

function lineClear(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  if (d < 1e-3) return true;
  const ux = (bx - ax) / d, uz = (bz - az) / d;
  for (let t = 0; t <= d; t += 0.35) {
    const x = ax + ux * t, z = az + uz * t;
    if (!isLand(x, z) || groundAt(x + ux * 0.6, z + uz * 0.6) - groundAt(x, z) >= MAX_RISE * 0.95) return false;
  }
  return true;
}

export function findPath(sx, sz, tx, tz) {
  const g = grid();
  const walk = (c) => g[c] > 0.25;
  let start = toCell(sz) * GRID + toCell(sx), snapped = false;
  if (!walk(start)) {
    // standing on the shoreline: the ground under you is land but this cell's
    // centre is water, so start from the nearest land cell you can step onto
    let best = -1, bd = Infinity;
    const si = start % GRID, sj = Math.floor(start / GRID), here = groundAt(sx, sz);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = si + di, j = sj + dj, c = j * GRID + i;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID || !walk(c) || g[c] - here >= MAX_RISE * 0.9) continue;
      const d = Math.hypot(toWorld(i) - sx, toWorld(j) - sz);
      if (d < bd) { bd = d; best = c; }
    }
    // standing on a steep edge (e.g. the side of the pier): nothing is a legal step up,
    // but the player is right beside walkable ground, so start from it anyway
    if (best < 0) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = si + di, j = sj + dj, c = j * GRID + i;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID || !walk(c)) continue;
      const d = Math.hypot(toWorld(i) - sx, toWorld(j) - sz);
      if (d < bd) { bd = d; best = c; }
    }
    if (best >= 0) { start = best; snapped = true; }
  }
  let goal = toCell(tz) * GRID + toCell(tx);
  if (!walk(goal)) {
    let best = -1, bd = Infinity;
    const gi = goal % GRID, gj = Math.floor(goal / GRID);
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) {
      const i = gi + di, j = gj + dj;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID || !walk(j * GRID + i)) continue;
      if (di * di + dj * dj < bd) { bd = di * di + dj * dj; best = j * GRID + i; }
    }
    if (best < 0) return null;
    goal = best;
  }
  const cost = new Float64Array(GRID * GRID).fill(Infinity), came = new Int32Array(GRID * GRID).fill(-1);
  const closed = new Uint8Array(GRID * GRID);
  const open = new Heap();
  cost[start] = 0;
  open.push(0, start);
  const gx = goal % GRID, gz = Math.floor(goal / GRID);
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = start === goal;
  // if the goal can't be reached, head for the reachable cell that gets closest to it
  let nearest = start, nearestD = Infinity;
  while (open.size && !found) {
    const [, c] = open.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) { found = true; break; }
    const dd = Math.hypot((c % GRID) - gx, Math.floor(c / GRID) - gz);
    if (dd < nearestD) { nearestD = dd; nearest = c; }
    const ci = c % GRID, cj = Math.floor(c / GRID);
    for (const [di, dj, k] of nb) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      const n = j * GRID + i;
      if (closed[n] || !walk(n) || g[n] - g[c] >= MAX_RISE * 0.9) continue;
      const nc = cost[c] + k + Math.max(0, g[n] - g[c]) * 0.5;
      if (nc < cost[n]) { cost[n] = nc; came[n] = c; open.push(nc + Math.hypot(i - gx, j - gz), n); }
    }
  }
  if (!found) {
    if (nearest === start || nearestD * CELL > 40) return null; // nowhere meaningfully closer
    goal = nearest;
  }
  const pts = [];
  for (let c = goal; c !== -1 && c !== start; c = came[c]) pts.unshift({ x: toWorld(c % GRID), z: toWorld(Math.floor(c / GRID)) });
  if (found) pts.push({ x: tx, z: tz });
  if (snapped) pts.unshift({ x: toWorld(start % GRID), z: toWorld(Math.floor(start / GRID)) });
  const out = [];
  let ax = sx, az = sz, k = 0;
  while (k < pts.length) {
    let far = k, m = k + 1;
    while (m < pts.length && lineClear(ax, az, pts[m].x, pts[m].z)) { far = m; m += 2; }
    out.push(pts[far]);
    ax = pts[far].x; az = pts[far].z;
    k = far + 1;
  }
  return out;
}

export function randomLandPoint(rnd, filter = () => true) {
  for (let i = 0; i < 500; i++) {
    const x = (rnd() - 0.5) * (SIZE - 20), z = (rnd() - 0.5) * (SIZE - 20);
    if (groundAt(x, z) > 1.3 && filter(x, z)) return { x, z };
  }
  return { x: 0, z: 60 };
}

export const SPAWN = (() => { for (let z = 170; z > 40; z--) if (height(pathX(z), z) > 1.4) return { x: pathX(z - 4), z: z - 4 }; return { x: 0, z: 120 }; })();
// the Insider meeting circle sits around a campfire just inland from spawn
export const MEETING_SPOT = { x: SPAWN.x, z: SPAWN.z - 6 };
