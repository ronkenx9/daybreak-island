// The Daybreak bean: one glossy round body in a single strong colour, a big
// face on the front, a hat, headphones and a little backpack (so it reads from
// behind, which is how players mostly see it), nub arms and feet.
// Built in code as ONE skinned mesh per character (bones: body, arms, feet,
// eyes), animated procedurally: waddle, squash and stretch, blinks, digging,
// cheering. Detector and shovel are small extra meshes on the right arm.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalView, positionViewDirection, dot, float, pow, uniform, clamp } from 'three/tsl';

// body, hat, hat band / accent. The six agents share the palette of the brand
// characters: white, charcoal, green, purple, blue, orange.
export const LOOKS = {
  cloud: { body: '#f3ede2', hat: '#e8c46a', band: '#ff7aa2', hatKind: 'straw' },
  midnight: { body: '#34313f', hat: '#ff7a2e', band: '#ff7a2e', hatKind: 'beanie' },
  electric: { body: '#28c06a', hat: '#ffd23f', band: '#1b1a22', hatKind: 'bucket' },
  orbit: { body: '#8b5cf6', hat: '#f1ece2', band: '#8b5cf6', hatKind: 'explorer' },
  racer: { body: '#2a86ff', hat: '#e5383b', band: '#ffffff', hatKind: 'cap' },
  afterhours: { body: '#ff7a2e', hat: '#26242e', band: '#26242e', hatKind: 'beanie' },
};
export const HEIGHT = 2.35; // top of the hat, for name tags and bubbles

const INK = '#1b1a22', WHITE = '#ffffff', BLUSH = '#ff8a9a', PHONES = '#24263a', PACK = '#c99a5c', STRAP = '#7a5634';
const R = { x: 0.8, y: 0.84, z: 0.76 }; // body ellipsoid radii
const BODY_Y = 0.98; // body centre above the ground at rest
const BONES = ['root', 'body', 'eyes', 'happy', 'arm_L', 'arm_R', 'foot_L', 'foot_R'];
const B = Object.fromEntries(BONES.map((b, i) => [b, i]));
// bone rest positions (parent-relative); body is the pivot at the base of the body
const REST = {
  root: [null, 0, 0, 0], body: ['root', 0, 0.16, 0],
  eyes: ['body', 0, BODY_Y - 0.16 + 0.12, 0], happy: ['body', 0, BODY_Y - 0.16 + 0.12, 0],
  arm_L: ['body', 0.74, BODY_Y - 0.16 - 0.12, 0.05], arm_R: ['body', -0.74, BODY_Y - 0.16 - 0.12, 0.05],
  foot_L: ['root', 0.3, 0, 0.05], foot_R: ['root', -0.3, 0, 0.05],
};
const restWorld = (b) => { const [p, x, y, z] = REST[b]; const v = new THREE.Vector3(x, y, z); return p ? v.add(restWorld(p)) : v; };

// ---------------------------------------------------------------- geometry helpers
const col = new THREE.Color();
function part(geo, color, bone) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  col.set(color);
  for (let i = 0; i < n; i++) { c.set([col.r, col.g, col.b], i * 3); idx[i * 4] = B[bone]; w[i * 4] = 1; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return g;
}
// a point on the body surface (azimuth a from the front, elevation e) and its outward normal, in root space
function onBody(a, e, lift = 0) {
  const p = new THREE.Vector3(R.x * Math.cos(e) * Math.sin(a), R.y * Math.sin(e), R.z * Math.cos(e) * Math.cos(a));
  const n = new THREE.Vector3(p.x / R.x ** 2, p.y / R.y ** 2, p.z / R.z ** 2).normalize();
  return { p: p.addScaledVector(n, lift).add(new THREE.Vector3(0, BODY_Y, 0)), n };
}
// orient geometry so its +z faces along n, then move it to p
function stick(geo, { p, n }, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const m = new THREE.Matrix4().compose(p, q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin)), new THREE.Vector3(1, 1, 1));
  return geo.applyMatrix4(m);
}
const disc = (rx, ry, depth, seg = 20) => new THREE.SphereGeometry(1, seg, Math.max(6, seg >> 1)).scale(rx, ry, depth);

