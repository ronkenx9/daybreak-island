// Stock Critters: made-up stocks that came to life. Grunts wander the island,
// a boss stalks it. They chase anyone outside the spawn safe zone, telegraph
// a swing (windup) and hit whoever is still in reach when it lands, so
// walking away dodges. Players `attack` in melee; a dead critter drops its
// stock split by damage dealt, and a boss can drop a real tokenized stock.
import { groundAt, canStep, randomLandPoint, SPAWN } from '../src/shared/world.js';

export const SAFE_RADIUS = 18;      // nobody fights inside this ring around spawn
export const ATTACK_RANGE = 4;
export const ATTACK_COOLDOWN = 0.7;
export const MAX_HP = 100;
const WINDUP = 0.8;
const KO_TIME = 4;

export const KINDS = {
  grunt: { hp: 60, speed: 3.4, dmg: 8, reach: 2.6, aggro: 14, loot: [15, 35], realChance: 0.03, want: 4, respawn: 15 },
  boss: { hp: 240, speed: 4.4, dmg: 18, reach: 3.4, aggro: 22, loot: [90, 160], realChance: 0.35, want: 1, respawn: 45 },
};

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const inSafeZone = (x, z) => Math.hypot(x - SPAWN.x, z - SPAWN.z) < SAFE_RADIUS;

export class Critters {
  constructor(game, enabled = true) {
    this.game = game;
    this.list = [];
    this.spawnQueue = []; // seconds until each dead critter's replacement appears
    if (enabled) for (const [kind, k] of Object.entries(KINDS)) for (let i = 0; i < k.want; i++) this.spawn(kind);
  }

  spawn(kind) {
    const g = this.game, k = KINDS[kind];
    const p = randomLandPoint(g.rnd, (x, z) => !inSafeZone(x, z) && Math.hypot(x - SPAWN.x, z - SPAWN.z) > 30);
    const ticker = g.market[Math.floor(g.rnd() * g.market.length)].ticker;
    const c = {
      id: `k${g.nextId++}`, kind, ticker, name: `$${ticker} ${kind === 'boss' ? 'Boss' : 'Critter'}`,
      x: p.x, z: p.z, y: groundAt(p.x, p.z), heading: g.rnd() * 6.28,
      hp: k.hp, maxHp: k.hp, target: null, windup: 0, wander: null, wanderT: 0, hitBy: new Map(),
    };
    this.list.push(c);
    return c;
  }

  view(c, from) {
    return {
      id: c.id, name: c.name, kind: c.kind, ticker: c.ticker, hp: c.hp, maxHp: c.maxHp, x: round(c.x), z: round(c.z),
      ...(from ? { distance: round(Math.hypot(c.x - from.x, c.z - from.z), 1) } : {}),
    };
  }

  near(p, range = 40) {
    return this.list.map((c) => this.view(c, p)).filter((c) => c.distance <= range).sort((a, b) => a.distance - b.distance);
  }

  // ---------------------------------------------------------------- player attack
  attack(p, args = {}) {
    const g = this.game;
    if (p.atkT > 0) return { ok: false, error: 'cooldown', wait: round(p.atkT, 2) };
    if (inSafeZone(p.x, p.z)) return { ok: false, error: 'the spawn area is a safe zone, no fighting here' };
    const want = args.target ? String(args.target).toLowerCase() : null;
    let best = null, bd = Infinity;
    for (const c of this.list) {
      if (want && c.id !== want && c.ticker.toLowerCase() !== want.replace('$', '') && c.name.toLowerCase() !== want) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || bd > ATTACK_RANGE) {
      const nearest = this.near(p, 200)[0];
      return { ok: false, error: `no critter within ${ATTACK_RANGE}m`, nearest: nearest ?? null, hint: nearest ? 'walk_to it (target {x,z}) then attack' : 'none alive right now' };
    }
    const dmg = 10 + Math.floor(g.rnd() * 7);
    p.atkT = ATTACK_COOLDOWN;
    p.anim = 'dig'; p.animT = 0.4;
    p.heading = Math.atan2(best.x - p.x, best.z - p.z);
    best.hp = Math.max(0, best.hp - dmg);
    best.hitBy.set(p.id, (best.hitBy.get(p.id) ?? 0) + dmg);
    if (best.hp > 0) {
      if (!best.target) best.target = p.id;
      return { ok: true, damage: dmg, critter: best.name, hp: best.hp, maxHp: best.maxHp, yourHp: p.hp };
    }
    return { ok: true, damage: dmg, defeated: true, critter: best.name, ...this.defeat(best, p), yourHp: p.hp };
  }

