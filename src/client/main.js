import * as THREE from 'three';
import { buildIsland } from './scene.js';
import { makeRenderer } from './render.js';
import { makeFx } from './fx.js';
import { makeCharacter } from './character.js';
import { loadChibi, makeChibi } from './chibi.js';
import { groundAt } from '../shared/world.js';
import { CHAIN } from '../shared/chain.js';
import { hasWallet, connect, signMessage, sendTx } from './wallet.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer, lights, finishing pass
const view = makeRenderer($('app'), { tier: params.get('quality') });
const { renderer, scene, camera } = view;
const island = buildIsland(scene);
view.onTier((tier) => island.grass.setDensity(tier.grass));
const fx = makeFx(scene);
// the Blender chibi; the code-built stand-in is only a fallback
let chibi = 'loading';
loadChibi().then(() => { chibi = 'ready'; }).catch((e) => { chibi = 'failed'; console.warn('chibi.glb failed, using stand-in', e); });
const newCharacter = (look) => (chibi === 'ready' ? makeChibi(look) : makeCharacter(look));
const ZOOM = Number(params.get('zoom') ?? 1);
const PORTRAIT = params.has('portrait'); // debug: front close-up of the followed character

// ---------------------------------------------------------------- world state from the server
const players = new Map(); // id -> { ch, cur: {x,y,z,h}, target, anim, ... }
let me = null, watchId = null, snap = null;

// the game server can live elsewhere (e.g. static page on Vercel, server on a VPS)
const SERVER = (import.meta.env.VITE_GAME_SERVER ?? '').replace(/\/$/, '');
const ws = new WebSocket(SERVER ? `${SERVER.replace(/^http/, 'ws')}/ws` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
// a remote server takes a moment to connect; hold messages until it's open
const wsSend = (msg) => {
  const data = JSON.stringify(msg);
  if (ws.readyState === WebSocket.OPEN) ws.send(data);
  else if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws.send(data), { once: true });
};
let rid = 0;
const pending = new Map();
const act = (action, args) => new Promise((resolve) => {
  const id = ++rid;
  pending.set(id, resolve);
  wsSend({ type: 'act', action, args, rid: id });
});
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'welcome') { me = m.id; showPrizePanel(); }
  if (m.type === 'full') { $('splash').hidden = false; $('play').textContent = m.error; }
  if (m.type === 'result') { pending.get(m.rid)?.(m.out); pending.delete(m.rid); }
  if (m.type === 'snap') onSnap(m);
});

const bubblesEl = $('bubbles');
function onSnap(s) {
  if (chibi === 'loading') return; // wait for the model so nobody spawns as the stand-in
  snap = s;
  const seen = new Set();
  for (const [id, name, kind, look, x, y, z, h, anim, say, emote, bars, scanAge, dig] of s.players) {
    seen.add(id);
    let p = players.get(id);
    if (!p) {
      const ch = newCharacter(look);
      scene.add(ch.root);
      const tag = document.createElement('div'); tag.className = `nametag ${kind}`; tag.textContent = name; bubblesEl.appendChild(tag);
      const bub = document.createElement('div'); bub.className = 'bubble'; bub.hidden = true; bubblesEl.appendChild(bub);
      p = { ch, tag, bub, cur: { x, y, z, h }, name, kind };
      players.set(id, p);
    }
    Object.assign(p, { target: { x, y, z, h }, anim, say, emote, bars, scanAge, dig, snapT: performance.now() });
  }
  for (const [id, p] of players) if (!seen.has(id)) { scene.remove(p.ch.root); p.tag.remove(); p.bub.remove(); players.delete(id); }
  hud(s);
}

