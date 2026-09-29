// One process: the authoritative game loop, WebSocket for browsers, a REST
// API for agents, and Vite (dev) or the built bundle (prod).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { Game, ACTIONS } from './game.mjs';
import { openDb } from './db.mjs';
import { prizePoolFromEnv } from './prizes.mjs';

// the owner's own pitches go to the council like anyone else's (the agents decide)
export const OWNER_PITCHES = [
  {
    key: 'critters-v1', by: 'the owner', kind: 'rule', args: { rule: 'critters', value: 1 },
    pitch: 'Monsters! Some you fight together (brutes that drop their hoard of stock), some you have to hide from (shades that chase you; dig a hole and hide in it, or duck in next to a building). Get caught and you drop part of your bag, buried where you fell for anyone to dig up. What do you think?',
  },
];
const councilFromEnv = () => ({ seeds: OWNER_PITCHES, ...Object.fromEntries(['propose', 'debate', 'vote'].filter((k) => process.env[`COUNCIL_${k.toUpperCase()}`]).map((k) => [k, Number(process.env[`COUNCIL_${k.toUpperCase()}`])])) });

export function startServer({ port = Number(process.env.PORT || 5180), prod = process.env.NODE_ENV === 'production', vite = !prod, secret = process.env.SEED_SECRET, store = openDb(), prizes = prizePoolFromEnv(store), insider = {}, council = councilFromEnv() } = {}) {
  const game = new Game({ secret, prizes, insider, council, store });
  const tokens = new Map(); // agent token -> player id
  // public-server limits
  const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 120);
  const JOINS_PER_MIN = Number(process.env.JOINS_PER_MIN || 20);
  const joinsByIp = new Map(); // ip -> [timestamps in the last minute]
  const ipOf = (req) => (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress;
  const canJoin = (ip) => {
    if (game.players.size >= MAX_PLAYERS) return 'the island is full, try again soon';
    const now = Date.now(), recent = (joinsByIp.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= JOINS_PER_MIN) return 'too many joins from your address, wait a minute';
    recent.push(now); joinsByIp.set(ip, recent);
    return null;
  };
  // forget tokens and rate-limit entries whose players or minute have gone
  const sweep = setInterval(() => {
    for (const [t, id] of tokens) if (!game.players.has(id)) tokens.delete(t);
    const now = Date.now();
    for (const [ip, ts] of joinsByIp) if (ts.every((t) => now - t >= 60_000)) joinsByIp.delete(ip);
  }, Number(process.env.SWEEP_MS || 30_000));

  // fixed-step simulation at 20Hz
  const TICK = 1 / 20;
  const loop = setInterval(() => game.tick(TICK), TICK * 1000);

  const send = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
  const readJson = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 20000) req.destroy(); }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } }); });

  // ---- agent REST API
  async function api(req, res, url) {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST' }); res.end(); return true; }
    const path = url.pathname;
    if (path === '/api/health') { send(res, 200, { ok: true, players: game.players.size, tick: game.t }); return true; }
    if (path === '/api/prizes') { send(res, 200, prizes.stats()); return true; }
    if (path === '/api/leaderboard') { send(res, 200, { leaderboard: game.leaderboard() }); return true; }
    if (path === '/api/council') { send(res, 200, game.council.view(null)); return true; }
    if (path === '/api/join' && req.method === 'POST') {
      const b = await readJson(req);
      const why = canJoin(ipOf(req));
      if (why) { send(res, 429, { ok: false, error: why }); return true; }
      const p = game.join({ name: b.name, kind: 'agent', look: b.look, key: b.key });
      const token = randomBytes(12).toString('hex');
      tokens.set(token, p.id);
      send(res, 200, { ok: true, token, id: p.id, name: p.name, look: p.look, actions: ACTIONS, rules: game.view(p).rules });
      return true;
    }
    if (path === '/api/act' && req.method === 'POST') {
      const b = await readJson(req);
      const id = tokens.get(b.token ?? (req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!id || !game.players.has(id)) { send(res, 401, { ok: false, error: 'unknown token, call /api/join first' }); return true; }
      const out = await game.act(id, b.action, b.args ?? {});
      send(res, 200, out);
      return true;
    }
    if (path === '/api/leave' && req.method === 'POST') {
      const b = await readJson(req);
      const id = tokens.get(b.token);
      if (id) { game.leave(id); tokens.delete(b.token); }
      send(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  let viteServer = null;
  const ready = (async () => {
    if (vite) {
      const { createServer: createVite } = await import('vite');
      viteServer = await createVite({ server: { middlewareMode: true, hmr: { port: port + 1000 } }, appType: 'spa' });
    }
  })();

  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  async function serveStatic(req, res) {
    const p = normalize(new URL(req.url, 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join('dist', p === '/' ? 'index.html' : p);
    try { const body = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch {
      try { const body = await readFile(join('dist', 'index.html')); res.writeHead(200, { 'content-type': 'text/html' }); res.end(body); }
      catch { res.writeHead(404); res.end('not found'); } // no build here (e.g. API-only server)
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/') && await api(req, res, url)) return;
    await ready;
    if (viteServer) viteServer.middlewares(req, res); else serveStatic(req, res);
  });

  // ---- WebSocket: browsers play (or watch) with the same actions
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', (ws, req) => {
    let id = null;
    const ip = ipOf(req);
    ws.on('error', () => ws.terminate()); // bad frames (e.g. oversized) must not crash the server
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'join') {
        if (id) return; // one player per connection
        const why = canJoin(ip);
        if (why) { ws.send(JSON.stringify({ type: 'full', error: why })); return; }
        const p = game.join({ name: m.name, kind: 'human', look: m.look, key: m.key });
        id = p.id;
        ws.send(JSON.stringify({ type: 'welcome', id }));
      } else if (m.type === 'act' && id) {
        const out = await game.act(id, m.action, m.args ?? {});
        if (m.rid) ws.send(JSON.stringify({ type: 'result', rid: m.rid, out }));
      }
    });
    ws.on('close', () => { if (id) game.leave(id); });
  });
  const snapLoop = setInterval(() => {
    if (!wss.clients.size) return;
    const snap = JSON.stringify({ type: 'snap', ...game.snapshot() });
    for (const c of wss.clients) if (c.readyState === 1) c.send(snap);
  }, 1000 / 12);

  server.listen(port, process.env.HOST); // HOST=127.0.0.1 behind a reverse proxy
  return {
    game, server, port, tokens,
    close() { clearInterval(loop); clearInterval(snapLoop); clearInterval(sweep); for (const p of game.players.values()) game.saveBag(p); game.council.save(); wss.close(); server.close(); server.closeAllConnections(); viteServer?.close(); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = startServer();
  console.log(`daybreak-island on http://localhost:${s.port}`);
}