function hatParts(L) {
  const top = BODY_Y + R.y, parts = [];
  const add = (g, c) => parts.push(part(g, c, 'body'));
  if (L.hatKind === 'straw') {
    add(new THREE.CylinderGeometry(0.98, 1.04, 0.05, 40).translate(0, top - 0.12, 0), L.hat); // wide brim
    add(new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, top - 0.12, 0), L.hat);
    add(new THREE.CylinderGeometry(0.505, 0.505, 0.09, 32, 1, true).translate(0, top - 0.06, 0), L.band);
  } else if (L.hatKind === 'bucket') {
    add(new THREE.CylinderGeometry(0.5, 0.78, 0.2, 36).translate(0, top - 0.14, 0), L.hat);
    add(new THREE.CylinderGeometry(0.46, 0.5, 0.3, 36).translate(0, top + 0.1, 0), L.hat);
    add(new THREE.SphereGeometry(0.46, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1).translate(0, top + 0.25, 0), L.hat);
    add(new THREE.CylinderGeometry(0.505, 0.505, 0.07, 32, 1, true).translate(0, top - 0.02, 0), L.band);
  } else if (L.hatKind === 'cap') {
    add(new THREE.SphereGeometry(0.62, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1).translate(0, top - 0.2, 0), L.hat);
    add(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 28, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.25).translate(0, top - 0.18, 0.5), L.hat); // bill
    add(new THREE.SphereGeometry(0.07, 12, 8).translate(0, top + 0.19, 0), L.band); // button
  } else if (L.hatKind === 'beanie') {
    add(new THREE.SphereGeometry(0.66, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.78, 1).translate(0, top - 0.24, 0), L.hat);
    add(new THREE.TorusGeometry(0.64, 0.09, 10, 40).rotateX(Math.PI / 2).translate(0, top - 0.22, 0), L.hat); // cuff
    add(new THREE.SphereGeometry(0.16, 16, 12).translate(0, top + 0.3, 0), L.band); // pom
  } else if (L.hatKind === 'explorer') {
    add(new THREE.SphereGeometry(0.58, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1.05).translate(0, top - 0.16, 0), L.hat);
    add(new THREE.CylinderGeometry(0.86, 0.9, 0.04, 40).scale(1, 1, 1.08).translate(0, top - 0.16, 0), L.hat);
    add(new THREE.CylinderGeometry(0.585, 0.585, 0.08, 32, 1, true).translate(0, top - 0.1, 0), L.band);
  }
  return parts;
}

