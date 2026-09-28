// The island. Kept light by instancing everything that repeats (one draw call
// per kind), but dense: a GPU grass field that follows the camera, forest
// clumps, bushes, ferns, rocks, flowers and crystals, patchy ground colour,
// shoreline foam, and real sun shadows (see render.js).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { height, SIZE, MESAS, pathDist } from '../shared/world.js';
import { makeNoise } from '../shared/noise.js';

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
export const toon = (opts) => new THREE.MeshToonMaterial({ gradientMap: toonRamp, ...opts });

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
  return t;
}
// big light/dark patches, same function for ground and grass so they match
const tone = (x, z) => THREE.MathUtils.clamp(N.fbm(x * 0.035, z * 0.035, 3) * 0.9 + 0.5, 0, 1);
const SAMPLE_GLSL = `
  uniform sampler2D uTerrain;
  vec4 terrainAt(vec2 w) {
    vec2 uv = (w / ${SIZE.toFixed(1)} + 0.5) * ${TEX.toFixed(1)} - 0.5;
    vec2 i = floor(uv), f = fract(uv);
    ivec2 a = ivec2(clamp(i, 0.0, ${(TEX - 1).toFixed(1)})), b = ivec2(clamp(i + 1.0, 0.0, ${(TEX - 1).toFixed(1)}));
    vec4 p = texelFetch(uTerrain, a, 0), q = texelFetch(uTerrain, ivec2(b.x, a.y), 0);
    vec4 r = texelFetch(uTerrain, ivec2(a.x, b.y), 0), s = texelFetch(uTerrain, b, 0);
    return mix(mix(p, q, f.x), mix(r, s, f.x), f.y);
  }`;
