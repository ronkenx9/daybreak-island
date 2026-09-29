// The Island Council: the loop that lets the island evolve itself.
//
// Every epoch: research (everyone can read the island report) and pitch ->
// debate -> vote -> enact. Pitches cost a small fee from the pitcher's own bag;
// backers pledge stock into the treasury; one vote per player. Passed pitches
// are funded best-first while the treasury can pay, and buildings then go up
// over a few minutes (faster when players help build).
//
// Agents never touch code or the server directly. They change the world only
// through this validated "genome": a catalogue of buildings (placed on flat,
// free land that keeps the island connected), rule knobs clamped to bounds,
// made-up stock listings, island events, upgrades and demolitions. Anything
// else goes on a ranked wishlist for the humans who maintain the game.
import { siteCheck, setObstacles, reachable, groundAt, SPAWN, MESAS, PIER, LIGHTHOUSE, pathDist, SIZE, MEETING_SPOT } from '../src/shared/world.js';

export const CATALOG = {
  'town-hall': { r: 7, cost: 900, time: 240, block: true, unique: true, desc: 'Round hall with a dome and a fire circle in front. The Insider emergency meetings and the council gather here instead of the beach campfire.' },
  plaza: { r: 9, cost: 300, time: 120, block: false, walk: true, desc: 'Paved square with benches, lamps and a fountain. A place for everyone to gather and hang out.' },
  exchange: { r: 6, cost: 800, time: 240, block: true, unique: true, desc: 'Stock exchange with a live ticker board. Needed before new made-up stocks can be listed.' },
  market: { r: 5, cost: 350, time: 150, block: true, range: 40, desc: 'Market stalls. Junk dug up within 40m is recycled into 2-6 units of a random made-up stock.' },
  'survey-tower': { r: 2.5, cost: 450, time: 180, block: true, range: 35, desc: 'Lattice tower with a beacon light. Metal detectors reach 40% further within 35m of it.' },
  beacon: { r: 2, cost: 600, time: 180, block: true, range: 45, desc: 'Glowing obelisk. 35% of new chests get buried within 45m of it, and rare chests are 1.5x as likely there.' },
  garden: { r: 6, cost: 200, time: 120, block: false, walk: true, desc: 'Flower garden with trees and a bench facing the sunset.' },
  statue: { r: 2, cost: 250, time: 90, block: true, desc: 'Golden statue honouring a player (set "honoree" to their name).' },
  lab: { r: 5, cost: 700, time: 240, block: true, unique: true, desc: 'Research lab with a dish. Every council report then includes a survey of where the richest chests are buried.' },
  bank: { r: 5, cost: 700, time: 240, block: true, unique: true, desc: 'Treasury vault. Raises the loot tax by 5 points and the treasury earns 2% every epoch.' },
  shelter: { r: 3, cost: 220, time: 100, block: true, desc: 'Sturdy stone hut. Anyone standing right next to any building is safe from hunting critters; shelters are the cheap way to add safe spots.' },
  road: { r: 1.6, cost: 40, per: 10, time: 60, block: false, walk: true, road: true, desc: 'Stone road from (x, z) to (x2, z2), up to 120m. Walkers move 30% faster on roads. Costs 40 per 10m.' },
};
export const RULES = {
  chestCount: { v: 24, min: 16, max: 40, step: 6, desc: 'chests buried on the island at once' },
  junkChance: { v: 0.5, min: 0.2, max: 0.7, step: 0.1, desc: 'chance an empty dig turns up junk' },
  digTime: { v: 1.8, min: 1.2, max: 2.6, step: 0.3, desc: 'seconds a dig takes' },
  rareRate: { v: 0.22, min: 0.12, max: 0.35, step: 0.05, desc: 'share of chests that are rare' },
  lootTax: { v: 0.1, min: 0.05, max: 0.25, step: 0.05, desc: 'share of chest loot paid into the treasury' },
  marketSwing: { v: 0.03, min: 0.01, max: 0.06, step: 0.01, desc: 'how wildly the made-up stocks move' },
  insiderBreak: { v: 60, min: 60, max: 900, step: 240, desc: 'seconds between Insider rounds' },
  critters: { v: 0, min: 0, max: 1, step: 1, desc: 'critters on (1) or off (0): monsters that roam in waves (see the critters pitch)' },
  critterEvery: { v: 8, min: 3, max: 20, step: 3, desc: 'minutes between critter waves' },
};
export const EVENTS = {
  festival: { cost: 300, minutes: 5, desc: 'Festival: chest loot is doubled for 5 minutes.' },
  'treasure-rush': { cost: 400, desc: 'Treasure rush: 6 extra chests (half of them rare) get buried within 30m of (x, z).' },
};
const REAL = ['TSLA', 'AMZN', 'NFLX', 'PLTR', 'AMD', 'AAPL', 'NVDA', 'MSFT', 'GOOG', 'META', 'COIN', 'HOOD'];
const DEFAULTS = { propose: 360, debate: 240, vote: 240, fee: 20, maxEnact: 3, maxPitches: 12, minYes: 2, maxStructures: 60 };
const clean = (t, n) => String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').trim().slice(0, n);
const r2 = (v) => Math.round(v * 100) / 100;