const geoCache = new Map();
function beanGeometry(look) {
  if (geoCache.has(look)) return geoCache.get(look);
  const L = LOOKS[look] ?? LOOKS.racer, parts = [];
  const add = (g, c, bone = 'body') => parts.push(part(g, c, bone));
  // body
  add(new THREE.SphereGeometry(1, 64, 44).scale(R.x, R.y, R.z).translate(0, BODY_Y, 0), L.body);
  // face: eyes (white, big pupil, two highlights), brows, blush, mouth
  for (const s of [-1, 1]) {
    const a = s * 0.36, e = 0.14;
    add(stick(disc(0.17, 0.2, 0.06), onBody(a, e, 0.0)), WHITE, 'eyes');
    add(stick(disc(0.12, 0.15, 0.05), onBody(a - s * 0.02, e - 0.02, 0.035)), INK, 'eyes');
    add(stick(disc(0.045, 0.045, 0.03, 12), onBody(a + s * 0.03, e + 0.06, 0.07)), WHITE, 'eyes');
    add(stick(disc(0.022, 0.022, 0.02, 10), onBody(a - s * 0.05, e - 0.06, 0.07)), WHITE, 'eyes');
    add(stick(new THREE.TorusGeometry(0.11, 0.028, 8, 16, Math.PI), onBody(a, e - 0.02, 0.03)), INK, 'happy'); // ^ ^
    add(stick(new THREE.CapsuleGeometry(0.03, 0.14, 4, 8).rotateZ(Math.PI / 2 + s * 0.18), onBody(a, e + 0.25, 0.02)), INK, 'body');
    add(stick(disc(0.12, 0.07, 0.02), onBody(s * 0.55, -0.06, 0.0)), BLUSH, 'body');
  }
  add(stick(new THREE.TorusGeometry(0.07, 0.022, 8, 16, Math.PI).rotateZ(Math.PI), onBody(0, -0.02, 0.01)), INK, 'body'); // smile
  // headphones: cups high on the sides, band over the top
  const cupE = 0.5, cx = R.x * Math.cos(cupE) + 0.03, cy = BODY_Y + R.y * Math.sin(cupE);
  const bandR = Math.hypot(cx, cy - BODY_Y), a0 = Math.atan2(cy - BODY_Y, cx);
  add(new THREE.TorusGeometry(bandR + 0.04, 0.05, 10, 40, Math.PI - 2 * a0).rotateZ(a0).translate(0, BODY_Y, 0), PHONES);
  for (const s of [-1, 1]) {
    const tilt = -s * (Math.PI / 2 - cupE);
    add(new THREE.CylinderGeometry(0.21, 0.21, 0.15, 24).rotateZ(tilt).translate(s * cx, cy, 0), PHONES);
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20).rotateZ(tilt).translate(s * (cx + 0.08 * Math.sin(Math.PI / 2 - cupE)), cy + 0.08 * Math.cos(Math.PI / 2 - cupE), 0), L.band === '#ffffff' ? L.hat : L.band);
  }
  // backpack with straps and a little sieve, on the back
  const back = onBody(Math.PI, -0.12, 0.02);
  add(new THREE.BoxGeometry(0.62, 0.56, 0.26, 2, 2, 2).translate(back.p.x, back.p.y, back.p.z - 0.08), PACK);
  add(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 20, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(back.p.x, back.p.y + 0.28, back.p.z - 0.1), STRAP); // flap
  add(new THREE.TorusGeometry(0.16, 0.025, 6, 18).translate(back.p.x + 0.18, back.p.y - 0.02, back.p.z - 0.23), '#d8dde6'); // sieve rim
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 18).rotateX(Math.PI / 2).translate(back.p.x + 0.18, back.p.y - 0.02, back.p.z - 0.23), '#9aa3b2');
  for (const s of [-1, 1]) add(new THREE.TorusGeometry(R.x * 0.98, 0.035, 6, 40, Math.PI * 0.5).rotateY(Math.PI / 2).rotateX(-0.1).translate(s * 0.28, BODY_Y - 0.04, 0.02), STRAP);
  // hat
  parts.push(...hatParts(L));
  // arms: little rounded nubs hanging from the shoulders (bone space origin at the shoulder)
  for (const [bone, s] of [['arm_L', 1], ['arm_R', -1]]) {
    const o = restWorld(bone);
    add(new THREE.CapsuleGeometry(0.13, 0.26, 6, 14).rotateZ(s * 0.35).translate(o.x + s * 0.06, o.y - 0.17, o.z), L.body, bone);
  }
  // feet: dark rounded shoes
  for (const bone of ['foot_L', 'foot_R']) {
    const o = restWorld(bone);
    add(new THREE.SphereGeometry(1, 20, 12).scale(0.2, 0.13, 0.28).translate(o.x, 0.12, o.z + 0.05), INK, bone);
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  geoCache.set(look, g);
  return g;
}

// glossy soft vinyl, lit by the low sun: vertex colours, clearcoat, a warm rim
let mat = null;
function beanMaterial() {
  if (mat) return mat;
  mat = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.48, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffe2c8') });
  const facing = clamp(dot(normalView, positionViewDirection), 0, 1);
  mat.emissiveNode = uniform(new THREE.Color('#ff9a5c')).mul(pow(float(1).sub(facing), 3).mul(0.45));
  return mat;
}

