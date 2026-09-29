// The island. Kept light by instancing everything that repeats (one draw call
// per kind), but dense: a GPU grass field that follows the camera, forest
// clumps, bushes, ferns, rocks, flowers and crystals, patchy ground colour,
// shoreline foam, and real sun shadows (see render.js).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, uniformArray, vec2, vec3, vec4, float, ivec2, floor, fract, sin, cos, mix, smoothstep, step, clamp, textureLoad,
  positionLocal, positionWorld, cameraPosition, normalize, reflect, dot, max, pow, distance, Loop, select, vertexStage, instanceIndex, hash,
  mx_noise_float, cameraViewMatrix, abs, screenCoordinate, frameId,
} from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { height, SIZE, MESAS, pathDist } from '../shared/world.js';
import { makeNoise } from '../shared/noise.js';
import { SUN_DIR } from './render.js';

const N = makeNoise(99);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 3-step cel ramp for the characters (the world uses soft Lambert light)
export const toonRamp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
export const toon = (opts) => new THREE.MeshToonNodeMaterial({ gradientMap: toonRamp, ...opts });

const C = (h) => new THREE.Color(h);
const PAL = {
  sand: C('#f2d99c'), wet: C('#d9bd80'), grass: C('#8fc23a'), grassLight: C('#b8d94c'), grassDark: C('#5f9a31'),
  cliff: C('#6b6560'), cliffDark: C('#46403d'), dirt: C('#c4935a'),
};
const flat = (x, z) => { const e = 1, a = height(x, z); return Math.max(Math.abs(height(x + e, z) - a), Math.abs(height(x, z + e) - a)) < 0.35; };

// ---------------------------------------------------------------- terrain data for shaders
// RGBA float texture over the island: R height, G where grass grows, B colour patch tone
const TEX = 256;
function terrainData() {
  const data = new Float32Array(TEX * TEX * 4);
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const x = ((i + 0.5) / TEX - 0.5) * SIZE, z = ((j + 0.5) / TEX - 0.5) * SIZE;
    const h = height(x, z);
    const slope = Math.max(Math.abs(height(x + 0.8, z) - h), Math.abs(height(x, z + 0.8) - h));
    const grow = THREE.MathUtils.smoothstep(h, 1.4, 1.9) * (1 - THREE.MathUtils.smoothstep(slope, 0.3, 0.5)) * THREE.MathUtils.smoothstep(pathDist(x, z), 1.6, 3.2);
    const k = (j * TEX + i) * 4;
    data[k] = h; data[k + 1] = grow; data[k + 2] = tone(x, z);
  }
  const t = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  terrainTexture = t;
  return t;
}
// big light/dark patches, same function for ground and grass so they match
const tone = (x, z) => THREE.MathUtils.clamp(N.fbm(x * 0.035, z * 0.035, 3) * 0.9 + 0.5, 0, 1);
// shared shader helpers (TSL: compiles to WGSL on WebGPU, GLSL on the WebGL2 fallback)
const uTime = uniform(0);
const uSun = uniform(SUN_DIR);
let terrainTexture = null;
// bilinear read of the terrain texture at a world xz
const terrainAt = Fn(([w]) => {
  const uv = w.div(SIZE).add(0.5).mul(TEX).sub(0.5);
  const i = floor(uv), f = fract(uv);
  const a = ivec2(clamp(i, 0, TEX - 1)), b = ivec2(clamp(i.add(1), 0, TEX - 1));
  const p = textureLoad(terrainTexture, a), q = textureLoad(terrainTexture, ivec2(b.x, a.y));
  const r = textureLoad(terrainTexture, ivec2(a.x, b.y)), t = textureLoad(terrainTexture, b);
  return mix(mix(p, q, f.x), mix(r, t, f.x), f.y);
});
// sun glitter off a rippling surface (HDR, so it blooms)
const glitter = Fn(([p, strength, scale]) => {
  const n1 = mx_noise_float(vec3(p.x.mul(scale), p.y.mul(scale), uTime.mul(0.9)));
  const n2 = mx_noise_float(vec3(p.y.mul(scale).add(17), p.x.mul(scale), uTime.mul(0.7)));
  const n = normalize(vec3(n1.mul(strength), 1, n2.mul(strength)));
  const view = normalize(cameraPosition.sub(positionWorld));
  const r = reflect(view.negate(), n);
  return pow(max(dot(r, uSun), 0), 220).mul(9);
});