export class Council {
  constructor(game, opts = {}) {
    this.g = game;
    this.o = { ...DEFAULTS, ...opts };
    this.store = opts.store ?? null;
    this.epoch = 1;
    this.phase = 'propose';
    this.left = this.o.propose;
    this.treasury = {}; // ticker -> units
    this.structures = [];
    this.rules = Object.fromEntries(Object.entries(RULES).map(([k, d]) => [k, d.v]));
    this.listings = []; // extra made-up stocks the council listed
    this.proposals = [];
    this.chronicle = [];
    this.wishlist = []; // { text, by, score, epoch }
    this.events = []; // active island events { kind, until, ... }
    this.stats = this.freshStats();
    this.version = 1;
    this.nextId = 1;
    this.seeded = []; // keys of owner pitches already put on the agenda
    this.seeds = opts.seeds ?? [];
    this.load();
    this.sync();
  }

  freshStats() { return { chests: 0, junk: 0, loot: 0, digs: {}, visits: {}, crowd: {}, human: [] }; }

  // ---------------------------------------------------------------- persistence
  save() {
    this.version++;
    if (!this.store?.put) return;
    const { epoch, phase, left, treasury, structures, rules, listings, chronicle, wishlist, events, nextId, seeded } = this;
    const proposals = this.proposals.map((p) => ({ ...p, yes: [...p.yes], no: [...p.no] }));
    this.store.put('council', { epoch, phase, left, treasury, structures, rules, listings, chronicle, wishlist, events, nextId, proposals, seeded });
  }
  load() {
    const s = this.store?.get?.('council');
    if (!s) return;
    Object.assign(this, { epoch: s.epoch, phase: s.phase, left: s.left, treasury: s.treasury ?? {}, structures: s.structures ?? [], listings: s.listings ?? [], chronicle: s.chronicle ?? [], wishlist: s.wishlist ?? [], events: s.events ?? [], nextId: s.nextId ?? 1, seeded: s.seeded ?? [] });
    this.rules = { ...this.rules, ...(s.rules ?? {}) };
    this.proposals = (s.proposals ?? []).map((p) => ({ ...p, yes: new Set(p.yes), no: new Set(p.no) }));
    for (const l of this.listings) if (!this.g.market.some((m) => m.ticker === l.ticker)) this.g.market.push({ ...l, open: l.price, history: [l.price] });
  }
  /** push world changes into walking, the meeting spot and the game */
  sync() {
    setObstacles(this.structures.filter((s) => CATALOG[s.type]?.block).map((s) => ({ x: s.x, z: s.z, r: CATALOG[s.type].r * (1 + 0.15 * (s.level - 1)) })));
    const hall = this.structures.find((s) => s.type === 'town-hall' && s.progress >= 1);
    const spot = hall ? { x: hall.x + Math.sin(hall.rot) * (CATALOG['town-hall'].r + 7), z: hall.z + Math.cos(hall.rot) * (CATALOG['town-hall'].r + 7) } : { ...MEETING_SPOT };
    if (this.g.insider && this.g.insider.phase !== 'meeting' && this.g.insider.phase !== 'reveal') this.g.insider.spot = spot;
    this.meetingSpot = spot;
  }
  log(text, kind = 'council') {
    this.chronicle.push({ epoch: this.epoch, t: this.g.now(), text });
    if (this.chronicle.length > 200) this.chronicle.shift();
    this.g.pushEvent({ kind, text });
  }

  // ---------------------------------------------------------------- money
  priceOf(ticker) { return this.g.market.find((m) => m.ticker === ticker)?.price ?? 0; }
  treasuryValue() { return r2(Object.entries(this.treasury).reduce((v, [t, n]) => v + n * this.priceOf(t), 0)); }
  /** move units worth `value` out of a bag (biggest holdings first); returns the units taken or null if it can't */
  take(bag, value) {
    const worth = Object.entries(bag).reduce((v, [t, n]) => v + n * this.priceOf(t), 0);
    if (worth + 1e-9 < value) return null;
    const out = {};
    let need = value;
    for (const [t, n] of Object.entries(bag).sort((a, b) => b[1] * this.priceOf(b[0]) - a[1] * this.priceOf(a[0]))) {
      const p = this.priceOf(t);
      if (!p || need <= 0) continue;
      const k = Math.min(n, Math.ceil(need / p));
      out[t] = k; bag[t] -= k; need -= k * p;
      if (!bag[t]) delete bag[t];
    }
    return out;
  }
  deposit(units) { for (const [t, n] of Object.entries(units)) this.treasury[t] = (this.treasury[t] ?? 0) + n; }
  /** the loot tax: part of every chest goes to the treasury */
  taxLoot(loot) {
    const rate = this.rules.lootTax + (this.has('bank') ? 0.05 : 0);
    const kept = {}, tax = {};
    for (const [t, n] of Object.entries(loot)) { const k = Math.floor(n * rate); tax[t] = k; kept[t] = n - k; }
    this.deposit(tax);
    this.stats.loot += Object.entries(loot).reduce((v, [t, n]) => v + n * this.priceOf(t), 0);
    return kept;
  }
  has(type) { return this.structures.some((s) => s.type === type && s.progress >= 1); }
  active(type) { return this.structures.filter((s) => s.type === type && s.progress >= 1); }
  eventOn(kind) { return this.events.some((e) => e.kind === kind && e.until > this.g.t); }

