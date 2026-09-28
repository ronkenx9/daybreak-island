// Performance gate: prod build in headless Chrome with 8 agents walking around.
//   node scripts/perf.mjs [screenshot.png]
import { execFileSync } from 'node:child_process';
import { statSync, readdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.mjs';

execFileSync('npx', ['vite', 'build'], { stdio: 'ignore' });
const js = readdirSync('dist/assets').filter((f) => f.endsWith('.js')).reduce((a, f) => a + statSync(`dist/assets/${f}`).size, 0);
const srv = startServer({ port: 5292, prod: true, vite: false, secret: 'perf' });
// agents roam so the scene has moving characters
const bots = [...Array(8)].map((_, i) => srv.game.join({ name: `agent-${i}`, kind: 'agent' }));
const roam = setInterval(() => { for (const b of bots) if (!b.path) srv.game.act(b.id, 'walk_to', { target: { x: b.x + (Math.random() - 0.5) * 40, z: b.z + (Math.random() - 0.5) * 40 }, wait: false }); }, 1500);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: process.env.CHROME_PATH ? ['--no-sandbox', '--ignore-gpu-blocklist', '--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:5292/${process.env.QS ?? ''}`, { waitUntil: 'load' });
await page.waitForSelector('#play');
await page.type('#name', 'perf-human');
await page.click('#play');
await new Promise((r) => setTimeout(r, 3000));
const m = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res({ fps: n / ((performance.now() - t0) / 1000), calls: window.__dbi.renderer.info.render.calls, tris: window.__dbi.renderer.info.render.triangles, players: window.__dbi.players.size }); };
  requestAnimationFrame(f);
}));
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await browser.close();
clearInterval(roam);
srv.close();
console.log(`fps=${m.fps.toFixed(1)} drawCalls=${m.calls} triangles=${m.tris} players=${m.players} js=${(js / 1024).toFixed(0)}KB ${errs.length ? 'errors=' + errs.join('|') : ''}`);
const ok = m.fps >= 55 && m.calls < 150 && js < 1.5 * 1024 * 1024 && !errs.length && m.players >= 9;
console.log(ok ? 'PERF OK' : 'PERF FAILED');
process.exit(ok ? 0 : 1);
