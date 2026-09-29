// The council's buildings, drawn from the live world state. Every type in the
// catalogue has a hand-built look in the island's palette. While a building is
// under construction it rises inside wooden scaffolding; finished ones get a
// little pop. Roads, plazas and gardens hug the terrain; buildings stand on a
// stone foundation so they sit level on the terraced ground.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundAt, baseHeightAt } from '../shared/world.js';

const R = { 'town-hall': 7, plaza: 9, exchange: 6, market: 5, 'survey-tower': 2.5, beacon: 2, garden: 6, statue: 2, lab: 5, bank: 5, shelter: 3, road: 1.6 };
const col = new THREE.Color();
function part(geo, color, { ao = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, n = g.attributes.position.count, c = new Float32Array(n * 3);
  col.set(color);
  for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i), k = 1 - ao * (1 - (y - min.y) / Math.max(0.001, max.y - min.y)); c.set([col.r * k, col.g * k, col.b * k], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const merge = (parts) => mergeGeometries(parts);
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r0, r1, h, x = 0, y = 0, z = 0, seg = 20) => new THREE.CylinderGeometry(r1, r0, h, seg).translate(x, y + h / 2, z);
const ring = (n, r, fn) => Array.from({ length: n }, (_, k) => fn(Math.sin((k / n) * Math.PI * 2) * r, Math.cos((k / n) * Math.PI * 2) * r, k));

const mat = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
const glow = (c, k = 3) => new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

// ---------------------------------------------------------------- the catalogue, drawn
const cache = new Map();
function shape(type) {
  if (cache.has(type)) return cache.get(type);
  const P = [], L = []; // P: solid parts, L: glowing bits [geometry, colour]
  const stone = '#e6dccb', cream = '#f5ecdb', roof = '#e0784a', wood = '#8a5d3b', dark = '#3a3140', gold = '#f2c14e';
  switch (type) {
    case 'town-hall': {
      P.push(part(cyl(5.3, 5.3, 4.2), cream, { ao: 0.25 }));
      P.push(...ring(10, 6.1, (x, z) => part(cyl(0.34, 0.3, 4.4, x, 0, z, 10), '#ffffff', { ao: 0.2 })));
      P.push(part(cyl(6.6, 6.6, 0.45, 0, 4.4), stone));
      P.push(part(new THREE.SphereGeometry(5.4, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 4.8, 0), roof, { ao: 0.15 }));
      P.push(part(cyl(0.9, 0.7, 1.4, 0, 10), cream), part(new THREE.SphereGeometry(0.55, 16, 10).translate(0, 11.8, 0), gold));
      P.push(part(box(2.2, 3.1, 0.3, 0, 0, 5.25), dark), part(box(3.6, 0.35, 2.2, 0, 0, 6.3), stone), part(box(3.0, 0.35, 1.2, 0, 0.35, 6.0), stone));
      P.push(part(cyl(0.06, 0.06, 5, 0, 11.4), '#dddddd'), part(box(0.05, 1.1, 1.7, 0, 15.2, 0.9), '#ff7a2e'));
      ring(8, 5.33, (x, z, k) => { if (k === 0) return; L.push([new THREE.BoxGeometry(0.6, 1.3, 0.12).rotateY(Math.atan2(x, z)).translate(x, 2.4, z), '#ffcf7a']); }); // warm windows (the door faces front)
      break;
    }
    case 'plaza': {
      // tiles are drawn separately (they hug the terrain); these are the props
      P.push(part(cyl(2.2, 2.4, 0.7), '#d9d0c1', { ao: 0.2 }), part(cyl(0.35, 0.3, 1.6), '#d9d0c1'), part(cyl(0.9, 0.7, 0.25, 0, 1.4), '#d9d0c1'));
      L.push([cyl(1.95, 1.95, 0.05, 0, 0.62, 0, 24), '#7fd3ff'], [cyl(0.72, 0.72, 0.04, 0, 1.6, 0, 16), '#9be0ff']);
      ring(4, 6.3, (x, z, k) => { const a = (k / 4) * Math.PI * 2; const b = new THREE.Object3D(); b.position.set(x, 0, z); b.rotation.y = a; b.updateMatrix(); P.push(part(box(2.2, 0.12, 0.6, 0, 0.45, 0).applyMatrix4(b.matrix), wood), part(box(2.2, 0.5, 0.1, 0, 0.55, -0.28).applyMatrix4(b.matrix), wood), part(box(0.1, 0.45, 0.5, -0.95, 0, 0).applyMatrix4(b.matrix), dark), part(box(0.1, 0.45, 0.5, 0.95, 0, 0).applyMatrix4(b.matrix), dark)); });
      ring(4, 8, (x, z) => { const a = Math.atan2(x, z) + Math.PI / 4, lx = Math.sin(a) * 8, lz = Math.cos(a) * 8; P.push(part(cyl(0.08, 0.08, 3.2, lx, 0, lz, 8), dark)); L.push([new THREE.SphereGeometry(0.28, 12, 8).translate(lx, 3.35, lz), '#ffd28a']); });
      break;
    }
    case 'exchange': {
      P.push(part(box(10, 5.2, 7, 0, 0, -0.6), cream, { ao: 0.2 }), part(box(10.6, 0.5, 7.6, 0, 5.2, -0.6), stone));
      P.push(...[-3.6, -1.2, 1.2, 3.6].map((x) => part(cyl(0.38, 0.34, 4.7, x, 0.4, 3.6, 12), '#ffffff', { ao: 0.2 })));
      P.push(part(box(9.4, 0.4, 2.2, 0, 0, 3.6), stone), part(box(9.4, 0.5, 2.4, 0, 5.1, 3.6), stone));
      const tri = new THREE.Shape([new THREE.Vector2(-4.9, 0), new THREE.Vector2(4.9, 0), new THREE.Vector2(0, 1.5)]);
      P.push(part(new THREE.ExtrudeGeometry(tri, { depth: 2.4, bevelEnabled: false }).translate(0, 5.6, 2.4), stone), part(box(2.2, 3.4, 0.2, 0, 0.4, 2.95), dark));
      P.push(part(box(8.4, 2.3, 0.3, 0, 5.7, -0.4), dark)); // the ticker board's frame, up on the roof
      break;
    }
    case 'market': {
      const colors = [['#e5383b', '#fff5ea'], ['#2a86ff', '#fff5ea'], ['#28c06a', '#fff5ea']];
      colors.forEach(([a, b], k) => {
        const o = new THREE.Object3D(); o.position.set((k - 1) * 3.4, 0, k === 1 ? -0.8 : 0.4); o.rotation.y = (k - 1) * 0.25; o.updateMatrix();
        for (const [sx, sz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) P.push(part(cyl(0.07, 0.07, 2.6, sx, 0, sz, 6), wood).applyMatrix4(o.matrix));
        P.push(part(box(2.6, 0.9, 1.0, 0, 0, 0.6), wood, { ao: 0.3 }).applyMatrix4(o.matrix));
        for (let s = 0; s < 6; s++) P.push(part(box(0.46, 0.08, 2.3, -1.15 + s * 0.46, 2.6 + (s % 2) * 0.02, 0).applyMatrix4(new THREE.Matrix4().makeRotationX(-0.18)), s % 2 ? a : b).applyMatrix4(o.matrix));
        for (let f = 0; f < 5; f++) P.push(part(new THREE.SphereGeometry(0.16, 8, 6).translate(-0.9 + f * 0.45, 1.05, 0.7), ['#ff7a2e', '#ffd23f', '#e5383b', '#28c06a', '#8b5cf6'][(f + k) % 5]).applyMatrix4(o.matrix));
      });
      break;
    }
    case 'survey-tower': {
      const H = 10;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const g = new THREE.CylinderGeometry(0.09, 0.14, H, 6).translate(0, H / 2, 0); g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(sz * 0.09, 0, -sx * 0.09))); g.translate(sx * 1.2, 0, sz * 1.2); P.push(part(g, '#b8bfcc')); }
      for (let y = 1.5; y < H; y += 2.2) { const w = 2.4 - (y / H) * 1.7; for (const [rx, ry] of [[0, 0], [0, Math.PI / 2]]) P.push(part(new THREE.BoxGeometry(w * 2, 0.08, 0.08).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)).translate(0, y, 0).applyMatrix4(new THREE.Matrix4().makeTranslation(ry ? w : 0, 0, ry ? 0 : w)), '#9aa3b2')); }
      P.push(part(box(1.6, 0.15, 1.6, 0, H), dark), part(cyl(0.03, 0.03, 2.5, 0, H), '#dddddd'), part(cyl(0.5, 0.5, 0.12, 0.4, H + 1.3, 0, 12).applyMatrix4(new THREE.Matrix4().makeRotationZ(0.5)), '#dddddd'));
      L.push([new THREE.SphereGeometry(0.22, 10, 8).translate(0, H + 2.6, 0), '#ff4d4d']);
      break;
    }
    case 'beacon': {
      P.push(part(cyl(1.9, 1.6, 0.8), stone, { ao: 0.2 }), part(cyl(1.3, 1.1, 0.6, 0, 0.8), '#cfc6b8'));
      L.push([new THREE.OctahedronGeometry(1, 0).scale(0.8, 2.4, 0.8).translate(0, 4.2, 0), '#7fe7ff'], [new THREE.TorusGeometry(1.6, 0.06, 6, 32).rotateX(Math.PI / 2).translate(0, 3.2, 0), '#ffe08a']);
      break;
    }
    case 'garden': {
      ring(7, 3.8, (x, z, k) => P.push(part(new THREE.IcosahedronGeometry(0.5 + (k % 3) * 0.12, 1).scale(1.2, 0.7, 1.2).translate(x, 0.25, z), ['#5f8649', '#6d9a55', '#557f48'][k % 3])));
      ring(28, 2.6, (x, z, k) => P.push(part(new THREE.SphereGeometry(0.16, 6, 5).translate(x + Math.sin(k) * 0.4, 0.25, z + Math.cos(k * 1.7) * 0.4), ['#ff7aa2', '#ffd23f', '#fff5e0', '#e5383b', '#a57bff'][k % 5])));
      for (const [x, z] of [[-4.6, -2], [4.2, -3], [0, -4.8]]) P.push(part(cyl(0.12, 0.16, 1.6, x, 0, z, 6), '#6b4a33'), part(new THREE.IcosahedronGeometry(1.1, 1).translate(x, 2.2, z), '#e3a262'));
      P.push(part(box(2, 0.12, 0.55, 0, 0.45, 4.2), wood), part(box(2, 0.45, 0.1, 0, 0.55, 3.95), wood));
      L.push([new THREE.SphereGeometry(0.2, 10, 8).translate(0, 1.7, -0.6), '#ffd28a']);
      P.push(part(cyl(0.06, 0.06, 1.6, 0, 0, -0.6, 6), dark));
      break;
    }
    case 'statue': {
      P.push(part(box(2.2, 1.6, 2.2), stone, { ao: 0.3 }), part(box(2.6, 0.25, 2.6, 0, 1.6), stone));
      P.push(part(new THREE.SphereGeometry(1, 28, 20).scale(1, 1.05, 0.95).translate(0, 2.95, 0), gold), part(new THREE.SphereGeometry(0.65, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 3.85, 0), '#e0b24a'));
      P.push(...[-0.34, 0.34].map((x) => part(new THREE.SphereGeometry(0.13, 10, 8).scale(1, 1.2, 0.5).translate(x, 3.05, 0.9), dark)));
      break;
    }
    case 'lab': {
      P.push(part(box(7, 3.6, 6), '#f1f3f6', { ao: 0.2 }), part(box(7.4, 0.3, 6.4, 0, 3.6), '#c9d2dc'));
      P.push(part(new THREE.SphereGeometry(2.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(-1.4, 3.9, -0.6), '#dfe6ee'), part(box(0.5, 1.6, 3.8, -1.4, 3.9, -0.6), dark));
      P.push(part(cyl(0.12, 0.12, 2.2, 2.2, 3.9, 1.2, 8), '#c9d2dc'), part(new THREE.SphereGeometry(1.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6).rotateX(Math.PI * 0.75).translate(2.2, 6.4, 1.2), '#ffffff'));
      P.push(part(box(1.8, 2.6, 0.2, 0, 0, 3.02), '#2a86ff'));
      L.push(...[-2.4, 2.4].map((x) => [new THREE.BoxGeometry(1.2, 0.9, 0.08).translate(x, 2.1, 3.04), '#bfe8ff']));
      break;
    }
    case 'bank': {
      P.push(part(box(8, 4, 6.4), '#e8e0d0', { ao: 0.25 }), part(box(8.6, 0.6, 7, 0, 4), stone), part(box(8.6, 0.4, 7.4, 0, 0), stone));
      P.push(...[-2.8, -1.2, 1.2, 2.8].map((x) => part(cyl(0.32, 0.3, 3.6, x, 0.4, 3.45, 12), '#ffffff')));
      P.push(part(cyl(1.25, 1.25, 0.3, 0, 0, 0, 28).rotateX(Math.PI / 2).translate(0, 1.9, 3.3), gold), part(cyl(0.3, 0.3, 0.35, 0, 0, 0, 12).rotateX(Math.PI / 2).translate(0, 1.9, 3.45), '#c9962a'));
      break;
    }
    case 'shelter': {
      P.push(part(new THREE.SphereGeometry(2.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), '#cfc6b8', { ao: 0.3 }), part(box(1.3, 1.8, 1.2, 0, 0, 2.3), '#bdb3a4'), part(box(0.9, 1.5, 0.1, 0, 0, 2.95), dark));
      break;
    }
    default: break;
  }
  const out = { solid: P.length ? merge(P) : null, lights: L.filter(([g]) => g).map(([g, c]) => ({ geo: g, color: c })) };
  out.solid?.computeBoundingBox();
  out.height = out.solid ? out.solid.boundingBox.max.y : 1;
  cache.set(type, out);
  return out;
}

