// G8: limits that make the server safe to expose on the public internet.
//   node test/public.mjs
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.MAX_PLAYERS = '5';
process.env.JOINS_PER_MIN = '8';
process.env.SWEEP_MS = '200';
const { startServer } = await import('../server/index.mjs');
const PORT = 5294, BASE = `http://127.0.0.1:${PORT}`;
const srv = startServer({ port: PORT, vite: false, secret: 'public' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
await wait(200);
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); srv.close(); process.exit(1); } };

const tokens = [];
await test('player cap: the 6th join is refused while 5 are on the island', async () => {
  for (let i = 0; i < 5; i++) { const r = await post('/api/join', { name: `cap-${i}` }); assert.equal(r.status, 200); tokens.push(r.token); }
  const r = await post('/api/join', { name: 'cap-5' });
  assert.equal(r.status, 429); assert.match(r.error, /full/);
});

await test('per-address join rate limit', async () => {
  for (const token of tokens.splice(0)) await post('/api/leave', { token });
  // 5 joins already counted this minute; 3 more are allowed, the 9th is not
  for (let i = 0; i < 3; i++) { const r = await post('/api/join', { name: `rate-${i}` }); assert.equal(r.status, 200, `join ${i}`); tokens.push(r.token); }
  const r = await post('/api/join', { name: 'rate-3' });
  assert.equal(r.status, 429); assert.match(r.error, /too many joins/);
});

await test('stale agent tokens are swept once their player is gone', async () => {
  const id = srv.tokens.get(tokens[0]);
  srv.game.leave(id); // e.g. timed out as idle
  await wait(500);
  assert.equal(srv.tokens.has(tokens[0]), false);
  const r = await post('/api/act', { token: tokens[0], action: 'state' });
  assert.equal(r.status, 401);
});

await test('one player per WebSocket connection', async () => {
  for (const token of tokens.splice(0)) await post('/api/leave', { token });
  srv.game.players.clear();
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'x-forwarded-for': '10.0.0.9' } });
  await new Promise((r) => ws.on('open', r));
  for (let i = 0; i < 4; i++) ws.send(JSON.stringify({ type: 'join', name: `dup-${i}` }));
  await wait(300);
  assert.equal(srv.game.players.size, 1);
  ws.close();
  await wait(200);
  assert.equal(srv.game.players.size, 0, 'closing the socket removes the player');
});

await test('oversized WebSocket messages close that connection, not the server', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { 'x-forwarded-for': '10.0.0.10' } });
  await new Promise((r) => ws.on('open', r));
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  ws.send('x'.repeat(10_000));
  assert.equal(await closed, 1009);
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(h.ok, true, 'server still up');
});

srv.close();
console.log(`${n} tests\nPUBLIC OK`);
process.exit(0);
