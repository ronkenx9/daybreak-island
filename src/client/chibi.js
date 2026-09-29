// Loads the Blender-made chibi (public/models/chibi.glb) and turns it into a
// cheap, recolourable, animated character:
//  - per bone, all rigid parts merge into ONE vertex-coloured toon mesh
//    (the glowing head skin stays separate), about 8 draw calls per character
//  - material names drive per-look recolouring (Hat, Flap, Jacket, ...)
//  - the exported actions (idle, walk, dig, cheer, wave, sad) play via a mixer
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, toonRamp } from './scene.js';

export const LOOKS = {
  racer: { Hat: '#2b4dff', Flap: '#f4f6fb', Jacket: '#f4f6fb', Seam: '#c9cfdc', Pants: '#1b2a7a', Shoes: '#2b4dff', PinMark: '#e3303a' },
  midnight: { Hat: '#1d1e28', Flap: '#f4f6fb', Jacket: '#e9ebf1', Seam: '#c3c7d2', Pants: '#1c1e2a', Shoes: '#1d1e28', PinMark: '#6cc51f' },
  electric: { Hat: '#3358ff', Flap: '#f4f6fb', Jacket: '#1c2766', Seam: '#131b4a', Pants: '#e9ebf1', Shoes: '#f59e1b', PinMark: '#f59e1b' },
  cloud: { Hat: '#f1f2f6', Flap: '#f1f2f6', Jacket: '#2b4dff', Seam: '#1c35c0', Pants: '#1c1e2a', Shoes: '#f3f5fa', PinMark: '#2f9bff' },
  orbit: { Hat: '#e9ebf1', Flap: '#e9ebf1', Jacket: '#1463d6', Seam: '#0d48a0', Pants: '#e9ebf1', Shoes: '#15151c', PinMark: '#1463d6' },
  afterhours: { Hat: '#2c2c34', Flap: '#2c2c34', Jacket: '#2c2c34', Seam: '#1b1b21', Pants: '#0f0f14', Shoes: '#d7dbe3', PinMark: '#d7dbe3' },
};
const FIXED = { EyeWhite: '#ffffff', Pupil: '#0b0b10', Pin: '#ffffff', Chrome: '#dfe6f0', Glove: '#f6f7fb', Wood: '#8a5a33', Steel: '#c9d2dc', Skin: '#14151f' };
const BONES = ['root', 'hips', 'spine', 'head', 'arm_L', 'arm_R', 'leg_L', 'leg_R'];

let template = null;
export async function loadChibi(url = '/models/chibi.glb') {
  if (template) return template;
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bones = {};
  root.traverse((o) => { if (BONES.includes(o.name)) bones[o.name] = o; });
  // gather each bone's rigid parts in the bone's local space, tagged by material
  const groups = {};
  const skinGroups = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    let b = o.parent; while (b && !BONES.includes(b.name)) b = b.parent;
    if (!b) return;
    const inv = new THREE.Matrix4().copy(b.matrixWorld).invert();
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry.clone().applyMatrix4(m);
    const matName = o.material.name;
    const shovel = /Shovel/.test(o.name);
    if (matName === 'Skin') {
      g.userData.emissiveMap = o.material.emissiveMap;
      (skinGroups[b.name] ??= []).push(g);
      return;
    }
    const keep = ['position', 'normal'];
    for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    const flat = g.index ? g.toNonIndexed() : g; // toNonIndexed drops userData
    flat.userData.mat = matName;
    (groups[`${b.name}${shovel ? '#shovel' : ''}`] ??= []).push(flat);
  });
  template = { bones, groups, skinGroups, clips: gltf.animations, root };
  return template;
}