// ---------------------------------------------------------------- HUD
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
let lastEvent = 0;
function hud(s) {
  $('ticker').innerHTML = s.market.map(([t, p, c]) => `<span>$${t} ${p.toFixed(2)} <b class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'}${Math.abs(c)}%</b></span>`).join('');
  for (const e of s.events) {
    if (e.t <= lastEvent) continue;
    lastEvent = e.t;
    const div = document.createElement('div');
    let delay = 0;
    if (e.kind === 'chest') { div.className = e.rarity; div.textContent = `${e.who} dug up a ${e.rarity} chest: ${Object.entries(e.loot).map(([t, n]) => `${n} $${t}`).join(', ')}${e.streak > 1 ? ` (streak ${e.streak})` : ''}`; delay = 1350; }
    else if (e.kind === 'junk') div.textContent = `${e.who} dug up ${e.label}`;
    else if (e.kind === 'join') div.textContent = `${e.who} arrived`;
    else if (e.kind === 'prize') { div.className = 'prize'; div.textContent = `${e.who} won ${e.amount} real $${e.ticker}!`; delay = 1350; }
    else continue;
    // chest news waits for the chest to finish shaking, so the feed doesn't spoil it
    setTimeout(() => {
      $('feed').appendChild(div);
      while ($('feed').children.length > 5) $('feed').firstChild.remove();
      setTimeout(() => div.remove(), 9000);
    }, delay);
  }
}
async function refreshBoard() {
  try {
    const { leaderboard } = await (await fetch(`${SERVER}/api/leaderboard`)).json();
    const myName = players.get(me)?.name;
    $('board').innerHTML = leaderboard.slice(0, 8).map((r) => `<li class="${r.kind === 'agent' ? 'agent' : ''} ${r.name === myName ? 'you' : ''}">${esc(r.name)}<span>${fmt(r.value)}</span></li>`).join('');
    if (me) {
      const st = await act('state');
      if (st?.ok) {
        $('pf-value').textContent = fmt(st.portfolio.value);
        const h = Object.entries(st.portfolio.holdings);
        $('pf-holdings').textContent = h.length ? h.map(([t, n]) => `${n} $${t}`).join(' · ') : 'dig up chests to earn stock';
      }
    }
  } catch { /* offline */ }
}
setInterval(refreshBoard, 2000);

// ---------------------------------------------------------------- input (same actions agents use)
const keys = new Set();
let lastMove = '';
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys.add(e.code);
  if (!me) { if (e.code === 'Tab') { e.preventDefault(); cycleWatch(); } return; }
  if (e.code === 'Space') { e.preventDefault(); startSweep(); }
  if (e.code === 'KeyE' || e.code === 'KeyF') dig();
  if (e.code === 'Tab') { e.preventDefault(); cycleWatch(); }
  if (e.code.startsWith('Digit')) { const em = ['wave', 'cheer', 'dance', 'sad', 'shrug'][Number(e.code.slice(5)) - 1]; if (em) act('emote', { name: em }); }
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Space') stopSweep(); });
addEventListener('blur', () => { keys.clear(); stopSweep(); });
function sendMove() {
  if (!me) return;
  const dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const dz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  const k = `${dx},${dz}`;
  if (k !== lastMove) { lastMove = k; act('move', { dx, dz }); }
}
// hold Space: the detector keeps sweeping and beeping, faster and higher as you close in
let sweeping = false, sweepTimer = null;
function startSweep() {
  if (sweeping) return;
  sweeping = true;
  const tick = async () => {
    const r = await scan();
    if (sweeping) sweepTimer = setTimeout(tick, r && r.bars >= 4 ? 260 : 380);
  };
  tick();
}
function stopSweep() { sweeping = false; clearTimeout(sweepTimer); }
async function scan() {
  const r = await act('detect');
  if (!r?.ok) return null;
  $('detector').dataset.bars = r.bars;
  $('detector-hint').textContent = r.hint;
  if (!r.cached) beep(r.bars);
  return r;
}
async function dig() {
  $('detector-hint').textContent = 'digging...';
  const r = await act('dig');
  if (!r?.ok) { $('detector-hint').textContent = r?.error ?? 'busy'; return; }
  if (r.found) {
    // let the chest shake before telling you what it is
    $('detector-hint').textContent = 'something is in here...';
    setTimeout(() => { $('detector-hint').textContent = `found a ${r.rarity} chest!${r.multiplier > 1 ? ` streak x${r.multiplier}` : ''}`; chime(); showStreak(r.streak, r.multiplier); }, 1350);
  } else {
    $('detector-hint').textContent = r.hint.split('. use')[0];
    if (r.junk) sadTrombone();
    showStreak(0, 1);
  }
  if (r.realPrize?.won) showWin(r.realPrize.prize);
  else if (r.realPrize && prizeMode !== 'off') $('prize-sub').textContent = r.realPrize.reason;
}

