// Loads the Blender-made chibi (public/models/chibi.glb) and turns it into a
// cheap, recolourable, animated character:
//  - per bone, all rigid parts merge into ONE vertex-coloured toon mesh
//    (the glowing head skin stays separate), about 8 draw calls per character
//  - material names drive per-look recolouring (Hat, Flap, Jacket, ...)
//  - the exported actions (idle, walk, dig, cheer, wave, sad) play via a mixer
import * as THREE from 'three';
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

const geoCache = new Map();
function coloredGeometry(key, parts, look) {
  const ck = `${key}|${look}`;
  if (geoCache.has(ck)) return geoCache.get(ck);
  const L = LOOKS[look] ?? LOOKS.racer;
  const geos = parts.map((g) => {
    const c = new THREE.Color(L[g.userData.mat] ?? FIXED[g.userData.mat] ?? '#ff00ff');
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    const out = g.clone();
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  });
  const merged = mergeGeometries(geos);
  geoCache.set(ck, merged);
  return merged;
}

const partMat = toon({ vertexColors: true });
let skinMat = null;

export function makeChibi(look = 'racer') {
  const T = template;
  // rebuild a light hierarchy: bone nodes only (named, so clips bind)
  const nodes = {};
  const clone = (src, parent) => {
    const n = new THREE.Object3D();
    n.name = src.name; n.position.copy(src.position); n.quaternion.copy(src.quaternion); n.scale.copy(src.scale);
    parent?.add(n);
    for (const c of src.children) if (BONES.includes(c.name) || c.children.some((cc) => BONES.includes(cc.name))) clone(c, n);
    if (BONES.includes(src.name)) nodes[src.name] = n;
    return n;
  };
  const armatureRoot = T.bones.root.parent ?? T.bones.root;
  const top = clone(armatureRoot, null);
  const root = new THREE.Group();
  root.add(top);
  let shovel = null;
  for (const [key, parts] of Object.entries(T.groups)) {
    const [bone, tag] = key.split('#');
    const mesh = new THREE.Mesh(coloredGeometry(key, parts, look), partMat);
    nodes[bone].add(mesh);
    if (tag === 'shovel') { shovel = mesh; mesh.visible = false; }
  }
  for (const [bone, parts] of Object.entries(T.skinGroups)) {
    skinMat ??= new THREE.MeshToonMaterial({ gradientMap: toonRamp, color: '#14151f', emissive: '#4aa8ff', emissiveMap: parts[0].userData.emissiveMap, emissiveIntensity: 1.3 });
    nodes[bone].add(new THREE.Mesh(parts.length > 1 ? mergeGeometries(parts) : parts[0], skinMat));
  }
  // blob shadow (cheaper than shadow maps)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.2, depthWrite: false }));
  shadow.position.y = 0.04;
  root.add(shadow);

  const mixer = new THREE.AnimationMixer(top);
  const actions = Object.fromEntries(T.clips.map((c) => [c.name, mixer.clipAction(c)]));
  let current = null;
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
    update(dt, anim, moving, emote) {
      const want = anim === 'dig' ? 'dig' : emote === 'cheer' || emote === 'dance' || anim === 'cheer' ? 'cheer' : emote === 'wave' ? 'wave' : emote === 'sad' ? 'sad' : moving ? 'walk' : 'idle';
      play(want);
      if (shovel) shovel.visible = want === 'dig';
      mixer.update(dt);
    },
  };
}
