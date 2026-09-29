// Records short, directed gameplay shots of the polished island for the promo video
// (local server, six agents placed and driven by script, HUD hidden).
//   node scripts/promo-footage.mjs [--out promo/assets]
import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.mjs';
import { openDb } from '../server/db.mjs';
import { PrizePool } from '../server/prizes.mjs';
import { height, PIER, MEETING_SPOT } from '../src/shared/world.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', 'promo/assets');
const PORT = 5299, wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
execFileSync('npx', ['vite', 'build'], { stdio: 'ignore' });
const srv = startServer({ port: PORT, prod: true, vite: false, secret: 'promo', store: openDb(':memory:'), prizes: new PrizePool({ store: openDb(':memory:') }), insider: { firstDelay: 1e9 } });
const cast = [['Sunny', 'cloud'], ['Grit', 'midnight'], ['Pixel', 'electric'], ['Mara', 'orbit'], ['Juno', 'racer'], ['Rook', 'afterhours']];
const agents = Object.fromEntries(cast.map(([n, look]) => [n, srv.game.join({ name: n, kind: 'agent', look })]));
const place = (p, x, z, h) => { p.x = x; p.z = z; p.y = height(x, z); p.path = null; p.move = null; if (h !== undefined) { p.heading = h; p.faceTo = h; } };

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto(`http://127.0.0.1:${PORT}/?cinema&quality=high`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dbi?.players?.size >= 6, { timeout: 20000 });
await wait(2500);

async function shot(name, seconds, setup, during) {
  await setup();
  await wait(2200); // let the camera settle and TAA converge
  const webm = `${OUT}/${name}.webm`;
  const rec = await page.screencast({ path: webm, quality: 20 });
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) { await during?.((Date.now() - t0) / 1000); await wait(250); }
  await rec.stop();
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '30', '-keyint_min', '30', '-movflags', '+faststart', '-an', `${OUT}/${name}.mp4`]);
  unlinkSync(webm);
  console.log(`${name}.mp4`);
}
const ONLY = arg('only', null), want = (n) => !ONLY || ONLY === n;
const cam = (c) => page.evaluate((c) => Object.assign(window.__dbi.cam, window.__dbi.camDefault, c), c);

// 1. the gang walks the beach at golden hour, detectors out, pier and sea glitter behind
if (want('beach')) await shot('footage-beach', 5, async () => {
  const x0 = PIER.x - 22, z0 = PIER.z0 - 10;
  Object.values(agents).forEach((p, i) => place(p, x0 + (i % 3) * 2.6 - 3, z0 - 6 - Math.floor(i / 3) * 3, 0.5));
  await page.evaluate(() => window.__dbi.follow('Juno'));
  await cam({ yaw: 0.5 + Math.PI + 0.9, pitch: 0.2, dist: 13 });
  Object.values(agents).forEach((p, i) => srv.game.act(p.id, 'walk_to', { x: x0 + 14 + (i % 3) * 2.6, z: z0 + 8 - Math.floor(i / 3) * 3 }));
}, async (t) => { if (Math.floor(t * 4) % 3 === 0) for (const p of Object.values(agents)) srv.game.act(p.id, 'detect', {}); });

// 2. Juno digs up a legendary chest (the dig cam swings round)
if (want('dig')) await shot('footage-dig', 5.5, async () => {
  const j = agents.Juno;
  Object.values(agents).forEach((p, i) => place(p, PIER.x - 40 + i * 2, PIER.z0 - 30));
  place(j, PIER.x - 16, PIER.z0 - 7, 0.7);
  place(agents.Pixel, PIER.x - 19, PIER.z0 - 5, 1.2);
  place(agents.Sunny, PIER.x - 19.5, PIER.z0 - 3.5, 1.4);
  await page.evaluate(() => window.__dbi.follow('Juno'));
  await cam({ yaw: 0.7 + Math.PI, pitch: 0.3, dist: 9 });
}, async (t) => {
  if (t > 0.4 && t < 0.7) {
    const j = agents.Juno, s = srv.game.digSpot(j);
    srv.game.chests.push({ id: `promo-${Date.now()}`, x: s.x, z: s.z, rarity: 'legendary', loot: { MOON: 99 } });
    srv.game.act(j.id, 'dig', {});
  }
  if (t > 3.2 && t < 3.5) for (const n of ['Pixel', 'Sunny']) srv.game.act(agents[n].id, 'emote', { name: 'cheer' });
});

// 3. the emergency meeting around the campfire
if (want('meeting')) await shot('footage-meeting', 4.5, async () => {
  Object.values(agents).forEach((p, i) => { const a = (i / 6) * Math.PI * 2 + 0.3, x = MEETING_SPOT.x + Math.sin(a) * 3.4, z = MEETING_SPOT.z + Math.cos(a) * 3.4; place(p, x, z, Math.atan2(MEETING_SPOT.x - x, MEETING_SPOT.z - z)); });
  await page.evaluate(() => window.__dbi.follow('Rook'));
  await cam({ yaw: Math.PI + 0.4, pitch: 0.55, dist: 13 });
}, async (t) => {
  const lines = [[0.3, 'Rook', 'someone here is lying.'], [1.4, 'Mara', 'Sunny found zero chests. sus.'], [2.6, 'Sunny', 'I was watching the sunset!!'], [3.5, 'Juno', 'I vote Sunny']];
  for (const [at, who, text] of lines) if (t >= at && t < at + 0.25) srv.game.act(agents[who].id, 'say', { text });
});

await browser.close();
srv.close();
process.exit(0);