// ---------------------------------------------------------------- real-stock prizes
// Legendary chests win real tokenized stock from a small daily pool. The server
// only signs a voucher; the player's own wallet collects it from the vault.
let prizeMode = 'off', myWallet = null, pendingWin = null;
fetch(`${SERVER}/api/prizes`).then((r) => r.json()).then((st) => { prizeMode = st.mode; showPrizePanel(); }).catch(() => {});
function showPrizePanel() {
  $('prizes').hidden = prizeMode === 'off' || !me;
  if (!hasWallet()) { $('link-wallet').hidden = true; $('prize-sub').textContent = 'install a wallet (e.g. MetaMask) to win real stock'; }
}
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
$('link-wallet').addEventListener('click', async (e) => {
  e.currentTarget.blur();
  const btn = $('link-wallet');
  btn.disabled = true; btn.textContent = 'check your wallet…';
  try {
    const address = await connect();
    const ch = await act('link_wallet_challenge');
    if (!ch?.ok) throw new Error(ch?.error ?? 'could not start linking');
    const r = await act('link_wallet', { address, signature: await signMessage(address, ch.message) });
    if (!r?.ok) throw new Error(r?.error ?? 'link failed');
    myWallet = r.wallet;
    btn.hidden = true;
    $('prize-sub').textContent = `wallet ${short(myWallet)} linked · dig legendary chests to win`;
    refreshPrizes();
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Link wallet';
    $('prize-sub').textContent = err?.message?.slice(0, 80) ?? 'wallet link failed';
  }
});
async function refreshPrizes() {
  if (!myWallet) return;
  const r = await act('prizes');
  if (!r?.ok) return;
  const ul = $('prize-list');
  ul.replaceChildren(...r.prizes.slice(0, 4).map((p) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${p.amountTokens} $${p.ticker}`;
    li.append(label);
    if (p.status === 'issued') {
      const b = document.createElement('button');
      b.className = 'mini gold'; b.textContent = 'Collect';
      b.addEventListener('click', (e) => { e.currentTarget.blur(); collect(p, b); });
      li.append(b);
    } else {
      const tag = document.createElement('span');
      tag.textContent = p.status === 'claimed' ? 'collected' : p.status;
      li.append(tag);
    }
    return li;
  }));
}
async function collect(prize, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'confirm…'; }
  try {
    const hash = await sendTx(myWallet, prize.tx);
    const li = btn?.parentElement;
    if (li) { const a = document.createElement('a'); a.href = `${CHAIN.explorer}/tx/${hash}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'sent ↗'; btn.replaceWith(a); }
    $('prize-sub').textContent = `sent! ${prize.amountTokens} $${prize.ticker} is on its way`;
    setTimeout(refreshPrizes, 4000);
    return hash;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Collect'; }
    $('prize-sub').textContent = err?.message?.slice(0, 80) ?? 'collect failed';
  }
}
function showWin(prize) {
  pendingWin = prize;
  $('win-title').textContent = `You won ${prize.amountTokens} real $${prize.ticker}!`;
  $('win-text').textContent = 'A real tokenized stock from today\'s prize pool. Collect it to your wallet on Robinhood Chain.';
  $('win').hidden = false;
  refreshPrizes();
}
$('win-collect').addEventListener('click', async (e) => {
  e.currentTarget.blur();
  $('win').hidden = true;
  if (pendingWin) await collect(pendingWin, null);
});
$('win-close').addEventListener('click', (e) => { e.currentTarget.blur(); $('win').hidden = true; });
function cycleWatch() {
  const ids = [...players.keys()].filter((id) => players.get(id).kind === 'agent');
  if (!ids.length) return;
  watchId = ids[(ids.indexOf(watchId) + 1) % ids.length];
  $('watching').hidden = false;
  $('watching').textContent = `watching ${players.get(watchId).name} · Tab for next`;
}

// tiny synth sounds
let actx = null;
const tone = (f, d, v = 0.15, type = 'square') => {
  actx ??= new AudioContext();
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(v, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
};
// one reading = a quick blip; closer = higher pitch and a double/triple blip ("de de de")
const beep = (b) => { const n = b >= 5 ? 3 : b >= 4 ? 2 : 1; for (let i = 0; i < n; i++) setTimeout(() => tone(b ? 420 + b * 150 : 260, 0.07, b ? 0.07 : 0.03), i * 75); };
const sadTrombone = () => [392, 370, 349, 311].forEach((f, i) => setTimeout(() => tone(f, i === 3 ? 0.5 : 0.22, 0.08, 'sawtooth'), i * 230));
function showStreak(streak, mult) {
  const el = $('streak');
  el.hidden = streak < 2;
  el.textContent = `STREAK ${streak} · x${mult}`;
}
const chime = () => [660, 880, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.12, 'triangle'), i * 90));

// ---------------------------------------------------------------- splash
$('name').value = localStorage.getItem('dbi-name') ?? '';
$('play').addEventListener('click', () => {
  const name = $('name').value.trim() || 'player';
  localStorage.setItem('dbi-name', name);
  wsSend({ type: 'join', name, look: params.get('look') ?? 'racer' });
  $('splash').hidden = true;
});
$('watch').addEventListener('click', () => { $('splash').hidden = true; $('controls').textContent = 'watching agents · Tab to switch'; setTimeout(cycleWatch, 500); });
if (params.has('watch')) $('watch').click();