function terrain() {
  const seg = 220;
  const geo = new THREE.PlaneGeometry(SIZE + 60, SIZE + 60, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), up = nrm.getY(i);
    const t = tone(x, z);
    if (y < 0.6) c.copy(PAL.wet).lerp(PAL.sand, Math.max(0, y / 0.6));
    else if (y < 1.35) c.copy(PAL.sand);
    else c.copy(PAL.grassDark).lerp(PAL.grass, THREE.MathUtils.smoothstep(t, 0.15, 0.55)).lerp(PAL.grassLight, THREE.MathUtils.smoothstep(t, 0.6, 0.95));
    if (y >= 1.35 && y < 1.6) c.lerp(PAL.sand, (1.6 - y) / 0.25);
    if (up < 0.72 && y > 0.8) c.copy(PAL.cliff).lerp(PAL.cliffDark, THREE.MathUtils.clamp((1 - up) * 1.6, 0, 1));
    if (pathDist(x, z) < 2.2 && y > 1.2 && up > 0.8) c.lerp(PAL.dirt, 0.85);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
  // fine speckle and rock striations so the ground isn't a flat sheet; the tide line is wet and sparkles
  const h = positionWorld.y;
  const speck = mx_noise_float(positionWorld.xz.mul(2.3)).mul(0.5).add(0.5).mul(0.6).add(mx_noise_float(positionWorld.xz.mul(7)).mul(0.5).add(0.5).mul(0.4));
  const wet = smoothstep(1.0, 0.55, h).mul(smoothstep(0.1, 0.3, h));
  mat.colorNode = vec3(float(0.9).add(speck.mul(0.18)).mul(mix(float(1), float(0.62), wet)));
  mat.emissiveNode = vec3(1.0, 0.8, 0.6).mul(glitter(positionWorld.xz, 0.5, 3.0)).mul(wet);
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

function water() {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true });
  mat.colorNode = Fn(() => {
    const inside = step(abs(positionWorld.x), SIZE / 2).mul(step(abs(positionWorld.z), SIZE / 2));
    const ground = mix(float(-8), terrainAt(positionWorld.xz).x, inside);
    const depth = clamp(float(0.25).sub(ground).div(2.5), 0, 1);
    const base = mix(vec3(0.20, 0.62, 0.66), vec3(0.06, 0.24, 0.42), smoothstep(0.0, 0.6, depth));
    // at a low sun the sea mirrors the sky: more pink-gold toward the horizon
    const view = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(float(1).sub(max(view.y, 0)), 3);
    const col = mix(base, vec3(1.0, 0.66, 0.55), fres.mul(0.75)).toVar();
    const rim = smoothstep(0.035, 0.0, depth);
    const wave = smoothstep(0.8, 1.0, sin(depth.mul(45).sub(uTime.mul(2.2)).add(mx_noise_float(positionWorld.xz.mul(0.3)).mul(4)))).mul(smoothstep(0.18, 0.02, depth));
    col.assign(mix(col, vec3(1.0, 0.93, 0.88), clamp(rim.mul(0.8).add(wave.mul(0.55)), 0, 1)));
    col.addAssign(vec3(1.0, 0.85, 0.65).mul(glitter(positionWorld.xz, 0.45, 1.6)));
    return col;
  })();
  mat.opacityNode = float(0.94);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.25;
  return m;
}