// Each character draws as 2 skinned meshes (body parts + glowing head) instead
// of ~8 rigid pieces: the rigid parts are baked into the armature's rest pose
// with weight 1 on their bone. Shovel and detector are small extra meshes on
// the right hand, drawn only while digging / scanning.
const geoCache = new Map();
let restCache = null;
function rest(T) {
  // each bone's rest transform relative to the armature node, and to the character root
  if (restCache) return restCache;
  const rig = T.bones.root.parent;
  const rigInv = new THREE.Matrix4().copy(rig.matrixWorld).invert();
  restCache = { rig: {}, root: {} };
  for (const b of BONES) {
    restCache.rig[b] = new THREE.Matrix4().multiplyMatrices(rigInv, T.bones[b].matrixWorld);
    restCache.root[b] = T.bones[b].matrixWorld.clone();
  }
  return restCache;
}
const paint = (g, color) => {
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
};
const skinTo = (g, boneIndex) => {
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { idx[i * 4] = boneIndex; w[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return g;
};
function bodyGeometry(T, look) {
  const ck = `body|${look}`;
  if (geoCache.has(ck)) return geoCache.get(ck);
  const L = LOOKS[look] ?? LOOKS.racer, R = rest(T).rig, parts = [];
  for (const [key, geos] of Object.entries(T.groups)) {
    const [bone, tag] = key.split('#');
    if (tag) continue; // shovel is its own mesh
    for (const g of geos) parts.push(skinTo(paint(g.clone().applyMatrix4(R[bone]), new THREE.Color(L[g.userData.mat] ?? FIXED[g.userData.mat] ?? '#ff00ff')), BONES.indexOf(bone)));
  }
  const merged = mergeGeometries(parts);
  geoCache.set(ck, merged);
  return merged;
}
function headGeometry(T) {
  if (geoCache.has('head')) return geoCache.get('head');
  const R = rest(T).rig, parts = [];
  for (const [bone, geos] of Object.entries(T.skinGroups)) {
    for (const g0 of geos) {
      const g = (g0.index ? g0.toNonIndexed() : g0.clone()).applyMatrix4(R[bone]);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      parts.push(skinTo(g, BONES.indexOf(bone)));
    }
  }
  const merged = parts.length > 1 ? mergeGeometries(parts) : parts[0];
  geoCache.set('head', merged);
  return merged;
}
function shovelGeometry(T) {
  if (geoCache.has('shovel')) return geoCache.get('shovel');
  const g = mergeGeometries((T.groups['arm_R#shovel'] ?? []).map((p) => paint(p.clone(), new THREE.Color(FIXED[p.userData.mat] ?? '#999'))));
  geoCache.set('shovel', g);
  return g;
}

// soft felt: fabric sheen catches the low sun on every edge
const partMat = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.8, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color('#fff1e0') });
let skinMat = null;
const detectorLedMat = new THREE.MeshBasicNodeMaterial({ color: '#3b4dff' });
const BAR_COLORS = ['#3b4dff', '#3b4dff', '#4fc3ff', '#7dffa8', '#ffe066', '#ffcf3f'].map((c) => new THREE.Color(c));

export function makeChibi(look = 'racer') {
  const T = template, R = rest(T);
  // light hierarchy: bone nodes only (named, so clips bind)
  const nodes = {};
  const clone = (src, parent) => {
    const n = BONES.includes(src.name) ? new THREE.Bone() : new THREE.Object3D();
    n.name = src.name; n.position.copy(src.position); n.quaternion.copy(src.quaternion); n.scale.copy(src.scale);
    parent?.add(n);
    for (const c of src.children) if (BONES.includes(c.name) || c.children.some((cc) => BONES.includes(cc.name))) clone(c, n);
    if (BONES.includes(src.name)) nodes[src.name] = n;
    return n;
  };
  const rig = clone(T.bones.root.parent, null);
  const root = new THREE.Group();
  root.add(rig);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((b) => nodes[b])); // inverses from the rest pose
  const body = new THREE.SkinnedMesh(bodyGeometry(T, look), partMat);
  // glossy dark head with glowing cracks
  skinMat ??= new THREE.MeshPhysicalNodeMaterial({ color: '#14151f', roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.2, emissive: '#4aa8ff', emissiveMap: Object.values(T.skinGroups)[0]?.[0]?.userData.emissiveMap, emissiveIntensity: 2.2 });
  const head = new THREE.SkinnedMesh(headGeometry(T), skinMat);
  for (const m of [body, head]) { rig.add(m); m.bind(skeleton); m.castShadow = true; m.frustumCulled = false; }

  // tools on the right hand (bone-local)
  const shovel = new THREE.Mesh(shovelGeometry(T), partMat);
  shovel.visible = false; shovel.castShadow = true;
  nodes.arm_R.add(shovel);
  const detector = makeDetector(R.root.arm_R);
  detector.pivot.visible = false;
  nodes.arm_R.add(detector.pivot);

  // blob shadow: a soft contact shadow under the feet (real shadows come from the sun)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#000', transparent: true, opacity: 0.16, depthWrite: false }));
  shadow.position.y = 0.04;
  root.add(shadow);

  const mixer = new THREE.AnimationMixer(rig);
  const actions = Object.fromEntries(T.clips.map((c) => [c.name, mixer.clipAction(c)]));
  let current = null, t = 0;
  const play = (name) => {
    const a = actions[name] ?? actions.idle;
    if (a === current) return;
    a.reset().fadeIn(0.15).play();
    current?.fadeOut(0.15);
    current = a;
  };
  play('idle');
  return {
    root,
    /** scanning: seconds since this player last used the detector (null if never) */
    update(dt, anim, moving, emote, scanAge = null, bars = 0) {
      t += dt;
      const want = anim === 'dig' ? 'dig' : emote === 'cheer' || emote === 'dance' || anim === 'cheer' ? 'cheer' : emote === 'wave' ? 'wave' : emote === 'sad' ? 'sad' : moving ? 'walk' : 'idle';
      play(want);
      shovel.visible = want === 'dig';
      const scanning = scanAge !== null && scanAge < 1.4 && want !== 'dig';
      // the detector stays out while hunting (walking/idle), put away for digging and emotes
      detector.pivot.visible = (want === 'idle' || want === 'walk') && (scanning || moving || scanAge !== null && scanAge < 8);
      mixer.update(dt);
      if (detector.pivot.visible) detector.sweep(scanning ? Math.sin(t * 9) * 0.55 : Math.sin(t * 2.2) * 0.12, BAR_COLORS[Math.min(5, bars)], scanning ? 0.6 + 0.4 * Math.sin(t * (6 + bars * 4)) : 0.35);
    },
  };
}

