import * as THREE from 'three';
import { buildIsland } from './scene.js';
import { makeCharacter } from './character.js';
import { loadChibi, makeChibi } from './chibi.js';
import { groundAt } from '../shared/world.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from './scene.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- renderer (lean)
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9d8f0');
scene.fog = new THREE.Fog('#a9d8f0', 90, 260);
scene.add(new THREE.HemisphereLight('#fff6e0', '#6a8a3a', 1.4));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
sun.position.set(-40, 80, 30);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 1, 600);
const island = buildIsland(scene);
// the Blender chibi; the code-built stand-in is only a fallback
let chibi = 'loading';
loadChibi().then(() => { chibi = 'ready'; }).catch((e) => { chibi = 'failed'; console.warn('chibi.glb failed, using stand-in', e); });
const newCharacter = (look) => (chibi === 'ready' ? makeChibi(look) : makeCharacter(look));
const ZOOM = Number(params.get('zoom') ?? 1);
const PORTRAIT = params.has('portrait'); // debug: front close-up of the followed character

// ---------------------------------------------------------------- world state from the server
const players = new Map(); // id -> { ch, cur: {x,y,z,h}, target, anim, ... }
let me = null, watchId = null, snap = null;
const holeMeshes = [];
const holeGeo = new THREE.CircleGeometry(0.9, 14).rotateX(-Math.PI / 2);
const holeMat = new THREE.MeshBasicMaterial({ color: '#5a4430' });
const goldMat = new THREE.MeshBasicMaterial({ color: '#ffcf3f' });

// stock critters: a toon blob per ticker colour, two merged eyes, one DOM tag with hp
const critters = new Map(); // id -> { mesh, tag, bar, cur, ... }
const CRIT_COLORS = { BLUP: '#4d8dff', MOON: '#ffd54a', FROG: '#54c96a', DIGG: '#c98a52', PUMP: '#ff6b57', WAGMI: '#b47cff' };
const eyeGeo = (() => {
  const parts = [-0.38, 0.38].flatMap((x) => [new THREE.SphereGeometry(0.3, 8, 6).translate(x, 0.35, 0.82), new THREE.SphereGeometry(0.14, 6, 4).translate(x, 0.35, 1.05)]);
  parts.forEach((g, i) => { const c = new THREE.Color(i % 2 ? '#1c1a2e' : '#ffffff'), a = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < a.length; k += 3) a.set([c.r, c.g, c.b], k); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); });
  return mergeGeometries(parts);
})();
const blobGeo = new THREE.SphereGeometry(1, 14, 10);
const eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true });

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
let rid = 0;
const pending = new Map();
const act = (action, args) => new Promise((resolve) => {
  const id = ++rid;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ type: 'act', action, args, rid: id }));
});
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'welcome') me = m.id;
  if (m.type === 'result') { pending.get(m.rid)?.(m.out); pending.delete(m.rid); }
  if (m.type === 'snap') onSnap(m);
});

const bubblesEl = $('bubbles');
function onSnap(s) {
  if (chibi === 'loading') return; // wait for the model so nobody spawns as the stand-in
  snap = s;
  const seen = new Set();
  for (const [id, name, kind, look, x, y, z, h, anim, say, emote, bars, hp, ko] of s.players) {
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
    Object.assign(p, { target: { x, y, z, h }, anim, say, emote, bars, hp, ko });
  }
  for (const [id, p] of players) if (!seen.has(id)) { scene.remove(p.ch.root); p.tag.remove(); p.bub.remove(); players.delete(id); }
  syncCritters(s.critters ?? []);
  // holes
  while (holeMeshes.length < s.holes.length) { const m = new THREE.Mesh(holeGeo, holeMat); scene.add(m); holeMeshes.push(m); }
  holeMeshes.forEach((m, i) => {
    const h = s.holes[i];
    m.visible = !!h;
    if (h) { m.position.set(h[0], groundAt(h[0], h[1]) + 0.05, h[1]); m.material = h[2] ? goldMat : holeMat; m.scale.setScalar(h[2] ? 1.3 : 1); }
  });
  hud(s);
  const mine = players.get(me);
  if (mine) { $('hp-fill').style.width = `${Math.max(0, mine.hp)}%`; $('hp-note').textContent = mine.ko ? 'knocked out, back at spawn' : ''; }
  $('insider').hidden = !me;
  if (me) renderInsider(s.insider);
}

