// Beauty shots for art direction: the game as a player sees it (default camera,
// HUD on) and as a viewer sees it (?cinema), at 1080p, in one contact sheet.
//   node scripts/beauty.mjs [--out evidence/beauty] [--webgl]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.mjs';
import { openDb } from '../server/db.mjs';
import { PrizePool } from '../server/prizes.mjs';
import { height, PIER, SPAWN, MEETING_SPOT, LIGHTHOUSE } from '../src/shared/world.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', 'evidence/beauty');
const QS = process.argv.includes('--webgl') ? '&backend=webgl' : '';
const PORT = 5298, wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
execFileSync('npx', ['vite', 'build'], { stdio: 'ignore' });
const srv = startServer({ port: PORT, prod: true, vite: false, secret: 'beauty', store: openDb(':memory:'), prizes: new PrizePool({ store: openDb(':memory:') }), insider: { firstDelay: 1e9 } });
const names = ['Sunny', 'Grit', 'Pixel', 'Mara', 'Juno'];
const looks = ['cloud', 'midnight', 'electric', 'orbit', 'racer'];
for (const [i, n] of names.entries()) srv.game.join({ name: n, kind: 'agent', look: looks[i] });

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/?quality=high${QS}`, { waitUntil: 'load' });
await page.type('#name', 'Rook');
await page.click('#play');
await page.waitForFunction(() => window.__dbi?.me && window.__dbi.players.get(window.__dbi.me), { timeout: 15000 });
const me = [...srv.game.players.values()].find((p) => p.name === 'Rook');
const agents = [...srv.game.players.values()].filter((p) => p.kind === 'agent');
const place = (p, x, z, h) => { p.x = x; p.z = z; p.y = height(x, z); if (h !== undefined) { p.heading = h; p.faceTo = h; } p.path = null; };

// each shot: where I stand, where the agents stand, camera (null = the game's default), HUD or cinema
const shots = [
  { name: 'spawn-default', at: [SPAWN.x, SPAWN.z - 2, Math.PI], crowd: (i) => [SPAWN.x - 6 + i * 3, SPAWN.z - 10 - (i % 2) * 3] },
  { name: 'beach-default', at: [PIER.x - 10, PIER.z0 - 6, 0.2], crowd: (i) => [PIER.x - 20 + i * 5, PIER.z0 - 16 - (i % 3) * 4] },
  { name: 'forest-default', at: [-20, 40, Math.PI], crowd: (i) => [-26 + i * 3, 30 - (i % 2) * 4] },
  { name: 'meeting', at: [MEETING_SPOT.x, MEETING_SPOT.z + 3.2, Math.PI], crowd: (i) => [MEETING_SPOT.x + Math.sin((i / 5) * 6.28 + 0.6) * 3.2, MEETING_SPOT.z + Math.cos((i / 5) * 6.28 + 0.6) * 3.2], cam: { pitch: 0.62, dist: 14 }, cinema: true },
  { name: 'pier-cinema', at: [PIER.x, PIER.z1 - 3, 0], crowd: (i) => [PIER.x - 8 + i * 4, PIER.z0 - 8], cam: { yaw: Math.PI + 0.5, pitch: 0.16, dist: 8 }, cinema: true },
  { name: 'lighthouse-cinema', at: [LIGHTHOUSE.x - 12, LIGHTHOUSE.z - 10, Math.atan2(12, 10)], crowd: (i) => [LIGHTHOUSE.x - 18 + i * 2.5, LIGHTHOUSE.z - 16], cam: { yaw: Math.atan2(12, 10) + Math.PI + 0.4, pitch: 0.3, dist: 16 }, cinema: true },
];
for (const sh of shots) {
  place(me, sh.at[0], sh.at[1], sh.at[2]);
  agents.forEach((p, i) => { const [x, z] = sh.crowd(i); place(p, x, z, Math.atan2(me.x - x, me.z - z)); });
  await page.evaluate((c, cinema) => {
    document.body.classList.toggle('cinema', !!cinema);
    const d = window.__dbi;
    Object.assign(d.cam, d.camDefault, c ?? {});
  }, sh.cam ?? null, !!sh.cinema);
  await wait(4000);
  await page.screenshot({ path: `${OUT}/${sh.name}.png` });
}
// dig and reveal on the beach, with the game's own camera (the dig cam should swing round)
{
  place(me, PIER.x - 14, PIER.z0 - 8, 0.3);
  agents.forEach((p, i) => place(p, PIER.x - 30 + i * 3, PIER.z0 - 20));
  await page.evaluate(() => { document.body.classList.remove('cinema'); const d = window.__dbi; Object.assign(d.cam, d.camDefault); d.cam.yaw = 0.3 + Math.PI; });
  await wait(2500);
  const s = srv.game.digSpot(me);
  srv.game.chests.push({ id: 'beauty', x: s.x, z: s.z, rarity: 'legendary', loot: { MOON: 99 } });
  srv.game.act(me.id, 'dig', {});
  await wait(1100);
  await page.screenshot({ path: `${OUT}/dig.png` });
  await wait(2300);
  await page.screenshot({ path: `${OUT}/reveal.png` });
  shots.push({ name: 'dig' }, { name: 'reveal' });
}
// walk cycle: frames of an agent walking across in front of me, plus one scanning
if (process.argv.includes('--walk')) {
  place(me, PIER.x - 14, PIER.z0 - 8, Math.PI / 2);
  const w = agents[4], sc = agents[2];
  place(w, PIER.x - 10, PIER.z0 - 12, 0);
  place(sc, PIER.x - 16, PIER.z0 - 3, 0);
  await page.evaluate(() => { document.body.classList.add('cinema'); const d = window.__dbi; Object.assign(d.cam, d.camDefault, { yaw: Math.PI / 2 + Math.PI, pitch: 0.18, dist: 10 }); });
  await wait(2000);
  srv.game.act(w.id, 'walk_to', { x: PIER.x - 10, z: PIER.z0 + 4 });
  for (let k = 0; k < 8; k++) { if (k % 2 === 0) srv.game.act(sc.id, 'detect', {}); await wait(180); await page.screenshot({ path: `${OUT}/walk-${k}.png` }); }
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => ['-i', `${OUT}/walk-${k}.png`]), '-filter_complex', '[0][1][2][3]hstack=4[a];[4][5][6][7]hstack=4[b];[a][b]vstack,scale=2400:-1', `${OUT}/walk.jpg`]);
}
const info = await page.evaluate(() => window.__dbi.view.info());
execFileSync('ffmpeg', ['-v', 'error', '-y', ...shots.flatMap((sh) => ['-i', `${OUT}/${sh.name}.png`]), '-filter_complex', '[0][1][2][3]hstack=4[a];[4][5][6][7]hstack=4[b];[a][b]vstack,scale=2400:-1', `${OUT}/sheet.jpg`]);
console.log(JSON.stringify(info));
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await browser.close();
srv.close();
process.exit(0);
