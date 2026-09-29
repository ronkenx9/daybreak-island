// G26: the AI agent loop with a stub model (no network, no spend).
//   node test/ai.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLLM, makeMeter, parseJson } from '../agents/llm.mjs';
import { Agent, PERSONAS } from '../agents/brain.mjs';
import { startServer } from '../server/index.mjs';
import { openDb } from '../server/db.mjs';
import { PrizePool } from '../server/prizes.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dbi-ai-'));
const store = openDb(':memory:');
const srv = startServer({ port: 5299, vite: false, secret: 'ai-test', store, prizes: new PrizePool({ store }) });
const BASE = 'http://127.0.0.1:5299';
await new Promise((r) => setTimeout(r, 200));
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); srv.close(); process.exit(1); } };

// a stub model: returns queued replies and reports usage like the gateway does
function stub(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const text = replies.shift() ?? '{"do":"rest"}';
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }) };
  };
  return { calls, fetchImpl };
}
const journalOf = (file) => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];

await test('replies are parsed even with prose or code fences around the JSON', () => {
  assert.deepEqual(parseJson('Sure! ```json\n{"do":"hunt","say":"let\'s go {team}"}\n``` ok'), { do: 'hunt', say: "let's go {team}" });
  assert.equal(parseJson('no json here'), null);
  assert.equal(parseJson('{"do": "hunt",'), null);
});

await test('spend is metered from reported usage and persisted', () => {
  const file = join(dir, 'spend.json');
  const m = makeMeter({ budget: 1, file });
  const cost = m.add('claude-haiku-4.5', { prompt_tokens: 1_000_000, completion_tokens: 100_000 });
  assert.ok(Math.abs(cost - (1.5 + 0.75)) < 1e-9);
  assert.equal(m.exhausted, true);
  assert.equal(makeMeter({ budget: 1, file }).spent, cost, 'a restart keeps counting');
});

await test('an AI decision is carried out in the game, spoken aloud and journaled', async () => {
  const journal = join(dir, 'j1.jsonl');
  const s = stub(['Here you go: {"thought":"say hi to everyone","do":"emote","name":"wave","say":"hello island!"}']);
  const llm = makeLLM({ key: 'k', base: 'http://stub', meter: makeMeter({ budget: 20, file: null }), fetchImpl: s.fetchImpl });
  const a = new Agent({ persona: PERSONAS[0], base: BASE, llm, journal });
  const { d, result } = await a.step();
  assert.equal(d.do, 'emote'); assert.equal(d.source, 'ai'); assert.match(result, /wave/);
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].messages[0].content, /Sunny/); // persona in the prompt
  assert.match(s.calls[0].messages[1].content, /Detector: \d\/5 bars/); // what it can see
  const j = journalOf(journal);
  assert.ok(j.some((l) => l.kind === 'decision' && l.thought === 'say hi to everyone'));
  assert.ok(j.some((l) => l.kind === 'say' && l.text === 'hello island!'));
  assert.ok(srv.game.events.some((e) => e.kind === 'say' && e.who === 'Sunny' && e.text === 'hello island!'));
});

await test('a broken reply falls back to a scripted habit instead of stalling', async () => {
  const journal = join(dir, 'j2.jsonl');
  const s = stub(['I think I will go hunting now!']);
  const llm = makeLLM({ key: 'k', base: 'http://stub', meter: makeMeter({ budget: 20, file: null }), fetchImpl: s.fetchImpl });
  const a = new Agent({ persona: PERSONAS[1], base: BASE, llm, journal });
  const obs = await a.observe();
  const d = await a.think(obs);
  assert.equal(d.source, 'script');
  assert.ok(journalOf(journal).some((l) => l.kind === 'bad-reply'));
});

