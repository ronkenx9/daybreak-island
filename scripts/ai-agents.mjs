// Run AI agents on an island.
//   agent-keys run dbi-ai -- node scripts/ai-agents.mjs [--url http://localhost:5180] [--agents 5] [--minutes 30] [--budget 20] [--daily] [--play-rate 0.15]
// Without --url it starts its own local server. Decisions, lines and outcomes go to data/journal.jsonl,
// spend to data/ai-spend.json (shared across runs, so the cap holds all night).
import { makeLLM, makeMeter } from '../agents/llm.mjs';
import { Agent, PERSONAS } from '../agents/brain.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('agents', 5)), MINUTES = Number(arg('minutes', 30)), BUDGET = Number(arg('budget', 20));
let BASE = arg('url', null), srv = null;
if (!BASE) {
  const { startServer } = await import('../server/index.mjs');
  srv = startServer({ port: Number(arg('port', 5180)), vite: false, prod: true, secret: `ai-${Date.now()}` });
  BASE = `http://127.0.0.1:${srv.port}`;
  await new Promise((r) => setTimeout(r, 300));
}
// --daily: the budget is per UTC day (for agents that live on the server around the clock)
const meter = makeMeter({ budget: BUDGET, file: arg('spend', 'data/ai-spend.json'), daily: process.argv.includes('--daily') });
const llm = process.env.BANKR_LLM_KEY ? makeLLM({ meter, model: arg('model', 'claude-haiku-4.5') }) : null;
if (!llm) console.log('no BANKR_LLM_KEY: agents run on scripted habits only');
const quiet = process.argv.includes('--quiet');
const log = (l) => { if (!quiet && ['say', 'find', 'junk', 'sunset', 'budget', 'bad-reply', 'ai-error'].includes(l.kind)) console.log(`${new Date(l.t).toISOString().slice(11, 19)} ${l.agent.padEnd(6)} ${l.kind.padEnd(8)} ${l.text}`); };
const agents = PERSONAS.slice(0, N).map((persona) => new Agent({ persona, base: BASE, llm, log, journal: arg('journal', 'data/journal.jsonl'), playRate: Number(arg('play-rate', 1)) }));
const until = Date.now() + MINUTES * 60000;
const t0 = Date.now();
await Promise.all(agents.map(async (a, i) => { await new Promise((r) => setTimeout(r, i * 2500)); return a.live({ until }); }));
console.log(`done: ${agents.map((a) => `${a.persona.name}=${a.decisions}`).join(' ')} in ${Math.round((Date.now() - t0) / 60000)}min; spent $${meter.spent.toFixed(3)} of $${BUDGET} over ${meter.calls} calls`);
srv?.close();
process.exit(0);