// puffy lavender clouds sitting on the horizon
function clouds() {
  const blobs = [];
  for (let k = 0; k < 7; k++) blobs.push(lumpy(new THREE.IcosahedronGeometry(1, 2), 0.1, k + 60).scale(1 + (k % 3) * 0.3, 0.8, 1).translate((k - 3) * 1.25, (k % 2) * 0.55 + (k === 3) * 0.6, (k % 3) * 0.3));
  const geo = mergeGeometries(blobs.map((g) => { g.deleteAttribute('uv'); return g; }));
  const mat = new THREE.MeshBasicNodeMaterial({ fog: false });
  // soft shading: plum underside, pink-lit top, brighter toward the sun
  mat.colorNode = Fn(() => {
    const up = positionLocal.y.add(1).div(2.6);
    const c = mix(vec3(0.40, 0.33, 0.66), vec3(0.95, 0.78, 0.92), smoothstep(0.15, 1.0, up));
    const toSun = max(dot(normalize(positionWorld.sub(cameraPosition)), uSun), 0);
    return c.add(vec3(1.0, 0.72, 0.5).mul(pow(toSun, 12).mul(0.25)));
  })();
  const spots = [];
  for (let i = 0; i < 11; i++) {
    const a = Math.PI / 2 + (i / 11 - 0.5) * 2.4 + (rnd() - 0.5) * 0.2; // spread across the view, toward the sun
    const r = 230 + rnd() * 50;
    spots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: 34 + rnd() * 40, s: 4 + rnd() * 3.5 });
  }
  return instanced(geo, mat, spots, (d, s) => { d.position.set(s.x, s.y, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.set(s.s * 1.4, s.s, s.s); });
}

// glowing motes drifting in the sunlight around the player
function motes() {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.OctahedronGeometry(0.035, 0));
  const n = 170, inst = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { inst[i * 3] = (rnd() - 0.5) * 40; inst[i * 3 + 1] = (rnd() - 0.5) * 40; inst[i * 3 + 2] = rnd(); }
  geo.setAttribute('aMote', new THREE.InstancedBufferAttribute(inst, 3));
  geo.instanceCount = n;
  const uFocus = uniform(new THREE.Vector2());
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const m = attribute('aMote', 'vec3');
  mat.positionNode = Fn(() => {
    const wp = m.xy.add(float(40).mul(floor(uFocus.sub(m.xy).div(40).add(0.5))));
    const t = uTime.mul(0.25).add(m.z.mul(40));
    const drift = vec3(sin(t.mul(1.3)).mul(0.9), sin(t.mul(0.9).add(1.7)).mul(0.5), cos(t.mul(1.1)).mul(0.9));
    const ground = terrainAt(wp).x;
    return positionLocal.mul(0.8).add(vec3(wp.x, ground.add(m.z.mul(3.2)).add(0.4), wp.y)).add(drift);
  })();
  const twinkle = sin(uTime.mul(2.3).add(m.z.mul(60))).mul(0.5).add(0.5);
  mat.colorNode = vec3(2.2, 1.5, 0.8).mul(twinkle.mul(0.8).add(0.2));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, uFocus };
}

