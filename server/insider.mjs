// Insider: Among Us for stocks. Everyone who opts in trades made-up stocks on
// a public tape. One of them is the insider and secretly knows which stock is
// about to pump. Traders can't see that, so they have to work out who is
// trading like they know. Then everyone votes. Catch the insider and the
// traders win; miss and the insider wins. The pump lands after the vote, so
// it can't give the game away.
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export const INSIDER_DEFAULTS = { min: 4, lobby: 15, trade: 90, vote: 30, reveal: 12, cash: 1000, pump: 1.8 };
const IMPACT = 0.002;      // price moves 0.2% per share traded
const MAX_TRADE = 100;
const TAPE_KEEP = 40;

export class Insider {
  constructor(game, cfg = {}) {
    this.game = game;
    this.cfg = { ...INSIDER_DEFAULTS, ...cfg };
    this.members = new Set();   // player ids opted in (stay opted in between rounds)
    this.phase = 'lobby';
    this.t = 0;                 // seconds left in the phase
    this.round = null;          // live round state
    this.last = null;           // result of the previous round
    this.rounds = 0;
    this.driftT = 0;
  }

  get active() { return this.phase === 'trading' || this.phase === 'voting'; }
  name(id) { return this.game.players.get(id)?.name ?? '?'; }
  idByName(n) { const s = String(n ?? '').toLowerCase(); return [...this.round.players.keys()].find((id) => this.name(id).toLowerCase() === s); }

  // ---------------------------------------------------------------- actions
  join(p) {
    if (this.members.has(p.id)) return { ok: true, already: true, ...this.status(p) };
    this.members.add(p.id); // joining mid-round means waiting for the next one
    this.game.pushEvent({ kind: 'insider_join', who: p.name });
    return { ok: true, message: `joined the Insider lobby. A round starts when ${this.cfg.min}+ players are in.`, ...this.status(p) };
  }

  leave(p) {
    if (!this.members.has(p.id)) return { ok: false, error: 'not in the Insider game' };
    this.remove(p.id);
    return { ok: true };
  }

  remove(id) {
    if (!this.members.delete(id)) return;
    if (this.active && this.round.players.has(id)) {
      if (id === this.round.insider) return this.abort('the insider left the island');
      this.round.players.delete(id);
      this.round.votes.delete(id);
      for (const [v, t] of this.round.votes) if (t === id) this.round.votes.delete(v);
      if (this.round.players.size < 3) this.abort('too few players left');
    }
  }

  trade(p, args = {}) {
    if (this.phase !== 'trading') return { ok: false, error: `trading is closed (phase: ${this.phase})` };
    const me = this.round.players.get(p.id);
    if (!me) return { ok: false, error: 'you are not in this round' };
    const ticker = String(args.ticker ?? '').toUpperCase().replace('$', '');
    const stock = this.round.book.find((s) => s.ticker === ticker);
    if (!stock) return { ok: false, error: 'unknown ticker', tickers: this.round.book.map((s) => s.ticker) };
    const side = args.side === 'sell' ? 'sell' : args.side === 'buy' ? 'buy' : null;
    if (!side) return { ok: false, error: 'side must be buy or sell' };
    let shares = Math.floor(Number(args.shares));
    if (!(shares >= 1)) return { ok: false, error: 'shares must be a whole number >= 1' };
    shares = Math.min(shares, MAX_TRADE);
    const price = stock.price;
    if (side === 'buy') {
      shares = Math.min(shares, Math.floor(me.cash / price));
      if (shares < 1) return { ok: false, error: 'not enough cash', cash: round(me.cash) };
      me.cash -= shares * price;
      me.pos[ticker] = (me.pos[ticker] ?? 0) + shares;
      stock.price = price * (1 + IMPACT * shares);
    } else {
      shares = Math.min(shares, me.pos[ticker] ?? 0);
      if (shares < 1) return { ok: false, error: `you hold no $${ticker}` };
      me.cash += shares * price;
      me.pos[ticker] -= shares;
      stock.price = Math.max(0.05, price / (1 + IMPACT * shares));
    }
    const entry = { who: p.name, side, ticker, shares, price: round(price), t: round(this.game.t, 1) };
    this.round.tape.push(entry);
    if (this.round.tape.length > TAPE_KEEP) this.round.tape.shift();
    return { ok: true, ...entry, cash: round(me.cash), holdings: { ...me.pos }, newPrice: round(stock.price) };
  }

  accuse(p, args = {}) {
    if (this.phase !== 'voting') return { ok: false, error: `voting is not open (phase: ${this.phase})` };
    if (!this.round.players.has(p.id)) return { ok: false, error: 'you are not in this round' };
    const target = this.idByName(args.name);
    if (!target) return { ok: false, error: 'unknown player', players: [...this.round.players.keys()].map((id) => this.name(id)) };
    if (target === p.id) return { ok: false, error: 'you cannot accuse yourself' };
    this.round.votes.set(p.id, target);
    if (this.round.votes.size === this.round.players.size) this.t = 0; // everyone voted
    return { ok: true, accused: this.name(target), voted: this.round.votes.size, of: this.round.players.size };
  }

  // ---------------------------------------------------------------- views
  publicView() {
    const r = this.round;
    return {
      phase: this.phase, timeLeft: round(Math.max(0, this.t), 1), min: this.cfg.min,
      members: [...this.members].map((id) => this.name(id)),
      ...(r && this.active ? { prices: r.book.map((s) => [s.ticker, round(s.price)]), tape: r.tape.slice(-8), voted: r.votes.size } : {}),
      ...(this.phase === 'reveal' && this.last ? { result: this.last } : {}),
    };
  }

