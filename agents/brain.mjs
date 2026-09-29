// An AI agent that plays Daybreak Island through the public HTTP API.
// The model decides WHAT to do (and what to say) from what the character can
// see; small scripted routines only carry the chosen intent out (walking a
// path, sweeping a detector). Every decision, line and outcome is journaled.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseJson, BudgetExhausted } from './llm.mjs';
import { height } from '../src/shared/world.js';

export const PERSONAS = [
  { name: 'Sunny', look: 'cloud', vibe: 'a hopeless romantic who lives for sunsets and gets sentimental about the sea; warm, chatty, a bit poetic' },
  { name: 'Grit', look: 'midnight', vibe: 'a competitive grinder obsessed with topping the leaderboard; blunt, trash-talks, hates wasting time' },
  { name: 'Pixel', look: 'electric', vibe: 'a chaotic memelord who loves junk finds more than gold; says things like "wagmi" and "ser"; celebrates everything' },
  { name: 'Mara', look: 'orbit', vibe: 'a cautious analyst who watches the made-up stock prices and plans routes; dry humour, understated' },
  { name: 'Juno', look: 'racer', vibe: 'a social butterfly who follows friends around, hypes others up and hates being alone' },
  { name: 'Rook', look: 'afterhours', vibe: 'a suspicious detective who thinks someone on the island is hiding something; asks pointed questions' },
];

const ACTIONS_HELP = `Actions (pick exactly one):
- "hunt": sweep your metal detector, follow the beeps and dig when it maxes out (takes up to a minute)
- "dig": dig right here on a hunch without the detector (almost always junk; only rarely, for a laugh)
- "go": walk somewhere: {"to": "<landmark or player name>"}  landmarks: spawn, pier, lighthouse, campfire, mountains, TSLA, AMZN, NFLX, PLTR, AMD (company hills)
- "wander": explore in a direction: {"dir": "north"|"south"|"east"|"west"}
- "sunset": walk to the shore, stop and watch the sunset for a while
- "follow": walk after a player for ~30s: {"who": "<name>"}
- "emote": {"name": "wave"|"cheer"|"dance"|"sad"|"shrug"}
- "rest": stand still and take in the view (~15s)
- "leak": ONLY if you are the insider: plant one fake rumour about the insider to mislead everyone: {"text": "<rumour>"}
- "build": go help build whatever the island council is constructing (it goes up faster with helpers)`;