function syncCritters(list) {
  const seen = new Set();
  for (const [id, kind, ticker, x, y, z, h, hp, maxHp, wind] of list) {
    seen.add(id);
    let c = critters.get(id);
    if (!c) {
      const r = kind === 'boss' ? 2.2 : 1.1;
      const body = new THREE.Mesh(blobGeo, toon({ color: CRIT_COLORS[ticker] ?? '#ff8fa3' }));
      body.scale.set(r, r * 0.9, r);
      const eyes = new THREE.Mesh(eyeGeo, eyeMat);
      eyes.scale.setScalar(r);
      const mesh = new THREE.Group(); mesh.add(body, eyes);
      scene.add(mesh);
      const tag = document.createElement('div'); tag.className = `crit ${kind}`;
      tag.innerHTML = `$${ticker} ${kind === 'boss' ? 'BOSS' : ''}<b><i></i></b>`;
      bubblesEl.appendChild(tag);
      c = { mesh, body, tag, bar: tag.querySelector('i'), r, cur: { x, y, z, h }, kind };
      critters.set(id, c);
    }
    Object.assign(c, { target: { x, y, z, h }, wind, hp, maxHp });
  }
  for (const [id, c] of critters) if (!seen.has(id)) { scene.remove(c.mesh); c.tag.remove(); critters.delete(id); }
}