// terrain-hugging disc (plaza paving, garden lawn) and road strips
function disc(x, z, r, colors, rings = 5) {
  const g = new THREE.CircleGeometry(r, 48, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  const pos = g.attributes.position, c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), pz = pos.getZ(i), d = Math.hypot(px, pz);
    pos.setY(i, groundAt(x + px, z + pz) + 0.06);
    col.set(colors[Math.floor((d / r) * rings) % colors.length]);
    c.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}
function roadStrip(s) {
  const len = Math.hypot(s.x2 - s.x, s.z2 - s.z), n = Math.max(2, Math.ceil(len)), ux = (s.x2 - s.x) / len, uz = (s.z2 - s.z) / len, w = 1.7;
  const pos = [], c = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, cx = s.x + (s.x2 - s.x) * t, cz = s.z + (s.z2 - s.z) * t;
    for (const side of [-1, -0.8, 0.8, 1]) {
      const px = cx - uz * w * side, pz = cz + ux * w * side;
      pos.push(px, groundAt(px, pz) + 0.07, pz);
      col.set(Math.abs(side) === 1 ? '#b9ab98' : (i % 2 ? '#d7ccbb' : '#cfc3b0'));
      c.push(col.r, col.g, col.b);
    }
    if (i < n) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function scaffold(r, h) {
  const P = [];
  const n = Math.max(6, Math.round(r * 1.6));
  ring(n, r + 0.6, (x, z) => P.push(part(cyl(0.08, 0.08, h + 0.8, x, 0, z, 6), '#a8784c')));
  for (let y = 1.4; y < h + 0.5; y += 1.8) ring(n, r + 0.6, (x, z, k) => { const a2 = ((k + 1) / n) * Math.PI * 2, x2 = Math.sin(a2) * (r + 0.6), z2 = Math.cos(a2) * (r + 0.6), l = Math.hypot(x2 - x, z2 - z); const g = new THREE.BoxGeometry(l, 0.12, 0.3).translate(0, 0, 0); g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.atan2(z2 - z, x2 - x))); g.translate((x + x2) / 2, y, (z + z2) / 2); P.push(part(g, '#c29264')); });
  return merge(P);
}