// ---------------------------------------------------------------- grass field (GPU)
// One draw call: blades live in a square patch that wraps around the focus
// point, get their height and colour from the terrain texture, and sway.
const PATCH = 60;
function grassField() {
  const blade = new THREE.BufferGeometry();
  // tapered, slightly bent blade: 2 segments + tip
  const w = 0.055;
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, -w * 0.7, 0.45, 0.06, w * 0.7, 0.45, 0.06, 0, 1, 0.2], 3));
  blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(15).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const MAX = 110000;
  const geo = new THREE.InstancedBufferGeometry().copy(blade);
  const inst = new Float32Array(MAX * 3);
  for (let i = 0; i < MAX; i++) { inst[i * 3] = (rnd() - 0.5) * PATCH; inst[i * 3 + 1] = (rnd() - 0.5) * PATCH; inst[i * 3 + 2] = rnd(); }
  geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(inst, 3));
  geo.instanceCount = MAX;
  const uFocus = uniform(new THREE.Vector2());
  const holes = Array.from({ length: 24 }, () => new THREE.Vector3()); // dug holes clear the grass: x, z, radius
  const uHoles = uniformArray(holes, 'vec3');
  const b = attribute('aBlade', 'vec3');
  const wp = b.xy.add(float(PATCH).mul(floor(uFocus.sub(b.xy).div(PATCH).add(0.5))));
  const T = terrainAt(wp);
  const mat = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  mat.positionNode = Fn(() => {
    const edge = float(1).sub(smoothstep(PATCH * 0.34, PATCH * 0.5, distance(wp, uFocus)));
    const r = b.z;
    const s = step(fract(r.mul(91.7)), T.y).mul(edge).mul(r.mul(0.7).add(0.6)).toVar();
    Loop(24, ({ i }) => {
      const hl = uHoles.element(i);
      s.mulAssign(select(hl.z.greaterThan(0), smoothstep(hl.z.mul(0.75), hl.z.mul(1.15), distance(wp, hl.xy)), float(1)));
    });
    const a = r.mul(43);
    const p = positionLocal;
    const rx = p.x.mul(cos(a)).sub(p.z.mul(sin(a))), rz = p.x.mul(sin(a)).add(p.z.mul(cos(a)));
    const wind = sin(uTime.mul(1.8).add(wp.x.mul(0.22)).add(wp.y.mul(0.17))).mul(0.6).add(sin(uTime.mul(3.1).add(wp.x.mul(0.7)).add(r.mul(6))).mul(0.25));
    const bend = wind.mul(0.16).mul(p.y).mul(p.y);
    return vec3(wp.x, T.x.sub(0.02), wp.y).add(vec3(rx.add(bend), p.y, rz).mul(vec3(s.mul(1.25), s.mul(T.z.mul(0.16).add(0.2)), s.mul(1.25))));
  })();
  // both sides lit like the ground (no dark back faces)
  mat.normalNode = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
  // same palette as the ground, darker at the root
  const tone = vertexStage(T.z), rr = vertexStage(b.z), hgt = vertexStage(positionLocal.y);
  const cDark = uniform(PAL.grassDark.clone().multiplyScalar(1.05)), cMid = uniform(PAL.grass.clone().multiplyScalar(1.08)), cLight = uniform(PAL.grassLight.clone());
  const tip = mix(mix(cDark, cMid, smoothstep(0.15, 0.55, tone)), cLight, smoothstep(0.6, 0.95, tone));
  mat.colorNode = mix(tip.mul(0.62), tip.mul(1.1), smoothstep(0.0, 0.9, hgt)).mul(rr.mul(0.2).add(0.9));
  const dbg = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('debug') : null;
  if (dbg === 'grass-unlit') { const m2 = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide }); m2.positionNode = mat.positionNode; m2.colorNode = mat.colorNode; mat.dispose(); Object.assign(mat, {}); geo.userData.dbgMat = m2; }
  if (dbg === 'grass-noshadow') mat.userData.noShadow = true;
  const mesh = new THREE.Mesh(geo, geo.userData.dbgMat ?? mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = dbg !== 'grass-noshadow';
  return {
    mesh, uFocus, parts: { tone, rr, hgt, tip, T, b, wp }, setDensity: (f) => { geo.instanceCount = Math.floor(MAX * f); },
    /** holes near the camera: [{ x, z, r }] */
    setHoles(list) { for (let k = 0; k < holes.length; k++) { const h = list[k]; holes[k].set(h ? h.x : 0, h ? h.z : 0, h ? h.r : 0); } },
  };
}