// Metal detector: grip at the right hand, shaft reaching forward-down, flat
// search coil near the ground, control box with a signal light. Built in the
// character's root space, then expressed in the arm bone's local space.
const detGeoCache = {};
function makeDetector(armRest) {
  if (!detGeoCache.body) {
    const parts = [];
    const add = (geo, color, pos, look) => {
      const m = new THREE.Object3D(); m.position.copy(pos);
      if (look) m.lookAt(look);
      m.updateMatrix();
      const g = geo.clone().applyMatrix4(m.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
      parts.push(paint(g.index ? g.toNonIndexed() : g, new THREE.Color(color)));
    };
    const grip = new THREE.Vector3(0, 0, 0), coil = new THREE.Vector3(-0.08, -0.56, 0.78);
    const len = grip.distanceTo(coil) - 0.08;
    const mid = grip.clone().lerp(coil, 0.5);
    add(new THREE.CylinderGeometry(0.022, 0.022, len, 6).rotateX(Math.PI / 2), '#c9d2dc', mid, coil); // shaft
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 8).rotateX(Math.PI / 2), '#1c1e2a', grip.clone().add(new THREE.Vector3(0, 0.03, -0.02)), coil); // grip
    add(new THREE.BoxGeometry(0.13, 0.09, 0.16), '#2b4dff', grip.clone().add(new THREE.Vector3(0, 0.1, 0.12)), null); // control box
    add(new THREE.TorusGeometry(0.2, 0.03, 6, 20).rotateX(Math.PI / 2).scale(1, 1, 0.8), '#1c1e2a', coil, null); // coil ring
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20).scale(1, 1, 0.8), '#ffcf3f', coil, null); // coil plate
    detGeoCache.body = mergeGeometries(parts);
    detGeoCache.led = new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.16, 0.16);
  }
  // grip sits at the hand; convert root-space placement to arm-bone space
  const hand = new THREE.Vector3(0.47, 0.6, 0.06);
  const inv = new THREE.Matrix4().copy(armRest).invert();
  const pivot = new THREE.Group();
  pivot.position.copy(hand.clone().applyMatrix4(inv));
  const armQ = new THREE.Quaternion(); armRest.decompose(new THREE.Vector3(), armQ, new THREE.Vector3());
  const baseQ = armQ.clone().invert(); // undo the arm's rest rotation so the tool is upright in root space
  pivot.quaternion.copy(baseQ);
  const up = new THREE.Vector3(0, 1, 0);
  const body = new THREE.Mesh(detGeoCache.body, partMat);
  body.castShadow = true;
  const led = new THREE.Mesh(detGeoCache.led, detectorLedMat.clone());
  pivot.add(body, led);
  const q = new THREE.Quaternion();
  return {
    pivot,
    sweep(angle, color, glow) {
      pivot.quaternion.copy(baseQ).multiply(q.setFromAxisAngle(up, angle));
      led.material.color.copy(color).multiplyScalar(0.6 + glow);
    },
  };
}