// ---------------------------------------------------------------- the live set
export const footprint = (s) => (s[1] === 'road' ? null : { x: s[2], z: s[3], r: (R[s[1]] ?? 3) * (1 + 0.15 * ((s[6] ?? 1) - 1)) + 0.6 });
export function makeBuildings(scene) {
  const live = new Map(); // id -> { group, body, scaf, lights, type, progress, pop }
  const tickerCanvas = document.createElement('canvas'); tickerCanvas.width = 512; tickerCanvas.height = 128;
  const tickerTex = new THREE.CanvasTexture(tickerCanvas); tickerTex.colorSpace = THREE.SRGBColorSpace;
  const tickerMat = new THREE.MeshBasicNodeMaterial({ map: tickerTex });
  let tickerT = 0;
  function drawTicker(market, t) {
    const g = tickerCanvas.getContext('2d');
    g.fillStyle = '#10131a'; g.fillRect(0, 0, 512, 128);
    g.font = '700 34px sans-serif'; g.textBaseline = 'middle';
    const items = market.map(([tk, p, ch]) => [`$${tk} ${p.toFixed(2)} ${ch >= 0 ? '▲' : '▼'}${Math.abs(ch)}%`, ch >= 0 ? '#5dff9a' : '#ff6b6b']);
    let x = -((t * 60) % 900);
    for (let rep = 0; rep < 3; rep++) for (const [s, c] of items) { g.fillStyle = c; g.fillText(s, x, 64); x += g.measureText(s).width + 36; }
    tickerTex.needsUpdate = true;
  }
  function build(s) {
    const [id, type, x, z, rot, , level, name] = s;
    const group = new THREE.Group();
    const r = R[type] ?? 3;
    if (type === 'road') {
      const m = new THREE.Mesh(roadStrip({ x, z, x2: s[9], z2: s[10] }), mat); m.receiveShadow = true;
      group.add(m); scene.add(group);
      return { group, body: m, type, flat: true };
    }
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < 12; a++) for (const f of [0.3, 0.7, 1]) { const h = baseHeightAt(x + Math.sin(a) * r * f, z + Math.cos(a) * r * f); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const flat = type === 'plaza' || type === 'garden';
    const base = flat ? groundAt(x, z) : hi;
    group.position.set(x, 0, z);
    if (!flat) { // a stone foundation so the building stands level on terraced ground
      const f = new THREE.Mesh(part(cyl(r + 0.4, r + 0.2, hi - lo + 0.8, 0, lo - 0.6), '#cfc3b0', { ao: 0.35 }), mat);
      f.castShadow = f.receiveShadow = true; group.add(f);
    } else {
      const m = new THREE.Mesh(disc(x, z, r, type === 'plaza' ? ['#efe5d3', '#e2d5bf', '#efe5d3', '#d8c9b0', '#efe5d3'] : ['#7fa45a', '#8db566', '#7fa45a']), mat);
      m.position.set(-x, 0, -z); m.receiveShadow = true; group.add(m);
    }
    const sh = shape(type);
    const body = new THREE.Group();
    body.position.y = base; body.rotation.y = rot;
    const sc = 1 + 0.15 * (level - 1);
    body.scale.setScalar(sc);
    if (sh.solid) { const m = new THREE.Mesh(sh.solid, mat); m.castShadow = m.receiveShadow = true; body.add(m); }
    const lights = sh.lights.map(({ geo, color }) => { const m = new THREE.Mesh(geo, glow(color)); body.add(m); return m; });
    if (type === 'exchange') { const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.9), tickerMat); board.position.set(0, 6.85, -0.23); body.add(board); }
    group.add(body);
    const scaf = new THREE.Mesh(scaffold(r * sc, sh.height * sc), mat);
    scaf.position.y = base; scaf.castShadow = true;
    group.add(scaf);
    scene.add(group);
    return { group, body, scaf, lights, type, base, flat, level, name };
  }
  return {
    live,
    /** structures: the snapshot tuples [id, type, x, z, rot, progress, level, name, honoree, x2, z2] */
    sync(structures = []) {
      const seen = new Set();
      for (const s of structures) {
        const [id, type, , , , progress, level] = s;
        seen.add(id);
        let b = live.get(id);
        if (b && b.level !== undefined && b.level !== level) { scene.remove(b.group); live.delete(id); b = null; } // upgraded: rebuild bigger
        if (!b) { b = build(s); b.shown = 0; live.set(id, b); }
        b.progress = progress;
      }
      for (const [id, b] of live) if (!seen.has(id)) { scene.remove(b.group); live.delete(id); }
    },
    update(t, dt, market) {
      for (const b of live.values()) {
        const p = b.progress ?? 1;
        b.shown += (p - b.shown) * Math.min(1, dt * 3);
        if (b.type === 'road') { b.body.visible = p > 0.02; b.body.material.opacity = 1; continue; }
        const done = p >= 1;
        // rises out of its foundation inside the scaffolding, then a little pop when it's finished
        if (!done) { b.body.scale.y = (1 + 0.15 * ((b.level ?? 1) - 1)) * Math.max(0.04, b.shown); b.pop = 0; }
        else { b.pop = Math.min(1, (b.pop ?? 0) + dt * 2.5); const s = (1 + 0.15 * ((b.level ?? 1) - 1)) * (1 + Math.sin(b.pop * Math.PI) * 0.06); b.body.scale.set(s, s, s); }
        if (b.scaf) b.scaf.visible = !done;
        for (const m of b.lights ?? []) m.visible = done;
        if (done && b.type === 'beacon') b.body.children.forEach((m, i) => { if (i > 0) m.rotation.y = t * 0.8; });
        if (done && b.type === 'survey-tower' && b.lights?.[0]) b.lights[0].visible = Math.sin(t * 4) > 0;
      }
      tickerT += dt;
      if (market && [...live.values()].some((b) => b.type === 'exchange') && tickerT > 0.08) { tickerT = 0; drawTicker(market, t); }
    },
  };
}

