// Authoritative Treasure Hunt simulation. Humans (WebSocket) and agents
// (HTTP/MCP) call the same actions; the server owns positions, hidden chests,
// the detector, digging and everyone's portfolio.
import { createHmac, randomBytes } from 'node:crypto';
import {
  groundAt, canStep, findPath, randomLandPoint, SPAWN, MESAS, SIZE,
} from '../src/shared/world.js';

export const MEME_STOCKS = [
  { ticker: 'BLUP', name: 'Blup Industries', price: 4.2 },
  { ticker: 'MOON', name: 'Moonshot Holdings', price: 12.5 },
  { ticker: 'FROG', name: 'Frog Capital', price: 0.9 },
  { ticker: 'DIGG', name: 'Digg Dynamics', price: 7.7 },
  { ticker: 'PUMP', name: 'Pump & Sons', price: 2.4 },
  { ticker: 'WAGMI', name: 'WAGMI Group', price: 18.0 },
];
// Real tokenized stocks never drop from chests directly: a legendary chest
// draws from the daily prize pool (server/prizes.mjs) instead.

const LOOKS = ['racer', 'midnight', 'electric', 'cloud', 'orbit', 'afterhours'];
const SPEED = 6.5;
const DIG_TIME = 1.8; // long enough to see the hole grow and the dirt fly
const DETECT_RANGE = 28;
const ACTIVE_CHESTS = 14;
const EMOTES = ['wave', 'cheer', 'sad', 'dance', 'shrug'];