await test('at the spending cap the model is no longer called; agents keep playing on habits', async () => {
  const journal = join(dir, 'j3.jsonl');
  const s = stub(['{"do":"rest"}', '{"do":"rest"}', '{"do":"rest"}']);
  const meter = makeMeter({ budget: 0.002, file: null }); // one stub call costs 0.0015 + 0.00075
  const llm = makeLLM({ key: 'k', base: 'http://stub', meter, fetchImpl: s.fetchImpl });
  const a = new Agent({ persona: PERSONAS[2], base: BASE, llm, journal });
  const obs = await a.observe();
  assert.equal((await a.think(obs)).source, 'ai');
  assert.equal(meter.exhausted, true);
  const d2 = await a.think(obs), d3 = await a.think(obs);
  assert.equal(d2.source, 'script'); assert.equal(d3.source, 'script');
  assert.equal(s.calls.length, 1, 'no calls after the cap');
  assert.ok(journalOf(journal).some((l) => l.kind === 'budget'));
});

await test('watching the sunset: walks to the shore, faces the sun and shares the moment', async () => {
  const journal = join(dir, 'j4.jsonl');
  const a = new Agent({ persona: PERSONAS[0], base: BASE, llm: null, journal });
  a.sleepMs = 0;
  const obs = await a.observe();
  const orig = globalThis.setTimeout;
  const r = await Promise.race([a.sunset(obs.me), new Promise((res) => orig(() => res('timeout'), 40000))]);
  assert.match(r, /^watched the sunset/);
  assert.ok(srv.game.events.some((e) => e.kind === 'moment' && e.who === 'Sunny'));
  assert.ok(journalOf(journal).some((l) => l.kind === 'sunset'));
});

await test('agents play a whole Insider round: the insider plants a rumour, everyone talks and votes in the meeting', async () => {
  const store2 = openDb(':memory:');
  const srv2 = startServer({ port: 5300, vite: false, secret: 'ai-insider', store: store2, prizes: new PrizePool({ store: store2 }), insider: { minPlayers: 4, firstDelay: 1, cooldown: 60, hunt: 20, meeting: 20, reveal: 2, clueChance: 1 } });
  await new Promise((r) => setTimeout(r, 200));
  const prompts = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const sys = body.messages[0].content, user = body.messages[1].content;
    prompts.push(sys);
    let reply = '{"do":"rest"}';
    if (/EMERGENCY MEETING/.test(sys)) {
      const me = sys.match(/You are (\w+)/)[1];
      const players = user.match(/Players in the circle: ([^.]+)\./)[1].split(', ');
      const target = players.find((p) => p !== me);
      reply = JSON.stringify({ thought: 'hmm', say: `I have a bad feeling about ${target}`, vote: target });
    } else if (/YOU are the insider/.test(user) && /plant one fake rumour/.test(user)) reply = '{"do":"leak","text":"the insider wears a white hat"}';
    else if (/INSIDER ROUND/.test(user)) reply = '{"do":"dig"}';
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 500, completion_tokens: 50 } }) };
  };
  const llm = makeLLM({ key: 'k', base: 'http://stub', meter: makeMeter({ budget: 20, file: null }), fetchImpl });
  const journal = join(dir, 'j5.jsonl');
  const agents = PERSONAS.slice(0, 4).map((persona) => new Agent({ persona, base: 'http://127.0.0.1:5300', llm, journal }));
  const until = Date.now() + 60000;
  const live = agents.map((a) => a.live({ until }));
  const g = srv2.game;
  while (Date.now() < until && !(g.insider.last && g.insider.last.round === 1)) await new Promise((r) => setTimeout(r, 250));
  for (const a of agents) a.running = false;
  await Promise.race([Promise.all(live), new Promise((r) => setTimeout(r, 15000))]);
  srv2.close();
  const j = journalOf(journal);
  assert.ok(g.insider.last && g.insider.last.round === 1, 'the round reached the reveal');
  assert.equal(Object.keys(g.insider.last.votes).length, 4, 'all four voted');
  assert.ok(j.filter((l) => l.kind === 'say' && l.meeting).length >= 4, 'everyone spoke in the meeting');
  assert.ok(g.events.some((e) => e.kind === 'rumor' && /white hat/.test(e.text)), 'the insider planted a rumour');
  assert.ok(prompts.some((p) => /you ARE the insider/.test(p)) && prompts.some((p) => /You are crew/.test(p)), 'each side got its own brief');
  assert.ok(j.some((l) => l.kind === 'clue'), 'crew digs turned up clues');
});

srv.close();
console.log(`${n} tests\nAI OK`);
process.exit(0);