  status(p) {
    const r = this.round, pub = this.publicView();
    const out = { ...pub, joined: this.members.has(p.id), rounds: this.rounds };
    if (!r || !this.active && this.phase !== 'reveal') return { ...out, howTo: this.howTo(), stats: p.insiderStats };
    const me = r.players.get(p.id);
    if (me) {
      out.role = p.id === r.insider ? 'insider' : 'trader';
      if (p.id === r.insider) out.move = { ticker: r.move, note: `$${r.move} will pump ~${Math.round((this.cfg.pump - 1) * 100)}% right after the vote. Profit from it without getting caught.` };
      out.cash = round(me.cash);
      out.holdings = { ...me.pos };
      out.tape = r.tape.slice(-25);
      out.prices = r.book.map((s) => ({ ticker: s.ticker, price: round(s.price) }));
      if (this.phase === 'voting') out.yourVote = r.votes.has(p.id) ? this.name(r.votes.get(p.id)) : null;
    }
    return out;
  }

  howTo() {
    return `Insider: join the lobby (${this.cfg.min}+ players). One player is secretly the insider and knows which stock will pump. Trade with insider_trade, read the public tape, then insider_accuse who you think it is. Catch the insider and traders win; miss and the insider wins. Winners earn stock in the main game.`;
  }

  // ---------------------------------------------------------------- simulation
  tick(dt) {
    const g = this.game;
    if (this.phase === 'lobby') {
      if (this.members.size >= this.cfg.min) {
        if (this.t <= 0) this.t = this.cfg.lobby;
        this.t -= dt;
        if (this.t <= 0) this.start();
      } else this.t = 0;
      return;
    }
    this.t -= dt;
    if (this.phase === 'trading') {
      // ambient drift keeps prices from being a tell on their own
      this.driftT += dt;
      if (this.driftT > 3) {
        this.driftT = 0;
        for (const s of this.round.book) s.price = Math.max(0.05, s.price * (1 + (g.rnd() - 0.5) * 0.03));
      }
      if (this.t <= 0) { this.phase = 'voting'; this.t = this.cfg.vote; g.pushEvent({ kind: 'insider_vote', who: 'Insider' }); }
    } else if (this.phase === 'voting') {
      if (this.t <= 0) this.resolve();
    } else if (this.phase === 'reveal') {
      if (this.t <= 0) { this.phase = 'lobby'; this.t = 0; this.round = null; }
    }
  }

  start() {
    const g = this.game;
    const ids = [...this.members].filter((id) => g.players.has(id));
    if (ids.length < this.cfg.min) { this.t = 0; return; }
    const book = g.market.map((s) => ({ ticker: s.ticker, price: s.open }));
    this.round = {
      players: new Map(ids.map((id) => [id, { cash: this.cfg.cash, pos: {} }])),
      insider: ids[Math.floor(g.rnd() * ids.length)],
      move: book[Math.floor(g.rnd() * book.length)].ticker,
      book, tape: [], votes: new Map(),
    };
    this.phase = 'trading';
    this.t = this.cfg.trade;
    this.driftT = 0;
    for (const id of ids) g.players.get(id).insiderStats.played++;
    g.pushEvent({ kind: 'insider_start', who: 'Insider', players: ids.length });
  }

  equity(me, book) { return me.cash + Object.entries(me.pos).reduce((a, [t, n]) => a + n * book.find((s) => s.ticker === t).price, 0); }

  abort(reason) {
    this.last = { aborted: true, reason };
    this.phase = 'reveal'; this.t = this.cfg.reveal;
    this.game.pushEvent({ kind: 'insider_end', who: 'Insider', aborted: true, reason });
  }

  resolve() {
    const g = this.game, r = this.round;
    const tally = new Map();
    for (const t of r.votes.values()) tally.set(t, (tally.get(t) ?? 0) + 1);
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const accusedId = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null; // a tie catches nobody
    const caught = accusedId === r.insider;
    // the pump lands now, after the vote
    r.book.find((s) => s.ticker === r.move).price *= this.cfg.pump;
    const results = [...r.players.entries()].map(([id, me]) => ({
      name: this.name(id), role: id === r.insider ? 'insider' : 'trader', equity: round(this.equity(me, r.book)), profit: round(this.equity(me, r.book) - this.cfg.cash),
    })).sort((a, b) => b.profit - a.profit);
    const winners = caught ? 'traders' : 'insider';
    // winners take home real stock in the main game
    const reward = (id, n) => { const p = g.players.get(id); if (p) { p.portfolio[r.move] = (p.portfolio[r.move] ?? 0) + n; } };
    for (const id of r.players.keys()) {
      const isInsider = id === r.insider;
      if (isInsider ? !caught : caught) { reward(id, isInsider ? 100 : 40); g.players.get(id) && g.players.get(id).insiderStats.wins++; }
    }
    this.rounds++;
    this.last = {
      winners, caught, insider: this.name(r.insider), move: r.move, pump: `x${this.cfg.pump}`,
      accused: accusedId ? this.name(accusedId) : null,
      votes: [...r.votes.entries()].map(([v, t]) => ({ from: this.name(v), to: this.name(t) })),
      results,
      reward: `${winners === 'insider' ? 100 : 40} $${r.move} to each winner`,
    };
    this.phase = 'reveal'; this.t = this.cfg.reveal;
    g.pushEvent({ kind: 'insider_end', who: 'Insider', winners, insider: this.last.insider, caught });
  }
}
