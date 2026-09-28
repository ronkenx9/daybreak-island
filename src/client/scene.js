// The island, rendered cheaply: cel-shaded toon materials, baked vertex
// colours, instanced trees and grass tufts, one water plane, no post stack.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { height, SIZE, MESAS, pathDist } from '../shared/world.js';
import { makeNoise } from '../shared/noise.js';

const N = makeNoise(99);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 3-step cel ramp shared by every toon material
export const toonRamp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
export const toon = (opts) => new THREE.MeshToonMaterial({ gradientMap: toonRamp, ...opts });

const C = (h) => new THREE.Color(h);
const PAL = {
  sand: C('#f1dfae'), wet: C('#d8bf86'), grass: C('#a6d24d'), grass2: C('#8cc243'), grassDark: C('#6fa83a'),
  cliff: C('#6f6a66'), cliffDark: C('#524d4a'), dirt: C('#d9b77f'),
};

function terrain() {
  const seg = 160;
  const geo = new THREE.PlaneGeometry(SIZE + 60, SIZE + 60, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), up = nrm.getY(i);
    const n = N.fbm(x * 0.03, z * 0.03, 3) * 0.5 + 0.5;
    if (y < 0.6) c.copy(PAL.wet).lerp(PAL.sand, Math.max(0, y / 0.6));
    else if (y < 1.3) c.copy(PAL.sand);
    else c.copy(PAL.grass).lerp(PAL.grass2, n).lerp(PAL.grassDark, Math.max(0, N.noise(x * 0.09, z * 0.09)) * 0.5);
    if (up < 0.72 && y > 0.8) c.copy(PAL.cliff).lerp(PAL.cliffDark, 1 - up);
    if (pathDist(x, z) < 2.2 && y > 1.2 && up > 0.8) c.lerp(PAL.dirt, 0.85);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, toon({ vertexColors: true }));
  return m;
}

function water() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        float r = length(vW.xz * vec2(1.0, 0.95));
        float shore = smoothstep(126.0, 96.0, r);
        vec3 c = mix(vec3(0.10, 0.50, 0.82), vec3(0.27, 0.80, 0.90), shore);
        float lap = sin(r * 0.8 - uTime * 1.6) * 0.5 + 0.5;
        float foam = smoothstep(0.85, 1.0, lap) * smoothstep(98.0, 108.0, r) * smoothstep(118.0, 110.0, r);
        vec2 g = floor(vW.xz * 0.6 + vec2(uTime * 0.3, 0.0));
        float glint = step(0.985, h(g)) * 0.35;
        gl_FragColor = vec4(c + foam * 0.6 + glint, 0.92);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.25;
  return m;
}