// ---------------------------------------------------------------- tools
const toolMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 });
const toolCache = {};
function toolGeo(kind) {
  if (toolCache[kind]) return toolCache[kind];
  const parts = [];
  const add = (g, c) => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (!['position', 'normal'].includes(k)) q.deleteAttribute(k); const n = q.attributes.position.count, a = new Float32Array(n * 3); col.set(c); for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3); q.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(q); };
  if (kind === 'detector') {
    // grip at the origin (the hand); the coil lies flat near the ground ahead
    const coil = new THREE.Vector3(0.12, -0.7, 0.95), len = coil.length() - 0.1;
    const o = new THREE.Object3D(); o.position.copy(coil).multiplyScalar(0.5); o.lookAt(coil); o.updateMatrix();
    add(new THREE.CylinderGeometry(0.024, 0.024, len, 8).rotateX(Math.PI / 2).applyMatrix4(o.matrix), '#d7dde6');
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10).rotateX(Math.PI / 2).applyMatrix4(o.matrix.clone().setPosition(0, 0.02, 0.02)), INK);
    add(new THREE.BoxGeometry(0.15, 0.1, 0.18).translate(0, 0.1, 0.16), '#2f6bff');
    add(new THREE.TorusGeometry(0.22, 0.032, 8, 24).rotateX(Math.PI / 2).scale(1, 1, 0.8).translate(coil.x, coil.y, coil.z), INK);
    add(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 24).scale(1, 1, 0.8).translate(coil.x, coil.y, coil.z), '#ffcf3f');
  } else {
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 8).translate(0, -0.2, 0.25).rotateX(0.5), '#8a5a33');
    add(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 4, 1).scale(1, 1, 0.25).rotateY(Math.PI / 4).translate(0, -0.78, 0.52).rotateX(0.5), '#c9d2dc');
    add(new THREE.BoxGeometry(0.2, 0.05, 0.05).translate(0, 0.3, 0).rotateX(0.5), INK);
  }
  toolCache[kind] = mergeGeometries(parts);
  return toolCache[kind];
}
const BAR_COLORS = ['#3b4dff', '#3b4dff', '#4fc3ff', '#7dffa8', '#ffe066', '#ffcf3f'].map((c) => new THREE.Color(c));