// ---------------------------------------------------------------- critters
export function makeCritters(scene) {
  const live = new Map();
  const shadeMat = new THREE.MeshPhysicalNodeMaterial({ color: '#2a1f3d', roughness: 0.35, transparent: true, opacity: 0.88, emissive: new THREE.Color('#5b2a8a'), emissiveIntensity: 0.5 });
  const eyeMat = glow('#ffffff', 4), angryEye = glow('#ff3b3b', 5);
  const shadeGeo = mergeGeometries([new THREE.SphereGeometry(0.9, 24, 16).scale(1, 1.15, 1).translate(0, 1.6, 0), new THREE.ConeGeometry(0.75, 1.4, 16).rotateX(Math.PI).translate(0, 0.65, 0)]);
  const eyeGeo = mergeGeometries([new THREE.SphereGeometry(0.13, 10, 8).scale(1, 0.6, 0.5).translate(-0.3, 1.8, 0.78), new THREE.SphereGeometry(0.13, 10, 8).scale(1, 0.6, 0.5).translate(0.3, 1.8, 0.78)]);
  const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.5); };
  function make(kind, name) {
    const g = new THREE.Group();
    if (kind === 'shade') {
      const m = new THREE.Mesh(shadeGeo, shadeMat); m.castShadow = true; g.add(m);
      g.add(new THREE.Mesh(eyeGeo, eyeMat));
    } else {
      const c = hue(name ?? 'brute');
      const bm = new THREE.MeshPhysicalNodeMaterial({ color: c, roughness: 0.5, clearcoat: 0.4 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 22).scale(1.1, 0.95, 1).translate(0, 1.55, 0), bm); body.castShadow = true;
      const horns = new THREE.Mesh(mergeGeometries([new THREE.ConeGeometry(0.28, 1, 10).rotateZ(0.5).translate(-0.9, 3, 0.1), new THREE.ConeGeometry(0.28, 1, 10).rotateZ(-0.5).translate(0.9, 3, 0.1)]), new THREE.MeshLambertNodeMaterial({ color: '#f5ecdb' }));
      const teeth = new THREE.Mesh(mergeGeometries([-0.35, 0, 0.35].map((x) => new THREE.ConeGeometry(0.12, 0.3, 6).rotateX(Math.PI).translate(x, 1.2, 1.45))), new THREE.MeshLambertNodeMaterial({ color: '#ffffff' }));
      const eyes = new THREE.Mesh(mergeGeometries([new THREE.SphereGeometry(0.2, 10, 8).translate(-0.5, 2.05, 1.3), new THREE.SphereGeometry(0.2, 10, 8).translate(0.5, 2.05, 1.3)]), angryEye);
      const brows = new THREE.Mesh(mergeGeometries([new THREE.BoxGeometry(0.6, 0.12, 0.12).rotateZ(-0.4).translate(-0.5, 2.38, 1.3), new THREE.BoxGeometry(0.6, 0.12, 0.12).rotateZ(0.4).translate(0.5, 2.38, 1.3)]), new THREE.MeshLambertNodeMaterial({ color: '#1b1a22' }));
      g.add(body, horns, teeth, eyes, brows);
    }
    scene.add(g);
    return { g, kind };
  }
  return {
    live,
    sync(list = []) {
      const seen = new Set();
      for (const [id, kind, x, z, h, hp, name] of list) {
        seen.add(id);
        let c = live.get(id);
        if (!c) { c = make(kind, name); c.cur = { x, z, h }; live.set(id, c); }
        Object.assign(c, { target: { x, z, h }, hp, name });
      }
      for (const [id, c] of live) if (!seen.has(id)) { scene.remove(c.g); c.tag?.remove(); live.delete(id); }
    },
    update(t, dt) {
      for (const c of live.values()) {
        const k = 1 - Math.exp(-dt * 10);
        c.cur.x += (c.target.x - c.cur.x) * k; c.cur.z += (c.target.z - c.cur.z) * k;
        let dh = c.target.h - c.cur.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); c.cur.h += dh * k;
        const y = groundAt(c.cur.x, c.cur.z);
        c.g.position.set(c.cur.x, y + (c.kind === 'shade' ? 0.4 + Math.sin(t * 3 + c.cur.x) * 0.25 : Math.abs(Math.sin(t * 5)) * 0.15), c.cur.z);
        c.g.rotation.y = c.cur.h;
        if (c.kind === 'brute') c.g.scale.set(1 + Math.sin(t * 5) * 0.03, 1 - Math.sin(t * 5) * 0.03, 1);
      }
    },
  };
}
