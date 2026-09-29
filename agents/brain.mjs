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
- "leak": ONLY if you are the insider: plant one fake rumour about the insider to mislead everyone: {"text": "<rumour>"}`;

const SUN_HEADING = Math.atan2(-0.3, 0.94); // the way the low sun is (see src/client/render.js)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Agent {
  constructor({ persona, base, llm, journal = 'data/journal.jsonl', log = () => {}, fallbackOnly = false }) {
    Object.assign(this, { persona, base, llm, journalFile: journal, log, fallbackOnly });
    this.memory = []; // recent { do, result }
    this.heard = []; // recent lines other players said nearby
    this.said = []; // own recent lines
    this.token = null;
    this.running = false;
    this.decisions = 0;
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
    const j = await this.post('/api/join', { name: this.persona.name, look: this.persona.look });
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
    this.landmarks ??= (await this.act('landmarks')).landmarks ?? [];
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
    return `You are ${where}. Detector: ${s.detector.bars}/5 bars (${s.detector.secondsAgo}s ago).
Your bag: ${holdings}; portfolio worth $${p.value}; chests found ${p.chestsFound}.
Market: ${market}
Nearby: ${others}
Recent on the island: ${events}
You recently: ${mem}
Things you said lately (don't repeat yourself): ${this.said.slice(-3).map((l) => `"${l}"`).join(' ') || 'nothing yet'}`;
  }

  // ---------------------------------------------------------------- deciding
  async think(obs) {
    if (this.fallbackOnly || this.llm === null) return this.scripted(obs);
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

  // ---------------------------------------------------------------- life
  async step() {
    const obs = await this.observe();
    if (obs.ins?.phase === 'meeting' && (obs.ins.role === 'crew' || obs.ins.role === 'insider')) return this.meetingStep(obs);
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
