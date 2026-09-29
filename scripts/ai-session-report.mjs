// G27: summarise the AI agents' journal (and spend) and check a session really happened.
//   node scripts/ai-session-report.mjs [--min-decisions 40] [--since <ms epoch>] [--journal data/journal.jsonl]
import { readFileSync, existsSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const file = arg('journal', 'data/journal.jsonl');
const since = Number(arg('since', 0));
const minDecisions = Number(arg('min-decisions', 1));
const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.t >= since) : [];
const by = (k) => lines.filter((l) => l.kind === k);
const decisions = by('decision'), ai = decisions.filter((d) => d.source === 'ai');
const spend = existsSync('data/ai-spend.json') ? JSON.parse(readFileSync('data/ai-spend.json', 'utf8')) : null;
const count = {};
for (const d of decisions) { const k = d.text.split(' ')[0]; count[k] = (count[k] ?? 0) + 1; }
const agents = [...new Set(lines.map((l) => l.agent))];
console.log(`agents: ${agents.join(', ')}`);
console.log(`decisions: ${decisions.length} (${ai.length} by the model, ${decisions.length - ai.length} scripted)  ${JSON.stringify(count)}`);
console.log(`spoken lines: ${by('say').length}  finds: ${by('find').length}  junk: ${by('junk').length}  sunsets: ${by('sunset').length}  errors: ${by('error').length + by('ai-error').length}  bad replies: ${by('bad-reply').length}`);
if (spend) console.log(`spend: $${spend.spent.toFixed(3)} of $${spend.budget} over ${spend.calls} calls (${spend.tokensIn} in / ${spend.tokensOut} out tokens)`);
console.log('some lines:');
for (const l of by('say').slice(-8)) console.log(`  ${l.agent}: "${l.text}"`);
const ok = decisions.length >= minDecisions && ai.length >= minDecisions * 0.7 && by('say').length > 0 && spend && spend.spent <= spend.budget;
console.log(ok ? 'SESSION OK' : 'SESSION FAILED');
process.exit(ok ? 0 : 1);