const rngFrom = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export class Game {
  constructor({ secret = randomBytes(16).toString('hex'), now = () => Date.now(), prizes = null } = {}) {
    this.now = now;
    this.prizes = prizes; // PrizePool or null
    this.rnd = rngFrom(createHmac('sha256', secret).update('chests').digest().readUInt32BE(0));
    this.players = new Map();
    this.chests = [];
    this.holes = []; // dug spots, shown in the world for a while
    this.events = [];
    this.market = MEME_STOCKS.map((s) => ({ ...s, open: s.price, history: [s.price] }));
    this.marketT = 0;
    this.nextId = 1;
    this.t = 0;
    while (this.chests.length < ACTIVE_CHESTS) this.spawnChest();
  }

  // ---------------------------------------------------------------- chests
  spawnChest() {
    const r = this.rnd();
    const rarity = r < 0.04 ? 'legendary' : r < 0.26 ? 'rare' : 'common';
    const p = randomLandPoint(this.rnd, (x, z) => Math.hypot(x - SPAWN.x, z - SPAWN.z) > 12 && this.chests.every((c) => Math.hypot(c.x - x, c.z - z) > 14));
    const pick = () => this.market[Math.floor(this.rnd() * this.market.length)].ticker;
    const loot = {};
    const add = (t, n) => { loot[t] = (loot[t] ?? 0) + n; };
    if (rarity === 'common') add(pick(), 5 + Math.floor(this.rnd() * 16));
    if (rarity === 'rare') { add(pick(), 20 + Math.floor(this.rnd() * 40)); add(pick(), 10 + Math.floor(this.rnd() * 20)); }
    if (rarity === 'legendary') add(pick(), 60 + Math.floor(this.rnd() * 60));
    this.chests.push({ id: `c${this.nextId++}`, x: p.x, z: p.z, rarity, loot });
  }

  nearestChest(x, z) {
    let best = null, bd = Infinity;
    for (const c of this.chests) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
    return { chest: best, dist: bd };
  }

  // ---------------------------------------------------------------- players
  join({ name, kind = 'agent', look } = {}) {
    const id = `p${this.nextId++}`;
    const clean = String(name ?? '').replace(/[^\w .-]/g, '').slice(0, 20) || `${kind}-${id}`;
    const p = {
      id, name: clean, kind, look: LOOKS.includes(look) ? look : LOOKS[this.players.size % LOOKS.length],
      x: SPAWN.x + (this.rnd() - 0.5) * 6, z: SPAWN.z + (this.rnd() - 0.5) * 6, heading: Math.PI,
      move: null, path: null, pathWaiters: [], anim: 'idle', say: null, sayT: 0, emote: null, emoteT: 0,
      dig: null, detect: { signal: 0, bars: 0, t: 0 }, portfolio: {}, found: 0, lastSeen: this.now(), stuckT: 0, wallet: null,
    };
    p.y = groundAt(p.x, p.z);
    this.players.set(id, p);
    this.pushEvent({ kind: 'join', who: p.name });
    return p;
  }

  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.pathWaiters.forEach((w) => w({ ok: false, status: 'left' }));
    this.players.delete(id);
    this.pushEvent({ kind: 'leave', who: p.name });
  }

  pushEvent(e) {
    this.events.push({ ...e, t: this.now() });
    if (this.events.length > 60) this.events.shift();
  }

  portfolioValue(p) {
    let v = 0;
    for (const [t, n] of Object.entries(p.portfolio)) {
      const m = this.market.find((s) => s.ticker === t);
      v += m ? m.price * n : 250 * n; // real drops valued at a flat paper 250
    }
    return round(v);
  }

  // ---------------------------------------------------------------- actions (shared by humans + agents)
  act(id, action, args = {}) {
    const p = this.players.get(id);
    if (!p) return { ok: false, error: 'not in the game' };
    p.lastSeen = this.now();
    const busy = p.dig && action !== 'state' && action !== 'look' && action !== 'leaderboard' && action !== 'say';
    if (busy) return { ok: false, error: 'busy digging' };
    switch (action) {
      case 'move': {
        const dx = Number(args.dx) || 0, dz = Number(args.dz) || 0, l = Math.hypot(dx, dz);
        this.cancelPath(p, 'interrupted');
        p.move = l > 0.05 ? { dx: dx / Math.max(1, l), dz: dz / Math.max(1, l) } : null;
        return { ok: true };
      }
      case 'stop': this.cancelPath(p, 'stopped'); p.move = null; return { ok: true };
      case 'walk_to': {
        const t = this.resolveTarget(args.target ?? args);
        if (!t) return { ok: false, error: 'unknown target', landmarks: this.landmarks().map((l) => l.name) };
        const path = findPath(p.x, p.z, t.x, t.z);
        if (!path) return { ok: false, error: 'unreachable' };
        this.cancelPath(p, 'interrupted');
        p.move = null;
        p.path = path;
        const promise = new Promise((resolve) => p.pathWaiters.push(resolve));
        return args.wait === false ? { ok: true, status: 'walking', waypoints: path.length } : promise;
      }
      case 'detect': {
        const { dist } = this.nearestChest(p.x, p.z);
        const signal = dist < DETECT_RANGE ? round(Math.pow(1 - dist / DETECT_RANGE, 1.6), 3) : 0;
        // 5 bars means "within digging reach"
        const bars = dist < 2.0 ? 5 : dist < 5 ? 4 : dist < 10 ? 3 : dist < 17 ? 2 : dist < DETECT_RANGE ? 1 : 0;
        p.detect = { signal, bars, t: this.t };
        return { ok: true, signal, bars, hint: bars >= 5 ? 'right here, dig!' : bars >= 3 ? 'very close' : bars >= 1 ? 'something nearby' : 'nothing in range' };
      }
      case 'dig': {
        this.cancelPath(p, 'interrupted');
        p.move = null;
        p.anim = 'dig';
        return new Promise((resolve) => { p.dig = { t: DIG_TIME, resolve }; });
      }
      case 'say': {
        const text = String(args.text ?? '').slice(0, 140);
        if (!text) return { ok: false, error: 'text required' };
        p.say = text; p.sayT = 5;
        this.pushEvent({ kind: 'say', who: p.name, text });
        return { ok: true };
      }
      case 'emote': {
        if (!EMOTES.includes(args.name)) return { ok: false, error: 'unknown emote', emotes: EMOTES };
        p.emote = args.name; p.emoteT = 2.5;
        return { ok: true };
      }
      case 'link_wallet_challenge': {
        if (!this.prizes?.enabled) return { ok: false, error: 'real prizes are off on this server' };
        return { ok: true, message: this.prizes.challenge(p), how: 'sign this exact message with your wallet (personal_sign), then call link_wallet with { address, signature }' };
      }
      case 'link_wallet': {
        if (!this.prizes?.enabled) return { ok: false, error: 'real prizes are off on this server' };
        return this.prizes.link(p, args);
      }
      case 'prizes': {
        if (!this.prizes?.enabled) return { ok: false, error: 'real prizes are off on this server' };
        return this.prizes.list(p);
      }
      case 'state': return { ok: true, ...this.view(p) };
      case 'look': return { ok: true, ...this.look(p) };
      case 'leaderboard': return { ok: true, leaderboard: this.leaderboard() };
      case 'landmarks': return { ok: true, landmarks: this.landmarks() };
      default: return { ok: false, error: `unknown action ${action}`, actions: ACTIONS };
    }
  }

  cancelPath(p, status) {
    if (p.pathWaiters.length) p.pathWaiters.splice(0).forEach((w) => w({ ok: false, status, position: { x: round(p.x), z: round(p.z) } }));
    p.path = null;
  }

  landmarks() {
    return [
      { name: 'spawn', x: round(SPAWN.x), z: round(SPAWN.z) },
      ...MESAS.map((m) => ({ name: m.ticker, kind: 'mesa', x: round(m.x), z: round(m.z + m.r * 0.9) })),
    ];
  }

  resolveTarget(t) {
    if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) return { x: Math.max(-SIZE / 2 + 3, Math.min(SIZE / 2 - 3, t.x)), z: Math.max(-SIZE / 2 + 3, Math.min(SIZE / 2 - 3, t.z)) };
    if (typeof t === 'string') {
      const lm = this.landmarks().find((l) => l.name.toLowerCase() === t.toLowerCase());
      if (lm) return lm;
      const other = [...this.players.values()].find((o) => o.name.toLowerCase() === t.toLowerCase());
      if (other) return { x: other.x, z: other.z };
    }
    return null;
  }

  view(p) {
    return {
      you: { id: p.id, name: p.name, look: p.look, wallet: p.wallet, x: round(p.x), y: round(p.y), z: round(p.z), heading: round(p.heading), anim: p.anim, walking: !!p.path || !!p.move, digging: !!p.dig },
      detector: { signal: p.detect.signal, bars: p.detect.bars, secondsAgo: round(this.t - p.detect.t, 1) },
      portfolio: { holdings: p.portfolio, value: this.portfolioValue(p), chestsFound: p.found },
      market: this.market.map((s) => ({ ticker: s.ticker, price: round(s.price), change: round(((s.price - s.open) / s.open) * 100, 1) })),
      nearby: this.look(p).players,
      recent: this.events.slice(-8),
      rules: 'Walk around, call detect often (bars 0-5 rise as you near a buried chest), dig when bars are 5. Chests hold made-up stocks. Legendary chests also win a real tokenized stock from the daily prize pool if you linked a wallet (one per wallet per day); collect it with the prizes action.',
      realPrizes: this.prizes?.enabled ? this.prizes.stats() : { mode: 'off' },
    };
  }

  look(p) {
    const players = [...this.players.values()].filter((o) => o !== p)
      .map((o) => ({ name: o.name, kind: o.kind, x: round(o.x), z: round(o.z), distance: round(Math.hypot(o.x - p.x, o.z - p.z), 1), anim: o.anim, say: o.say }))
      .sort((a, b) => a.distance - b.distance).slice(0, 8);
    const holes = this.holes.filter((h) => Math.hypot(h.x - p.x, h.z - p.z) < 30).map((h) => ({ x: round(h.x), z: round(h.z), found: h.found }));
    return { players, holes, landmarks: this.landmarks() };
  }

  leaderboard() {
    return [...this.players.values()].map((p) => ({ name: p.name, kind: p.kind, value: this.portfolioValue(p), chests: p.found }))
      .sort((a, b) => b.value - a.value).slice(0, 20);
  }

  // ---------------------------------------------------------------- simulation
  tick(dt) {
    this.t += dt;
    // made-up stock market: small random walk, occasional spikes
    this.marketT += dt;
    if (this.marketT > 4) {
      this.marketT = 0;
      for (const s of this.market) {
        const shock = this.rnd() < 0.03 ? (this.rnd() - 0.4) * 0.3 : 0;
        s.price = Math.max(0.05, s.price * (1 + (this.rnd() - 0.5) * 0.03 + shock));
        s.history.push(round(s.price, 3));
        if (s.history.length > 90) s.history.shift();
      }
    }
    for (const p of this.players.values()) {
      if (p.sayT > 0 && (p.sayT -= dt) <= 0) p.say = null;
      if (p.emoteT > 0 && (p.emoteT -= dt) <= 0) p.emote = null;
      if (p.dig) { this.tickDig(p, dt); continue; }
      let dir = null;
      if (p.path) {
        const w = p.path[0];
        const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
        // progress watchdog: sliding along a ledge counts as moving but can orbit a
        // waypoint forever, so judge by getting closer, not by moving at all
        if (w !== p.wp) { p.wp = w; p.wpBest = d; p.wpT = 0; }
        if (d < p.wpBest - 0.25) { p.wpBest = d; p.wpT = 0; } else p.wpT += dt;
        const last = p.path.length === 1;
        const close = last && p.wpT > 1.5 && d < 1.6; // good enough, it's a ledge
        if (d < (last ? 0.6 : 1.2) || close || (!last && p.wpT > 1.5 && d < 2.5)) {
          p.path.shift();
          if (!p.path.length) { p.path = null; p.pathWaiters.splice(0).forEach((r) => r({ ok: true, status: 'arrived', position: { x: round(p.x), z: round(p.z) } })); }
        } else if (p.wpT > 3) { this.cancelPath(p, 'blocked'); p.anim = 'idle'; }
        else dir = { dx: dx / d, dz: dz / d };
      } else if (p.move) dir = p.move;
      if (dir) {
        const want = Math.atan2(dir.dx, dir.dz);
        let dh = want - p.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, dt * 12);
        const step = SPEED * dt;
        let moved = false;
        for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.4, -1.4]) {
          const a = want + off, nx = p.x + Math.sin(a) * step, nz = p.z + Math.cos(a) * step;
          if (canStep(p.x, p.z, nx, nz)) { p.x = nx; p.z = nz; moved = true; break; }
        }
        p.anim = moved ? 'walk' : 'idle';
        if (!moved) {
          p.stuckT += dt;
          if (p.path && p.stuckT > 2) { this.cancelPath(p, 'blocked'); p.stuckT = 0; }
        } else p.stuckT = 0;
      } else if (p.anim === 'walk') p.anim = 'idle';
      p.y = groundAt(p.x, p.z);
    }
    // holes fade after 3 minutes
    this.holes = this.holes.filter((h) => this.t - h.t < 180);
    // idle agents time out after 10 minutes (one waiting on its own action isn't idle)
    for (const p of [...this.players.values()]) {
      if (p.pathWaiters.length || p.dig) p.lastSeen = this.now();
      else if (p.kind === 'agent' && this.now() - p.lastSeen > 600_000) this.leave(p.id);
    }
  }

  // the hole appears just in front of the digger, where the shovel goes in
  digSpot(p) { return { x: p.x + Math.sin(p.heading) * 0.75, z: p.z + Math.cos(p.heading) * 0.75 }; }

  tickDig(p, dt) {
    p.dig.t -= dt;
    if (p.dig.t > 0) return;
    const resolve = p.dig.resolve;
    p.dig = null;
    const { chest, dist } = this.nearestChest(p.x, p.z);
    if (chest && dist < 2.2) {
      this.chests.splice(this.chests.indexOf(chest), 1);
      for (const [t, n] of Object.entries(chest.loot)) p.portfolio[t] = (p.portfolio[t] ?? 0) + n;
      p.found++;
      p.anim = 'cheer'; p.emote = 'cheer'; p.emoteT = 2;
      this.holes.push({ ...this.digSpot(p), t: this.t, found: chest.rarity });
      this.pushEvent({ kind: 'chest', who: p.name, rarity: chest.rarity, loot: chest.loot });
      this.spawnChest();
      const result = { ok: true, found: true, rarity: chest.rarity, loot: chest.loot, portfolioValue: this.portfolioValue(p) };
      if (chest.rarity === 'legendary' && this.prizes) {
        resolve(this.prizes.award(p).then((prize) => {
          if (prize.won) this.pushEvent({ kind: 'prize', who: p.name, ticker: prize.prize.ticker, amount: prize.prize.amountTokens });
          return { ...result, realPrize: prize };
        }).catch(() => ({ ...result, realPrize: { won: false, reason: 'prize service error, try again later' } })));
      } else resolve(result);
    } else {
      p.anim = 'idle';
      this.holes.push({ ...this.digSpot(p), t: this.t, found: null });
      resolve({ ok: true, found: false, hint: 'nothing here. use detect and follow the bars up' });
    }
  }

  // compact snapshot for renderers
  snapshot() {
    return {
      t: round(this.t, 2),
      players: [...this.players.values()].map((p) => [p.id, p.name, p.kind, p.look, round(p.x), round(p.y), round(p.z), round(p.heading, 2), p.anim, p.say, p.emote, p.detect.bars, p.detect.t ? round(this.t - p.detect.t, 1) : null, p.dig ? round(1 - p.dig.t / DIG_TIME, 2) : null]),
      holes: this.holes.map((h) => [round(h.x), round(h.z), h.found, round(this.t - h.t, 1)]),
      market: this.market.map((s) => [s.ticker, round(s.price), round(((s.price - s.open) / s.open) * 100, 1)]),
      events: this.events.slice(-6),
    };
  }
}

export const ACTIONS = ['state', 'look', 'landmarks', 'leaderboard', 'move', 'stop', 'walk_to', 'detect', 'dig', 'say', 'emote', 'link_wallet_challenge', 'link_wallet', 'prizes'];
