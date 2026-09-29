// G10: the public site works end to end in a real browser: page loads from
// Vercel, connects to the VPS game server over wss, shows live characters
// using the bean characters, and a human can join alongside the agents.
//   node scripts/check-live.mjs [url] [screenshot.png]
import puppeteer from 'puppeteer-core';

const URL = process.argv[2] ?? 'https://daybreak-island.vercel.app/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [], sockets = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
cdp.on('Network.webSocketCreated', (e) => sockets.push(e.url));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('#play');
await page.type('#name', 'live-check');
await page.click('#play');
await new Promise((r) => setTimeout(r, 6000));
const s = await page.evaluate(() => {
  const d = window.__dbi;
  const players = [...d.players.values()];
  const me = players.find((p) => p.name === 'live-check');
  let chibi = false;
  me?.ch.root.traverse((o) => { if (o.isBone && o.name === 'happy') chibi = true; }); // the bean's expression bone
  return { players: players.length, agents: players.filter((p) => p.kind === 'agent').length, me: !!me, chibi, board: document.querySelectorAll('#board li').length };
});
if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
await browser.close();
const wss = sockets.find((u) => u.startsWith('wss://'));
console.log(`url=${URL} socket=${wss ?? 'none'} players=${s.players} agents=${s.agents} joined=${s.me} chibi=${s.chibi} leaderboard=${s.board} ${errs.length ? 'errors=' + errs.join(' | ') : ''}`);
const ok = !!wss && s.me && s.agents >= 1 && s.chibi && s.board >= 1 && !errs.length;
console.log(ok ? 'LIVE OK' : 'LIVE FAILED');
process.exit(ok ? 0 : 1);