// ---------------------------------------------------------------- HUD
const fmt = (v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
let lastEvent = 0;
function hud(s) {
  $('ticker').innerHTML = s.market.map(([t, p, c]) => `<span>$${t} ${p.toFixed(2)} <b class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'}${Math.abs(c)}%</b></span>`).join('');
  for (const e of s.events) {
    if (e.t <= lastEvent) continue;
    lastEvent = e.t;
    const div = document.createElement('div');
    if (e.kind === 'chest') { div.className = e.rarity; div.textContent = `${e.who} dug up a ${e.rarity} chest: ${Object.entries(e.loot).map(([t, n]) => `${n} $${t}`).join(', ')}`; }
    else if (e.kind === 'join') div.textContent = `${e.who} arrived`;
    else if (e.kind === 'critter') { div.className = e.boss || e.real ? 'legendary' : 'rare'; div.textContent = `${e.who} beat ${e.critter}: ${e.shares.map((x) => `${x.name} +${x.shares} $${e.ticker}`).join(', ')}${e.real ? ` · real $${e.real}!` : ''}`; }
    else if (e.kind === 'ko') div.textContent = `${e.who} got knocked out by ${e.by}`;
    else if (e.kind === 'insider_start') { div.className = 'rare'; div.textContent = `Insider round started with ${e.players} players. Someone knows the move...`; }
    else if (e.kind === 'insider_end') { div.className = 'legendary'; div.textContent = e.aborted ? `Insider round cancelled: ${e.reason}` : `${e.insider} was the insider. ${e.caught ? 'Traders caught them!' : 'They got away with it.'}`; }
    else if (e.kind === 'say') continue;
    else continue;
    $('feed').appendChild(div);
    while ($('feed').children.length > 5) $('feed').firstChild.remove();
    setTimeout(() => div.remove(), 9000);
  }
}
async function refreshBoard() {
  try {
    const { leaderboard } = await (await fetch('/api/leaderboard')).json();
    const myName = players.get(me)?.name;
    $('board').innerHTML = leaderboard.slice(0, 8).map((r) => `<li class="${r.kind === 'agent' ? 'agent' : ''} ${r.name === myName ? 'you' : ''}">${r.name}<span>${fmt(r.value)}</span></li>`).join('');
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
  if (e.code === 'Space') { e.preventDefault(); scan(); }
  if (e.code === 'KeyE' || e.code === 'KeyF') dig();
  if (e.code === 'KeyX') attack();
  if (e.code === 'Tab') { e.preventDefault(); cycleWatch(); }
  if (e.code.startsWith('Digit')) { const em = ['wave', 'cheer', 'dance', 'sad', 'shrug'][Number(e.code.slice(5)) - 1]; if (em) act('emote', { name: em }); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
function sendMove() {
  if (!me) return;
  const dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const dz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  const k = `${dx},${dz}`;
  if (k !== lastMove) { lastMove = k; act('move', { dx, dz }); }
}
async function scan() {
  const r = await act('detect');
  if (!r?.ok) return;
  $('detector').dataset.bars = r.bars;
  $('detector-hint').textContent = r.hint;
  beep(r.bars);
}
async function dig() {
  $('detector-hint').textContent = 'digging...';
  const r = await act('dig');
  if (!r?.ok) { $('detector-hint').textContent = r?.error ?? 'busy'; return; }
  $('detector-hint').textContent = r.found ? `found a ${r.rarity} chest!` : 'nothing here';
  if (r.found) chime();
}
async function attack() {
  const r = await act('attack');
  if (r?.ok) { tone(220, 0.08, 0.08, 'sawtooth'); if (r.defeated) chime(); $('detector-hint').textContent = r.defeated ? `defeated ${r.critter}!` : `hit ${r.critter}: ${r.hp}/${r.maxHp}`; }
  else if (r && r.error !== 'cooldown') $('detector-hint').textContent = r.error;
}
function cycleWatch() {
  const ids = [...players.keys()].filter((id) => players.get(id).kind === 'agent');
  if (!ids.length) return;
  watchId = ids[(ids.indexOf(watchId) + 1) % ids.length];
  $('watching').hidden = false;
  $('watching').textContent = `watching ${players.get(watchId).name} · Tab for next`;
}

// ---------------------------------------------------------------- Insider panel
let insHtml = '', insPriv = null, insBusy = false;
async function pollInsider() {
  if (!me || insBusy) return;
  insBusy = true;
  try { const s = await act('insider_status'); if (s?.ok) insPriv = s; } finally { insBusy = false; }
}
setInterval(pollInsider, 1000);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderInsider(pub) {
  const priv = insPriv, joined = !!priv?.joined, myName = players.get(me)?.name;
  $('ins-phase').textContent = pub.phase === 'lobby' ? '' : `${pub.phase} ${Math.ceil(pub.timeLeft)}s`;
  let h = '';
  if (!joined) h = `<p>Among Us for stocks. One trader knows the move. Find them.</p><p>${pub.members.length} / ${pub.min} in the lobby</p><button class="wide" data-ins="join">Join lobby</button>`;
  else if (pub.phase === 'lobby') h = `<p>${pub.members.length} / ${pub.min} in the lobby${pub.members.length >= pub.min ? ` · starting in ${Math.ceil(pub.timeLeft)}s` : ''}</p><p class="tape">${pub.members.map(esc).join(', ')}</p><button class="wide sell" data-ins="leave">Leave</button>`;
  else if (pub.phase === 'trading' && priv?.role) {
    h = priv.role === 'insider' ? `<p class="role ins">You are the INSIDER. $${priv.move.ticker} is about to pump.</p>` : '<p class="role">You are a trader. Watch the tape.</p>';
    h += `<p>cash $${Math.round(priv.cash)}</p><table>${pub.prices.map(([t, p]) => `<tr><td>$${t}${priv.holdings[t] ? ` (${priv.holdings[t]})` : ''}</td><td>${p.toFixed(2)}</td><td><button data-ins="buy" data-t="${t}">+10</button><button class="sell" data-ins="sell" data-t="${t}">-10</button></td></tr>`).join('')}</table>`;
    h += `<div class="tape">${pub.tape.slice(-4).map((e) => `${esc(e.who)} ${e.side === 'buy' ? 'bought' : 'sold'} ${e.shares} $${e.ticker}`).join('<br>')}</div>`;
  } else if (pub.phase === 'voting' && priv?.role) {
    h = `<p>Who is the insider? ${pub.voted} voted</p>` + pub.members.filter((n) => n !== myName).map((n) => `<button class="wide ${priv.yourVote === n ? 'picked' : ''}" data-ins="accuse" data-n="${esc(n)}">${esc(n)}</button>`).join('');
  } else if (pub.phase === 'reveal' && pub.result) {
    const r = pub.result;
    h = r.aborted ? `<p>Round cancelled: ${esc(r.reason)}</p>` : `<p class="win">${esc(r.insider)} was the insider${r.caught ? '. Caught!' : ' and got away with it.'}</p><p>$${r.move} pumped ${r.pump}. ${esc(r.reward)}.</p><div class="tape">${r.results.slice(0, 4).map((x) => `${esc(x.name)} ${x.profit >= 0 ? '+' : ''}${Math.round(x.profit)}`).join('<br>')}</div>`;
  } else h = `<p>Round in progress. You join the next one.</p><button class="wide sell" data-ins="leave">Leave</button>`;
  if (h !== insHtml) { insHtml = h; $('ins-body').innerHTML = h; }
}
$('ins-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-ins]');
  if (!b) return;
  const d = b.dataset, r = await act(d.ins === 'buy' || d.ins === 'sell' ? 'insider_trade' : d.ins === 'accuse' ? 'insider_accuse' : `insider_${d.ins}`, d.ins === 'accuse' ? { name: d.n } : { ticker: d.t, side: d.ins, shares: 10 });
  if (r && r.ok === false) $('hp-note').textContent = r.error;
  insPriv = null; pollInsider();
});

// tiny synth sounds
let actx = null;
const tone = (f, d, v = 0.15, type = 'square') => {
  actx ??= new AudioContext();
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(v, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
};
const beep = (b) => { for (let i = 0; i < Math.max(1, b); i++) setTimeout(() => tone(500 + b * 140, 0.08, 0.06), i * 110); };
const chime = () => [660, 880, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.12, 'triangle'), i * 90));

// ---------------------------------------------------------------- splash
$('name').value = localStorage.getItem('dbi-name') ?? '';
$('play').addEventListener('click', () => {
  const name = $('name').value.trim() || 'player';
  localStorage.setItem('dbi-name', name);
  ws.send(JSON.stringify({ type: 'join', name, look: params.get('look') ?? 'racer' }));
  $('splash').hidden = true;
});
$('watch').addEventListener('click', () => { $('splash').hidden = true; $('controls').textContent = 'watching agents · Tab to switch'; setTimeout(cycleWatch, 500); });
if (params.has('watch')) $('watch').click();

// ---------------------------------------------------------------- loop
const camPos = new THREE.Vector3(0, 60, 120), camLook = new THREE.Vector3(0, 0, 60);
const v = new THREE.Vector3();
let last = performance.now(), fpsAcc = 0, fpsN = 0, qualityChecked = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sendMove();
  island.update(now / 1000);
  for (const [id, p] of players) {
    const k = 1 - Math.exp(-dt * 12);
    p.cur.x += (p.target.x - p.cur.x) * k; p.cur.z += (p.target.z - p.cur.z) * k; p.cur.y += (p.target.y - p.cur.y) * k;
    let dh = p.target.h - p.cur.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.cur.h += dh * k;
    const moving = Math.hypot(p.target.x - p.cur.x, p.target.z - p.cur.z) > 0.05 || p.anim === 'walk';
    p.ch.root.position.set(p.cur.x, p.cur.y, p.cur.z);
    p.ch.root.rotation.y = p.cur.h;
    p.ch.update(dt, p.anim, moving, p.emote);
    // name tags + speech bubbles
    v.set(p.cur.x, p.cur.y + 3.4, p.cur.z).project(camera);
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight, onScreen = v.z < 1;
    p.tag.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, 0)`;
    p.tag.hidden = !onScreen;
    p.bub.hidden = !p.say || !onScreen;
    if (p.say) { p.bub.textContent = p.say; p.bub.style.transform = `translate(${sx}px, ${sy - 8}px) translate(-50%, -100%)`; }
  }
  for (const c of critters.values()) {
    const k = 1 - Math.exp(-dt * 10);
    c.cur.x += (c.target.x - c.cur.x) * k; c.cur.z += (c.target.z - c.cur.z) * k; c.cur.y += (c.target.y - c.cur.y) * k;
    let dh = c.target.h - c.cur.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); c.cur.h += dh * k;
    const t = now / 1000, hop = Math.abs(Math.sin(t * 5 + c.r * 7)) * 0.35 * c.r;
    const squash = c.wind ? 1 + Math.sin(t * 40) * 0.08 : 1;
    c.mesh.position.set(c.cur.x, c.cur.y + c.r * 0.9 + hop, c.cur.z);
    c.mesh.rotation.y = c.cur.h;
    c.mesh.scale.set(squash, c.wind ? 0.85 : 1, squash);
    c.body.material.emissive.set(c.wind ? '#ff2a1a' : '#000000');
    c.bar.style.width = `${(100 * c.hp) / c.maxHp}%`;
    c.tag.classList.toggle('wind', !!c.wind);
    v.set(c.cur.x, c.cur.y + c.r * 2.4, c.cur.z).project(camera);
    c.tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    c.tag.hidden = v.z >= 1;
  }
  // camera: high three-quarter follow of you (or the agent you're watching)
  const focus = players.get(watchId ?? me) ?? players.get(me);
  const fx = focus ? focus.cur.x : 0, fz = focus ? focus.cur.z : 60, fy = focus ? focus.cur.y : 2;
  if (PORTRAIT && focus) { const h = focus.cur.h; camPos.set(fx + Math.sin(h) * 5.5, fy + 2.2, fz + Math.cos(h) * 5.5); camLook.set(fx, fy + 1.3, fz); } else {
    camPos.lerp(v.set(fx, fy + 18 * ZOOM, fz + 25 * ZOOM), 1 - Math.exp(-dt * 4));
    camLook.lerp(v.set(fx, fy, fz), 1 - Math.exp(-dt * 6));
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  renderer.render(scene, camera);
  // adaptive quality: drop resolution if we can't hold ~50fps
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) {
    const fps = fpsN / fpsAcc;
    window.__fps = fps;
    if (fps < 48 && pixelRatio > 0.75 && now - qualityChecked > 3000) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); qualityChecked = now; }
    fpsAcc = 0; fpsN = 0;
  }
}
renderer.setAnimationLoop(frame);
// on tall phone screens keep at least ~52 deg of horizontal view, else you
// only see a sliver of the island around your character
function fitCamera() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  const minHFov = (52 * Math.PI) / 180;
  camera.fov = Math.min(70, Math.max(34, (2 * Math.atan(Math.tan(minHFov / 2) / camera.aspect) * 180) / Math.PI));
  camera.updateProjectionMatrix();
}
addEventListener('resize', fitCamera);
fitCamera();
window.__dbi = { renderer, scene, players, get me() { return me; } };
