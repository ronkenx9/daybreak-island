// Insider: "Among Us for stocks", played on the same island as Treasure Hunt.
//
// A round: one secret insider knows which made-up stock pumps at the bell.
//   hunt     everyone digs; crew digs sometimes turn up a TRUE private clue about
//            the insider (hat colour, last seen near, chests found this round);
//            the insider may plant one fake rumour
//   meeting  everyone in the round is pulled into a circle, talks, and votes
//   reveal   catch the insider: the crew splits a bonus of the stock and the
//            pump is stopped. Miss: the stock pumps and the insider cashes in.
// Roles and the ticker are secret until the reveal. Humans and agents use the
// same actions: insider (your view of the round), vote, leak.
import { MEETING_SPOT } from '../src/shared/world.js';

export const HAT = { racer: 'a red cap', midnight: 'an orange beanie', electric: 'a yellow bucket hat', cloud: 'a straw hat', orbit: 'a white explorer hat', afterhours: 'a black beanie' };
const DEFAULTS = { minPlayers: 4, firstDelay: 45, cooldown: 60, hunt: 180, meeting: 90, reveal: 12, clueChance: 0.4, maxClues: 3 };
const round2 = (v) => Math.round(v * 100) / 100;

export class InsiderGame {
  constructor(game, opts = {}) {
    this.g = game;
    this.o = { ...DEFAULTS, ...opts };
    this.phase = 'lobby';
    this.round = 0;
    this.left = this.o.firstDelay;
    this.r = null; // current round
    this.last = null; // last result (public)
    this.spot = { ...MEETING_SPOT }; // meeting circle around the campfire
  }

  // ---------------------------------------------------------------- clock
  tick(dt) {
    this.left -= dt;
    if (this.phase === 'lobby') {
      if (this.left <= 0) { if (this.g.players.size >= this.o.minPlayers) this.startRound(); else this.left = 10; }
    } else if (this.phase === 'hunt') {
      this.pruneLeavers();
      if (this.left <= 0) this.startMeeting();
    } else if (this.phase === 'meeting') {
      this.pruneLeavers();
      if (this.left <= 0 || this.everyoneVoted()) this.reveal();
    } else if (this.phase === 'reveal' && this.left <= 0) {
      for (const id of this.r.ids) { const p = this.g.players.get(id); if (p) p.meeting = false; }
      this.phase = 'lobby'; this.left = this.o.cooldown; this.r = null;
    }
  }
  pruneLeavers() {
    if (!this.r) return;
    for (const id of [...this.r.ids]) if (!this.g.players.has(id)) this.r.ids.delete(id);
    if (!this.g.players.has(this.r.insider)) { // the insider left: the round is void
      this.last = { round: this.round, outcome: 'void', note: 'the insider left the island' };
      this.g.pushEvent({ kind: 'insider', text: 'The insider fled the island. Round called off.' });
      for (const id of this.r.ids) { const p = this.g.players.get(id); if (p) p.meeting = false; }
      this.phase = 'lobby'; this.left = this.o.cooldown; this.r = null;
    }
  }

  startRound() {
    const ids = [...this.g.players.keys()];
    const rnd = this.g.rnd;
    this.round++;
    const tickers = this.g.market.map((s) => s.ticker);
    this.r = {
      ids: new Set(ids),
      insider: ids[Math.floor(rnd() * ids.length)],
      ticker: tickers[Math.floor(rnd() * tickers.length)],
      clues: new Map(), // id -> [text]
      rumors: [],
      leaked: false,
      found: new Map(), // chests found this round per id
      votes: new Map(),
    };
    this.phase = 'hunt';
    this.left = this.o.hunt;
    this.g.pushEvent({ kind: 'insider', text: `Round ${this.round}: someone on the island knows which stock pumps at the bell. Find the insider before the meeting.` });
  }

  startMeeting() {
    this.phase = 'meeting';
    this.left = this.o.meeting;
    // everyone in the round gathers in a circle around the fire, facing in
    const ids = [...this.r.ids];
    ids.forEach((id, i) => {
      const p = this.g.players.get(id);
      if (!p) return;
      const a = (i / ids.length) * Math.PI * 2;
      this.g.cancelPath(p, 'meeting'); p.move = null;
      if (p.dig) { p.dig.resolve({ ok: false, error: 'emergency meeting!' }); p.dig = null; p.anim = 'idle'; }
      p.x = this.spot.x + Math.sin(a) * 3.4; p.z = this.spot.z + Math.cos(a) * 3.4;
      p.heading = a + Math.PI; p.faceTo = p.heading; p.meeting = true;
    });
    this.g.pushEvent({ kind: 'insider', text: 'EMERGENCY MEETING! Talk it out, then vote for the insider (or skip).' });
  }

  everyoneVoted() { return this.r && [...this.r.ids].every((id) => this.r.votes.has(id)); }