// ---------------------------------------------------------------- character
export function makeBean(look = 'racer') {
  const root = new THREE.Group();
  const bones = {};
  for (const b of BONES) {
    const bone = new THREE.Bone(); bone.name = b;
    const [p, x, y, z] = REST[b];
    bone.position.set(x, y, z);
    (p ? bones[p] : root).add(bone);
    bones[b] = bone;
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((b) => bones[b]));
  const mesh = new THREE.SkinnedMesh(beanGeometry(look), beanMaterial());
  mesh.castShadow = true; mesh.frustumCulled = false;
  root.add(mesh);
  mesh.bind(skeleton);
  bones.happy.scale.setScalar(0.001);

  // tools in the right hand (arm bone space: hand is ~0.4 below the shoulder)
  const hand = new THREE.Group(); hand.position.set(-0.08, -0.36, 0.08); bones.arm_R.add(hand);
  const detector = new THREE.Mesh(toolGeo('detector'), toolMat); detector.castShadow = true; detector.visible = false;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8).translate(0, 0.17, 0.2), new THREE.MeshBasicNodeMaterial({ color: '#3b4dff' }));
  detector.add(led);
  const shovel = new THREE.Mesh(toolGeo('shovel'), toolMat); shovel.castShadow = true; shovel.visible = false;
  hand.add(detector, shovel);

  // soft contact shadow under the feet
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#2a1630', transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.position.y = 0.04;
  root.add(shadow);

  let t = Math.random() * 10, phase = 0, walk = 0, nextBlink = 1 + Math.random() * 3, blink = 0, happyW = 0, digW = 0, hold = 0;
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  return {
    root,
    update(dt, anim, moving, emote, scanAge = null, bars = 0) {
      t += dt;
      const digging = anim === 'dig';
      const cheer = !digging && (emote === 'cheer' || emote === 'dance' || anim === 'cheer');
      const wave = !digging && emote === 'wave', sad = !digging && emote === 'sad';
      const scanning = scanAge !== null && scanAge < 1.4 && !digging;
      const holding = !digging && !cheer && !wave && (scanning || moving || (scanAge !== null && scanAge < 8));
      walk = damp(walk, moving && !digging ? 1 : 0, 10, dt);
      digW = damp(digW, digging ? 1 : 0, 10, dt);
      happyW = damp(happyW, cheer || wave ? 1 : 0, 12, dt);
      hold = damp(hold, holding ? 1 : 0, 8, dt);
      phase += dt * 10 * walk;

      const b = bones.body, s = Math.sin(phase), c = Math.cos(phase);
      const breath = Math.sin(t * 2.2) * 0.015;
      const hop = cheer ? Math.abs(Math.sin(t * 7.5)) * 0.35 : 0;
      const dig = Math.sin(t * 7);
      b.position.y = 0.16 + Math.abs(s) * 0.09 * walk + hop;
      b.rotation.set(0.07 * walk + digW * (0.28 + dig * 0.16) + (sad ? 0.22 : 0), emote === 'dance' ? Math.sin(t * 5) * 0.4 : 0, s * 0.1 * walk);
      const squash = walk * Math.abs(c) * 0.05 + (cheer ? (1 - Math.abs(Math.sin(t * 7.5))) * 0.08 : 0) + digW * (dig > 0 ? dig * 0.05 : 0);
      b.scale.set(1 + squash * 0.5 - breath * 0.5, 1 - squash + breath, 1 + squash * 0.5 - breath * 0.5);

      // feet step; stay planted otherwise
      bones.foot_L.position.set(0.3, Math.max(0, c) * 0.1 * walk, 0.05 + s * 0.2 * walk);
      bones.foot_R.position.set(-0.3, Math.max(0, -c) * 0.1 * walk, 0.05 - s * 0.2 * walk);
      // arms: swing when walking, up when cheering, right one holds the tool
      const aL = bones.arm_L, aR = bones.arm_R;
      aL.rotation.set(-s * 0.6 * walk, 0, cheer ? 2.4 + Math.sin(t * 15) * 0.2 : sad ? -0.1 : 0.12 + breath * 3);
      const rWave = wave ? -2.5 + Math.sin(t * 12) * 0.35 : 0;
      aR.rotation.set(s * 0.6 * walk * (1 - hold) - hold * 0.55 - digW * (1.1 + dig * 0.7), 0, cheer ? -2.4 - Math.sin(t * 15) * 0.2 : rWave || -0.12);

      // tools
      detector.visible = hold > 0.05;
      detector.scale.setScalar(Math.min(1, hold * 1.2));
      if (detector.visible) {
        hand.rotation.set(hold * 0.55, -0.55 * hold + (scanning ? Math.sin(t * 9) * 0.5 : Math.sin(t * 2.2) * 0.12), 0); // off to the right, so it shows from behind
        led.material.color.copy(BAR_COLORS[Math.min(5, bars)]).multiplyScalar(scanning ? 1.2 + Math.sin(t * (6 + bars * 4)) : 0.8);
      } else hand.rotation.set(digW * 1.1, 0, 0);
      shovel.visible = digW > 0.3;

      // eyes: blink, happy ^ ^ when cheering/waving, half-shut when sad
      nextBlink -= dt;
      if (nextBlink < 0) { blink = 0.14; nextBlink = 2 + Math.random() * 3.5; }
      blink = Math.max(0, blink - dt);
      const open = (blink > 0 ? 0.08 : sad ? 0.5 : 1) * (1 - happyW);
      bones.eyes.scale.set(1, Math.max(0.001, open), 1);
      bones.happy.scale.setScalar(Math.max(0.001, happyW));
    },
  };
}