  // ---------------------------------------------------------------- the genome: validate a pitch
  cost(kind, spec) {
    if (kind === 'build') { const c = CATALOG[spec.type]; return spec.type === 'road' ? Math.ceil(Math.hypot(spec.x2 - spec.x, spec.z2 - spec.z) / c.per) * c.cost : c.cost; }
    if (kind === 'upgrade') { const s = this.structures.find((q) => q.id === spec.target); return s ? CATALOG[s.type].cost * (s.level + 1) * 0.6 : 0; }
    if (kind === 'demolish') return 60;
    if (kind === 'rule') return 150;
    if (kind === 'listing') return 400;
    if (kind === 'event') return EVENTS[spec.event]?.cost ?? 0;
    return 0; // ideas are free to put on the wishlist
  }
  validate(kind, a, self = null) {
    const spec = {};
    if (kind === 'build') {
      const c = CATALOG[a.type];
      if (!c) return { error: `unknown building type "${a.type}". Types: ${Object.keys(CATALOG).join(', ')}` };
      spec.type = a.type;
      spec.x = r2(Number(a.x)); spec.z = r2(Number(a.z));
      spec.rot = Number.isFinite(Number(a.rot)) ? r2(Number(a.rot)) : r2(Math.atan2(SPAWN.x - spec.x, SPAWN.z - spec.z)); // face spawn by default
      spec.name = clean(a.name, 32) || null;
      if (c.unique && this.structures.some((s) => s.type === a.type)) return { error: `there is already a ${a.type} (only one allowed); pitch an upgrade instead` };
      if (this.structures.length >= this.o.maxStructures) return { error: 'the island is full of buildings; pitch a demolition first' };
      if (a.type === 'statue') { spec.honoree = clean(a.honoree, 20); if (!spec.honoree) return { error: 'a statue needs an "honoree" (a player name)' }; }
      if (a.type === 'road') {
        spec.x2 = r2(Number(a.x2)); spec.z2 = r2(Number(a.z2));
        const len = Math.hypot(spec.x2 - spec.x, spec.z2 - spec.z);
        if (!Number.isFinite(len) || len < 8 || len > 120) return { error: 'a road needs x, z, x2, z2 between 8 and 120m apart' };
        for (let k = 0; k <= 10; k++) { const x = spec.x + (spec.x2 - spec.x) * (k / 10), z = spec.z + (spec.z2 - spec.z) * (k / 10); if (groundAt(x, z) < 0.6) return { error: 'the road would run into the sea' }; }
        return { spec };
      }
      const site = siteCheck(spec.x, spec.z, c.r, { maxSlope: c.walk ? 1.4 : 2.8 });
      if (!site.ok) return { error: `can't build at (${spec.x}, ${spec.z}): ${site.reason}. Try one of the suggested sites in the report.` };
      for (const s of this.structures) {
        const d = Math.hypot(s.x - spec.x, s.z - spec.z), need = c.r + (CATALOG[s.type]?.r ?? 3) + 3;
        if (s.type !== 'road' && d < need) return { error: `too close to the ${s.type} "${s.name ?? s.id}" (${d.toFixed(0)}m, needs ${need.toFixed(0)}m)` };
      }
      for (const p of this.proposals) if (p !== self && p.status === 'open' && p.kind === 'build' && p.spec.type !== 'road' && Math.hypot(p.spec.x - spec.x, p.spec.z - spec.z) < c.r + CATALOG[p.spec.type].r + 3) return { error: `another pitch (${p.id}) already wants that spot` };
      if (c.block) {
        const before = reachable(), after = reachable({ x: spec.x, z: spec.z, r: c.r });
        if (before - after > Math.PI * c.r * c.r * 1.3 + 12) return { error: 'that would wall off part of the island' };
      }
      return { spec };
    }
    if (kind === 'upgrade' || kind === 'demolish') {
      const s = this.structures.find((q) => q.id === a.target);
      if (!s) return { error: `no building "${a.target}". Buildings: ${this.structures.map((q) => `${q.id} (${q.type})`).join(', ') || 'none yet'}` };
      if (kind === 'upgrade' && s.level >= 3) return { error: 'already at the top level (3)' };
      if (kind === 'upgrade' && s.progress < 1) return { error: 'still under construction' };
      return { spec: { target: s.id, type: s.type } };
    }
    if (kind === 'rule') {
      const d = RULES[a.rule];
      if (!d) return { error: `unknown rule "${a.rule}". Rules: ${Object.keys(RULES).join(', ')}` };
      let v = Number(a.value);
      if (!Number.isFinite(v)) return { error: 'value must be a number' };
      const cur = this.rules[a.rule];
      v = Math.max(d.min, Math.min(d.max, v));
      if (Math.abs(v - cur) > d.step + 1e-9) v = cur + Math.sign(v - cur) * d.step; // one step per pitch
      v = r2(v);
      if (v === cur) return { error: `${a.rule} is already ${cur} (range ${d.min}-${d.max})` };
      return { spec: { rule: a.rule, value: v, from: cur } };
    }
    if (kind === 'listing') {
      if (!this.has('exchange')) return { error: 'build an exchange first; listings need one' };
      const ticker = String(a.ticker ?? '').toUpperCase();
      if (!/^[A-Z]{3,5}$/.test(ticker)) return { error: 'ticker must be 3-5 letters' };
      if (REAL.includes(ticker)) return { error: 'that is a real company ticker; made-up stocks only' };
      if (this.g.market.some((m) => m.ticker === ticker) || this.proposals.some((p) => p !== self && p.status === 'open' && p.spec?.ticker === ticker)) return { error: 'ticker already taken' };
      if (this.g.market.length >= 12) return { error: 'the exchange is full (12 stocks)' };
      const name = clean(a.name, 28);
      if (!name) return { error: 'a listing needs a company name' };
      const price = Math.max(0.5, Math.min(25, Number(a.price) || 5));
      return { spec: { ticker, name, price: r2(price) } };
    }
    if (kind === 'event') {
      const e = EVENTS[a.event];
      if (!e) return { error: `unknown event. Events: ${Object.keys(EVENTS).join(', ')}` };
      const spec = { event: a.event };
      if (a.event === 'treasure-rush') { spec.x = r2(Number(a.x)); spec.z = r2(Number(a.z)); if (!(groundAt(spec.x, spec.z) > 1.3)) return { error: 'a treasure rush needs x, z on dry land' }; }
      return { spec };
    }
    if (kind === 'idea') {
      const text = clean(a.text ?? a.idea, 280);
      if (text.length < 12) return { error: 'describe the idea in a sentence' };
      return { spec: { text } };
    }
    return { error: 'kind must be one of: build, upgrade, demolish, rule, listing, event, idea' };
  }
  title(kind, spec) {
    if (kind === 'build') return spec.type === 'road' ? `Road (${Math.round(Math.hypot(spec.x2 - spec.x, spec.z2 - spec.z))}m)` : `${spec.name ?? spec.type}${spec.name ? ` (${spec.type})` : ''} at ${Math.round(spec.x)}, ${Math.round(spec.z)}`;
    if (kind === 'upgrade') return `Upgrade the ${spec.type} ${spec.target}`;
    if (kind === 'demolish') return `Demolish the ${spec.type} ${spec.target}`;
    if (kind === 'rule') return `${spec.rule}: ${spec.from} -> ${spec.value}`;
    if (kind === 'listing') return `List $${spec.ticker} (${spec.name})`;
    if (kind === 'event') return spec.event === 'festival' ? 'Festival (double loot)' : `Treasure rush near ${Math.round(spec.x)}, ${Math.round(spec.z)}`;
    return `Idea: ${spec.text.slice(0, 60)}`;
  }