  defeat(c, killer) {
    const g = this.game, k = KINDS[c.kind];
    this.list.splice(this.list.indexOf(c), 1);
    this.spawnQueue.push({ kind: c.kind, t: k.respawn });
    const total = k.loot[0] + Math.floor(g.rnd() * (k.loot[1] - k.loot[0] + 1));
    const dealt = [...c.hitBy.entries()].filter(([id]) => g.players.has(id));
    const sum = dealt.reduce((a, [, d]) => a + d, 0) || 1;
    let top = null;
    const shares = [];
    for (const [id, d] of dealt) {
      const pl = g.players.get(id);
      const n = Math.max(1, Math.round((total * d) / sum));
      pl.portfolio[c.ticker] = (pl.portfolio[c.ticker] ?? 0) + n;
      pl.kills++;
      shares.push({ name: pl.name, shares: n });
      if (!top || d > top.d) top = { pl, d };
    }
    let real = null;
    if (top && g.rnd() < k.realChance) {
      real = g.realDrop();
      top.pl.portfolio[real] = (top.pl.portfolio[real] ?? 0) + 1;
    }
    killer.anim = 'cheer'; killer.emote = 'cheer'; killer.emoteT = 2;
    g.pushEvent({ kind: 'critter', who: killer.name, critter: c.name, boss: c.kind === 'boss', ticker: c.ticker, shares, real });
    return { ticker: c.ticker, loot: { [c.ticker]: shares.find((s) => s.name === killer.name)?.shares ?? 0, ...(real && top.pl === killer ? { [real]: 1 } : {}) }, split: shares, ...(real ? { realDrop: { ticker: real, to: top.pl.name } } : {}), portfolioValue: g.portfolioValue(killer) };
  }

  knockOut(p, by) {
    const g = this.game;
    g.cancelPath(p, 'knocked out');
    p.move = null;
    if (p.dig) { const r = p.dig.resolve; p.dig = null; r({ ok: false, error: 'knocked out' }); }
    p.ko = KO_TIME; p.hp = 0; p.anim = 'sad';
    p.x = SPAWN.x + (g.rnd() - 0.5) * 6; p.z = SPAWN.z + (g.rnd() - 0.5) * 6; p.y = groundAt(p.x, p.z);
    g.pushEvent({ kind: 'ko', who: p.name, by: by.name });
  }

  // ---------------------------------------------------------------- simulation
  tick(dt) {
    const g = this.game;
    for (const q of this.spawnQueue) q.t -= dt;
    for (const q of this.spawnQueue.filter((s) => s.t <= 0)) { this.spawn(q.kind); this.spawnQueue.splice(this.spawnQueue.indexOf(q), 1); }
    for (const p of g.players.values()) {
      if (p.atkT > 0) p.atkT -= dt;
      if (p.ko > 0 && (p.ko -= dt) <= 0) { p.ko = 0; p.hp = MAX_HP; p.anim = 'idle'; }
    }
    for (const c of this.list) {
      const k = KINDS[c.kind];
      const alive = (id) => { const p = g.players.get(id); return p && p.ko <= 0 && !inSafeZone(p.x, p.z) ? p : null; };
      let tgt = c.target ? alive(c.target) : null;
      if (tgt && Math.hypot(tgt.x - c.x, tgt.z - c.z) > k.aggro * 2) tgt = null; // lost them
      if (!tgt) {
        c.target = null;
        let bd = k.aggro;
        for (const p of g.players.values()) {
          if (!alive(p.id)) continue;
          const d = Math.hypot(p.x - c.x, p.z - c.z);
          if (d < bd) { bd = d; tgt = p; }
        }
        c.target = tgt?.id ?? null;
      }
      let dir = null, speed = k.speed;
      if (tgt) {
        const dx = tgt.x - c.x, dz = tgt.z - c.z, d = Math.hypot(dx, dz);
        if (c.windup > 0) {
          c.windup -= dt; speed = 0;
          if (c.windup <= 0) {
            c.windup = 0;
            // the swing lands on everyone still in reach
            for (const p of g.players.values()) {
              if (p.ko > 0 || inSafeZone(p.x, p.z) || Math.hypot(p.x - c.x, p.z - c.z) > k.reach) continue;
              p.hp = Math.max(0, p.hp - k.dmg);
              p.hurt = 0.4;
              if (p.hp <= 0) this.knockOut(p, c);
            }
          }
        } else if (d <= k.reach * 0.85) { c.windup = WINDUP; speed = 0; }
        else dir = { dx: dx / d, dz: dz / d };
        c.heading = Math.atan2(dx, dz);
      } else {
        c.windup = 0;
        if ((c.wanderT -= dt) <= 0) {
          c.wanderT = 2 + g.rnd() * 3;
          const a = g.rnd() * 6.28;
          c.wander = g.rnd() < 0.3 ? null : { dx: Math.sin(a), dz: Math.cos(a) };
        }
        dir = c.wander; speed = k.speed * 0.4;
      }
      if (dir && speed > 0) {
        const want = Math.atan2(dir.dx, dir.dz);
        const step = speed * dt;
        for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
          const a = want + off, nx = c.x + Math.sin(a) * step, nz = c.z + Math.cos(a) * step;
          if (inSafeZone(nx, nz) || !canStep(c.x, c.z, nx, nz)) continue;
          c.x = nx; c.z = nz;
          if (!tgt) c.heading = a;
          break;
        }
      }
      c.y = groundAt(c.x, c.z);
    }
  }

  snapshot() {
    return this.list.map((c) => [c.id, c.kind, c.ticker, round(c.x), round(c.y), round(c.z), round(c.heading, 2), c.hp, c.maxHp, c.windup > 0 ? 1 : 0]);
  }
}
