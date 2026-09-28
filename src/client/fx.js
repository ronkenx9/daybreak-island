// Gameplay effects, all pooled and instanced:
//  - scan pulse: rings that ripple out from the detector coil, bluer when far,
//    gold when a chest is under you ("de de de")
//  - holes: a crater with a dirt rim that grows while someone digs, stays after
//  - dirt: clods thrown up with each shovel stroke
//  - chest reveal: a chest rises out of the hole, the lid pops, coins burst,
//    a light beam (gold and tall for legendary)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundAt } from '../shared/world.js';

const BAR_COLORS = ['#5b8cff', '#5b8cff', '#4fc3ff', '#7dffa8', '#ffe066', '#ffcf3f'].map((c) => new THREE.Color(c));
const RARITY = { common: new THREE.Color('#bfe3ff'), rare: new THREE.Color('#5b8cff'), legendary: new THREE.Color('#ffcf3f') };
const paint = (g, color, ao = 0) => {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
};

export function makeFx(scene) {
  const tmp = new THREE.Object3D();

  // ---------------------------------------------------------------- scan pulses
  const ringGeo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#5b8cff' }));
    m.visible = false; m.renderOrder = 2; m.userData = { t: 1 };
    scene.add(m); rings.push(m);
  }
  function pulse(x, z, bars) {
    // three rings, one per beep; bigger and warmer when close
    for (let k = 0; k < Math.min(3, 1 + Math.floor(bars / 2)); k++) {
      const r = rings.find((m) => !m.visible);
      if (!r) return;
      Object.assign(r.userData, { t: -k * 0.18, x, z, max: 1.6 + bars * 0.7 });
      r.material.color.copy(BAR_COLORS[Math.min(5, bars)]);
      r.visible = true;
    }
  }

  // ---------------------------------------------------------------- holes
  const crater = (() => {
    const pts = [[0, -0.22], [0.42, -0.2], [0.6, -0.04], [0.76, 0.17], [0.92, 0.2], [1.12, 0.08], [1.35, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(pts, 18);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i)), a = Math.atan2(p.getZ(i), p.getX(i));
      p.setY(i, p.getY(i) + Math.sin(a * 5 + r * 3) * 0.025 * (r > 0.5)); // lumpy rim
      const c = new THREE.Color(r < 0.55 ? '#2a1a0f' : r < 0.7 ? '#5a3a22' : '#9a7244');
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    // a few clods around the rim
    const clods = [0, 1, 2, 3, 4].map((k) => paint(new THREE.DodecahedronGeometry(0.09 + (k % 2) * 0.04, 0).translate(Math.cos(k * 1.3) * 0.95, 0.07, Math.sin(k * 1.3) * 0.95), '#8a643c'));
    const base = g.index ? g.toNonIndexed() : g;
    base.deleteAttribute('uv');
    return mergeGeometries([base, ...clods]);
  })();
  const MAX_HOLES = 160;
  const holes = new THREE.InstancedMesh(crater, new THREE.MeshLambertMaterial({ vertexColors: true }), MAX_HOLES);
  holes.receiveShadow = true; holes.count = 0; holes.frustumCulled = false;
  scene.add(holes);
  const seenHoles = new Set();

  // ---------------------------------------------------------------- particles (dirt + coins)
  function pool(geo, mat, n) {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
    scene.add(mesh);
    return { mesh, parts: [], n };
  }
  const dirt = pool(new THREE.DodecahedronGeometry(0.1, 0), new THREE.MeshLambertMaterial({ color: '#7a522e' }), 500);
  const coins = pool(new THREE.CylinderGeometry(0.1, 0.1, 0.025, 10).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#ffcf3f', emissive: '#6a4a00' }), 240);
  function emit(p, x, y, z, count, speed, up, life) {
    for (let i = 0; i < count && p.parts.length < p.n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.5 + Math.random() * 0.7);
      p.parts.push({ x, y, z, vx: Math.cos(a) * s, vy: up * (0.7 + Math.random() * 0.6), vz: Math.sin(a) * s, life, age: 0, spin: Math.random() * 6 });
    }
  }
  function stepPool(p, dt) {
    let k = 0;
    for (const q of p.parts) {
      q.age += dt; q.vy -= 14 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const g = groundAt(q.x, q.z);
      if (q.y < g + 0.04) { q.y = g + 0.04; q.vx *= 0.5; q.vz *= 0.5; q.vy = Math.abs(q.vy) * 0.25; }
      const s = q.age > q.life - 0.4 ? Math.max(0, (q.life - q.age) / 0.4) : 1;
      tmp.position.set(q.x, q.y, q.z); tmp.rotation.set(q.age * q.spin, q.age * q.spin * 0.7, 0); tmp.scale.setScalar(s); tmp.updateMatrix();
      p.mesh.setMatrixAt(k++, tmp.matrix);
    }
    p.parts = p.parts.filter((q) => q.age < q.life);
    p.mesh.count = k; p.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- chest reveal
  const chestBody = mergeGeometries([
    paint(new THREE.BoxGeometry(0.7, 0.4, 0.46).translate(0, 0.2, 0), '#8a5a33'),
    paint(new THREE.BoxGeometry(0.72, 0.06, 0.48).translate(0, 0.12, 0), '#caa24a'),
    paint(new THREE.BoxGeometry(0.72, 0.06, 0.48).translate(0, 0.36, 0), '#caa24a'),
  ]);
  const chestLid = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.23, 0.23, 0.7, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.23), '#9a6a3c'),
    paint(new THREE.BoxGeometry(0.1, 0.12, 0.06).translate(0, 0.02, 0.47), '#ffcf3f'),
  ]);
  const chestMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const beamGeo = new THREE.CylinderGeometry(0.16, 0.34, 1, 16, 1, true).translate(0, 0.5, 0);
  const seamGeo = new THREE.BoxGeometry(0.76, 0.07, 0.52).translate(0, 0.4, 0);
  const OPEN = 1.3; // rise, then shake with light leaking out, then pop
  const reveals = [];
  function reveal(x, z, rarity) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(chestBody, chestMat), lid = new THREE.Group();
    const lidMesh = new THREE.Mesh(chestLid, chestMat);
    lidMesh.position.z = -0.23; lid.position.set(0, 0.4, 0.0); lid.add(lidMesh);
    body.castShadow = lidMesh.castShadow = true;
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: RARITY[rarity] ?? RARITY.common, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const seam = new THREE.Mesh(seamGeo, new THREE.MeshBasicMaterial({ color: RARITY[rarity] ?? RARITY.common, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(body, lid, beam, seam);
    const y0 = groundAt(x, z);
    g.position.set(x, y0 - 0.7, z);
    g.scale.setScalar(1.35);
    g.rotation.y = Math.random() * 6;
    scene.add(g);
    reveals.push({ g, lid, beam, seam, x, z, y0, rarity, t: 0, burst: false });
  }
  function stepReveals(dt) {
    for (const r of reveals) {
      r.t += dt;
      const rise = Math.min(1, r.t / 0.55), ease = 1 - (1 - rise) ** 3;
      r.g.position.y = r.y0 - 0.7 + ease * 0.95 + (r.t > OPEN + 2.7 ? -(r.t - OPEN - 2.7) * 0.9 : 0);
      const shaking = r.t > 0.5 && r.t < OPEN;
      const amp = shaking ? 0.02 + ((r.t - 0.5) / (OPEN - 0.5)) * (r.rarity === 'legendary' ? 0.11 : 0.06) : 0;
      r.g.rotation.z = Math.sin(r.t * 55) * amp;
      r.g.rotation.x = Math.cos(r.t * 47) * amp * 0.6;
      r.seam.material.opacity = shaking ? 0.35 + 0.45 * Math.abs(Math.sin(r.t * 18)) : r.t >= OPEN ? Math.max(0, 0.8 - (r.t - OPEN) * 2) : 0;
      r.lid.rotation.x = -Math.min(1.9, Math.max(0, (r.t - OPEN) * 7));
      if (r.t > OPEN + 0.05 && !r.burst) {
        r.burst = true;
        api.shake = Math.max(api.shake, r.rarity === 'legendary' ? 0.55 : r.rarity === 'rare' ? 0.18 : 0.06);
        emit(coins, r.x, r.y0 + 0.5, r.z, r.rarity === 'legendary' ? 70 : r.rarity === 'rare' ? 40 : 22, 2.4, 6.5, 2.2);
      }
      const tall = r.rarity === 'legendary' ? 14 : r.rarity === 'rare' ? 6 : 3;
      r.beam.scale.set(1, tall * Math.min(1, Math.max(0, (r.t - OPEN) * 2)), 1);
      r.beam.material.opacity = r.t < OPEN ? 0 : Math.max(0, 0.32 - Math.max(0, r.t - OPEN - 0.7) * 0.14);
    }
    for (const r of reveals.filter((q) => q.t > OPEN + 3.4)) { scene.remove(r.g); r.beam.material.dispose(); r.seam.material.dispose(); }
    for (let i = reveals.length - 1; i >= 0; i--) if (reveals[i].t > OPEN + 3.4) reveals.splice(i, 1);
  }

  // ---------------------------------------------------------------- junk: pops out of an empty hole, spins, drops
  const junkGeo = {};
  const B = (w, h, d, x, y, z, c) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
  const S = (r, x, y, z, c, sy = 1) => paint(new THREE.SphereGeometry(r, 10, 8).scale(1, sy, 1).translate(x, y, z), c);
  const Cy = (r, h, x, y, z, c) => paint(new THREE.CylinderGeometry(r, r, h, 12).translate(x, y, z), c);
  const JUNK_PARTS = {
    boot: () => [B(0.2, 0.3, 0.2, 0, 0.15, -0.08, '#7a4a2a'), B(0.2, 0.12, 0.42, 0, 0.06, 0.03, '#7a4a2a'), B(0.22, 0.04, 0.44, 0, 0, 0.03, '#2a2a2a')],
    cap: () => [Cy(0.12, 0.04, 0, 0.02, 0, '#e5383b'), Cy(0.1, 0.045, 0, 0.022, 0, '#f2f2f2')],
    phone: () => [B(0.16, 0.34, 0.06, 0, 0.17, 0, '#5a5f6a'), B(0.12, 0.14, 0.02, 0, 0.24, 0.03, '#1c2a3a')],
    duck: () => [S(0.16, 0, 0.13, 0, '#ffd23f', 0.8), S(0.1, 0, 0.29, 0.08, '#ffd23f'), B(0.08, 0.04, 0.08, 0, 0.28, 0.18, '#ff8a1e')],
    paperhands: () => [B(0.2, 0.26, 0.03, -0.14, 0.15, 0, '#fbfbf5'), B(0.2, 0.26, 0.03, 0.14, 0.15, 0, '#fbfbf5'),
      ...[-0.07, 0, 0.07].flatMap((f) => [B(0.04, 0.12, 0.03, -0.14 + f, 0.34, 0, '#fbfbf5'), B(0.04, 0.12, 0.03, 0.14 + f, 0.34, 0, '#fbfbf5')])],
    receipt: () => [B(0.16, 0.36, 0.02, 0, 0.18, 0, '#f4f1e6')],
    bag: () => [S(0.2, 0, 0.18, 0, '#b08a5a', 1.1), Cy(0.06, 0.06, 0, 0.4, 0, '#8a6a3a')],
    can: () => [Cy(0.09, 0.24, 0, 0.12, 0, '#b9c0c8'), Cy(0.092, 0.12, 0, 0.12, 0, '#3a7bd5')],
  };
  const junkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const junks = [];
  function revealJunk(x, z, kind) {
    junkGeo[kind] ??= mergeGeometries((JUNK_PARTS[kind] ?? JUNK_PARTS.can)());
    const m = new THREE.Mesh(junkGeo[kind], junkMat);
    m.castShadow = true;
    const y0 = groundAt(x, z);
    m.position.set(x, y0, z);
    scene.add(m);
    junks.push({ m, y0, t: 0 });
    emit(dirt, x, y0 + 0.1, z, 10, 1.2, 3, 1);
  }
  function stepJunk(dt) {
    for (const j of junks) {
      j.t += dt;
      const up = j.t < 0.45 ? Math.sin((j.t / 0.45) * Math.PI / 2) * 1.2 : j.t < 1.8 ? 1.2 + Math.sin(j.t * 3) * 0.06 : Math.max(0, 1.2 - (j.t - 1.8) * 2.4);
      j.m.position.y = j.y0 + up;
      j.m.rotation.y = j.t * 4; j.m.rotation.z = Math.sin(j.t * 5) * 0.3;
      j.m.scale.setScalar(Math.min(1, j.t * 5) * 1.6);
    }
    for (const j of junks.filter((q) => q.t > 2.3)) scene.remove(j.m);
    for (let i = junks.length - 1; i >= 0; i--) if (junks[i].t > 2.3) junks.splice(i, 1);
  }

  // ---------------------------------------------------------------- per-frame, from the latest snapshot
  const lastScan = new Map(); // player id -> scanAge seen last frame
  const lastStroke = new Map();
  const api = {
    rings, holes, dirt, coins, reveals, junks, shake: 0,
    /** players: [{ id, x, z, h, bars, scanAge, dig }] ; holeList: snapshot holes */
    update(dt, players, holeList) {
      // new scans start a pulse at the detector coil
      for (const p of players) {
        const prev = lastScan.get(p.id);
        const fresh = p.scanAge !== null && p.scanAge < 0.35 && (prev === undefined || prev === null || prev > p.scanAge + 0.05);
        if (fresh) pulse(p.x + Math.sin(p.h) * 0.9, p.z + Math.cos(p.h) * 0.9, p.bars);
        lastScan.set(p.id, p.scanAge);
      }
      for (const r of rings) {
        if (!r.visible) continue;
        const u = r.userData; u.t += dt;
        if (u.t < 0) { r.scale.setScalar(0.001); continue; }
        const k = u.t / 0.9;
        if (k >= 1) { r.visible = false; continue; }
        r.position.set(u.x, groundAt(u.x, u.z) + 0.08, u.z);
        r.scale.setScalar(0.2 + k * u.max);
        r.material.opacity = Math.min(1, (1 - k) * 1.4);
      }

      // holes: finished ones from the server, plus live ones growing under diggers
      let n = 0;
      for (const [x, z, found, age, junk] of holeList) {
        if (n >= MAX_HOLES) break;
        const key = `${x},${z}`;
        if (!seenHoles.has(key)) { seenHoles.add(key); if (found && age < 1.5) reveal(x, z, found); else if (junk && age < 1.5) revealJunk(x, z, junk); }
        const fade = age > 170 ? Math.max(0, 1 - (age - 170) / 10) : 1;
        tmp.position.set(x, groundAt(x, z) + 0.01, z); tmp.rotation.set(0, (x * 7 + z * 13) % 6, 0); tmp.scale.setScalar(fade); tmp.updateMatrix();
        holes.setMatrixAt(n++, tmp.matrix);
      }
      for (const p of players) {
        if (p.dig === null || n >= MAX_HOLES) { lastStroke.delete(p.id); continue; }
        const hx = p.x + Math.sin(p.h) * 0.75, hz = p.z + Math.cos(p.h) * 0.75;
        tmp.position.set(hx, groundAt(hx, hz) + 0.01, hz); tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(0.25 + p.dig * 0.75); tmp.updateMatrix();
        holes.setMatrixAt(n++, tmp.matrix);
        // a spray of dirt on each shovel stroke (about 4 strokes per dig)
        const stroke = Math.floor(p.dig * 4);
        if (lastStroke.get(p.id) !== stroke) { lastStroke.set(p.id, stroke); emit(dirt, hx, groundAt(hx, hz) + 0.15, hz, 22, 2.0, 4.8, 1.3); }
      }
      holes.count = n; holes.instanceMatrix.needsUpdate = true;

      stepPool(dirt, dt); stepPool(coins, dt); stepReveals(dt); stepJunk(dt);
      api.shake *= Math.exp(-dt * 5);
    },
  };
  return api;
}
