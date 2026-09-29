// G34: AI agents run the council on their own through the real model interface
// (a stub model here: no network, no spend). They read the report, pitch within the
// genome (retrying with the server's reason when a pitch is refused), argue, vote,
// pledge, and walk over to help build; a full epoch ends with a building standing.
//   node test/ai-council.mjs  -> AI COUNCIL OK
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLLM, makeMeter } from '../agents/llm.mjs';
import { Agent, PERSONAS } from '../agents/brain.mjs';
import { startServer } from '../server/index.mjs';
import { openDb } from '../server/db.mjs';
import { PrizePool } from '../server/prizes.mjs';

process.env.AGENT_BAG_SECRET = 'council-test-secret';
const dir = mkdtempSync(join(tmpdir(), 'dbi-council-'));
const journal = join(dir, 'journal.jsonl');
const store = openDb(':memory:');
const cast = PERSONAS.slice(0, 4);
// the agents arrive with something in their bags (as if they had been digging)
for (const p of cast) store.put(`bag:${createHash('sha256').update(`bag:${process.env.AGENT_BAG_SECRET}:${p.name}`).digest('hex')}`, { portfolio: { MOON: 120 }, found: 3 });
const srv = startServer({ port: 5301, vite: false, secret: 'ai-council', store, prizes: new PrizePool({ store }), council: { propose: 14, debate: 8, vote: 8, seeds: [] }, insider: { firstDelay: 1e9 } });
const BASE = 'http://127.0.0.1:5301';
await new Promise((r) => setTimeout(r, 200));

// a stub model that reads the prompt it is given (like the real one would)
const calls = [];
function reply(body) {
  const sys = body.messages[0].content, last = body.messages.at(-1).content;
  const me = cast.findIndex((p) => sys.includes(`You are ${p.name} `));
  if (/PITCH phase/.test(sys)) {
    if (/rejected that/.test(last)) {
      const v = JSON.parse(body.messages[1].content), site = v.report.suggestedSites[me % v.report.suggestedSites.length];
      const type = ['plaza', 'garden', 'market', 'survey-tower'][me];
      return { kind: 'build', type, x: site.x, z: site.z, name: `${cast[me].name}'s ${type}`, pitch: 'a better spot, per the report', say: `pitched a ${type}!` };
    }
    return { kind: 'build', type: 'plaza', x: 0, z: 175, pitch: 'a plaza on the water, why not', say: 'plaza time' }; // refused: in the sea
  }
  if (/DEBATE phase/.test(sys)) { const v = JSON.parse(body.messages[1].content); return { comments: v.pitches.filter((p) => p.status === 'open').slice(0, 1).map((p) => ({ id: p.id, text: `${cast[me].name} likes ${p.title}` })), say: 'good pitches all round' }; }
  if (/VOTE phase/.test(sys)) { const v = JSON.parse(body.messages[1].content); const open = v.pitches.filter((p) => p.status === 'open'); return { votes: open.map((p) => ({ id: p.id, vote: 'yes' })), pledge: open[0] ? { id: open[0].id, amount: 250 } : null }; }
  return { thought: 'help the town grow', do: 'build' };
}
const fetchImpl = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply(body)) } }], usage: { prompt_tokens: 1500, completion_tokens: 120 } }) };
};
const llm = makeLLM({ key: 'k', base: 'http://stub', meter: makeMeter({ budget: 20, file: null }), fetchImpl });
const agents = cast.map((persona) => new Agent({ persona, base: BASE, llm, journal }));
const until = Date.now() + 75_000;
const runs = agents.map(async (a, i) => { await new Promise((r) => setTimeout(r, i * 400)); return a.live({ until }); });
// speed construction up for the test once something is being built
const t0 = Date.now();
while (Date.now() < until && !srv.game.council.structures.some((s) => s.progress > 0.02)) await new Promise((r) => setTimeout(r, 500));
await Promise.all(runs);
const secs = Math.round((Date.now() - t0) / 1000);
srv.close();

const j = existsSync(journal) ? readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const c = srv.game.council;
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
check(calls.some((b) => /PITCH phase/.test(b.messages[0].content) && /suggestedSites/.test(b.messages[1].content) && /catalog/.test(b.messages[1].content)), 'agents pitch from the council report (catalogue, sites) in the prompt');
check(calls.some((b) => /The council rejected that: can't build/.test(b.messages.at(-1).content)), 'a refused pitch comes back to the agent with the reason, and it retries');
check(j.filter((l) => l.kind === 'pitch' && l.ok).length >= 2, `agents pitched (${j.filter((l) => l.kind === 'pitch' && l.ok).length} accepted)`);
check(j.some((l) => l.kind === 'comment'), 'they argue in the debate');
check(j.some((l) => l.kind === 'council-vote') && j.some((l) => l.kind === 'pledge'), 'they vote and back pitches with their own stock');
check(c.structures.length >= 1, `a building is standing (${c.structures.map((s) => `${s.name} ${Math.round(s.progress * 100)}%`).join(', ')})`);
check(j.some((l) => l.kind === 'build-help'), 'they walked over and helped build');
check(c.chronicle.some((e) => /pitch passed/.test(e.text)), 'the chronicle records it');
console.log(`(${secs}s, ${calls.length} model calls)`);
console.log(failed ? `AI COUNCIL FAILED (${failed})` : 'AI COUNCIL OK');
process.exit(failed ? 1 : 0);