const HASH_GLSL = `
  float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y); }`;

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
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // fine speckle and rock striations so the ground doesn't read as a flat sheet
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying float vUp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vUp = normal.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWp; varying float vUp;${HASH_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sp = vnoise(vWp.xz * 2.3) * 0.6 + vnoise(vWp.xz * 7.0) * 0.4;
        diffuseColor.rgb *= 0.9 + sp * 0.18;
        if (vUp < 0.72) diffuseColor.rgb *= 0.85 + 0.3 * vnoise(vec2(vWp.y * 3.0, (vWp.x + vWp.z) * 0.4));`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

function water(terrainTex) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 }, uTerrain: { value: terrainTex } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; varying vec3 vW;${SAMPLE_GLSL}${HASH_GLSL}
      void main(){
        float ground = abs(vW.x) < ${(SIZE / 2).toFixed(1)} && abs(vW.z) < ${(SIZE / 2).toFixed(1)} ? terrainAt(vW.xz).r : -8.0;
        float depth = clamp((0.25 - ground) / 2.5, 0.0, 1.0);
        vec3 c = mix(vec3(0.25, 0.80, 0.88), vec3(0.05, 0.40, 0.80), smoothstep(0.0, 0.6, depth));
        // foam: a bright rim at the shore plus waves rolling in
        float rim = smoothstep(0.035, 0.0, depth);
        float wave = smoothstep(0.8, 1.0, sin(depth * 45.0 - uTime * 2.2 + vnoise(vW.xz * 0.3) * 4.0)) * smoothstep(0.18, 0.02, depth);
        float speck = step(0.93, vnoise(vW.xz * 1.6 + vec2(uTime * 0.4, uTime * 0.2))) * 0.25 * (1.0 - depth);
        c = mix(c, vec3(1.0), clamp(rim * 0.85 + wave * 0.6 + speck, 0.0, 1.0));
        gl_FragColor = vec4(c, 0.93);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.25;
  return m;
}

// ---------------------------------------------------------------- grass field (GPU)
// One draw call: blades live in a square patch that wraps around the focus
// point, get their height and colour from the terrain texture, and sway.
const PATCH = 60;
function grassField(terrainTex) {
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
  // same palette as the ground (Color converts the sRGB hex to linear for the shader)
  const uniforms = { uTerrain: { value: terrainTex }, uFocus: { value: new THREE.Vector2() }, uTime: { value: 0 },
    uHoles: { value: Array.from({ length: 24 }, () => new THREE.Vector3(0, 0, 0)) }, // dug holes clear the grass: x, z, radius
    uDarkG: { value: PAL.grassDark.clone().multiplyScalar(1.05) }, uMidG: { value: PAL.grass.clone().multiplyScalar(1.08) }, uLightG: { value: PAL.grassLight.clone() } };
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute vec3 aBlade; uniform vec2 uFocus; uniform float uTime; uniform vec3 uHoles[24]; varying float vH; varying float vTone; varying float vRand;${SAMPLE_GLSL}`)
      .replace('#include <begin_vertex>', `
        vec2 wp = aBlade.xy + ${PATCH.toFixed(1)} * floor((uFocus - aBlade.xy) / ${PATCH.toFixed(1)} + 0.5);
        vec4 T = terrainAt(wp);
        float edge = 1.0 - smoothstep(${(PATCH * 0.34).toFixed(1)}, ${(PATCH * 0.5).toFixed(1)}, length(wp - uFocus));
        float r = aBlade.z;
        float s = step(fract(r * 91.7), T.g) * edge * (0.6 + r * 0.7);
        for (int k = 0; k < 24; k++) { vec3 hl = uHoles[k]; if (hl.z > 0.0) s *= smoothstep(hl.z * 0.75, hl.z * 1.15, distance(wp, hl.xy)); }
        float a = r * 43.0;
        vec3 p = position;
        p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
        float wind = sin(uTime * 1.8 + wp.x * 0.22 + wp.y * 0.17) * 0.6 + sin(uTime * 3.1 + wp.x * 0.7 + r * 6.0) * 0.25;
        p.x += wind * 0.16 * position.y * position.y;
        vec3 transformed = vec3(wp.x, T.r - 0.02, wp.y) + p * vec3(s * 1.25, s * (0.2 + T.b * 0.16), s * 1.25);
        vH = position.y; vTone = T.b; vRand = r;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH; varying float vTone; varying float vRand; uniform vec3 uDarkG, uMidG, uLightG;')
      // both sides of a blade are lit like the ground (no dark back faces)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tip = mix(uDarkG, uMidG, smoothstep(0.15, 0.55, vTone));
        tip = mix(tip, uLightG, smoothstep(0.6, 0.95, vTone));
        vec3 dark = tip * 0.62, mid = tip * 1.1;
        diffuseColor.rgb = mix(dark, mid, smoothstep(0.0, 0.9, vH)) * (0.9 + vRand * 0.2);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const holes = uniforms.uHoles.value;
  return {
    mesh, uniforms, setDensity: (f) => { geo.instanceCount = Math.floor(MAX * f); },
    /** holes near the camera: [{ x, z, r }] */
    setHoles(list) { for (let k = 0; k < holes.length; k++) { const h = list[k]; holes[k].set(h ? h.x : 0, h ? h.z : 0, h ? h.r : 0); } },
  };
}

// Wind sway for instanced foliage (vertex only)
function windy(mat, amount) {
  const uTime = { value: 0 };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        float s = sin(uTime * 1.4 + ip.x * 0.35 + ip.z * 0.25);
        transformed.x += s * ${amount.toFixed(3)} * max(position.y, 0.0);`);
  };
  return uTime;
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
  const crownMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uTime = windy(crownMat, 0.025);
  const trunkGeo = baked([[new THREE.CylinderGeometry(0.16, 0.28, 2.4, 6).translate(0, 1.2, 0), '#6b4a33', 0.3]]);
  const greens = ['#3d7d3f', '#4a8c44', '#34703a', '#5a9a47', '#2f6636'].map(C), autumn = ['#d99a4a', '#c9853c', '#e0b25a'].map(C);
  const scale = (s) => 0.7 + (N.noise(s.x * 0.3, s.z * 0.3) * 0.5 + 0.5) * 0.7;
  const crowns = instanced(crownGeo, crownMat, spots, (d, s) => { d.position.set(s.x, s.h - 0.15, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(scale(s)); });
  const trunks = instanced(trunkGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), spots, (d, s) => { d.position.set(s.x, s.h - 0.15, s.z); d.scale.setScalar(scale(s)); });
  spots.forEach((s, i) => crowns.setColorAt(i, (N.noise(s.x * 0.05 + 9, s.z * 0.05) > 0.45 ? autumn : greens)[i % (N.noise(s.x * 0.05 + 9, s.z * 0.05) > 0.45 ? 3 : 5)]));
  for (const m of [crowns, trunks]) { m.castShadow = true; m.receiveShadow = true; }
  return { meshes: [crowns, trunks], uTime, spots };
}

