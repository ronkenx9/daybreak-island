// Chibi Daybreak characters. Loads the Blender-made GLB when present
// (public/models/chibi.glb), otherwise builds a light procedural stand-in
// with the same parts and animation states: idle, walk, dig, cheer + emotes.
import * as THREE from 'three/webgpu';
import { toon } from './scene.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// merge coloured parts into one mesh (one draw call)
function merged(parts) {
  const geos = parts.map(([geo, color, m]) => {
    const g = geo.clone().applyMatrix4(m ?? new THREE.Matrix4());
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(color);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    return g.index ? g.toNonIndexed() : g;
  });
  return new THREE.Mesh(mergeGeometries(geos), toon({ vertexColors: true }));
}
const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));

export const LOOKS = {
  racer: { hat: '#2b4dff', flap: '#f4f6fb', jacket: '#f4f6fb', pants: '#1b2a7a', shoes: '#2b4dff', skin: '#14151f' },
  midnight: { hat: '#1a1b24', flap: '#f4f6fb', jacket: '#e9ebf1', pants: '#1c1e2a', shoes: '#1a1b24', skin: '#14151f' },
  electric: { hat: '#3358ff', flap: '#f4f6fb', jacket: '#1c2766', pants: '#e9ebf1', shoes: '#f59e1b', skin: '#14151f' },
  cloud: { hat: '#f1f2f6', flap: '#f1f2f6', jacket: '#2b4dff', pants: '#1c1e2a', shoes: '#f3f5fa', skin: '#d9dce6' },
  orbit: { hat: '#e9ebf1', flap: '#e9ebf1', jacket: '#1463d6', pants: '#e9ebf1', shoes: '#15151c', skin: '#14151f' },
  afterhours: { hat: '#2c2c34', flap: '#2c2c34', jacket: '#2c2c34', pants: '#0f0f14', shoes: '#d7dbe3', skin: '#14151f' },
};

const geoCache = {};
const G = (k, f) => (geoCache[k] ??= f());

function faceTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  // big white eyes with heavy lids, like the Daybreak heads
  for (const x of [78, 178]) {
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 62, 30, 28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.ellipse(x + 3, 66, 13, 15, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 8, 59, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#14151f'; g.fillRect(x - 34, 26, 68, 18);
  }
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.arc(128, 92, 16, 0.2, Math.PI - 0.2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let faceTex = null;

export function makeCharacter(lookId = 'racer') {
  const L = LOOKS[lookId] ?? LOOKS.racer;
  faceTex ??= faceTexture();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (parent, geo, color, x = 0, y = 0, z = 0, extra = {}) => {
    const m = new THREE.Mesh(geo, toon({ color, ...extra }));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  // body: torso + collar in one mesh
  body.add(merged([
    [G('torso', () => new THREE.CapsuleGeometry(0.34, 0.28, 4, 12)), L.jacket, M(0, 0.72, 0)],
    [G('collar', () => new THREE.TorusGeometry(0.28, 0.1, 6, 16).rotateX(Math.PI / 2)), L.flap, M(0, 1.02, 0)],
  ]));
  // head: glossy dark sphere, chrome glasses, ushanka + earmuffs in one mesh; face as a decal
  const head = new THREE.Group();
  head.position.y = 1.55;
  body.add(head);
  head.add(merged([
    [G('head', () => new THREE.SphereGeometry(0.62, 20, 14)), L.skin],
    [G('frame', () => new THREE.TorusGeometry(0.17, 0.035, 6, 14)), '#e8edf5', M(-0.24, 0.02, 0.63, 1.15, 0.85, 1)],
    [G('frame', () => new THREE.TorusGeometry(0.17, 0.035, 6, 14)), '#e8edf5', M(0.24, 0.02, 0.63, 1.15, 0.85, 1)],
    [G('crown', () => new THREE.CylinderGeometry(0.72, 0.8, 0.62, 18)), L.hat, M(0, 0.62, 0)],
    [G('band', () => new THREE.TorusGeometry(0.79, 0.14, 8, 22).rotateX(Math.PI / 2)), L.hat, M(0, 0.34, 0)],
    [G('muff', () => new THREE.SphereGeometry(0.24, 10, 8)), L.flap, M(-0.7, -0.05, -0.02, 0.6, 1, 0.95)],
    [G('muff', () => new THREE.SphereGeometry(0.24, 10, 8)), L.flap, M(0.7, -0.05, -0.02, 0.6, 1, 0.95)],
  ]));
  const face = new THREE.Mesh(G('face', () => new THREE.PlaneGeometry(0.9, 0.45)), new THREE.MeshBasicNodeMaterial({ map: faceTex, transparent: true }));
  face.position.set(0, -0.02, 0.6);
  head.add(face);
  // limbs
  const hands = [-1, 1].map((s) => add(body, G('hand', () => new THREE.SphereGeometry(0.14, 10, 8)), '#f6f7fb', s * 0.46, 0.66, 0.05));
  const feet = [-1, 1].map((s) => { const f = add(root, G('foot', () => new THREE.SphereGeometry(0.15, 10, 8)), L.shoes, s * 0.17, 0.08, 0.02); f.scale.set(1, 0.6, 1.4); return f; });
  const legs = [-1, 1].map((s) => add(root, G('leg', () => new THREE.CapsuleGeometry(0.1, 0.18, 3, 8)), L.pants, s * 0.15, 0.3, 0));
  // shovel for digging
  const shovel = new THREE.Group();
  add(shovel, G('shaft', () => new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5)), '#8a5a33', 0, 0.35, 0);
  add(shovel, G('blade', () => new THREE.BoxGeometry(0.22, 0.28, 0.04)), '#c9d2dc', 0, -0.18, 0);
  hands[1].add(shovel);
  shovel.visible = false;
  // blob shadow
  const shadow = new THREE.Mesh(G('shadow', () => new THREE.CircleGeometry(0.62, 16).rotateX(-Math.PI / 2)), new THREE.MeshBasicNodeMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.position.y = 0.04;
  root.add(shadow);

  let t = 0, walkT = 0, speed = 0;
  return {
    root,
    update(dt, anim, moving, emote) {
      t += dt;
      speed += ((moving ? 1 : 0) - speed) * Math.min(1, dt * 10);
      walkT += dt * 11 * speed;
      const s = Math.sin(walkT), c = Math.abs(Math.cos(walkT));
      body.position.y = Math.abs(s) * 0.1 * speed;
      body.rotation.set(0.08 * speed, 0, s * 0.06 * speed);
      head.rotation.set(0, 0, 0);
      feet[0].position.set(-0.17, 0.08 + Math.max(0, s) * 0.14 * speed, s * 0.22 * speed);
      feet[1].position.set(0.17, 0.08 + Math.max(0, -s) * 0.14 * speed, -s * 0.22 * speed);
      legs[0].position.set(-0.15, 0.3, feet[0].position.z * 0.5);
      legs[1].position.set(0.15, 0.3, feet[1].position.z * 0.5);
      hands[0].position.set(-0.46, 0.66 + c * 0.04 * speed, 0.05 + s * 0.2 * speed);
      hands[1].position.set(0.46, 0.66 + c * 0.04 * speed, 0.05 - s * 0.2 * speed);
      shovel.visible = anim === 'dig';
      if (anim === 'dig') {
        const k = Math.sin(t * 9);
        body.rotation.x = 0.25 + k * 0.12;
        hands[1].position.set(0.3, 0.55 + k * 0.18, 0.4);
        hands[0].position.set(-0.1, 0.6 + k * 0.15, 0.4);
        shovel.rotation.x = 0.8 + k * 0.4;
      }
      const e = emote ?? (anim === 'cheer' ? 'cheer' : null);
      if (e === 'cheer' || e === 'dance') {
        body.position.y = Math.abs(Math.sin(t * 8)) * 0.35;
        hands[0].position.set(-0.5, 1.9 + Math.sin(t * 12) * 0.1, 0.1);
        hands[1].position.set(0.5, 1.9 + Math.cos(t * 12) * 0.1, 0.1);
        if (e === 'dance') body.rotation.y = Math.sin(t * 5) * 0.6;
      } else if (e === 'wave') {
        hands[1].position.set(0.55, 1.75 + Math.sin(t * 14) * 0.12, 0.2);
      } else if (e === 'sad') {
        head.rotation.x = 0.35; body.position.y = -0.06;
      } else if (e === 'shrug') {
        hands[0].position.set(-0.62, 1.05, 0.25); hands[1].position.set(0.62, 1.05, 0.25);
        head.rotation.z = 0.15;
      }
      if (!moving && !e && anim !== 'dig') body.scale.y = 1 + Math.sin(t * 2.2) * 0.015; else body.scale.y = 1;
    },
  };
}
