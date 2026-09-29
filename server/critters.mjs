// Critters (the owner's pitch; off until the council switches the "critters" rule on).
//
// Waves roam in every few minutes:
//   brute  a big stock-monster named after a made-up ticker. It lumbers after
//          players and swats them back. Beat it together (attack when close):
//          its hoard of that stock is split by how much damage each player did.
//   shade  a hunter you can't fight. It is faster than you and chases anyone it
//          can see; a catch knocks part of your bag loose, and it gets buried
//          on the spot as a "dropped bag" anyone can dig up. Hide from it: dig a
//          hole and hide in it, or stand right next to any building.
// Humans and agents use the same actions: attack, hide.
import { randomLandPoint, groundAt, canStep } from '../src/shared/world.js';

const SHADE_SPEED = 7.4, BRUTE_SPEED = 3.2, SHADE_SIGHT = 30, BRUTE_SIGHT = 26;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export class Critters {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.nextWave = 45;
    this.nextId = 1;
    this.waves = 0;
  }
  get on() { return !!this.g.council?.rules.critters; }

  // ---------------------------------------------------------------- waves
  tick(dt) {
    if (!this.on) { if (this.list.length) this.list = []; this.nextWave = 45; return; }
    this.nextWave -= dt;
    if (this.nextWave <= 0 && this.g.players.size) { this.spawnWave(); this.nextWave = (this.g.council.rules.critterEvery ?? 8) * 60; }
    for (const c of [...this.list]) {
      c.age += dt;
      c.cool = Math.max(0, c.cool - dt);
      if (c.kind === 'shade') this.tickShade(c, dt); else this.tickBrute(c, dt);
    }
    for (const p of this.g.players.values()) if (p.stunT > 0) p.stunT -= dt;
  }
  spawnWave() {
    this.waves++;
    const players = [...this.g.players.values()];
    const anchor = players[Math.floor(this.g.rnd() * players.length)];
    const near = (min, max) => randomLandPoint(this.g.rnd, (x, z) => { const d = Math.hypot(x - anchor.x, z - anchor.z); return d > min && d < max && players.every((p) => Math.hypot(p.x - x, p.z - z) > 16); });
    const ticker = this.g.market[Math.floor(this.g.rnd() * this.g.market.length)].ticker;
    const b = near(25, 60);
    this.list.push({ id: `k${this.nextId++}`, kind: 'brute', name: `the $${ticker} brute`, ticker, x: b.x, z: b.z, h: 0, hp: 160, max: 160, age: 0, cool: 0, dmg: {}, life: 200 });
    const shades = Math.min(3, 1 + Math.floor(players.length / 4));
    for (let k = 0; k < shades; k++) { const s = near(35, 70); this.list.push({ id: `k${this.nextId++}`, kind: 'shade', name: 'a shade', x: s.x, z: s.z, h: 0, hp: 1, max: 1, age: 0, cool: 0, life: 75 }); }
    this.g.pushEvent({ kind: 'critters', text: `Critters! ${this.list.at(-1 - shades).name} and ${shades} shade${shades > 1 ? 's' : ''} came out. Hide from shades (dig a hole and hide, or stand by a building); beat the brute together.` });
  }
  visible(p) { return !p.hidden && !(this.g.council?.sheltered(p.x, p.z)) && !(p.stunT > 0); }
  nearestPlayer(c, sight, filter = () => true) {
    let best = null, bd = sight;
    for (const p of this.g.players.values()) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < bd && filter(p)) { bd = d; best = p; } }
    return best ? { p: best, d: bd } : null;
  }
  step(c, tx, tz, speed, dt) {
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const a = Math.atan2(dx, dz), st = Math.min(d, speed * dt);
    for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
      const nx = c.x + Math.sin(a + off) * st, nz = c.z + Math.cos(a + off) * st;
      if (c.kind === 'shade' ? groundAt(nx, nz) > 0.3 : canStep(c.x, c.z, nx, nz)) { c.x = nx; c.z = nz; c.h = a + off; return; }
    }
  }
  wander(c, speed, dt) {
    if (!c.goal || Math.hypot(c.goal.x - c.x, c.goal.z - c.z) < 2) c.goal = randomLandPoint(this.g.rnd, (x, z) => Math.hypot(x - c.x, z - c.z) < 40);
    this.step(c, c.goal.x, c.goal.z, speed, dt);
  }
  tickShade(c, dt) {
    if (c.age > c.life) { this.remove(c, 'The shades sank back into the sand.'); return; }
    const t = c.cool > 0 ? null : this.nearestPlayer(c, SHADE_SIGHT, (p) => this.visible(p));
    if (!t) { this.wander(c, 3, dt); return; }
    this.step(c, t.p.x, t.p.z, SHADE_SPEED, dt);
    if (t.d < 1.3) this.catch(c, t.p);
  }
  tickBrute(c, dt) {
    if (c.hp <= 0) return;
    if (c.age > c.life) { this.remove(c, `${c.name} lumbered off with its hoard.`); return; }
    const t = this.nearestPlayer(c, BRUTE_SIGHT);
    if (!t) { this.wander(c, 2, dt); return; }
    if (t.d > 2.2) this.step(c, t.p.x, t.p.z, BRUTE_SPEED, dt);
    else if (c.cool <= 0) {
      // swat: knock everyone close back a few metres and daze them
      c.cool = 2.4;
      for (const p of this.g.players.values()) {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d > 2.8) continue;
        const a = Math.atan2(p.x - c.x, p.z - c.z);
        for (let k = 4; k > 0; k--) { const nx = p.x + Math.sin(a) * k, nz = p.z + Math.cos(a) * k; if (groundAt(nx, nz) > 0.3) { p.x = nx; p.z = nz; break; } }
        p.stunT = 1; p.path = null; p.emote = 'sad'; p.emoteT = 1.2;
      }
    }
  }
  catch(c, p) {
    c.cool = 4;
    p.stunT = 2.5; p.path = null; p.move = null; p.emote = 'sad'; p.emoteT = 2.5;
    const dropped = {};
    for (const [t, n] of Object.entries(p.portfolio)) { const k = Math.ceil(n * 0.25); if (k > 0) { dropped[t] = k; p.portfolio[t] -= k; if (!p.portfolio[t]) delete p.portfolio[t]; } }
    if (Object.keys(dropped).length) this.g.chests.push({ id: `c${this.g.nextId++}`, x: p.x + 0.8, z: p.z + 0.8, rarity: 'bag', loot: dropped, bag: p.name });
    this.g.pushEvent({ kind: 'critter', who: p.name, text: Object.keys(dropped).length ? `${p.name} got caught by a shade and dropped part of their bag (${Object.entries(dropped).map(([t, n]) => `${n} $${t}`).join(', ')}). It's buried where they fell.` : `${p.name} got caught by a shade (nothing to drop).` });
    return dropped;
  }
  remove(c, text) { this.list.splice(this.list.indexOf(c), 1); if (!this.list.length && text) this.g.pushEvent({ kind: 'critters', text }); }

  // ---------------------------------------------------------------- actions
  attack(p) {
    if (!this.on) return { ok: false, error: 'no critters on this island (the council has not switched them on)' };
    const b = this.list.filter((c) => c.kind === 'brute' && c.hp > 0).map((c) => ({ c, d: Math.hypot(c.x - p.x, c.z - p.z) })).sort((a, b) => a.d - b.d)[0];
    if (!b) return { ok: false, error: 'no brute around' };
    if (b.d > 3.4) return { ok: false, error: `get closer (${b.d.toFixed(1)}m away)`, brute: { x: round(b.c.x), z: round(b.c.z) } };
    if (p.attackT && this.g.t - p.attackT < 0.6) return { ok: true, hp: b.c.hp, cached: true };
    p.attackT = this.g.t;
    p.anim = 'dig'; p.hidden = false;
    const c = b.c, dmg = 12;
    c.hp -= dmg; c.dmg[p.id] = (c.dmg[p.id] ?? 0) + dmg;
    if (c.hp > 0) return { ok: true, hit: dmg, hp: c.hp, max: c.max };
    // defeated: the hoard is split by damage
    const total = Object.values(c.dmg).reduce((a, b) => a + b, 0), hoard = 140, shares = {};
    for (const [id, d] of Object.entries(c.dmg)) {
      const q = this.g.players.get(id); if (!q) continue;
      const n = Math.max(1, Math.round((hoard * d) / total));
      q.portfolio[c.ticker] = (q.portfolio[c.ticker] ?? 0) + n; shares[q.name] = n;
      q.emote = 'cheer'; q.emoteT = 2;
    }
    this.list.splice(this.list.indexOf(c), 1);
    this.g.pushEvent({ kind: 'critter', who: p.name, text: `${c.name} is down! Its hoard of $${c.ticker} was split: ${Object.entries(shares).map(([n, k]) => `${n} ${k}`).join(', ')}.` });
    return { ok: true, defeated: true, share: shares[p.name] ?? 0, ticker: c.ticker };
  }
  hide(p) {
    if (this.g.council?.sheltered(p.x, p.z)) { p.hidden = true; return { ok: true, hidden: true, how: 'tucked in next to a building' }; }
    const hole = this.g.holes.find((h) => Math.hypot(h.x - p.x, h.z - p.z) < 1.8);
    if (!hole) return { ok: false, error: 'no hole to hide in: dig one first (or stand right next to a building)' };
    p.x = hole.x; p.z = hole.z; p.hidden = true; p.path = null; p.move = null;
    return { ok: true, hidden: true, how: 'curled up in a hole' };
  }
  status(p) {
    return { on: this.on, nextWaveIn: this.on ? Math.round(this.nextWave) : null, critters: this.list.map((c) => ({ kind: c.kind, name: c.name, x: round(c.x), z: round(c.z), distance: p ? round(Math.hypot(c.x - p.x, c.z - p.z), 1) : null, hp: c.kind === 'brute' ? c.hp : undefined })), youAreHidden: !!p?.hidden };
  }
  snapshot() { return this.list.map((c) => [c.id, c.kind, round(c.x), round(c.z), round(c.h, 2), c.kind === 'brute' ? round(c.hp / c.max, 2) : 1, c.name]); }
}