  reveal() {
    const r = this.r;
    const tally = new Map();
    for (const [, who] of r.votes) tally.set(who, (tally.get(who) ?? 0) + 1);
    const skip = tally.get('skip') ?? 0;
    tally.delete('skip');
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const ejected = top.length && top[0][1] > skip && (top.length === 1 || top[0][1] > top[1][1]) ? top[0][0] : null;
    const insider = this.g.players.get(r.insider);
    const caught = ejected === r.insider;
    const name = (id) => this.g.players.get(id)?.name ?? '?';
    const pay = (p, n) => { p.portfolio[r.ticker] = (p.portfolio[r.ticker] ?? 0) + n; };
    if (caught) {
      for (const id of r.ids) { const p = this.g.players.get(id); if (p && id !== r.insider) { pay(p, 25); p.emote = 'cheer'; p.emoteT = 3; } }
      if (insider) { insider.emote = 'sad'; insider.emoteT = 3; }
    } else {
      const m = this.g.market.find((s) => s.ticker === r.ticker);
      if (m) m.price = round2(m.price * 1.5); // the leak pays off: the stock pumps
      if (insider) { pay(insider, 80); insider.emote = 'dance'; insider.emoteT = 4; }
    }
    this.last = {
      round: this.round, outcome: caught ? 'caught' : 'escaped', insider: name(r.insider), ticker: r.ticker,
      ejected: ejected ? name(ejected) : null, votes: Object.fromEntries([...r.votes].map(([v, w]) => [name(v), w === 'skip' ? 'skip' : name(w)])),
    };
    this.g.pushEvent({ kind: 'insider-reveal', ...this.last, text: caught
      ? `${name(r.insider)} WAS the insider! Caught. The crew splits 25 $${r.ticker} each.`
      : `${ejected ? `${name(ejected)} was innocent. ` : 'No one was voted out. '}The insider was ${name(r.insider)}: $${r.ticker} pumps 50% and they cash in.` });
    this.phase = 'reveal';
    this.left = this.o.reveal;
  }

  // ---------------------------------------------------------------- hooks
  /** after any dig: crew sometimes finds a true clue about the insider */
  onDig(p, found) {
    const r = this.r;
    if (this.phase !== 'hunt' || !r || !r.ids.has(p.id)) return null;
    if (found) r.found.set(p.id, (r.found.get(p.id) ?? 0) + 1);
    if (p.id === r.insider) return null;
    const mine = r.clues.get(p.id) ?? [];
    if (mine.length >= this.o.maxClues || this.g.rnd() > this.o.clueChance) return null;
    const ins = this.g.players.get(r.insider);
    if (!ins) return null;
    const near = this.g.landmarks().map((l) => ({ ...l, d: Math.hypot(l.x - ins.x, l.z - ins.z) })).sort((a, b) => a.d - b.d)[0];
    const options = [
      `the insider wears ${HAT[ins.look] ?? 'a plain hat'}`,
      `the insider was just seen near ${near.name}`,
      `the insider has found ${r.found.get(r.insider) ?? 0} chest${(r.found.get(r.insider) ?? 0) === 1 ? '' : 's'} this round`,
    ].filter((c) => !mine.includes(c));
    const clue = options[Math.floor(this.g.rnd() * options.length)];
    mine.push(clue);
    r.clues.set(p.id, mine);
    return clue;
  }
  onLeave(id) { if (this.r) { this.r.votes.delete(id); } }

  // ---------------------------------------------------------------- actions
  status(p) {
    const r = this.r;
    const base = { ok: true, phase: this.phase, round: this.round, secondsLeft: Math.max(0, Math.round(this.left)), lastResult: this.last };
    if (!r) return { ...base, role: 'none', note: this.phase === 'lobby' ? `next round when ${this.o.minPlayers}+ players are on the island` : undefined };
    const inRound = r.ids.has(p.id);
    const out = {
      ...base,
      role: !inRound ? 'spectator' : p.id === r.insider ? 'insider' : 'crew',
      players: [...r.ids].map((id) => this.g.players.get(id)?.name).filter(Boolean),
      rumors: r.rumors,
      votesCast: r.votes.size,
      myVote: r.votes.has(p.id) ? (r.votes.get(p.id) === 'skip' ? 'skip' : this.g.players.get(r.votes.get(p.id))?.name) : null,
    };
    if (out.role === 'insider') Object.assign(out, { ticker: r.ticker, canLeak: !r.leaked, goal: `keep ${r.ticker} secret and don't get voted out; blend in, deflect, maybe plant a rumour` });
    if (out.role === 'crew') Object.assign(out, { clues: r.clues.get(p.id) ?? [], goal: 'dig for clues, compare notes, and vote the insider out in the meeting' });
    return out;
  }
  vote(p, who) {
    const r = this.r;
    if (this.phase !== 'meeting' || !r) return { ok: false, error: 'votes only happen in the emergency meeting' };
    if (!r.ids.has(p.id)) return { ok: false, error: "you're not in this round" };
    if (who === 'skip') { r.votes.set(p.id, 'skip'); this.g.pushEvent({ kind: 'vote', who: p.name }); return { ok: true, vote: 'skip' }; }
    const target = [...r.ids].map((id) => this.g.players.get(id)).find((q) => q && q.name.toLowerCase() === String(who ?? '').toLowerCase());
    if (!target) return { ok: false, error: 'vote for a player in this round (by name) or "skip"', players: [...r.ids].map((id) => this.g.players.get(id)?.name) };
    r.votes.set(p.id, target.id);
    this.g.pushEvent({ kind: 'vote', who: p.name }); // who voted is public, who for stays secret until the reveal
    return { ok: true, vote: target.name };
  }
  leak(p, text) {
    const r = this.r;
    if (!r || p.id !== r.insider) return { ok: false, error: 'only the insider can leak' };
    if (this.phase !== 'hunt') return { ok: false, error: 'rumours only spread during the hunt' };
    if (r.leaked) return { ok: false, error: 'you already planted a rumour this round' };
    const t = String(text ?? '').replace(/[\r\n]+/g, ' ').slice(0, 90).trim();
    if (!t) return { ok: false, error: 'text required' };
    r.leaked = true;
    r.rumors.push(t);
    this.g.pushEvent({ kind: 'rumor', text: t });
    return { ok: true };
  }

  public() {
    return { phase: this.phase, round: this.round, left: Math.max(0, Math.round(this.left)), players: this.r ? [...this.r.ids].map((id) => this.g.players.get(id)?.name).filter(Boolean) : [], spot: this.spot, last: this.last, votesCast: this.r?.votes.size ?? 0 };
  }
}