// ---------------------------------------------------------------- small props
function props(treeSpots) {
  const near = (x, z, r) => treeSpots.some((t) => Math.abs(t.x - x) < r && Math.abs(t.z - z) < r);
  const meshes = [];
  const lambert = () => new THREE.MeshLambertMaterial({ vertexColors: true });

  // bushes: low lumpy clumps, often at forest edges
  const bushGeo = baked([0, 1, 2, 3].map((k) => [lumpy(new THREE.IcosahedronGeometry(0.55 - k * 0.06, 1), 0.15, k + 20).translate(Math.cos(k * 1.9) * 0.45, 0.35 + (k === 0) * 0.25, Math.sin(k * 1.9) * 0.45), '#ffffff', 0.5]));
  const bushSpots = scatter(420, (x, z, h) => open(x, z, h) && Math.hypot(x, z - 84) > 5 && (near(x, z, 5) || rnd() < 0.3), 1.2);
  const bushes = instanced(bushGeo, lambert(), bushSpots, (d, s) => { d.position.set(s.x, s.h - 0.05, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.7 + rnd() * 0.8); });
  bushSpots.forEach((_, i) => bushes.setColorAt(i, C(['#4f8f3a', '#5f9e3f', '#467f36', '#7aa84a'][i % 4])));
  bushes.castShadow = true;
  meshes.push(bushes);

  // ferns: star of splayed leaves
  const leaf = new THREE.PlaneGeometry(0.22, 0.9, 1, 3).translate(0, 0.45, 0);
  const lp = leaf.attributes.position;
  for (let i = 0; i < lp.count; i++) { const y = lp.getY(i); lp.setX(i, lp.getX(i) * (1 - y * 0.9)); lp.setZ(i, y * y * 0.35); }
  const fernGeo = baked([0, 1, 2, 3, 4, 5, 6].map((k) => [leaf.clone().rotateX(-0.65).rotateY((k / 7) * Math.PI * 2), '#ffffff', 0.45]));
  const fernMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const fernTime = windy(fernMat, 0.06);
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
  const flowers = instanced(cluster, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#221111' }), flowerSpots, (d, s) => { d.position.set(s.x, s.h, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.8 + rnd() * 0.6); });
  flowerSpots.forEach((_, i) => flowers.setColorAt(i, C(i % 5 === 0 ? '#fff5e0' : i % 7 === 0 ? '#ffd23f' : '#e5383b')));
  meshes.push(flowers);

  const crystalGeo = baked([0, 1, 2].map((k) => [new THREE.OctahedronGeometry(0.12 - k * 0.025, 0).scale(1, 1.8, 1).rotateZ((k - 1) * 0.35).translate((k - 1) * 0.12, 0.16, 0), '#ffffff', 0]));
  const crystalSpots = scatter(260, (x, z, h) => open(x, z, h), 1.5);
  const crystals = instanced(crystalGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#1a2a9a', emissiveIntensity: 0.6 }), crystalSpots, (d, s) => { d.position.set(s.x, s.h - 0.03, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.8 + rnd() * 0.8); });
  crystalSpots.forEach((_, i) => crystals.setColorAt(i, C(i % 3 ? '#3a5cff' : '#6a8cff')));
  meshes.push(crystals);

  return { meshes, uTime: fernTime };
}

function mesas(scene) {
  // a flag on every company mesa
  for (const m of MESAS) {
    const top = height(m.x, m.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 6), new THREE.MeshLambertMaterial({ color: '#f5f1e8' }));
    pole.position.set(m.x, top + 2.5, m.z);
    pole.castShadow = true;
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#0210ef'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#fff'; g.font = '700 64px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(m.ticker, 128, 68);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5).translate(1.5, 0, 0), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    flag.position.set(m.x, top + 4.2, m.z);
    scene.add(pole, flag);
  }
}

export function buildIsland(scene) {
  const terrainTex = terrainData();
  scene.add(terrain());
  const w = water(terrainTex); scene.add(w);
  const f = forests(); scene.add(...f.meshes);
  const p = props(f.spots); scene.add(...p.meshes);
  const grass = grassField(terrainTex); scene.add(grass.mesh);
  mesas(scene);
  return {
    grass,
    update(time, focus) {
      w.material.uniforms.uTime.value = time; f.uTime.value = time; p.uTime.value = time;
      grass.uniforms.uTime.value = time; grass.uniforms.uFocus.value.set(focus.x, focus.z);
    },
  };
}
