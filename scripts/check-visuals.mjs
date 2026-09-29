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
const POLISH = process.argv.includes('--polish');
const BACKENDS = process.argv.includes('--backends');
const CAMERA = process.argv.includes('--camera');
const INSIDER = process.argv.includes('--insider');
const SCENIC = process.argv.includes('--scenic');
const QS = process.argv.includes('--webgl') ? '?backend=webgl' : '';
const PORT = 5297, wait = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync('npx', ['vite', 'build'], { stdio: 'ignore' });
const store = openDb(':memory:');
const srv = startServer({ port: PORT, prod: true, vite: false, secret: process.env.VIS_SECRET ?? 'visuals', store, prizes: new PrizePool({ store }),
  insider: INSIDER ? { minPlayers: 4, firstDelay: 14, cooldown: 600, hunt: 600, meeting: 600, reveal: 30, clueChance: 1 } : { firstDelay: 1e9 } });
for (let i = 0; i < 5; i++) srv.game.join({ name: `agent-${i}`, kind: 'agent' });

// a grassy spot at a forest edge, so the shot shows trees, grass and props
const N = makeNoise(99);
let spot = null;
for (let r = 0; r < 4000 && !spot; r++) {
  const x = ((r * 37) % 180) - 90, z = ((r * 53) % 180) - 90, h = height(x, z);
  if (h > 2 && pathDist(x, z) > 6 && N.fbm(x * 0.018 + 5, z * 0.018 - 3, 3) > -0.05 && N.fbm(x * 0.018 + 5, z * 0.018 - 3, 3) < 0.02) spot = { x, z };
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/${QS}`, { waitUntil: 'load' });
await page.type('#name', 'visual-check');
await page.click('#play');
await page.waitForFunction(() => window.__dbi?.me && window.__dbi.players.get(window.__dbi.me), { timeout: 15000 });
const me = [...srv.game.players.values()].find((p) => p.name === 'visual-check');
me.x = spot.x; me.z = spot.z; me.y = height(spot.x, spot.z); me.heading = 0.4;
for (const [i, p] of [...srv.game.players.values()].filter((q) => q.kind === 'agent').entries()) { p.x = spot.x + (i - 2) * 3.5; p.z = spot.z - 5 - (i % 2) * 3; }
await wait(2500);
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };

if (SCENIC) {
  const { PIER, LIGHTHOUSE } = await import('../src/shared/world.js');
  const shots = [
    { name: 'pier', x: PIER.x, z: PIER.z1 - 3, heading: 0, cam: { yaw: Math.PI, pitch: 0.2, dist: 9 } },
    { name: 'mountains', x: -10, z: -60, heading: Math.PI, cam: { yaw: 0, pitch: 0.55, dist: 32 } },
    { name: 'lighthouse', x: LIGHTHOUSE.x - 12, z: LIGHTHOUSE.z - 10, heading: Math.atan2(12, 10), cam: { yaw: Math.atan2(12, 10) + Math.PI, pitch: 0.42, dist: 14 } },
    { name: 'beach-huts', x: -38, z: 112, heading: 0, cam: { yaw: Math.PI, pitch: 0.35, dist: 16 } },
  ];
  for (const sh of shots) {
    me.x = sh.x; me.z = sh.z; me.y = height(sh.x, sh.z); me.heading = sh.heading; me.faceTo = sh.heading;
    await page.evaluate((c) => Object.assign(window.__dbi.cam, c), sh.cam);
    await wait(3500);
    await page.screenshot({ path: `evidence/scenic-${sh.name}.png` });
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...shots.flatMap((sh) => ['-i', `evidence/scenic-${sh.name}.png`]), '-filter_complex', '[0][1]hstack[a];[2][3]hstack[b];[a][b]vstack,scale=1600:-1', 'evidence/scenic-strip.png']);
  console.log(`shots: ${shots.map((x) => x.name).join(', ')}`);
} else if (INSIDER) {
  await page.waitForFunction(() => !document.getElementById('ins-banner').hidden, { timeout: 25000 }).catch(() => {});
  await wait(1500);
  const hunt = await page.evaluate(() => ({ banner: document.getElementById('ins-banner').textContent, panel: !document.getElementById('ins-panel').hidden, role: document.getElementById('ins-role').textContent, leak: !document.getElementById('ins-leak').hidden }));
  check(/INSIDER ROUND/.test(hunt.banner), `round banner (${hunt.banner})`);
  check(hunt.panel && /INSIDER|CREW/.test(hunt.role), `private role panel (${hunt.role})`);
  const role = srv.game.insider.status(me).role;
  if (role === 'insider') {
    check(hunt.leak, 'the insider gets a rumour box');
    await page.type('#ins-leak-text', 'the insider wears a white hat');
    await page.click('#ins-leak-btn');
    await wait(1500);
    check(srv.game.insider.r.rumors.length === 1, 'rumour planted from the browser');
  } else {
    check(!hunt.leak, 'crew has no rumour box');
    srv.game.chests = srv.game.chests.filter((c) => Math.hypot(c.x - me.x, c.z - me.z) > 20);
    await page.keyboard.press('KeyE');
    await wait(3200);
    const body = await page.evaluate(() => document.getElementById('ins-body').textContent);
    check(/Your clues/.test(body) && /insider/.test(body), `a dig turned up a clue (${body.slice(0, 80)})`);
  }
  await page.screenshot({ path: 'evidence/insider-hunt.png' });
  // chat from the browser
  await page.keyboard.press('Enter'); await page.keyboard.type('who has the white hat?'); await page.keyboard.press('Enter');
  await wait(600);
  check(srv.game.events.some((e) => e.kind === 'say' && e.who === 'visual-check' && /white hat/.test(e.text)), 'Enter opens chat and sends a line');
  // emergency meeting
  srv.game.insider.left = 0.05;
  await page.waitForFunction(() => !document.getElementById('meeting').hidden, { timeout: 8000 }).catch(() => {});
  await wait(3500);
  const mtg = await page.evaluate(() => ({ panel: !document.getElementById('meeting').hidden, buttons: document.querySelectorAll('#meeting-votes button').length, banner: document.getElementById('ins-banner').textContent }));
  const inRound = srv.game.insider.r.ids.size;
  check(mtg.panel && mtg.buttons === inRound, `meeting panel with a vote for each other player + skip (${mtg.buttons} buttons, ${inRound} players)`);
  check(/EMERGENCY MEETING/.test(mtg.banner), 'meeting banner');
  for (const p of srv.game.players.values()) if (p.kind === 'agent') srv.game.act(p.id, 'say', { text: `I was near ${['TSLA', 'AMZN', 'NFLX'][p.id.length % 3]} the whole time` });
  await wait(1200);
  const log = await page.evaluate(() => document.getElementById('meeting-log').textContent);
  check(/the whole time/.test(log), 'meeting chat shows what people say');
  await page.screenshot({ path: 'evidence/insider-meeting.png' });
  for (const p of srv.game.players.values()) if (p.kind === 'agent') srv.game.act(p.id, 'vote', { who: 'skip' });
  await page.click('#meeting-votes button');
  await page.waitForFunction(() => /CAUGHT|GOT AWAY/.test(document.getElementById('ins-banner').textContent) && document.getElementById('ins-banner').classList.contains('ph-reveal'), { timeout: 8000 }).catch(() => {});
  const rev = await page.evaluate(() => document.getElementById('ins-banner').textContent);
  check(/WAS THE INSIDER|GOT AWAY/.test(rev), `reveal banner (${rev})`);
  await page.screenshot({ path: 'evidence/insider-reveal.png' });
  console.log(`role=${role} hunt=${JSON.stringify(hunt)} meeting=${JSON.stringify(mtg)} reveal=${rev}`);
} else if (CAMERA) {
  const view = () => page.evaluate(() => { const d = window.__dbi, p = d.players.get(d.me).cur, c = d.view.camera.position; return { yaw: Math.atan2(c.x - p.x, c.z - p.z), dist: Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z), camYaw: d.cam.yaw, camDist: d.cam.dist }; });
  const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const v0 = await view();
  await page.mouse.move(640, 420); await page.mouse.down(); await page.mouse.move(840, 400, { steps: 12 }); await page.mouse.up();
  await wait(900);
  const v1 = await view();
  check(angle(v1.yaw, v0.yaw) > 0.8, `drag orbits the camera (${v0.yaw.toFixed(2)} -> ${v1.yaw.toFixed(2)})`);
  await page.mouse.move(640, 420); await page.mouse.wheel({ deltaY: 500 });
  await wait(900);
  const v2 = await view();
  check(v2.dist > v1.dist * 1.4, `wheel zooms out (${v1.dist.toFixed(1)} -> ${v2.dist.toFixed(1)})`);
  await page.mouse.move(640, 420); await page.mouse.down(); await page.mouse.move(640, 1400, { steps: 12 }); await page.mouse.up();
  const tilted = await page.evaluate(() => window.__dbi.cam.pitch);
  check(tilted <= 1.35 + 1e-6, `tilt stays within limits (${tilted.toFixed(2)})`);
  await page.screenshot({ path: 'evidence/camera-orbit.png' });
  await page.keyboard.press('KeyC');
  await wait(900);
  const v3 = await view();
  check(angle(v3.camYaw, me.heading + Math.PI) < 0.05 && Math.abs(v3.camDist - v0.camDist) < 0.01, `C puts the camera straight behind the character (${angle(v3.camYaw, me.heading + Math.PI).toFixed(2)})`);
  // follow camera: turn with D, then walk with W; the camera swings round to stay behind
  await wait(1400); // let the follow camera take over again after the drags
  const h0 = me.heading;
  await page.keyboard.down('KeyD'); await wait(700); await page.keyboard.up('KeyD'); await wait(600);
  const turned = angle(me.heading, h0);
  check(turned > 0.8, `D turns the character on the spot (${turned.toFixed(2)} rad)`);
  const a = { x: me.x, z: me.z };
  await page.keyboard.down('KeyW'); await wait(1500);
  const mid = await page.evaluate(() => { const d = window.__dbi, p = d.players.get(d.me).cur, c = d.view.camera.position; return { cx: c.x - p.x, cz: c.z - p.z }; });
  await page.keyboard.up('KeyW'); await wait(300);
  const dx = me.x - a.x, dz = me.z - a.z, len = Math.hypot(dx, dz);
  const walkDir = Math.atan2(dx, dz), camDir = Math.atan2(mid.cx, mid.cz);
  check(len > 2 && angle(walkDir, me.heading) < 0.3, `W walks where the character looks (moved ${len.toFixed(1)}m)`);
  check(angle(camDir, walkDir + Math.PI) < 0.45, `camera rides behind the character (off by ${angle(camDir, walkDir + Math.PI).toFixed(2)} rad)`);
  await page.screenshot({ path: 'evidence/camera-follow.png' });
  console.log(`yaw ${v0.yaw.toFixed(2)}->${v1.yaw.toFixed(2)} dist ${v1.dist.toFixed(1)}->${v2.dist.toFixed(1)} walked ${len.toFixed(1)}m, camera behind within ${angle(camDir, walkDir + Math.PI).toFixed(2)} rad`);
} else if (BACKENDS) {
  // this run: whichever backend the page picked; the webgl run is a second invocation (see below)
  const info = await page.evaluate(() => window.__dbi.view.info());
  check(info.backend === (QS ? 'webgl' : 'webgpu'), `backend ${info.backend}`);
  await page.screenshot({ path: `evidence/backend-${info.backend}.png` });
  console.log(`backend=${JSON.stringify(info)}`);
} else if (POLISH) {
  const high = await page.evaluate(() => {
    const d = window.__dbi;
    let motes = false, clouds = false, fill = 0, sheen = false;
    d.scene.traverse((o) => {
      if (o.geometry?.attributes?.aMote) motes = true;
      if (o.isInstancedMesh && o.material?.fog === false) clouds = true;
      if (o.isDirectionalLight) fill++;
      if (o.isSkinnedMesh && o.material?.sheen > 0) sheen = true;
    });
    return { ...d.view.info(), motes, clouds, lights: fill, sheen };
  });
  for (const k of ['ao', 'traa', 'bloom', 'dof', 'grade', 'motes', 'clouds', 'sheen']) check(high[k], `${k} on the high tier`);
  check(high.lights >= 2, 'sun + camera fill light');
  await page.evaluate(() => window.__dbi.view.setTier('medium'));
  await wait(800);
  const med = await page.evaluate(() => window.__dbi.view.info());
  check(!med.ao && !med.traa && !med.dof && med.bloom, `medium drops the heavy passes (${JSON.stringify(med)})`);
  console.log(`high=${JSON.stringify(high)} medium=${JSON.stringify(med)}`);
} else if (MECH) {
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
  check(after.post !== 'full' && !after.ao && !after.dof, 'heavy passes off on the cheaper tier');
  check(after.grass < 110000, 'less grass on the cheaper tier');
  await page.evaluate(() => window.__dbi.view.setTier('low'));
  const low = await page.evaluate(() => ({ ...window.__dbi.view.info(), grass: window.__dbi.island.grass.mesh.geometry.instanceCount }));
  check(!low.shadows && low.post !== 'full' && low.grass <= 22000, `low tier is cheap (${JSON.stringify(low)})`);
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

  // reveal: chest rises out of the hole, shakes, then the coins burst
  await page.waitForFunction(() => window.__dbi.fx.coins.mesh.count > 0, { timeout: 6000 }).catch(() => {});
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
const label = SCENIC ? 'SCENIC' : INSIDER ? 'INSIDER UI' : CAMERA ? 'CAMERA' : BACKENDS ? 'BACKEND' : POLISH ? 'POLISH' : MECH ? 'MECHANICS UI' : TIERS ? 'TIERS' : 'VISUALS';
console.log(problems.length ? `${label} FAILED` : `${label} OK`);
process.exit(problems.length ? 1 : 0);
