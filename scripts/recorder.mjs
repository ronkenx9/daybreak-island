// Films the island for the montage. A headless browser in cinema mode (no HUD)
// rides behind one agent at a time; a small "director" reads the agents'
// journal and cuts to whoever just did something interesting, and varies the
// shot (low and close for sunsets, wider for hunting).
//   node scripts/recorder.mjs [--url http://127.0.0.1:5180] [--minutes 30] [--segment 40] [--out data/footage]
import { mkdirSync, appendFileSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'http://127.0.0.1:5180'), MINUTES = Number(arg('minutes', 30)), SEG = Number(arg('segment', 40)) * 1000;
const OUT = arg('out', 'data/footage'), JOURNAL = arg('journal', 'data/journal.jsonl');
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${URL}/?cinema&watch&quality=high`, { waitUntil: 'load' });
await wait(4000);

// director: score agents by what they did in the last ~40s of the journal
let journalPos = 0;
function recentEvents() {
  if (!existsSync(JOURNAL)) return [];
  const size = statSync(JOURNAL).size;
  if (size <= journalPos) return [];
  const text = readFileSync(JOURNAL, 'utf8').slice(journalPos);
  journalPos = size;
  return text.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const WEIGHT = { find: 5, junk: 4, sunset: 6, say: 1.5, decision: 0.2 };
const weigh = (e) => (WEIGHT[e.kind] ?? 0) + (e.kind === 'decision' && /^sunset/.test(e.text) ? 9 : 0); // heading off to watch the sunset: go with them
const scores = new Map();
function pick(names, last) {
  for (const e of recentEvents()) scores.set(e.agent, (scores.get(e.agent) ?? 0) + weigh(e) + (e.rarity === 'legendary' ? 10 : 0));
  const ranked = names.map((n) => ({ n, s: (scores.get(n) ?? 0) + Math.random() - (n === last ? 2 : 0) })).sort((a, b) => b.s - a.s);
  for (const k of scores.keys()) scores.set(k, (scores.get(k) ?? 0) * 0.4); // decay
  return ranked[0]?.n;
}

const end = Date.now() + MINUTES * 60000;
let last = null, n = 0;
while (Date.now() < end) {
  const names = await page.evaluate(() => [...window.__dbi.players.values()].filter((p) => p.kind === 'agent').map((p) => p.name));
  if (!names.length) { await wait(3000); continue; }
  const who = pick(names, last);
  const shot = await page.evaluate((name) => {
    window.__dbi.follow(name);
    const p = [...window.__dbi.players.values()].find((q) => q.name === name);
    const cam = window.__dbi.cam;
    // sunset: low and close behind them; otherwise a random mix of medium and wide
    const sunset = p && p.cur.y < 1.6;
    const r = Math.random();
    if (sunset) cam.yaw = p.cur.h + Math.PI; // over their shoulder, into the sunset
    Object.assign(cam, sunset ? { pitch: 0.16, dist: 7.5 } : r < 0.4 ? { pitch: 0.32, dist: 9 } : r < 0.8 ? { pitch: 0.5, dist: 14 } : { pitch: 0.85, dist: 22 });
    return sunset ? 'sunset' : r < 0.4 ? 'medium' : r < 0.8 ? 'wide' : 'aerial';
  }, who);
  const file = `${OUT}/seg-${String(Date.now())}-${who}.webm`;
  const start = Date.now();
  const phase0 = await page.evaluate(() => window.__dbi.insiderPhase ?? null);
  const rec = await page.screencast({ path: file, quality: 34 });
  await wait(SEG);
  await rec.stop();
  // compress to H.264 in the background (webm straight from the screencast is ~2MB/s)
  const mp4 = file.replace(/\.webm$/, '.mp4');
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-i', file, '-c:v', 'h264_videotoolbox', '-b:v', '4M', '-r', '30', '-an', mp4], { stdio: 'ignore' });
  ff.on('exit', (code) => { if (code === 0) unlinkSync(file); });
  const phase1 = await page.evaluate(() => window.__dbi.insiderPhase ?? null);
  appendFileSync(`${OUT}/index.jsonl`, `${JSON.stringify({ file: mp4, start, end: Date.now(), follow: who, shot, phase: [phase0, phase1] })}\n`);
  console.log(`${new Date(start).toISOString().slice(11, 19)} filmed ${who} (${shot}) -> ${file}`);
  last = who; n++;
}
await browser.close();
console.log(`recorded ${n} segments${errs.length ? `; page errors: ${errs.slice(0, 3).join(' | ')}` : ''}`);
process.exit(0);
