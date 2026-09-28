// Real MCP client -> scripts/mcp.mjs -> game server. Plays a mini round.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../server/index.mjs';

const srv = startServer({ port: 5291, vite: false, secret: 'mcp-test', gameOptions: { critters: false } });
await new Promise((r) => setTimeout(r, 300));
const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['scripts/mcp.mjs'], env: { ...process.env, DBI_URL: 'http://localhost:5291', DBI_NAME: 'mcp-claude' } }));
const tool = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

let ok = true;
const check = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${d}`); if (!c) ok = false; };
const tools = (await client.listTools()).tools.map((t) => t.name);
check('tools listed', ['join', 'get_state', 'look', 'landmarks', 'walk_to', 'step', 'detect', 'dig', 'say', 'emote', 'leaderboard', 'critters', 'attack', 'insider_join', 'insider_leave', 'insider_status', 'insider_trade', 'insider_accuse'].every((t) => tools.includes(t)), tools.join(','));
const j = await tool('join', { name: 'mcp-claude', look: 'racer' });
check('join', j.ok && j.token);
const s = await tool('get_state');
check('get_state', s.ok && s.you.name === 'mcp-claude');
check('say', (await tool('say', { text: 'gm island' })).ok);
check('emote', (await tool('emote', { name: 'wave' })).ok);
const w = await tool('walk_to', { target: 'NFLX' });
check('walk_to landmark', w.ok && w.status === 'arrived', JSON.stringify(w));
const st = await tool('step', { direction: 'south', distance: 3 });
check('step', st.ok, JSON.stringify(st));
const d = await tool('detect');
check('detect', d.ok && d.bars >= 0);
// put the agent on a chest server-side to verify the dig path end to end
const me = [...srv.game.players.values()].find((p) => p.name === 'mcp-claude');
const c = srv.game.chests[0]; me.x = c.x; me.z = c.z;
const dg = await tool('dig');
check('dig finds chest', dg.ok && dg.found === true, JSON.stringify(dg));
// Stock Critters: fight the nearest critter over MCP
srv.game.critters.spawn('grunt'); srv.game.critters.spawn('boss'); // critters were off so the walking checks above stay deterministic
const cr = await tool('critters');
check('critters', cr.ok && cr.critters.length >= 2 && cr.critters.some((c) => c.kind === 'boss'), JSON.stringify(cr.critters?.[0]));
const k = srv.game.critters.list.find((c) => c.kind === 'grunt');
me.x = k.x + 2; me.z = k.z; k.hp = 8;
const at = await tool('attack', { target: k.id });
check('attack defeats a weakened critter', at.ok && at.defeated === true, JSON.stringify(at));
check('critter loot in portfolio', srv.game.players.get(me.id).portfolio[k.ticker] > 0);
// Insider: lobby over MCP
const ij = await tool('insider_join');
check('insider_join', ij.ok && ij.joined === true && ij.phase === 'lobby', JSON.stringify(ij).slice(0, 200));
check('insider_status', (await tool('insider_status')).ok);
check('insider_trade outside a round is refused', (await tool('insider_trade', { ticker: 'BLUP', side: 'buy', shares: 5 })).ok === false);
check('insider_leave', (await tool('insider_leave')).ok);
const lb = await tool('leaderboard');
check('leaderboard', lb.ok && lb.leaderboard.some((r) => r.name === 'mcp-claude' && r.value > 0));
await client.close();
srv.close();
console.log(ok ? 'MCP OK' : 'MCP FAILED');
process.exit(ok ? 0 : 1);