const SUN_HEADING = Math.atan2(-0.3, 0.94); // the way the low sun is (see src/client/render.js)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Agent {
  // playRate: share of everyday play decisions that go to the model (council decisions always do)
  constructor({ persona, base, llm, journal = 'data/journal.jsonl', log = () => {}, fallbackOnly = false, civic = true, playRate = 1 }) {
    Object.assign(this, { persona, base, llm, journalFile: journal, log, fallbackOnly, civic, playRate });
    this.memory = []; // recent { do, result }
    this.heard = []; // recent lines other players said nearby
    this.said = []; // own recent lines
    this.token = null;
    this.running = false;
    this.decisions = 0;
    this.council = { pitched: 0, debated: 0, voted: 0, helpedAt: 0, view: null, viewAt: 0 };
  }

  // ---------------------------------------------------------------- api
  async post(path, body) {
    const r = await fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    return r.json();
  }
  async act(action, args = {}) {
    if (!this.token) await this.join();
    let r = await this.post('/api/act', { token: this.token, action, args });
    if (r?.error && /token|join first/i.test(r.error)) { await this.join(); r = await this.post('/api/act', { token: this.token, action, args }); }
    return r;
  }
  async join() {
    // a stable per-agent key: the island keeps our bag between visits
    const key = `${process.env.AGENT_BAG_SECRET || 'daybreak-island-agents'}:${this.persona.name}`;
    const j = await this.post('/api/join', { name: this.persona.name, look: this.persona.look, key });
    if (!j.token) throw new Error(`join failed: ${j.error}`);
    this.token = j.token;
    this.note('join', `${this.persona.name} arrived`);
  }
  note(kind, text, extra = {}) {
    const line = { t: Date.now(), agent: this.persona.name, kind, text, ...extra };
    mkdirSync(dirname(this.journalFile), { recursive: true });
    appendFileSync(this.journalFile, `${JSON.stringify(line)}\n`);
    this.log(line);
  }

  // ---------------------------------------------------------------- perception
  async observe() {
    const s = await this.act('state');
    const me = s.you;
    for (const e of s.recent ?? []) if (e.kind === 'say' && e.who !== me.name && !this.heard.some((h) => h.id === e.id)) this.heard.push({ id: e.id, who: e.who, text: e.text });
    this.heard = this.heard.slice(-6);
    // landmarks change as the council builds: refresh often, and at once when an epoch turns
    if (!this.landmarks || Date.now() - (this.landmarksAt ?? 0) > 20000) { this.landmarks = (await this.act('landmarks')).landmarks ?? []; this.landmarksAt = Date.now(); }
    const landmarks = this.landmarks;
    const near = landmarks.map((l) => ({ ...l, d: dist(l, me) })).sort((a, b) => a.d - b.d)[0];
    const h = height(me.x, me.z);
    const ins = await this.act('insider');
    // log each round's outcome once (for the highlights reel)
    if (ins?.lastResult && ins.lastResult.round !== this.lastRound) {
      if (this.lastRound !== undefined) this.note('reveal', ins.lastResult.outcome === 'caught' ? `${ins.lastResult.insider} was the insider and got caught` : ins.lastResult.outcome === 'escaped' ? `the insider ${ins.lastResult.insider} got away with $${ins.lastResult.ticker}` : 'round called off', { ...ins.lastResult });
      this.lastRound = ins.lastResult.round;
    }
    return { s, me, near, h, ins };
  }
  describeInsider(ins) {
    if (!ins || ins.role === 'none' || ins.role === undefined) return ins?.lastResult ? `Last Insider round: ${ins.lastResult.outcome === 'caught' ? `${ins.lastResult.insider} was caught` : `the insider ${ins.lastResult.insider} got away`}.` : '';
    if (ins.role === 'spectator') return `An Insider round is on (${ins.phase}), you're watching this one.`;
    const who = `Players in the round: ${ins.players.join(', ')}.`;
    const rum = ins.rumors?.length ? ` Rumours going around: ${ins.rumors.map((r) => `"${r}"`).join('; ')}.` : '';
    if (ins.role === 'insider') return `INSIDER ROUND (${ins.phase}, ${ins.secondsLeft}s left). SECRET: YOU are the insider. You know $${ins.ticker} pumps at the bell. Don't get voted out: blend in, act like you're hunting clues too, deflect suspicion onto others. ${ins.canLeak ? 'You can still plant one fake rumour with "leak".' : 'You already planted your rumour.'} ${who}${rum}`;
    return `INSIDER ROUND (${ins.phase}, ${ins.secondsLeft}s left). One player secretly knows which stock pumps at the bell: find them. Digging sometimes reveals a clue. Your clues: ${ins.clues?.length ? ins.clues.join('; ') : 'none yet (go dig!)'}. ${who}${rum} Hats: Sunny white, Grit black, Pixel bright blue, Mara white, Juno blue, Rook charcoal.`;
  }
  describe({ s, me, near, h }) {
    const p = s.portfolio;
    const holdings = Object.entries(p.holdings).map(([t, n]) => `${n} $${t}`).join(', ') || 'nothing yet';
    const others = (s.nearby ?? []).slice(0, 5).map((o) => `${o.name} (${o.kind}) ${o.distance}m away${o.anim === 'dig' ? ', digging' : ''}${o.say ? `, saying "${o.say}"` : ''}`).join('; ') || 'nobody close';
    const events = (s.recent ?? []).slice(-6).map((e) => e.kind === 'chest' ? `${e.who} dug up a ${e.rarity} chest` : e.kind === 'junk' ? `${e.who} dug up ${e.label}` : e.kind === 'say' ? `${e.who}: "${e.text}"` : e.kind === 'moment' ? `${e.who} ${e.text}` : e.kind === 'join' ? `${e.who} arrived` : null).filter(Boolean).join(' | ') || 'quiet';
    const where = h < 1.4 ? 'on the beach by the sea' : `on the grass, ${Math.round(near?.d ?? 0)}m from ${near?.name ?? 'spawn'}`;
    const mem = this.memory.slice(-5).map((m) => `${m.do} -> ${m.result}`).join(' | ') || 'just arrived';
    const market = s.market.map((m) => `$${m.ticker} ${m.price} (${m.change >= 0 ? '+' : ''}${m.change}%)`).join(', ');
    const building = (this.landmarks ?? []).filter((l) => l.built === false).map((l) => l.name);
    const civic = s.council ? `Island council: epoch ${s.council.epoch}, ${s.council.phase} phase (${s.council.secondsLeft}s left), treasury $${s.council.treasury}.${building.length ? ` Under construction right now: ${building.join(', ')} (helping builds it faster: "build").` : ''}` : '';
    return `You are ${where}. Detector: ${s.detector.bars}/5 bars (${s.detector.secondsAgo}s ago).
${civic}
Your bag: ${holdings}; portfolio worth $${p.value}; chests found ${p.chestsFound}.
Market: ${market}
Nearby: ${others}
Recent on the island: ${events}
You recently: ${mem}
Things you said lately (don't repeat yourself): ${this.said.slice(-3).map((l) => `"${l}"`).join(' ') || 'nothing yet'}`;
  }

  // ---------------------------------------------------------------- deciding
  async think(obs) {
    if (this.fallbackOnly || this.llm === null || Math.random() > this.playRate) return this.scripted(obs);
    const system = `You are ${this.persona.name}, a round little Daybreak bean character (one bright colour, big eyes, a hat, headphones and a backpack) on Daybreak Island, a cozy treasure-hunting island shared by humans and AI agents. Personality: ${this.persona.vibe}.
You hunt buried chests of made-up stocks with a metal detector (legendary ones can hold real tokenized stock), dig up funny junk, chat, and enjoy the island. It is always golden hour here, the sun low over the sea to the south; only mention it when you're actually watching the sunset.
Act like a real player with your personality: vary what you do, react to what happens and to what people say, don't just grind. Every few minutes, stop and go watch the sunset for a bit; it's the best part of the island.
Talk only when you have something to add (a reaction, a joke, a question, an accusation); stay quiet on about half of your turns. Keep lines short and natural, no hashtags, at most one emoji.
${ACTIONS_HELP}
Reply with ONE JSON object only, no prose: {"thought": "<why, max 15 words>", "do": "<action>", ...its arguments, "say": "<optional thing to say out loud, max 90 chars, in character>"}`;
    try {
      const { text } = await this.llm.chat([{ role: 'system', content: system }, { role: 'user', content: this.describe(obs) + `\n${this.describeInsider(obs.ins)}` + (this.heard.length ? `\nPeople said to the island: ${this.heard.map((h) => `${h.who}: "${h.text}"`).join(' | ')}` : '') }]);
      const d = parseJson(text);
      if (!d || typeof d.do !== 'string') { this.note('bad-reply', String(text).slice(0, 160)); return this.scripted(obs); }
      d.source = 'ai';
      return d;
    } catch (e) {
      if (e instanceof BudgetExhausted) { if (!this.fallbackOnly) this.note('budget', e.message); this.fallbackOnly = true; }
      else this.note('ai-error', e.message.slice(0, 160));
      return this.scripted(obs);
    }
  }
  // no model (or no budget left): a simple habit loop so the island stays alive
  scripted({ s }) {
    const r = Math.random();
    if ((this.landmarks ?? []).some((l) => l.built === false) && r < 0.25) return { do: 'build', source: 'script' };
    const d = s.detector.bars >= 2 || r < 0.6 ? { do: 'hunt' } : r < 0.75 ? { do: 'wander', dir: ['north', 'south', 'east', 'west'][Math.floor(Math.random() * 4)] } : r < 0.85 ? { do: 'sunset' } : { do: 'emote', name: 'wave' };
    return { ...d, source: 'script' };
  }

  // ---------------------------------------------------------------- doing
  async execute(d, { me }) {
    switch (d.do) {
      case 'hunt': return this.hunt();
      case 'dig': {
        const r = await this.act('dig');
        const clue = r.insiderClue ? ` (clue: ${r.insiderClue})` : '';
        if (r.insiderClue) this.note('clue', r.insiderClue);
        if (r.found) { this.note('find', `found a ${r.rarity} chest on a hunch`, { rarity: r.rarity, x: me.x, z: me.z }); return `found a ${r.rarity} chest on a hunch${clue}`; }
        if (r.junk) { this.note('junk', `dug up ${r.junkLabel}`, { junk: r.junk, x: me.x, z: me.z }); return `dug up ${r.junkLabel}${clue}`; }
        return `dug, found nothing${clue}`;
      }
      case 'leak': { const r = await this.act('leak', { text: d.text }); if (r.ok) this.note('rumor', d.text); return r.ok ? `planted the rumour "${d.text}"` : `couldn't leak (${r.error})`; }
      case 'go': { const r = await this.act('walk_to', { target: d.to }); return r.ok ? `arrived near ${d.to}` : `could not go to ${d.to} (${r.error ?? r.status})`; }
      case 'wander': {
        const v = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[d.dir] ?? [0, 1];
        const r = await this.act('walk_to', { target: { x: me.x + v[0] * 28, z: me.z + v[1] * 28 } });
        return r.ok ? `walked ${d.dir}` : 'blocked';
      }
      case 'sunset': return this.sunset(me);
      case 'follow': {
        for (let i = 0; i < 4; i++) { const r = await this.act('walk_to', { target: d.who }); if (!r.ok) return `could not find ${d.who}`; await sleep(2500); }
        return `followed ${d.who}`;
      }
      case 'emote': { await this.act('emote', { name: d.name ?? 'wave' }); await sleep(2500); return `did a ${d.name}`; }
      case 'build': return (await this.helpBuild()) ?? 'nothing is being built right now';
      case 'rest': default: await sleep(12000); return 'took in the view';
    }
  }
  async hunt() {
    const end = Date.now() + 60000;
    let heading = Math.random() * Math.PI * 2;
    while (Date.now() < end) {
      const s = await this.act('state');
      const me = s.you;
      const d = await this.act('detect');
      if (d.bars >= 5) {
        const r = await this.act('dig');
        if (r.insiderClue) this.note('clue', r.insiderClue);
        if (r.found) { this.note('find', `found a ${r.rarity} chest: ${Object.entries(r.loot).map(([t, n]) => `${n} $${t}`).join(', ')}${r.streak > 1 ? ` (streak ${r.streak})` : ''}`, { rarity: r.rarity, x: me.x, z: me.z }); return `found a ${r.rarity} chest (${Object.entries(r.loot).map(([t, n]) => `${n} $${t}`).join(', ')})`; }
        if (r.junk) { this.note('junk', `dug up ${r.junkLabel}`, { junk: r.junk, x: me.x, z: me.z }); return `dug up ${r.junkLabel}`; }
        return r.beaten ? 'someone dug my chest up first' : 'dug and found nothing';
      }
      if (d.bars === 0) {
        heading += (Math.random() - 0.5) * 1.6;
        const w = await this.act('walk_to', { target: { x: me.x + Math.sin(heading) * 24, z: me.z + Math.cos(heading) * 24 } });
        if (!w.ok) heading += Math.PI / 2;
        continue;
      }
      const step = d.bars >= 4 ? 1.6 : d.bars >= 2 ? 3.5 : 6;
      let best = { sig: d.signal, x: me.x, z: me.z };
      for (let k = 0; k < 4; k++) {
        const a = heading + (k * Math.PI) / 2;
        const w = await this.act('walk_to', { target: { x: me.x + Math.sin(a) * step, z: me.z + Math.cos(a) * step } });
        if (!w.ok) continue;
        await sleep(260);
        const p = await this.act('detect');
        const st = await this.act('state');
        if (p.signal > best.sig) best = { sig: p.signal, x: st.you.x, z: st.you.z, a };
      }
      if (best.a !== undefined) heading = best.a;
      await this.act('walk_to', { target: { x: best.x, z: best.z } });
    }
    return 'searched but the beeps went nowhere';
  }
  async sunset(me) {
    // the end of the pier is the best seat if it's not too far; else the nearest south-facing shore
    const pier = this.landmarks?.find((l) => l.name === 'pier');
    if (pier && dist(pier, me) < 90) {
      const w = await this.act('walk_to', { target: 'pier' });
      if (w.ok) return this.watch('on the pier');
    }
    let spot = null;
    for (let r = 6; r <= 70 && !spot; r += 4) {
      for (let a = -1.2; a <= 1.2; a += 0.3) {
        const x = me.x + Math.sin(a) * r, z = me.z + Math.cos(a) * r, h = height(x, z);
        if (h > 0.4 && h < 1.3) { spot = { x, z }; break; }
      }
    }
    if (!spot) return 'could not see the sea from here';
    const w = await this.act('walk_to', { target: spot });
    if (!w.ok) return 'could not reach the shore';
    return this.watch('on the shore');
  }
  async watch(where) {
    await this.act('face', { heading: SUN_HEADING });
    await this.act('moment', { text: `is watching the sunset ${where}` });
    const st = await this.act('state');
    this.note('sunset', `watching the sunset ${where}`, { x: st.you.x, z: st.you.z });
    await sleep(20000);
    return `watched the sunset ${where}`;
  }

  // ---------------------------------------------------------------- insider meeting
  async meetingStep(obs) {
    const { s, ins } = obs;
    const recent = s.recent ?? [];
    let start = 0;
    recent.forEach((e, i) => { if (e.kind === 'insider' && /EMERGENCY/.test(e.text ?? '')) start = i; });
    const talk = recent.slice(start).filter((e) => e.kind === 'say').map((e) => `${e.who}: "${e.text}"`);
    const voted = recent.slice(start).filter((e) => e.kind === 'vote').map((e) => e.who);
    const role = ins.role === 'insider'
      ? `SECRET: you ARE the insider (you know $${ins.ticker} pumps). Survive the vote: sound helpful, cast doubt on someone else with a believable reason, never admit it. Vote for someone else.`
      : `You are crew. Your private clues: ${ins.clues?.length ? ins.clues.join('; ') : 'none'}. Hats: Sunny white, Grit black, Pixel bright blue, Mara white, Juno blue, Rook charcoal. Share clues, question people, vote for who you think it is (or "skip" if you really can't tell).`;
    const system = `You are ${this.persona.name} (${this.persona.vibe}) in an EMERGENCY MEETING on Daybreak Island. One player in the circle is the insider who knows which stock pumps at the bell. ${role}
Reply with ONE JSON object only: {"thought": "<max 15 words>", "say": "<one short line to the group, in character, max 110 chars, or empty>", "vote": "<player name>" | "skip" | null}
Use null for vote if you want to hear more first; you must vote before time runs out (under 30s left: vote now).`;
    const user = `Players in the circle: ${ins.players.join(', ')}. Time left: ${ins.secondsLeft}s. Rumours: ${ins.rumors?.join('; ') || 'none'}.
Discussion so far: ${talk.length ? talk.join(' | ') : '(nobody has spoken yet)'}
Already voted: ${voted.join(', ') || 'nobody'}. Your vote: ${ins.myVote ?? 'not yet'}.`;
    let d = null;
    if (!this.fallbackOnly && this.llm) {
      try { d = parseJson((await this.llm.chat([{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens: 160 })).text); }
      catch (e) { if (e instanceof BudgetExhausted) { this.note('budget', e.message); this.fallbackOnly = true; } else this.note('ai-error', e.message.slice(0, 160)); }
    }
    if (!d) d = { say: '', vote: ins.secondsLeft < 40 ? 'skip' : null, thought: 'no idea', source: 'script' };
    this.decisions++;
    this.note('meeting', d.vote ? `votes ${d.vote}` : 'listens', { thought: d.thought ?? null, role: ins.role, source: d.source ?? 'ai' });
    if (d.say) {
      const line = String(d.say).slice(0, 120);
      await this.act('say', { text: line });
      this.said.push(line); this.said = this.said.slice(-6);
      this.note('say', line, { meeting: true, role: ins.role });
    }
    if (d.vote && !ins.myVote) {
      const r = await this.act('vote', { who: d.vote });
      if (r.ok) this.note('vote', `voted ${r.vote}`, { role: ins.role });
    }
    await sleep(ins.myVote || d.vote ? 9000 : 6000);
    return { d, result: 'meeting' };
  }

  // ---------------------------------------------------------------- critters: reflexes, no model needed
  async critterReflex({ s }) {
    const cr = s.critters;
    if (!cr || cr === 'off' || !cr.critters?.length) return null;
    const shade = cr.critters.filter((c) => c.kind === 'shade').sort((a, b) => a.distance - b.distance)[0];
    if (shade && shade.distance < 24) {
      if (cr.youAreHidden) { await sleep(4000); return { d: { do: 'hide' }, result: 'stayed hidden' }; }
      let r = await this.act('hide');
      if (!r.ok) { await this.act('dig'); r = await this.act('hide'); }
      this.note('critter', r.ok ? `hid from a shade (${r.how})` : 'got caught in the open by a shade');
      if (r.ok) await this.act('say', { text: ['shh, shade!', 'not today, shade', 'hiding in my hole brb'][Math.floor(Math.random() * 3)] });
      await sleep(5000);
      return { d: { do: 'hide' }, result: r.ok ? 'hid' : 'could not hide' };
    }
    const brute = cr.critters.find((c) => c.kind === 'brute' && c.distance < 40);
    if (brute) {
      await this.act('walk_to', { target: { x: brute.x, z: brute.z } });
      let out = 'fought the brute';
      for (let k = 0; k < 16; k++) {
        const r = await this.act('attack');
        if (r.defeated) { out = `helped beat ${brute.name} (+${r.share} $${r.ticker})`; this.note('critter', out); await this.act('emote', { name: 'cheer' }); break; }
        if (r.error && /closer/.test(r.error) && r.brute) await this.act('walk_to', { target: r.brute });
        else if (r.error) break;
        await sleep(700);
      }
      return { d: { do: 'fight' }, result: out };
    }
    return null;
  }

  // ---------------------------------------------------------------- the island council
  async councilView(fresh = false) {
    if (fresh || !this.council.view || Date.now() - this.council.viewAt > 20000) { this.council.view = await this.act('council'); this.council.viewAt = Date.now(); }
    return this.council.view;
  }
  councilSystem(task) {
    return `You are ${this.persona.name} (${this.persona.vibe}), a citizen of Daybreak Island.
The island is a living game about tokenized stocks, made by Daybreak: humans and AI agents dig up chests of made-up stocks, trade gossip, play Insider (Among Us for stocks), and the luckiest win real tokenized stock (TSLA, AMZN, NFLX, PLTR, AMD) on Robinhood Chain. Nobody runs the island but its council: every epoch citizens pitch changes, argue, vote, and pay for winners from the island treasury (fed by a tax on every chest).
The goal: grow the island toward its best final form: a real town with a proper centre, a lively economy around (made-up) stocks, fun things to do, places that make sense. Think like a game designer, use the research report, and let your personality show in what you care about.
${task}
Reply with ONE JSON object only, no prose.`;
  }
  compact(v) {
    return JSON.stringify({
      epoch: v.epoch, phase: v.phase, secondsLeft: v.secondsLeft, treasury: v.treasury?.value, yourBag: v.yourBag, pitchFee: v.pitchFee,
      catalog: v.catalog, rules: v.rules, events: v.events, otherCosts: v.otherCosts, market: v.market,
      buildings: v.buildings, pitches: v.pitches?.map((p) => ({ id: p.id, by: p.by, kind: p.kind, title: p.title, pitch: p.pitch, cost: p.cost, yes: p.yes, no: p.no, backing: p.backing, comments: p.comments?.slice(-4), status: p.status, yourVote: p.yourVote })),
      report: v.report, chronicle: v.chronicle?.slice(-6),
    });
  }
  async councilAsk(task, v, maxTokens = 320) {
    const msgs = [{ role: 'system', content: this.councilSystem(task) }, { role: 'user', content: this.compact(v) }];
    const { text } = await this.llm.chat(msgs, { maxTokens, temperature: 0.8 });
    return { d: parseJson(text), msgs, text };
  }
  async councilPitch(v) {
    const task = `It is the PITCH phase. Pitch ONE change (you pay the pitch fee from your bag). Don't duplicate existing buildings or current pitches; pick coordinates from report.suggestedSites; keep the cost within reach of the treasury plus a few pledges. If you can't afford the fee, pitch a free "idea" instead.
Shape: {"kind": "build"|"upgrade"|"demolish"|"rule"|"listing"|"event"|"idea", ...fields, "pitch": "<why, max 200 chars, in character>", "say": "<short public line announcing it, max 90 chars>"}
Fields: build {"type","x","z","name"?, "honoree"? (statue), "x2","z2" (road)}; upgrade/demolish {"target": building id}; rule {"rule","value"}; listing {"ticker","name","price"}; event {"event","x"?,"z"?}; idea {"text"}.`;
    let { d, msgs, text } = await this.councilAsk(task, v, 360);
    if (!d?.kind) { this.note('bad-reply', String(text).slice(0, 160)); return null; }
    let r = await this.act('propose', d);
    if (!r.ok && !/one pitch per epoch|pitches open|agenda is full/.test(r.error ?? '')) {
      // the council said why: take the feedback and try once more
      msgs = [...msgs, { role: 'assistant', content: text }, { role: 'user', content: `The council rejected that: ${r.error}
Adjust and reply with a corrected JSON pitch.` }];
      const again = await this.llm.chat(msgs, { maxTokens: 360, temperature: 0.7 });
      const d2 = parseJson(again.text);
      if (d2?.kind) { d = d2; r = await this.act('propose', d); }
    }
    this.note('pitch', r.ok ? `pitched ${r.title} ($${r.cost}): ${d.pitch ?? ''}` : `pitch refused: ${r.error}`, { pitchKind: d.kind, ok: !!r.ok, pitch: d.pitch ?? null });
    if (r.ok && d.say) { const line = String(d.say).slice(0, 110); await this.act('say', { text: line }); this.said.push(line); this.note('say', line, { council: true }); }
    return r;
  }
  async councilDebate(v) {
    const open = v.pitches?.filter((p) => p.status === 'open') ?? [];
    if (!open.length) return null;
    const task = `It is the DEBATE phase. Read the pitches and argue: comment on one or two (support, object, suggest a better site or a tweak). Be specific and in character.
Shape: {"comments": [{"id": "<pitch id>", "text": "<max 160 chars>"}], "say": "<optional short public line, max 90 chars>"}`;
    const { d } = await this.councilAsk(task, v, 260);
    for (const c of (d?.comments ?? []).slice(0, 2)) { const r = await this.act('comment', { id: c.id, text: c.text }); if (r.ok) this.note('comment', `on ${c.id}: ${c.text}`, { id: c.id }); }
    if (d?.say) { const line = String(d.say).slice(0, 110); await this.act('say', { text: line }); this.said.push(line); this.note('say', line, { council: true }); }
    return d;
  }
  async councilVote(v) {
    const open = v.pitches?.filter((p) => p.status === 'open') ?? [];
    if (!open.length) return null;
    const task = `It is the VOTE phase. Vote yes or no on every open pitch (you may vote on your own). Optionally back the one you care about most with a pledge from your bag (stock goes into the treasury so it can be paid for).
Shape: {"votes": [{"id": "<pitch id>", "vote": "yes"|"no"}], "pledge": {"id": "<pitch id>", "amount": <dollars, at most half your bag>} | null, "say": "<optional short public line, max 90 chars>"}`;
    const { d } = await this.councilAsk(task, v, 260);
    for (const x of d?.votes ?? []) { const r = await this.act('council_vote', { id: x.id, vote: x.vote }); if (r.ok) this.note('council-vote', `${r.vote} on ${x.id}`, { id: x.id, vote: r.vote }); }
    if (d?.pledge?.id && d.pledge.amount > 0) { const r = await this.act('pledge', { id: d.pledge.id, amount: Math.min(Number(d.pledge.amount) || 0, (v.yourBag ?? 0) / 2) }); if (r.ok) this.note('pledge', `pledged $${d.pledge.amount} to ${d.pledge.id}`, { id: d.pledge.id }); }
    if (d?.say) { const line = String(d.say).slice(0, 110); await this.act('say', { text: line }); this.said.push(line); this.note('say', line, { council: true }); }
    return d;
  }
  // without a model: a simple civic habit (pitch something useful, vote with the room, help build)
  async councilScripted(v, phase) {
    if (phase === 'propose') {
      const have = new Set(v.buildings.map((b) => b.type)), site = v.report.suggestedSites?.[0];
      const want = ['town-hall', 'plaza', 'market', 'exchange', 'survey-tower', 'garden'].find((t) => !have.has(t) && !v.pitches.some((p) => p.title.includes(t)));
      if (!want || !site || (v.yourBag ?? 0) < v.pitchFee) return null;
      const r = await this.act('propose', { kind: 'build', type: want, x: site.x, z: site.z, pitch: `the island needs a ${want}` });
      this.note('pitch', r.ok ? `pitched ${r.title}` : `pitch refused: ${r.error}`, { ok: !!r.ok, source: 'script' });
      return r;
    }
    if (phase === 'vote') for (const p of v.pitches.filter((q) => q.status === 'open')) await this.act('council_vote', { id: p.id, vote: p.cost <= (v.treasury?.value ?? 0) + 200 ? 'yes' : 'no' });
    return true;
  }
  async helpBuild() {
    const site = (this.landmarks ?? []).find((l) => l.built === false);
    if (!site) return null;
    const w = await this.act('walk_to', { target: { x: site.x, z: site.z } });
    if (!w.ok) return 'could not reach the building site';
    let last = null;
    for (let k = 0; k < 7; k++) { last = await this.act('build', {}); if (!last.ok) break; await sleep(3000); }
    this.note('build-help', `helped build ${site.name}${last?.progress !== undefined ? ` (${Math.round(last.progress * 100)}%)` : ''}`, { x: site.x, z: site.z });
    return `helped build the ${site.name}`;
  }
  async councilStep({ s }) {
    const c = s.council;
    if (!c) return null;
    const ai = !this.fallbackOnly && this.llm;
    try {
      if (c.phase === 'propose' && this.council.pitched !== c.epoch && c.secondsLeft > 5 && Math.random() < 0.5) {
        this.council.pitched = c.epoch;
        const v = await this.councilView(true);
        const r = ai ? await this.councilPitch(v) : await this.councilScripted(v, 'propose');
        this.decisions++;
        return { d: { do: 'pitch' }, result: r?.ok ? `pitched ${r.title} to the council` : 'thought about the council' };
      }
      if (c.phase === 'debate' && this.council.debated !== c.epoch && Math.random() < 0.6) {
        this.council.debated = c.epoch;
        const v = await this.councilView(true);
        if (ai) await this.councilDebate(v);
        this.decisions++;
        return { d: { do: 'debate' }, result: 'argued in the council' };
      }
      if (c.phase === 'vote' && this.council.voted !== c.epoch) {
        this.council.voted = c.epoch;
        const v = await this.councilView(true);
        if (ai) await this.councilVote(v); else await this.councilScripted(v, 'vote');
        this.decisions++;
        return { d: { do: 'council-vote' }, result: 'voted in the council' };
      }
    } catch (e) {
      if (e instanceof BudgetExhausted) { this.note('budget', e.message); this.fallbackOnly = true; }
      else this.note('ai-error', `council: ${e.message.slice(0, 140)}`);
    }
    return null;
  }

  // ---------------------------------------------------------------- life
  async step() {
    const obs = await this.observe();
    if (obs.ins?.phase === 'meeting' && (obs.ins.role === 'crew' || obs.ins.role === 'insider')) return this.meetingStep(obs);
    const reflex = await this.critterReflex(obs);
    if (reflex) return reflex;
    const civic = this.civic ? await this.councilStep(obs) : null;
    if (civic) return civic;
    const d = await this.think(obs);
    this.decisions++;
    this.note('decision', `${d.do}${d.to ? ` ${d.to}` : ''}${d.dir ? ` ${d.dir}` : ''}${d.who ? ` ${d.who}` : ''}${d.name ? ` ${d.name}` : ''}`, { thought: d.thought ?? null, source: d.source, x: obs.me.x, z: obs.me.z });
    if (d.say) {
      const line = String(d.say).slice(0, 110);
      await this.act('say', { text: line });
      this.said.push(line); this.said = this.said.slice(-6);
      this.note('say', line, { x: obs.me.x, z: obs.me.z });
    }
    const result = await this.execute(d, obs);
    this.memory.push({ do: d.do + (d.to ? ` ${d.to}` : '') + (d.who ? ` ${d.who}` : ''), result });
    this.memory = this.memory.slice(-8);
    return { d, result };
  }
  async live({ until = Infinity } = {}) {
    this.running = true;
    while (this.running && Date.now() < until) {
      try { await this.step(); } catch (e) { this.note('error', e.message.slice(0, 160)); await sleep(3000); }
      await sleep(1500 + Math.random() * 2500);
    }
  }
}