  // ---------------------------------------------------------------- actions
  propose(p, args = {}) {
    if (this.phase !== 'propose') return { ok: false, error: `pitches open in the next epoch (now: ${this.phase}, ${Math.round(this.left)}s left)` };
    const kind = String(args.kind ?? '');
    const mine = this.proposals.filter((q) => q.epoch === this.epoch && q.byId === p.id && q.kind !== 'idea');
    if (kind !== 'idea' && mine.length >= 1) return { ok: false, error: 'one pitch per epoch (ideas for the wishlist are extra)' };
    if (this.proposals.filter((q) => q.epoch === this.epoch).length >= this.o.maxPitches) return { ok: false, error: 'the agenda is full this epoch; back someone else\'s pitch' };
    const v = this.validate(kind, args);
    if (v.error) return { ok: false, error: v.error };
    const fee = kind === 'idea' ? 0 : this.o.fee;
    if (fee) {
      const paid = this.take(p.portfolio, fee);
      if (!paid) return { ok: false, error: `a pitch costs $${fee} from your bag and you have $${this.g.portfolioValue(p)}; dig up some chests first` };
      this.deposit(paid);
    }
    const q = { id: `m${this.nextId++}`, epoch: this.epoch, by: p.name, byId: p.id, byKind: p.kind, kind, spec: v.spec, title: this.title(kind, v.spec), pitch: clean(args.pitch, 280), cost: r2(this.cost(kind, v.spec)), yes: new Set([p.id]), no: new Set(), backing: 0, backers: {}, comments: [], status: 'open' };
    this.proposals.push(q);
    this.g.pushEvent({ kind: 'pitch', who: p.name, text: q.title });
    this.save();
    return { ok: true, id: q.id, title: q.title, cost: q.cost, note: 'pitched. It needs more yes than no votes (at least 2 yes) and enough money in the treasury when the vote closes.' };
  }
  comment(p, args = {}) {
    const q = this.proposals.find((x) => x.id === args.id && x.status === 'open');
    if (!q) return { ok: false, error: 'no open pitch with that id' };
    const text = clean(args.text, 200);
    if (!text) return { ok: false, error: 'text required' };
    if (q.comments.filter((c) => c.who === p.name).length >= 3) return { ok: false, error: 'you already said your piece on this one (3 comments)' };
    q.comments.push({ who: p.name, text });
    this.save();
    return { ok: true };
  }
  vote(p, args = {}) {
    if (this.phase === 'propose') return { ok: false, error: 'voting opens after the pitches (debate and vote phases)' };
    const q = this.proposals.find((x) => x.id === args.id && x.status === 'open');
    if (!q) return { ok: false, error: 'no open pitch with that id' };
    const yes = args.vote === 'yes' || args.vote === true;
    q.yes.delete(p.id); q.no.delete(p.id);
    (yes ? q.yes : q.no).add(p.id);
    this.save();
    return { ok: true, id: q.id, vote: yes ? 'yes' : 'no', yes: q.yes.size, no: q.no.size };
  }
  pledge(p, args = {}) {
    const q = this.proposals.find((x) => x.id === args.id && x.status === 'open');
    if (!q) return { ok: false, error: 'no open pitch with that id' };
    const amount = Math.max(0, Math.min(5000, Number(args.amount) || 0));
    if (amount < 5) return { ok: false, error: 'pledge at least $5' };
    const paid = this.take(p.portfolio, amount);
    if (!paid) return { ok: false, error: `you only have $${this.g.portfolioValue(p)}` };
    this.deposit(paid);
    q.backing = r2(q.backing + amount);
    q.backers[p.name] = r2((q.backers[p.name] ?? 0) + amount);
    q.yes.add(p.id); q.no.delete(p.id);
    this.save();
    return { ok: true, id: q.id, backing: q.backing, treasury: this.treasuryValue(), note: 'your stock went into the island treasury, earmarked as backing for this pitch' };
  }
  /** help build: while you stand at a site and keep calling this, construction speeds up */
  help(p, args = {}) {
    const s = this.structures.find((x) => x.id === args.id) ?? this.structures.filter((x) => x.progress < 1).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!s || s.progress >= 1) return { ok: false, error: 'nothing under construction' };
    const d = s.type === 'road' ? 0 : Math.hypot(s.x - p.x, s.z - p.z);
    if (d > CATALOG[s.type].r + 7) return { ok: false, error: `walk to the site first (${d.toFixed(0)}m away at ${Math.round(s.x)}, ${Math.round(s.z)})`, site: { x: s.x, z: s.z } };
    p.helping = { id: s.id, until: this.g.t + 4 };
    p.anim = 'dig';
    return { ok: true, id: s.id, progress: r2(s.progress) };
  }

  /** the owner's pitches: put on the agenda once, free of charge, for the agents to argue over */
  plantSeeds() {
    for (const sd of this.seeds) {
      if (this.seeded.includes(sd.key)) continue;
      const v = this.validate(sd.kind, sd.args);
      if (v.error) continue;
      this.proposals.push({ id: `m${this.nextId++}`, epoch: this.epoch, by: sd.by, byId: null, byKind: 'owner', kind: sd.kind, spec: v.spec, title: this.title(sd.kind, v.spec), pitch: clean(sd.pitch, 400), cost: r2(this.cost(sd.kind, v.spec)), yes: new Set(), no: new Set(), backing: 0, backers: {}, comments: [], status: 'open' });
      this.seeded.push(sd.key);
      this.g.pushEvent({ kind: 'pitch', who: sd.by, text: this.title(sd.kind, v.spec) });
      this.save();
    }
  }

  // ---------------------------------------------------------------- clock
  tick(dt) {
    if (this.phase === 'propose' && this.seeds.length > this.seeded.length) this.plantSeeds();
    this.left -= dt;
    if (this.left <= 0) {
      if (this.phase === 'propose') { this.phase = 'debate'; this.left = this.o.debate; this.g.pushEvent({ kind: 'council', text: `Council epoch ${this.epoch}: debate is open on ${this.open().length} pitch(es).` }); }
      else if (this.phase === 'debate') { this.phase = 'vote'; this.left = this.o.vote; this.g.pushEvent({ kind: 'council', text: `Council epoch ${this.epoch}: voting is open.` }); }
      else this.enact();
      this.save();
    }
    // construction
    let changed = false;
    for (const s of this.structures) {
      if (s.progress >= 1) continue;
      const c = CATALOG[s.type];
      const helpers = [...this.g.players.values()].filter((p) => p.helping?.id === s.id && p.helping.until > this.g.t).length;
      s.progress = Math.min(1, s.progress + (dt / c.time) * (1 + 0.35 * Math.min(helpers, 6)));
      if (s.progress >= 1) { this.log(`${s.name ?? `The ${s.type}`} is finished${s.helpers?.length ? '' : ''}.`, 'built'); changed = true; }
    }
    // festival and other timed events end
    const before = this.events.length;
    this.events = this.events.filter((e) => e.until > this.g.t);
    if (changed || before !== this.events.length) { this.sync(); this.save(); }
    // research data: who is where (sampled every 2s)
    this.sampleT = (this.sampleT ?? 0) + dt;
    if (this.sampleT > 2) {
      this.sampleT = 0;
      for (const p of this.g.players.values()) {
        const q = quad(p.x, p.z);
        this.stats.crowd[q] = (this.stats.crowd[q] ?? 0) + 1;
        for (const s of this.structures) if (Math.hypot(s.x - p.x, s.z - p.z) < (CATALOG[s.type]?.r ?? 3) + 12) (this.stats.visits[s.id] ??= new Set()).add(p.name);
      }
    }
  }
  open() { return this.proposals.filter((p) => p.status === 'open'); }

  enact() {
    const players = this.g.players.size;
    const minYes = players <= 2 ? 1 : this.o.minYes;
    const open = this.open();
    const passed = open.filter((q) => q.yes.size > q.no.size && q.yes.size >= minYes).sort((a, b) => (b.yes.size - b.no.size) - (a.yes.size - a.no.size) || b.backing - a.backing);
    for (const q of open) if (!passed.includes(q)) q.status = 'failed';
    let done = 0;
    for (const q of passed) {
      if (q.kind === 'idea') { q.status = 'passed'; this.wishlist.push({ text: q.spec.text, by: q.by, score: q.yes.size - q.no.size, epoch: this.epoch }); this.wishlist.sort((a, b) => b.score - a.score); this.wishlist = this.wishlist.slice(0, 40); this.log(`${q.by}'s idea went on the island wishlist: "${q.spec.text.slice(0, 90)}"`); continue; }
      if (done >= this.o.maxEnact) { q.status = 'unfunded'; continue; }
      const again = this.validate(q.kind, q.spec, q);
      if (again.error && q.kind !== 'rule') { q.status = 'blocked'; this.log(`"${q.title}" passed but can't go ahead any more: ${again.error}`); continue; }
      if (this.treasuryValue() + 1e-9 < q.cost) { q.status = 'unfunded'; this.log(`"${q.title}" passed but the treasury ($${this.treasuryValue()}) can't cover $${q.cost} yet.`); continue; }
      const paid = this.take(this.treasury, q.cost);
      if (!paid) { q.status = 'unfunded'; continue; }
      this.apply(q);
      q.status = 'enacted';
      done++;
    }
    const failed = open.filter((q) => q.status === 'failed').length;
    this.g.pushEvent({ kind: 'council', text: `Council epoch ${this.epoch} closed: ${done} enacted, ${failed} voted down.` });
    // bank interest, then a fresh epoch
    if (this.has('bank')) for (const t of Object.keys(this.treasury)) this.treasury[t] = Math.round(this.treasury[t] * 1.02);
    this.lastReport = this.report(); // measure the epoch that just ended
    this.lastStats = this.stats;
    this.stats = this.freshStats();
    this.epoch++;
    this.phase = 'propose';
    this.left = this.o.propose;
    this.proposals = this.proposals.filter((q) => q.epoch >= this.epoch - 2); // keep recent history
    this.sync();
    this.save();
  }
  apply(q) {
    const s = q.spec;
    if (q.kind === 'build') {
      const b = { id: `b${this.nextId++}`, type: s.type, x: s.x, z: s.z, rot: s.rot ?? 0, name: s.name, honoree: s.honoree ?? null, x2: s.x2 ?? null, z2: s.z2 ?? null, level: 1, progress: 0, by: q.by, epoch: this.epoch };
      this.structures.push(b);
      this.log(`${q.by}'s pitch passed: ${q.title}. Construction starts now; come help build.`);
      // anyone standing where the walls go gets nudged out, and chests buried there move
      const c = CATALOG[s.type];
      if (c.block) { const before = this.g.chests.length; this.g.chests = this.g.chests.filter((ch) => ch.rarity === 'bag' || Math.hypot(ch.x - s.x, ch.z - s.z) > c.r + 1.5); for (let k = this.g.chests.length; k < before; k++) this.g.spawnChest(); }
      if (c.block) for (const p of this.g.players.values()) { const d = Math.hypot(p.x - s.x, p.z - s.z); if (d < c.r + 0.8) { const a = Math.atan2(p.x - s.x, p.z - s.z) || 0; p.x = s.x + Math.sin(a) * (c.r + 1.5); p.z = s.z + Math.cos(a) * (c.r + 1.5); p.path = null; } }
    } else if (q.kind === 'upgrade') {
      const b = this.structures.find((x) => x.id === s.target);
      if (b) { b.level++; this.log(`${b.name ?? `The ${b.type}`} was upgraded to level ${b.level} (${q.by}'s pitch).`); }
    } else if (q.kind === 'demolish') {
      const i = this.structures.findIndex((x) => x.id === s.target);
      if (i >= 0) { const [b] = this.structures.splice(i, 1); this.log(`${b.name ?? `The ${b.type}`} was demolished (${q.by}'s pitch).`); }
    } else if (q.kind === 'rule') {
      this.rules[s.rule] = s.value;
      this.log(`Rule change (${q.by}): ${s.rule} is now ${s.value} (was ${s.from}).`);
    } else if (q.kind === 'listing') {
      const l = { ticker: s.ticker, name: s.name, price: s.price, listedBy: q.by };
      this.listings.push(l);
      this.g.market.push({ ...l, open: l.price, history: [l.price] });
      this.log(`$${s.ticker} (${s.name}) is now listed on the exchange, pitched by ${q.by}. Chests can hold it from now on.`);
    } else if (q.kind === 'event') {
      if (s.event === 'festival') { this.events.push({ kind: 'festival', until: this.g.t + EVENTS.festival.minutes * 60 }); this.log(`Festival! Chest loot is doubled for ${EVENTS.festival.minutes} minutes (${q.by}'s pitch).`); }
      if (s.event === 'treasure-rush') { for (let k = 0; k < 6; k++) this.g.spawnChest({ near: { x: s.x, z: s.z, r: 30 }, rarity: k % 2 ? 'rare' : 'common' }); this.log(`Treasure rush: 6 chests were just buried near ${Math.round(s.x)}, ${Math.round(s.z)} (${q.by}'s pitch).`); }
    }
  }

  // ---------------------------------------------------------------- effects the game asks about
  detectRange(x, z, base) {
    let k = 1;
    for (const s of this.active('survey-tower')) if (Math.hypot(s.x - x, s.z - z) < CATALOG['survey-tower'].range * (1 + 0.25 * (s.level - 1))) k = Math.max(k, 1.4 + 0.1 * (s.level - 1));
    return base * k;
  }
  chestSpot() {
    const beacons = this.active('beacon');
    if (!beacons.length || this.g.rnd() > 0.35) return null;
    const b = beacons[Math.floor(this.g.rnd() * beacons.length)];
    return { x: b.x, z: b.z, r: CATALOG.beacon.range * (1 + 0.25 * (b.level - 1)), rareBoost: 1.5 };
  }
  recycles(x, z) { return this.active('market').some((s) => Math.hypot(s.x - x, s.z - z) < CATALOG.market.range * (1 + 0.25 * (s.level - 1))); }
  onRoad(x, z) {
    for (const s of this.structures) {
      if (s.type !== 'road' || s.progress < 1) continue;
      const vx = s.x2 - s.x, vz = s.z2 - s.z, l2 = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - s.x) * vx + (z - s.z) * vz) / l2));
      if (Math.hypot(x - (s.x + vx * t), z - (s.z + vz * t)) < 2) return true;
    }
    return false;
  }
  /** inside (or right against) a building's walls: no chests go there */
  blocked(x, z, pad = 1.5) {
    return this.structures.some((s) => CATALOG[s.type]?.block && Math.hypot(s.x - x, s.z - z) < CATALOG[s.type].r * (1 + 0.15 * (s.level - 1)) + pad);
  }
  /** a player right next to any finished building is sheltered (critters can't see them) */
  sheltered(x, z) {
    return this.structures.some((s) => s.progress >= 1 && CATALOG[s.type].block && Math.hypot(s.x - x, s.z - z) < CATALOG[s.type].r + 2.2);
  }
  recordDig(x, z, found) { const q = quad(x, z); this.stats.digs[q] = (this.stats.digs[q] ?? 0) + 1; if (found) this.stats.chests++; else this.stats.junk++; }
  heard(p, text) { if (p.kind === 'human') { this.stats.human.push(`${p.name}: ${text}`); this.stats.human = this.stats.human.slice(-8); } }

  // ---------------------------------------------------------------- research: the island report
  sites(n = 8) {
    const out = [];
    const land = [{ name: 'spawn', x: SPAWN.x, z: SPAWN.z }, { name: 'the pier', x: PIER.x, z: PIER.z0 }, { name: 'the lighthouse', x: LIGHTHOUSE.x, z: LIGHTHOUSE.z }, ...MESAS.map((m) => ({ name: `the ${m.ticker} hill`, x: m.x, z: m.z })), { name: 'the island centre', x: 0, z: 10 }];
    for (let x = -130; x <= 130; x += 12) for (let z = -120; z <= 150; z += 12) {
      const c = siteCheck(x, z, 9, { maxSlope: 1.4 });
      if (!c.ok || this.structures.some((s) => Math.hypot(s.x - x, s.z - z) < (CATALOG[s.type]?.r ?? 3) + 12)) continue;
      const near = land.map((l) => ({ ...l, d: Math.hypot(l.x - x, l.z - z) })).sort((a, b) => a.d - b.d)[0];
      out.push({ x, z, flat: c.slope < 0.6 ? 'very flat' : 'flat', near: `${Math.round(near.d)}m from ${near.name}`, fromSpawn: Math.round(Math.hypot(x - SPAWN.x, z - SPAWN.z)) });
    }
    // favour central, reachable spots; keep a spread
    out.sort((a, b) => Math.hypot(a.x, a.z - 20) - Math.hypot(b.x, b.z - 20));
    const pick = [];
    for (const s of out) { if (pick.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 30)) pick.push(s); if (pick.length >= n) break; }
    return pick;
  }
  report() {
    const obs = [];
    const hall = this.structures.find((s) => s.type === 'town-hall');
    if (!hall) obs.push(`There is no town centre. The Insider meeting circle is a small campfire on the beach edge right by spawn (${Math.round(MEETING_SPOT.x)}, ${Math.round(MEETING_SPOT.z)}), a few steps from the sea. The middle of the island (around 0, 10) is empty grass.`);
    if (!this.has('exchange')) obs.push('There is no exchange: nobody can list new made-up stocks yet.');
    if (!this.structures.length) obs.push('Nothing has been built by the council yet. The island has a pier, a lighthouse, five beach huts and five company hills (TSLA, AMZN, NFLX, PLTR, AMD) in the north.');
    const st = this.stats;
    const digs = Object.entries(st.digs).sort((a, b) => b[1] - a[1]);
    const crowd = Object.entries(st.crowd).sort((a, b) => b[1] - a[1]);
    if (digs.length) obs.push(`This epoch so far: ${st.chests} chests found and ${st.junk} empty digs; most digging in the ${digs[0][0]}.`);
    if (crowd.length) obs.push(`Players spend most time in the ${crowd[0][0]}${crowd[1] ? ` and the ${crowd[1][0]}` : ''}; least in the ${crowd.at(-1)[0]}.`);
    for (const s of this.structures) {
      const v = this.lastStats?.visits?.[s.id]?.size ?? st.visits[s.id]?.size ?? 0;
      obs.push(`${s.name ?? s.type} (${s.id}, ${s.type}, level ${s.level}) at ${Math.round(s.x)}, ${Math.round(s.z)}: ${s.progress < 1 ? `under construction ${Math.round(s.progress * 100)}%` : `${v} different visitors lately`}.`);
    }
    if (this.has('lab')) {
      const best = [...this.g.chests].sort((a, b) => ({ legendary: 3, rare: 2, common: 1 }[b.rarity] - { legendary: 3, rare: 2, common: 1 }[a.rarity]))[0];
      if (best) obs.push(`Lab survey: the richest buried chest is somewhere in the ${quad(best.x, best.z)}.`);
    }
    if (this.rules.critters) obs.push('Critters are ON: hunters roam in waves (hide in a dug hide-hole or next to a building), fighters can be beaten together for stock.');
    if (st.human.length) obs.push(`Humans said: ${st.human.slice(-4).map((h) => `"${h}"`).join(' ')}`);
    return {
      epoch: this.epoch, phase: this.phase, secondsLeft: Math.round(this.left), treasury: this.treasuryValue(), taxRate: this.rules.lootTax + (this.has('bank') ? 0.05 : 0),
      observations: obs,
      suggestedSites: this.sites(),
      lastEpoch: this.lastEpochSummary(),
      wishlist: this.wishlist.slice(0, 5).map((w) => `${w.text} (${w.by}, +${w.score})`),
    };
  }
  lastEpochSummary() {
    const prev = this.proposals.filter((q) => q.epoch === this.epoch - 1);
    return prev.map((q) => `${q.title} by ${q.by}: ${q.status} (${q.yes.size} yes, ${q.no.size} no)`);
  }
  /** everything a player (or agent) needs to take part */
  view(p) {
    return {
      ok: true,
      epoch: this.epoch, phase: this.phase, secondsLeft: Math.round(this.left),
      how: 'propose (phase "propose") -> debate: comment -> vote: council_vote yes/no, pledge stock to back a pitch -> passed pitches are built from the treasury; walk to a construction site and call build to speed it up.',
      treasury: { value: this.treasuryValue(), units: this.treasury },
      yourBag: p ? this.g.portfolioValue(p) : null,
      pitchFee: this.o.fee,
      catalog: Object.fromEntries(Object.entries(CATALOG).map(([k, c]) => [k, { cost: c.cost, footprint: c.r, ...(c.unique ? { unique: true } : {}), what: c.desc }])),
      rules: Object.fromEntries(Object.entries(RULES).map(([k, d]) => [k, { now: this.rules[k], min: d.min, max: d.max, stepPerPitch: d.step, what: d.desc }])),
      events: Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, { cost: e.cost, what: e.desc }])),
      otherCosts: { rule: 150, listing: 400, upgrade: 'building cost x (level+1) x 0.6', demolish: 60, idea: 0 },
      market: this.g.market.map((m) => m.ticker),
      buildings: this.structures.map((s) => ({ id: s.id, type: s.type, name: s.name, x: s.x, z: s.z, level: s.level, progress: r2(s.progress), by: s.by })),
      pitches: this.proposals.filter((q) => q.epoch === this.epoch).map((q) => ({ id: q.id, by: q.by, kind: q.kind, title: q.title, pitch: q.pitch, cost: q.cost, yes: q.yes.size, no: q.no.size, backing: q.backing, comments: q.comments, status: q.status, yourVote: p ? (q.yes.has(p.id) ? 'yes' : q.no.has(p.id) ? 'no' : null) : null })),
      report: this.report(),
      chronicle: this.chronicle.slice(-10).map((c) => `epoch ${c.epoch}: ${c.text}`),
    };
  }
  public() {
    return {
      v: this.version, epoch: this.epoch, phase: this.phase, left: Math.max(0, Math.round(this.left)), treasury: this.treasuryValue(),
      pitches: this.proposals.filter((q) => q.epoch === this.epoch).length,
      festival: this.eventOn('festival'),
    };
  }
  structuresSnap() { return this.structures.map((s) => [s.id, s.type, s.x, s.z, s.rot, r2(s.progress), s.level, s.name, s.honoree, s.x2, s.z2]); }
}

export function quad(x, z) {
  if (Math.hypot(x, z - 10) < 45) return 'island centre';
  return `${z < 10 ? 'north' : 'south'}${x < 0 ? '-west' : '-east'}`;
}
export { SIZE, pathDist };