// Foliage close to the camera dissolves (screen-door dither) so it never blocks the view
function seeThrough(mat, near = 3.5, far = 8) {
  const d = distance(positionWorld, cameraPosition);
  // changes every frame, so temporal anti-aliasing averages it into smooth transparency
  const dither = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096)).add(float(frameId).mod(64).mul(7919)));
  mat.alphaTest = 0.5;
  mat.opacityNode = step(dither, smoothstep(near, far, d)); // keep a pixel when it is farther than its dither threshold
}

// Wind sway for instanced foliage (vertex only)
function windy(mat, amount) {
  const phase = hash(instanceIndex).mul(6.28);
  mat.positionNode = positionLocal.add(vec3(sin(uTime.mul(1.4).add(phase)).mul(amount).mul(max(positionLocal.y, 0)), 0, 0));
}

// vertex-coloured, merged geometry from parts [geometry, colour, darkenBottom]
function baked(parts) {
  return mergeGeometries(parts.map(([g0, color, ao = 0]) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    g.computeBoundingBox();
    const { min, max } = g.boundingBox, c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = g.attributes.position.getY(i), k = 1 - ao * (1 - (y - min.y) / Math.max(0.001, max.y - min.y)); // fake occlusion underneath
      col.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }));
}
const lumpy = (g0, amt, seedOff) => {
  // weld shared corners so the lump shades round instead of faceted
  g0.deleteAttribute('uv'); g0.deleteAttribute('normal');
  const g = mergeVertices(g0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 1 + N.noise(x * 2.1 + seedOff, y * 2.1 + z * 1.7) * amt;
    p.setXYZ(i, x * n, y * n, z * n);
  }
  g.computeVertexNormals();
  return g;
};

function instanced(geo, mat, spots, fn) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const d = new THREE.Object3D();
  spots.forEach((s, i) => { fn(d, s, i); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); });
  mesh.count = spots.length;
  return mesh;
}

function scatter(n, accept, minGap, tries = n * 12) {
  const out = [];
  for (let i = 0; i < tries && out.length < n; i++) {
    const x = (rnd() - 0.5) * (SIZE - 16), z = (rnd() - 0.5) * (SIZE - 16), h = height(x, z);
    if (!accept(x, z, h)) continue;
    if (minGap && out.some((s) => Math.abs(s.x - x) < minGap && Math.abs(s.z - z) < minGap && Math.hypot(s.x - x, s.z - z) < minGap)) continue;
    out.push({ x, z, h });
  }
  return out;
}
const spawnClear = (x, z) => Math.hypot(x, z - 84) > 14;
const open = (x, z, h) => h > 1.6 && flat(x, z) && pathDist(x, z) > 3;
const land = (x, z, h) => open(x, z, h) && spawnClear(x, z);

// ---------------------------------------------------------------- forests
function forests() {
  // trees grow in clumps where a forest noise is high
  const forestMask = (x, z) => N.fbm(x * 0.018 + 5, z * 0.018 - 3, 3);
  const spots = scatter(620, (x, z, h) => land(x, z, h) && forestMask(x, z) > 0.05, 1.9, 20000);
  const lumps = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2, rr = k === 0 ? 0 : 0.75 + (k % 3) * 0.15;
    const y = k === 0 ? 3.3 : 2.3 + (k % 3) * 0.45;
    lumps.push([lumpy(new THREE.IcosahedronGeometry(k === 0 ? 1.25 : 0.95 - (k % 2) * 0.12, 1), 0.14, k).translate(Math.cos(a) * rr, y, Math.sin(a) * rr), '#ffffff', 0.55]);
  }
  const crownGeo = baked(lumps);
  const crownMat = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
  windy(crownMat, 0.025);
  seeThrough(crownMat, 4, 10);
  const trunkGeo = baked([[new THREE.CylinderGeometry(0.16, 0.28, 2.4, 6).translate(0, 1.2, 0), '#6b4a33', 0.3]]);
  const greens = ['#3d7d3f', '#4a8c44', '#34703a', '#5a9a47', '#2f6636'].map(C), autumn = ['#d99a4a', '#c9853c', '#e0b25a'].map(C);
  const scale = (s) => 0.7 + (N.noise(s.x * 0.3, s.z * 0.3) * 0.5 + 0.5) * 0.7;
  const crowns = instanced(crownGeo, crownMat, spots, (d, s) => { d.position.set(s.x, s.h - 0.15, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(scale(s)); });
  const trunkMat = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
  seeThrough(trunkMat, 4, 10);
  const trunks = instanced(trunkGeo, trunkMat, spots, (d, s) => { d.position.set(s.x, s.h - 0.15, s.z); d.scale.setScalar(scale(s)); });
  spots.forEach((s, i) => crowns.setColorAt(i, (N.noise(s.x * 0.05 + 9, s.z * 0.05) > 0.45 ? autumn : greens)[i % (N.noise(s.x * 0.05 + 9, s.z * 0.05) > 0.45 ? 3 : 5)]));
  for (const m of [crowns, trunks]) { m.castShadow = true; m.receiveShadow = true; }
  return { meshes: [crowns, trunks], spots };
}

