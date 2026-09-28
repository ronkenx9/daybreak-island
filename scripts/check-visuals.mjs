// G17/G18: the visual systems are on and react to play, with a screenshot strip.
//   node scripts/check-visuals.mjs            -> VISUALS OK, evidence/visuals-*.png
//   node scripts/check-visuals.mjs --tiers    -> TIERS OK (automatic step-down under load)
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { startServer } from '../server/index.mjs';
import { openDb } from '../server/db.mjs';
import { PrizePool } from '../server/prizes.mjs';
import { height, pathDist } from '../src/shared/world.js';
import { makeNoise } from '../src/shared/noise.js';

const TIERS = process.argv.includes('--tiers');
const MECH = process.argv.includes('--mechanics');
const PORT = 5297, wait = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync('npx', ['vite', 'build'], { stdio: 'ignore' });
const store = openDb(':memory:');
const srv = startServer({ port: PORT, prod: true, vite: false, secret: 'visuals', store, prizes: new PrizePool({ store }) });
for (let i = 0; i < 5; i++) srv.game.join({ name: `agent-${i}`, kind: 'agent' });

// a grassy spot at a forest edge, so the shot shows trees, grass and props
const N = makeNoise(99);
let spot = null;
for (let r = 0; r < 4000 && !spot; r++) {
  const x = ((r * 37) % 180) - 90, z = ((r * 53) % 180) - 90, h = height(x, z);
  if (h > 2 && pathDist(x, z) > 6 && N.fbm(x * 0.018 + 5, z * 0.018 - 3, 3) > -0.05 && N.fbm(x * 0.018 + 5, z * 0.018 - 3, 3) < 0.02) spot = { x, z };
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.type('#name', 'visual-check');
await page.click('#play');
await page.waitForFunction(() => window.__dbi?.me && window.__dbi.players.get(window.__dbi.me), { timeout: 15000 });
const me = [...srv.game.players.values()].find((p) => p.name === 'visual-check');
me.x = spot.x; me.z = spot.z; me.y = height(spot.x, spot.z); me.heading = 0.4;
for (const [i, p] of [...srv.game.players.values()].filter((q) => q.kind === 'agent').entries()) { p.x = spot.x + (i - 2) * 3.5; p.z = spot.z - 5 - (i % 2) * 3; }
await wait(2500);
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

if (MECH) {
  // count the human's detector readings on the server
  let detects = 0;
  const act0 = srv.game.act.bind(srv.game);
  srv.game.act = (id, action, args) => { if (id === me.id && action === 'detect') detects++; return act0(id, action, args); };
  srv.game.chests = srv.game.chests.filter((c) => Math.hypot(c.x - me.x, c.z - me.z) > 20);
  await page.keyboard.down('Space');
  await wait(1600);
  const during = detects;
  await page.keyboard.up('Space');
  await wait(1000);
  check(during >= 4, `holding Space keeps scanning (${during} readings in 1.6s)`);
  check(detects - during <= 1, `releasing Space stops scanning (${detects - during} after release)`);

  // empty dig: force junk
  const rnd0 = srv.game.rnd;
  srv.game.rnd = () => 0.1;
  await page.keyboard.press('KeyE');
  await wait(2100);
  srv.game.rnd = rnd0;
  const junk = await page.evaluate(() => ({ junks: window.__dbi.fx.junks.length, hint: document.getElementById('detector-hint').textContent }));
  check(junk.junks > 0, 'junk pops out of the hole'); check(/dug up/.test(junk.hint), `junk hint (${junk.hint})`);
  await page.screenshot({ path: 'evidence/mech-1-junk.png' });

  // streak: two finds in a row
  for (const rarity of ['common', 'legendary']) {
    await wait(2500);
    me.x += 3; me.y = height(me.x, me.z);
    await wait(300);
    srv.game.chests.push({ id: `m-${rarity}`, x: me.x + Math.sin(me.heading) * 0.6, z: me.z + Math.cos(me.heading) * 0.6, rarity, loot: { MOON: 40 } });
    await page.keyboard.press('KeyE');
    if (rarity === 'legendary') {
      await wait(1800 + 900); // dig, then mid-shake
      const shake = await page.evaluate(() => { const r = window.__dbi.fx.reveals.at(-1); return r ? { rot: Math.abs(r.g.rotation.z) + Math.abs(r.g.rotation.x), seam: r.seam.material.opacity, open: r.lid.rotation.x } : null; });
      check(shake && shake.rot > 0.001 && shake.seam > 0.2 && shake.open === 0, `chest shakes and glows before opening (${JSON.stringify(shake)})`);
      await page.screenshot({ path: 'evidence/mech-2-shake.png' });
      const maxShake = await page.evaluate(() => new Promise((res) => { let m = 0; const t0 = performance.now(); const f = () => { m = Math.max(m, window.__dbi.fx.shake); if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(m); }; f(); }));
      check(maxShake > 0.3, `legendary shakes the camera (${maxShake.toFixed(2)})`);
      await page.screenshot({ path: 'evidence/mech-3-open.png' });
    } else await wait(2000);
  }
  await wait(800);
  const streak = await page.evaluate(() => ({ hidden: document.getElementById('streak').hidden, text: document.getElementById('streak').textContent }));
  check(!streak.hidden && /x1\.5/.test(streak.text), `streak badge (${JSON.stringify(streak)})`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'evidence/mech-1-junk.png', '-i', 'evidence/mech-2-shake.png', '-i', 'evidence/mech-3-open.png', '-filter_complex', '[0][1][2]hstack=3,scale=1800:-1', 'evidence/mechanics-strip.png']);
  console.log(`detects=${during}/${detects} junk=${JSON.stringify(junk)} streak=${JSON.stringify(streak)}`);
} else if (TIERS) {
  const start = await page.evaluate(() => window.__dbi.view.info());
  check(start.tier === 'high' && start.shadows && start.post, `starts on high tier (${JSON.stringify(start)})`);
  // make the device "slow": throttle the CPU hard and wait for the automatic step-down
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 30 });
  await page.waitForFunction(() => window.__dbi.view.tier !== 'high', { timeout: 40000 }).catch(() => {});
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const after = await page.evaluate(() => ({ ...window.__dbi.view.info(), grass: window.__dbi.island.grass.mesh.geometry.instanceCount }));
  check(after.tier !== 'high', `stepped down under load (${JSON.stringify(after)})`);
  check(!after.post, 'blur pass off on the cheaper tier');
  check(after.grass < 110000, 'less grass on the cheaper tier');
  await page.evaluate(() => window.__dbi.view.setTier('low'));
  const low = await page.evaluate(() => ({ ...window.__dbi.view.info(), grass: window.__dbi.island.grass.mesh.geometry.instanceCount }));
  check(!low.shadows && !low.post && low.grass <= 22000, `low tier is cheap (${JSON.stringify(low)})`);
  console.log(`start=${JSON.stringify(start)} afterLoad=${JSON.stringify(after)} low=${JSON.stringify(low)}`);
} else {
  const base = await page.evaluate(() => ({ ...window.__dbi.view.info(), grass: window.__dbi.island.grass.mesh.geometry.instanceCount }));
  check(base.shadows, 'sun shadows on'); check(base.post, 'finishing pass on'); check(base.grass >= 100000, 'dense grass');
  await page.screenshot({ path: 'evidence/visuals-1-world.png' });

  // scan: detector out and sweeping, pulse rings on the ground
  const x0 = me.x, z0 = me.z;
  srv.game.chests.push({ id: 'vis-gold', x: x0 + Math.sin(me.heading) * 0.75, z: z0 + Math.cos(me.heading) * 0.75, rarity: 'legendary', loot: { MOON: 99 } });
  await page.keyboard.press('Space');
  await wait(250);
  const scan = await page.evaluate(() => {
    const d = window.__dbi;
    let detector = false;
    d.players.get(d.me).ch.root.traverse((o) => { if (o.isGroup && o.visible && o.children.length === 2 && o.parent?.name === 'arm_R') detector = true; });
    return { rings: d.fx.rings.filter((r) => r.visible).length, detector, bars: document.getElementById('detector').dataset.bars };
  });
  check(scan.rings > 0, 'scan pulse rings'); check(scan.detector, 'detector in hand'); check(scan.bars === '5', `detector reads 5 bars over the chest (${scan.bars})`);
  await page.screenshot({ path: 'evidence/visuals-2-scan.png' });

  // dig: hole grows, dirt flies
  await page.keyboard.press('KeyE');
  await wait(1000);
  const dig = await page.evaluate(() => ({ holes: window.__dbi.fx.holes.count, dirt: window.__dbi.fx.dirt.mesh.count }));
  check(dig.holes > 0, 'hole growing'); check(dig.dirt > 0, 'dirt flying');
  await page.screenshot({ path: 'evidence/visuals-3-dig.png' });

  // reveal: chest rises out of the hole, coins burst
  await wait(1500);
  const rev = await page.evaluate(() => ({ reveals: window.__dbi.fx.reveals.length, coins: window.__dbi.fx.coins.mesh.count }));
  check(rev.reveals > 0, 'chest rises'); check(rev.coins > 0, 'coins burst');
  await page.screenshot({ path: 'evidence/visuals-4-reveal.png' });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'evidence/visuals-1-world.png', '-i', 'evidence/visuals-2-scan.png', '-i', 'evidence/visuals-3-dig.png', '-i', 'evidence/visuals-4-reveal.png',
    '-filter_complex', '[0][1]hstack[a];[2][3]hstack[b];[a][b]vstack,scale=1600:-1', 'evidence/visuals-strip.png']);
  console.log(`base=${JSON.stringify(base)} scan=${JSON.stringify(scan)} dig=${JSON.stringify(dig)} reveal=${JSON.stringify(rev)}`);
}
check(!errs.length, `page errors: ${errs.join(' | ')}`);
await browser.close();
srv.close();
for (const p of problems) console.log(`  problem: ${p}`);
const label = MECH ? 'MECHANICS UI' : TIERS ? 'TIERS' : 'VISUALS';
console.log(problems.length ? `${label} FAILED` : `${label} OK`);
process.exit(problems.length ? 1 : 0);
