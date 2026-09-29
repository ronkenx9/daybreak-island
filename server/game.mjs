// Authoritative Treasure Hunt simulation. Humans (WebSocket) and agents
// (HTTP/MCP) call the same actions; the server owns positions, hidden chests,
// the detector, digging and everyone's portfolio.
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { InsiderGame } from './insider.mjs';
import { Council, CATALOG } from './council.mjs';
import { Critters } from './critters.mjs';
import {
  groundAt, canStep, findPath, randomLandPoint, SPAWN, MESAS, SIZE, PIER, LIGHTHOUSE, MEETING_SPOT,
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
const DETECT_COOLDOWN = 0.25; // readings refresh at most 4x a second; faster calls get the last one
// digging where nothing is buried: often junk, for the laughs
export const JUNK = {
  boot: 'a rusty boot', cap: 'a bottle cap', phone: 'an old flip phone', duck: 'a rubber duck',
  paperhands: 'a pair of paper hands', receipt: 'a soggy receipt', bag: 'an empty bag (you are the bag holder now)', can: 'a tin can',
};
// consecutive finds multiply made-up loot; a miss resets the streak
const STREAK_MULT = [1, 1, 1.5, 2, 2.5, 3];
export const streakMultiplier = (streak) => STREAK_MULT[Math.min(streak, STREAK_MULT.length - 1)];
const DETECT_RANGE = 28;
const EMOTES = ['wave', 'cheer', 'sad', 'dance', 'shrug'];

const rngFrom = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export class Game {
  constructor({ secret = randomBytes(16).toString('hex'), now = () => Date.now(), prizes = null, insider = {}, council = {}, store = null } = {}) {
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
    this.store = store;
    this.council = new Council(this, { ...council, store });
    this.critters = new Critters(this);
    while (this.chests.length < this.council.rules.chestCount) this.spawnChest();
    this.insider = new InsiderGame(this, insider);
    this.council.sync(); // the meeting circle may have moved to a town hall
  }
  get rules() { return this.council.rules; }

  // ---------------------------------------------------------------- chests
  spawnChest({ near = null, rarity: forced = null } = {}) {
    // a beacon draws some chests to itself (and they're richer there)
    const zone = near ?? this.council?.chestSpot() ?? null;
    const r = this.rnd(), rare = (this.council?.rules.rareRate ?? 0.22) * (zone?.rareBoost ?? 1);
    const rarity = forced ?? (r < 0.04 ? 'legendary' : r < 0.04 + rare ? 'rare' : 'common');
    const free = (x, z) => this.chests.every((c) => Math.hypot(c.x - x, c.z - z) > (zone ? 4 : 14)) && !this.council?.blocked(x, z);
    const p = randomLandPoint(this.rnd, (x, z) => Math.hypot(x - SPAWN.x, z - SPAWN.z) > 12 && free(x, z) && (!zone || Math.hypot(x - zone.x, z - zone.z) < zone.r));
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
  join({ name, kind = 'agent', look, key = null } = {}) {
    const id = `p${this.nextId++}`;
    const clean = String(name ?? '').replace(/[^\w .-]/g, '').slice(0, 20) || `${kind}-${id}`;
    const p = {
      id, name: clean, kind, look: LOOKS.includes(look) ? look : LOOKS[this.players.size % LOOKS.length],
      x: SPAWN.x + (this.rnd() - 0.5) * 6, z: SPAWN.z + (this.rnd() - 0.5) * 6, heading: 0, // facing the sea (and the sunset)
      move: null, path: null, pathWaiters: [], anim: 'idle', say: null, sayT: 0, emote: null, emoteT: 0,
      dig: null, detect: { signal: 0, bars: 0, t: 0, at: null }, portfolio: {}, found: 0, lastSeen: this.now(), stuckT: 0, wallet: null, streak: 0,
    };
    p.y = groundAt(p.x, p.z);
    // a saved bag: players who join with the same secret key keep what they dug up across visits
    if (typeof key === 'string' && key.length >= 16) {
      p.bagKey = createHash('sha256').update(`bag:${key}`).digest('hex');
      const saved = this.store?.get?.(`bag:${p.bagKey}`);
      if (saved?.portfolio) { p.portfolio = saved.portfolio; p.found = saved.found ?? 0; }
    }
    this.players.set(id, p);
    this.pushEvent({ kind: 'join', who: p.name });
    return p;
  }

  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.pathWaiters.forEach((w) => w({ ok: false, status: 'left' }));
    this.saveBag(p);
    this.players.delete(id);
    this.insider.onLeave(id);
    this.pushEvent({ kind: 'leave', who: p.name });
  }

  saveBag(p) { if (p.bagKey && this.store?.put) this.store.put(`bag:${p.bagKey}`, { portfolio: p.portfolio, found: p.found, name: p.name, t: this.now() }); }

  pushEvent(e) {
    this.evSeq = (this.evSeq ?? 0) + 1; // unique and ordered, even for events in the same millisecond
    this.events.push({ ...e, t: this.now(), id: this.evSeq });
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
    const busy = p.dig && !['state', 'look', 'leaderboard', 'say', 'insider', 'council', 'critters'].includes(action);
    if (busy) return { ok: false, error: 'busy digging' };
    if (p.meeting && ['move', 'walk_to', 'dig', 'face'].includes(action)) return { ok: false, error: 'you are in the emergency meeting: talk (say) and vote' };
    if (p.stunT > 0 && ['move', 'walk_to', 'dig', 'attack', 'build'].includes(action)) return { ok: false, error: 'dazed for a moment' };
    if (['move', 'walk_to', 'dig', 'build'].includes(action)) p.hidden = false; // moving gives your hiding spot away
    switch (action) {
      case 'move': {
        const dx = Number(args.dx) || 0, dz = Number(args.dz) || 0, l = Math.hypot(dx, dz);
        this.cancelPath(p, 'interrupted');
        p.move = l > 0.05 ? { dx: dx / Math.max(1, l), dz: dz / Math.max(1, l) } : null;
        return { ok: true };
      }
      case 'stop': this.cancelPath(p, 'stopped'); p.move = null; return { ok: true };
      case 'face': {
        // turn on the spot (third-person steering); walking also turns you
        const h = Number(args.heading);
        if (!Number.isFinite(h)) return { ok: false, error: 'heading (radians) required' };
        p.faceTo = Math.atan2(Math.sin(h), Math.cos(h));
        return { ok: true };
      }
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
        if (p.detect.at !== null && this.t - p.detect.at < DETECT_COOLDOWN) {
          const { signal, bars } = p.detect;
          return { ok: true, signal, bars, hint: bars >= 5 ? 'right here, dig!' : bars >= 3 ? 'very close' : bars >= 1 ? 'something nearby' : 'nothing in range', cached: true };
        }
        const { dist } = this.nearestChest(p.x, p.z);
        // a survey tower nearby stretches the detector's reach
        const range = this.council.detectRange(p.x, p.z, DETECT_RANGE), k = range / DETECT_RANGE;
        const signal = dist < range ? round(Math.pow(1 - dist / range, 1.6), 3) : 0;
        // 5 bars means "within digging reach"
        const bars = dist < 2.0 ? 5 : dist < 5 * k ? 4 : dist < 10 * k ? 3 : dist < 17 * k ? 2 : dist < range ? 1 : 0;
        p.detect = { signal, bars, t: this.t, at: this.t };
        return { ok: true, signal, bars, hint: bars >= 5 ? 'right here, dig!' : bars >= 3 ? 'very close' : bars >= 1 ? 'something nearby' : 'nothing in range' };
      }
      case 'dig': {
        this.cancelPath(p, 'interrupted');
        p.move = null;
        p.anim = 'dig';
        const aim = this.nearestChest(p.x, p.z);
        return new Promise((resolve) => { p.dig = { t: this.rules.digTime, len: this.rules.digTime, resolve, target: aim.chest && aim.dist < 2.2 ? aim.chest.id : null }; });
      }
      case 'say': {
        const text = String(args.text ?? '').slice(0, 140);
        if (!text) return { ok: false, error: 'text required' };
        p.say = text; p.sayT = 5;
        this.pushEvent({ kind: 'say', who: p.name, text });
        this.council.heard(p, text);
        return { ok: true };
      }
      case 'moment': {
        // a small public beat ("is watching the sunset"): shows in everyone's feed, at most one per 10s
        const text = String(args.text ?? '').replace(/[\r\n]+/g, ' ').slice(0, 80).trim();
        if (!text) return { ok: false, error: 'text required' };
        if (p.momentT && this.t - p.momentT < 10) return { ok: false, error: 'one moment per 10 seconds' };
        p.momentT = this.t;
        this.pushEvent({ kind: 'moment', who: p.name, text });
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
      case 'insider': return this.insider.status(p);
      case 'council': return this.council.view(p);
      case 'propose': return this.council.propose(p, args);
      case 'comment': return this.council.comment(p, args);
      case 'council_vote': return this.council.vote(p, args);
      case 'pledge': return this.council.pledge(p, args);
      case 'build': this.cancelPath(p, 'interrupted'); p.move = null; return this.council.help(p, args);
      case 'critters': return { ok: true, ...this.critters.status(p) };
      case 'attack': return this.critters.attack(p);
      case 'hide': this.cancelPath(p, 'stopped'); p.move = null; return this.critters.hide(p);
      case 'vote': return this.insider.vote(p, args.who);
      case 'leak': return this.insider.leak(p, args.text);
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
      { name: 'pier', kind: 'pier', x: round(PIER.x), z: round(PIER.z1 - 3) }, // the end of the pier: best sunset seat
      { name: 'lighthouse', kind: 'lighthouse', x: round(LIGHTHOUSE.x - Math.sign(LIGHTHOUSE.x) * 5), z: round(LIGHTHOUSE.z - 5) },
      { name: 'campfire', kind: 'campfire', x: round(this.insider?.spot?.x ?? MEETING_SPOT.x), z: round((this.insider?.spot?.z ?? MEETING_SPOT.z) + 2.5) },
      ...this.council.structures.filter((s) => s.type !== 'road').map((s) => { const r = (CATALOG[s.type]?.r ?? 3) + 2.5; return { name: s.name ?? s.type, kind: s.type, id: s.id, x: round(s.x + Math.sin(s.rot) * r), z: round(s.z + Math.cos(s.rot) * r), built: s.progress >= 1 }; }),
      { name: 'mountains', kind: 'mountains', x: 0, z: -100 },
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
      recent: this.events.slice(-14),
      council: { phase: this.council.phase, epoch: this.council.epoch, secondsLeft: Math.round(this.council.left), treasury: this.council.treasuryValue(), note: 'the island is run by its council: call council for the report, pitches and catalogue' },
      critters: this.critters.on ? this.critters.status(p) : 'off',
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
    this.insider.tick(dt);
    this.council.tick(dt);
    this.critters.tick(dt);
    if (this.chests.filter((c) => c.rarity !== 'bag').length < this.rules.chestCount) this.spawnChest();
    this.bagT = (this.bagT ?? 0) + dt;
    if (this.bagT > 30) { this.bagT = 0; for (const p of this.players.values()) this.saveBag(p); }
    // made-up stock market: small random walk, occasional spikes
    this.marketT += dt;
    if (this.marketT > 4) {
      this.marketT = 0;
      for (const s of this.market) {
        const shock = this.rnd() < 0.03 ? (this.rnd() - 0.4) * 0.3 : 0;
        s.price = Math.max(0.05, s.price * (1 + (this.rnd() - 0.5) * this.rules.marketSwing + shock));
        s.history.push(round(s.price, 3));
        if (s.history.length > 90) s.history.shift();
      }
    }
    for (const p of this.players.values()) {
      if (p.sayT > 0 && (p.sayT -= dt) <= 0) p.say = null;
      if (p.emoteT > 0 && (p.emoteT -= dt) <= 0) p.emote = null;
      if (p.dig) { this.tickDig(p, dt); continue; }
      if (p.helping && p.helping.until < this.t) { p.helping = null; if (p.anim === 'dig') p.anim = 'idle'; }
      if (p.stunT > 0) { p.path = null; p.move = null; p.anim = 'idle'; continue; }
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
        p.faceTo = null;
        const want = Math.atan2(dir.dx, dir.dz);
        let dh = want - p.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, dt * 12);
        const step = SPEED * (this.council.onRoad(p.x, p.z) ? 1.3 : 1) * dt;
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
      } else {
        if (p.anim === 'walk') p.anim = 'idle';
        if (p.faceTo !== undefined && p.faceTo !== null) {
          let dh = p.faceTo - p.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          p.heading += dh * Math.min(1, dt * 12);
        }
      }
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
    const { resolve, target } = p.dig;
    p.dig = null;
    const { chest, dist } = this.nearestChest(p.x, p.z);
    if (chest && dist < 2.2) {
      this.chests.splice(this.chests.indexOf(chest), 1);
      p.streak++;
      const multiplier = streakMultiplier(p.streak) * (this.council.eventOn('festival') ? 2 : 1);
      // part of every chest goes to the island treasury (a dropped bag is returned whole)
      const gross = Object.fromEntries(Object.entries(chest.loot).map(([t, n]) => [t, Math.round(n * (chest.rarity === 'bag' ? 1 : multiplier))]));
      const loot = chest.rarity === 'bag' ? gross : this.council.taxLoot(gross);
      this.council.recordDig(p.x, p.z, true);
      for (const [t, n] of Object.entries(loot)) p.portfolio[t] = (p.portfolio[t] ?? 0) + n;
      p.found++;
      p.anim = 'cheer'; p.emote = 'cheer'; p.emoteT = 2;
      this.holes.push({ ...this.digSpot(p), t: this.t, found: chest.rarity });
      this.pushEvent({ kind: 'chest', who: p.name, rarity: chest.rarity, loot, streak: p.streak, ...(chest.bag ? { bag: chest.bag } : {}) });
      const result = { ok: true, found: true, rarity: chest.rarity, loot, streak: p.streak, multiplier, portfolioValue: this.portfolioValue(p) };
      const clue = this.insider.onDig(p, true);
      if (clue) result.insiderClue = clue; // private: only the digger sees it
      if (chest.rarity === 'legendary' && this.prizes) {
        resolve(this.prizes.award(p).then((prize) => {
          if (prize.won) this.pushEvent({ kind: 'prize', who: p.name, ticker: prize.prize.ticker, amount: prize.prize.amountTokens });
          return { ...result, realPrize: prize };
        }).catch(() => ({ ...result, realPrize: { won: false, reason: 'prize service error, try again later' } })));
      } else resolve(result);
    } else {
      const lostStreak = p.streak;
      p.streak = 0;
      p.anim = 'idle';
      const beaten = target && !this.chests.some((c) => c.id === target);
      const junk = !beaten && this.rnd() < this.rules.junkChance ? Object.keys(JUNK)[Math.floor(this.rnd() * Object.keys(JUNK).length)] : null;
      this.holes.push({ ...this.digSpot(p), t: this.t, found: null, junk });
      this.council.recordDig(p.x, p.z, false);
      let recycled = null;
      if (junk && this.council.recycles(p.x, p.z)) {
        // the market takes junk off your hands for a few units of stock
        const t = this.market[Math.floor(this.rnd() * this.market.length)].ticker, n = 2 + Math.floor(this.rnd() * 5);
        p.portfolio[t] = (p.portfolio[t] ?? 0) + n; recycled = { [t]: n };
      }
      if (junk) { p.emote = 'sad'; p.emoteT = 2; this.pushEvent({ kind: 'junk', who: p.name, junk, label: JUNK[junk], ...(recycled ? { recycled } : {}) }); }
      const clue = this.insider.onDig(p, false);
      resolve({
        ...(clue ? { insiderClue: clue } : {}),
        ok: true, found: false, junk, junkLabel: junk ? JUNK[junk] : null, beaten: !!beaten, lostStreak, ...(recycled ? { recycled, note: 'the market recycled your junk into stock' } : {}),
        hint: beaten ? 'someone dug that chest up first!' : junk ? `you dug up ${JUNK[junk]}. use detect and follow the bars up` : 'nothing here. use detect and follow the bars up',
      });
    }
  }

  // compact snapshot for renderers
  snapshot() {
    return {
      t: round(this.t, 2),
      players: [...this.players.values()].map((p) => [p.id, p.name, p.kind, p.look, round(p.x), round(p.y), round(p.z), round(p.heading, 2), p.anim, p.say, p.emote, p.detect.bars, p.detect.at !== null ? round(this.t - p.detect.at, 1) : null, p.dig ? round(1 - p.dig.t / p.dig.len, 2) : null, p.hidden ? 1 : 0, p.stunT > 0 ? 1 : 0]),
      holes: this.holes.map((h) => [round(h.x), round(h.z), h.found, round(this.t - h.t, 1), h.junk ?? null]),
      market: this.market.map((s) => [s.ticker, round(s.price), round(((s.price - s.open) / s.open) * 100, 1)]),
      events: this.events.slice(-6),
      insider: this.insider.public(),
      council: this.council.public(),
      structures: this.council.structuresSnap(),
      critters: this.critters.snapshot(),
    };
  }
}

export const ACTIONS = ['state', 'look', 'landmarks', 'leaderboard', 'move', 'stop', 'face', 'walk_to', 'detect', 'dig', 'say', 'emote', 'moment', 'insider', 'vote', 'leak', 'council', 'propose', 'comment', 'council_vote', 'pledge', 'build', 'critters', 'attack', 'hide', 'link_wallet_challenge', 'link_wallet', 'prizes'];