// ---------------------------------------------------------------- small props
function props(treeSpots) {
  const near = (x, z, r) => treeSpots.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r);
  const meshes = [];
  const lambert = () => new THREE.MeshLambertNodeMaterial({ vertexColors: true });

  // bushes: low lumpy clumps, often at forest edges
  const bushGeo = baked([0, 1, 2, 3].map((k) => [lumpy(new THREE.IcosahedronGeometry(0.55 - k * 0.06, 1), 0.15, k + 20).translate(Math.cos(k * 1.9) * 0.45, 0.35 + (k === 0) * 0.25, Math.sin(k * 1.9) * 0.45), '#ffffff', 0.5]));
  const bushSpots = scatter(420, (x, z, h) => open(x, z, h) && Math.hypot(x, z - 84) > 5 && (near(x, z, 5) || rnd() < 0.3), 1.2);
  const bushMat = lambert();
  seeThrough(bushMat, 2.5, 6);
  const bushes = instanced(bushGeo, bushMat, bushSpots, (d, s) => { d.position.set(s.x, s.h - 0.05, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.7 + rnd() * 0.8); });
  bushSpots.forEach((_, i) => bushes.setColorAt(i, C(['#4f8f3a', '#5f9e3f', '#467f36', '#7aa84a'][i % 4])));
  bushes.castShadow = true;
  meshes.push(bushes);

  // ferns: star of splayed leaves
  const leaf = new THREE.PlaneGeometry(0.22, 0.9, 1, 3).translate(0, 0.45, 0);
  const lp = leaf.attributes.position;
  for (let i = 0; i < lp.count; i++) { const y = lp.getY(i); lp.setX(i, lp.getX(i) * (1 - y * 0.9)); lp.setZ(i, y * y * 0.35); }
  const fernGeo = baked([0, 1, 2, 3, 4, 5, 6].map((k) => [leaf.clone().rotateX(-0.65).rotateY((k / 7) * Math.PI * 2), '#ffffff', 0.45]));
  const fernMat = new THREE.MeshLambertNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
  windy(fernMat, 0.06);
  const fernSpots = scatter(520, (x, z, h) => open(x, z, h), 1.0);
  const ferns = instanced(fernGeo, fernMat, fernSpots, (d, s) => { d.position.set(s.x, s.h, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.8 + rnd() * 0.7); });
  fernSpots.forEach((_, i) => ferns.setColorAt(i, C(['#7fb04a', '#6aa23f', '#93bf55'][i % 3])));
  ferns.castShadow = true;
  meshes.push(ferns);

  // rocks
  const rockGeo = baked([[lumpy(new THREE.DodecahedronGeometry(0.5, 1), 0.18, 40).scale(1, 0.62, 0.9), '#ffffff', 0.35]]);
  const rockSpots = scatter(220, (x, z, h) => h > 1.1 && spawnClear(x, z) && pathDist(x, z) > 2.5, 2);
  const rocks = instanced(rockGeo, lambert(), rockSpots, (d, s) => { d.position.set(s.x, s.h - 0.08, s.z); d.rotation.set(rnd() * 0.4, rnd() * 6, rnd() * 0.4); d.scale.setScalar(0.4 + rnd() * rnd() * 2.2); });
  rockSpots.forEach((_, i) => rocks.setColorAt(i, C(['#9a948c', '#888078', '#aaa39a'][i % 3])));
  rocks.castShadow = true; rocks.receiveShadow = true;
  meshes.push(rocks);

  // flower clusters (red and white) and little blue crystals
  const petal = new THREE.IcosahedronGeometry(0.07, 0);
  const cluster = baked([0, 1, 2, 3, 4].map((k) => [petal.clone().translate(Math.cos(k * 2.4) * 0.22 * (k > 0), 0.14 + (k % 2) * 0.05, Math.sin(k * 2.4) * 0.22 * (k > 0)), '#ffffff', 0]));
  const flowerSpots = scatter(1400, (x, z, h) => open(x, z, h) && N.noise(x * 0.07 + 30, z * 0.07) > 0.05, 0.6);
  const flowers = instanced(cluster, new THREE.MeshLambertNodeMaterial({ vertexColors: true, emissive: '#221111' }), flowerSpots, (d, s) => { d.position.set(s.x, s.h, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.8 + rnd() * 0.6); });
  flowerSpots.forEach((_, i) => flowers.setColorAt(i, C(i % 5 === 0 ? '#fff5e0' : i % 7 === 0 ? '#ffd23f' : '#e5383b')));
  meshes.push(flowers);

  const crystalGeo = baked([0, 1, 2].map((k) => [new THREE.OctahedronGeometry(0.12 - k * 0.025, 0).scale(1, 1.8, 1).rotateZ((k - 1) * 0.35).translate((k - 1) * 0.12, 0.16, 0), '#ffffff', 0]));
  const crystalSpots = scatter(260, (x, z, h) => open(x, z, h), 1.5);
  const crystals = instanced(crystalGeo, new THREE.MeshLambertNodeMaterial({ vertexColors: true, emissive: '#1a2a9a', emissiveIntensity: 0.6 }), crystalSpots, (d, s) => { d.position.set(s.x, s.h - 0.03, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.8 + rnd() * 0.8); });
  crystalSpots.forEach((_, i) => crystals.setColorAt(i, C(i % 3 ? '#3a5cff' : '#6a8cff')));
  meshes.push(crystals);

  return { meshes };
}

function mesas(scene) {
  // a flag on every company mesa
  for (const m of MESAS) {
    const top = height(m.x, m.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 6), new THREE.MeshLambertNodeMaterial({ color: '#f5f1e8' }));
    pole.position.set(m.x, top + 2.5, m.z);
    pole.castShadow = true;
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#0210ef'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#fff'; g.font = '700 64px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(m.ticker, 128, 68);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5).translate(1.5, 0, 0), new THREE.MeshBasicNodeMaterial({ map: tex, side: THREE.DoubleSide }));
    flag.position.set(m.x, top + 4.2, m.z);
    scene.add(pole, flag);
  }
}

export function buildIsland(scene) {
  terrainData();
  scene.add(terrain());
  scene.add(water());
  const f = forests(); scene.add(...f.meshes);
  const p = props(f.spots); scene.add(...p.meshes);
  const grass = grassField(); scene.add(grass.mesh);
  const dust = motes(); scene.add(dust.mesh);
  scene.add(clouds());
  mesas(scene);
  return {
    grass,
    update(time, focus) {
      uTime.value = time;
      grass.uFocus.value.set(focus.x, focus.z);
      dust.uFocus.value.set(focus.x, focus.z);
    },
  };
}
