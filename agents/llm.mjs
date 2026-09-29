// OpenAI-compatible chat client (Bankr LLM gateway by default) with a hard
// spending cap. Cost is computed from the token usage each response reports,
// priced conservatively, and persisted so a restart keeps counting.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// $ per million tokens; deliberately above list price so the cap is never exceeded in practice
export const PRICES = { 'claude-haiku-4.5': { in: 1.5, out: 7.5 } };

export class BudgetExhausted extends Error {}

export function makeMeter({ budget = 20, file = 'data/ai-spend.json' } = {}) {
  let state = { spent: 0, calls: 0, tokensIn: 0, tokensOut: 0, startedAt: new Date().toISOString() };
  try { state = { ...state, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  const save = () => { if (!file) return; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ ...state, budget, updatedAt: new Date().toISOString() }, null, 2)); };
  return {
    get spent() { return state.spent; },
    get calls() { return state.calls; },
    get exhausted() { return state.spent >= budget; },
    budget,
    add(model, usage) {
      const p = PRICES[model] ?? { in: 5, out: 25 };
      const cost = ((usage?.prompt_tokens ?? 0) * p.in + (usage?.completion_tokens ?? 0) * p.out) / 1e6;
      state.spent += cost; state.calls++;
      state.tokensIn += usage?.prompt_tokens ?? 0; state.tokensOut += usage?.completion_tokens ?? 0;
      save();
      return cost;
    },
    snapshot: () => ({ ...state, budget }),
  };
}

export function makeLLM({ base = process.env.BANKR_LLM_BASE || 'https://llm.bankr.bot/v1', key = process.env.BANKR_LLM_KEY, model = 'claude-haiku-4.5', meter, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  return {
    model,
    async chat(messages, { maxTokens = 220, temperature = 0.9 } = {}) {
      if (meter?.exhausted) throw new BudgetExhausted(`AI budget of $${meter.budget} used up`);
      const r = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`LLM ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      const cost = meter ? meter.add(model, j.usage) : 0;
      return { text: j.choices?.[0]?.message?.content ?? '', usage: j.usage, cost };
    },
  };
}

/** Pull the first JSON object out of a model reply (tolerates prose or code fences around it). */
export function parseJson(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