// Wind sway for instanced foliage (cheap: vertex-only)
function windy(mat, amount) {
  const uTime = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        float s = sin(uTime * 1.6 + ip.x * 0.35 + ip.z * 0.25);
        transformed.x += s * ${amount.toFixed(3)} * max(position.y, 0.0);`);
  };
  return uTime;
}

function place(filter, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const x = (rnd() - 0.5) * (SIZE - 16), z = (rnd() - 0.5) * (SIZE - 16), h = height(x, z);
    if (filter(x, z, h)) return { x, z, h };
  }
  return null;
}
const flat = (x, z) => { const e = 1, a = height(x, z); return Math.max(Math.abs(height(x + e, z) - a), Math.abs(height(x, z + e) - a)) < 0.35; };

function trees() {
  const spots = [];
  for (let i = 0; i < 1600 && spots.length < 340; i++) {
    const p = place((x, z, h) => h > 1.6 && N.fbm(x * 0.02 + 5, z * 0.02 - 3, 3) > 0.1 && pathDist(x, z) > 4 && flat(x, z) && Math.hypot(x, z - 84) > 14);
    if (p && spots.every((s) => Math.hypot(s.x - p.x, s.z - p.z) > 2.4)) spots.push(p);
  }
  // one crown = 5 lumps merged; one trunk; both instanced
  const lumps = [];
  for (const [x, y, z, r] of [[0, 2.5, 0, 1.25], [0.8, 2.1, 0.3, 0.9], [-0.7, 2.2, -0.4, 0.95], [0.2, 3.3, -0.2, 0.9], [-0.3, 2.0, 0.8, 0.85]]) {
    lumps.push(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
  }
  const crownGeo = mergeGeometries(lumps);
  const crownMat = toon({ color: '#ffffff' });
  const uTime = windy(crownMat, 0.03);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0), toon({ color: '#5a3d2b' }), spots.length);
  const greens = ['#2f6b4c', '#3a7a55', '#2a5f45', '#44825a'].map(C), autumn = ['#e0a655', '#d18e45'].map(C);
  const d = new THREE.Object3D();
  spots.forEach((s, i) => {
    const sc = 0.75 + rnd() * 0.5;
    d.position.set(s.x, s.h - 0.1, s.z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(sc); d.updateMatrix();
    crowns.setMatrixAt(i, d.matrix); trunks.setMatrixAt(i, d.matrix);
    crowns.setColorAt(i, rnd() < 0.13 ? autumn[i % 2] : greens[i % 4]);
  });
  return { meshes: [crowns, trunks], uTime, spots };
}

function grass() {
  // tufts: 5 pointed blades splayed outward so they read as a clump from the
  // high camera (upright planes looked like sticks); dark base, light tip
  const blade = new THREE.BufferGeometry();
  blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.09, 0, 0, 0.09, 0, 0, 0, 0.5, 0], 3));
  blade.setAttribute('color', new THREE.Float32BufferAttribute([0.72, 0.72, 0.72, 0.72, 0.72, 0.72, 1.12, 1.12, 1.12], 3));
  blade.computeVertexNormals();
  const parts = [0, 1, 2, 3, 4].map((k) => {
    const b = blade.clone().rotateX(-0.55 - (k % 2) * 0.2).rotateY((k * Math.PI * 2) / 5 + 0.3);
    b.getAttribute('normal').array.fill(0).forEach((_, i, a) => { if (i % 3 === 1) a[i] = 1; }); // light blades like the ground
    return b;
  });
  const geo = mergeGeometries(parts);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide });
  const uTime = windy(mat, 0.25);
  const n = 7000;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const d = new THREE.Object3D();
  let k = 0;
  for (let i = 0; i < n * 6 && k < n; i++) {
    const x = (rnd() - 0.5) * (SIZE - 10), z = (rnd() - 0.5) * (SIZE - 10), h = height(x, z);
    if (h < 1.5 || !flat(x, z) || pathDist(x, z) < 2.5) continue;
    d.position.set(x, h, z); d.rotation.set(0, rnd() * 6, 0); d.scale.setScalar(0.7 + rnd() * 0.8); d.updateMatrix();
    mesh.setMatrixAt(k, d.matrix);
    const flower = rnd();
    mesh.setColorAt(k, flower < 0.05 ? C('#e8443a') : flower < 0.09 ? C('#3d5cf0') : C('#8cc243').offsetHSL(0, 0, (rnd() - 0.5) * 0.12));
    k++;
  }
  mesh.count = k;
  return { mesh, uTime };
}

function mesas(scene) {
  // a flag on every company mesa
  for (const m of MESAS) {
    const top = height(m.x, m.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 6), toon({ color: '#f5f1e8' }));
    pole.position.set(m.x, top + 2.5, m.z);
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
  scene.add(terrain());
  const w = water(); scene.add(w);
  const t = trees(); scene.add(...t.meshes);
  const gr = grass(); scene.add(gr.mesh);
  mesas(scene);
  return {
    update(time) { w.material.uniforms.uTime.value = time; t.uTime.value = time; gr.uTime.value = time; },
  };
}