// ---------------------------------------------------------------- loop
const camPos = new THREE.Vector3(0, 60, 120), camLook = new THREE.Vector3(0, 0, 60), focusV = new THREE.Vector3();
const v = new THREE.Vector3();
const fxPlayers = [];
let last = performance.now(), fpsAcc = 0, fpsN = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sendMove();
  fxPlayers.length = 0;
  for (const [id, p] of players) {
    const k = 1 - Math.exp(-dt * 12);
    p.cur.x += (p.target.x - p.cur.x) * k; p.cur.z += (p.target.z - p.cur.z) * k; p.cur.y += (p.target.y - p.cur.y) * k;
    let dh = p.target.h - p.cur.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.cur.h += dh * k;
    const moving = Math.hypot(p.target.x - p.cur.x, p.target.z - p.cur.z) > 0.05 || p.anim === 'walk';
    p.ch.root.position.set(p.cur.x, p.cur.y, p.cur.z);
    p.ch.root.rotation.y = p.cur.h;
    // ages advance between snapshots so animations stay smooth
    const since = (now - (p.snapT ?? now)) / 1000;
    const scanAge = p.scanAge === null || p.scanAge === undefined ? null : p.scanAge + since;
    p.ch.update(dt, p.anim, moving, p.emote, scanAge, p.bars ?? 0);
    fxPlayers.push({ id, x: p.cur.x, z: p.cur.z, h: p.cur.h, bars: p.bars ?? 0, scanAge, dig: p.dig ?? null });
    // name tags + speech bubbles
    v.set(p.cur.x, p.cur.y + 3.1, p.cur.z).project(camera);
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight, onScreen = v.z < 1;
    p.tag.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, 0)`;
    p.tag.hidden = !onScreen;
    p.bub.hidden = !p.say || !onScreen;
    if (p.say) { p.bub.textContent = p.say; p.bub.style.transform = `translate(${sx}px, ${sy - 8}px) translate(-50%, -100%)`; }
  }
  fx.update(dt, fxPlayers, snap?.holes ?? []);
  // clear grass inside the nearest holes (finished and being dug)
  const nearHoles = (snap?.holes ?? []).map(([x, z]) => ({ x, z, r: 1.3 }));
  for (const q of fxPlayers) if (q.dig !== null) nearHoles.push({ x: q.x + Math.sin(q.h) * 0.75, z: q.z + Math.cos(q.h) * 0.75, r: 0.4 + q.dig * 0.9 });
  nearHoles.sort((a, b) => Math.hypot(a.x - camLook.x, a.z - camLook.z) - Math.hypot(b.x - camLook.x, b.z - camLook.z));
  island.grass.setHoles(nearHoles);
  // camera: close three-quarter view that leads a little in the direction you walk
  const focus = players.get(watchId ?? me) ?? players.get(me);
  const fx0 = focus ? focus.cur.x : 0, fz0 = focus ? focus.cur.z : 60, fy = focus ? focus.cur.y : 2;
  const lead = focus && Math.hypot(focus.target.x - focus.cur.x, focus.target.z - focus.cur.z) > 0.05 ? 1.6 : 0;
  const fx1 = fx0 + (focus ? Math.sin(focus.cur.h) * lead : 0), fz1 = fz0 + (focus ? Math.cos(focus.cur.h) * lead : 0);
  if (PORTRAIT && focus) { const h = focus.cur.h; camPos.set(fx0 + Math.sin(h) * 5.5, fy + 2.2, fz0 + Math.cos(h) * 5.5); camLook.set(fx0, fy + 1.3, fz0); } else {
    camPos.lerp(v.set(fx1, fy + 21 * ZOOM, fz1 + 20 * ZOOM), 1 - Math.exp(-dt * 3.5));
    camLook.lerp(v.set(fx1, fy + 0.6, fz1), 1 - Math.exp(-dt * 5));
  }
  camera.position.copy(camPos);
  if (fx.shake > 0.01) camera.position.add(v.set((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake));
  camera.lookAt(camLook);
  focusV.set(camLook.x, fy, camLook.z);
  island.update(now / 1000, focusV);
  view.render(focusV, dt, now);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
}
renderer.setAnimationLoop(frame);
window.__dbi = { renderer, scene, players, view, fx, island, get me() { return me; } };
