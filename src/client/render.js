// three.js WebGPU renderer (automatic WebGL2 fallback) with a cinematic
// finish: ambient occlusion, temporal anti-aliasing, bloom, depth of field
// focused on the player, and colour grading. Golden-hour light: a low sun
// ahead of the camera throws long shadows toward you, purple shade, warm rims.
// Three quality tiers; the game steps down automatically when it can't keep up.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, uniform, vec3, vec4, float, mix, smoothstep, screenUV, dot, luminance, clamp, positionWorld, cameraPosition, normalize, max, pow, Fn,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';

export const TIERS = {
  high: { pixelRatio: 1.5, shadowMap: 2048, post: 'full', grass: 1 },
  medium: { pixelRatio: 1, shadowMap: 1024, post: 'lite', grass: 0.5 },
  low: { pixelRatio: 0.75, shadowMap: 0, post: 'lite', grass: 0.2 },
};
const ORDER = ['high', 'medium', 'low'];

// golden hour
export const SUN_DIR = new THREE.Vector3(-0.3, 0.17, 0.94).normalize(); // toward the sun: low over the southern sea, ahead of the camera
const SKY = { zenith: new THREE.Color('#7d6cc4'), mid: new THREE.Color('#e59bb0'), horizon: new THREE.Color('#ffc796'), sun: new THREE.Color('#fff1c9') };
export const FOG_COLOR = new THREE.Color('#e7a9a6');

function skyDome() {
  const sunDir = uniform(SUN_DIR);
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  mat.colorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition));
    const h = dir.y;
    const low = mix(uniform(SKY.horizon), uniform(SKY.mid), smoothstep(0.0, 0.18, h));
    const col = mix(low, uniform(SKY.zenith), smoothstep(0.15, 0.7, h)).toVar();
    const s = max(dot(dir, sunDir), 0.0);
    col.addAssign(vec3(1.0, 0.72, 0.45).mul(pow(s, 6.0).mul(0.45)));      // wide warm glow
    col.addAssign(uniform(SKY.sun).mul(pow(s, 120.0).mul(1.6)));             // halo
    col.addAssign(uniform(SKY.sun).mul(smoothstep(0.9993, 0.9996, s).mul(6.0))); // the disc (blooms)
    return col;
  })();
  const m = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

export async function makeRenderer(container, { tier: forced, backend } = {}) {
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance', forceWebGL: backend === 'webgl' });
  await renderer.init();
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps colours saturated (AgX washed the blues out)
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // count the whole frame (shadow + scene + post)
  container.appendChild(renderer.domElement);
  const backendName = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl';

  const scene = new THREE.Scene();
  scene.background = FOG_COLOR.clone();
  scene.fog = new THREE.Fog(FOG_COLOR, 90, 380);
  const sky = skyDome();
  scene.add(sky);
  const hemi = new THREE.HemisphereLight('#bdb0d8', '#7a6258', 0.9); // lavender sky fill, plum bounce
  const sun = new THREE.DirectionalLight('#ffc89e', 5.4);
  let S = 36; // shadow box half-size around the focus (grows for the overhead view)
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 220 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  // camera-side fill: keeps backlit faces readable (warm bounce, no shadows)
  const fill = new THREE.DirectionalLight('#ffc9b8', 0.5);
  scene.add(hemi, sun, sun.target, fill, fill.target);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.3, 450);

  // ---------------------------------------------------------------- finishing chain
  const pipeline = new THREE.RenderPipeline(renderer);
  const focus = { distance: uniform(12), range: uniform(22), bokeh: uniform(0.9) };
  const grade = (img) => {
    // art-directed golden hour: lavender shade, peach highlights, greens pulled
    // toward warm sage so they sit with the sand, gentle filmic contrast, soft vignette
    const c = img.rgb.toVar();
    const l = luminance(c);
    c.addAssign(vec3(0.03, 0.01, 0.045).mul(float(1).sub(smoothstep(0.0, 0.45, l))));
    const green = clamp(c.g.sub(max(c.r, c.b)).mul(2.2), 0, 0.5);
    c.assign(mix(c, vec3(l.mul(1.02), l.mul(1.03), l.mul(0.86)), green));
    const split = mix(vec3(0.95, 0.93, 1.06), vec3(1.05, 1.0, 0.93), smoothstep(0.1, 0.75, l));
    const sat = mix(vec3(l), c.mul(split), 1.06);
    const contrast = sat.sub(0.32).mul(1.06).add(0.32).max(0);
    const q = screenUV.sub(0.5);
    const vig = float(1).sub(dot(q, q).mul(0.55));
    return vec4(clamp(contrast, 0, 64).mul(vig), 1);
  };
  const passes = {};
  function buildChain(kind) {
    const scenePass = pass(scene, camera);
    let img;
    if (kind === 'full') {
      scenePass.setMRT(mrt({ output, normal: normalView, velocity }));
      const color = scenePass.getTextureNode('output'), depth = scenePass.getTextureNode('depth');
      const aoPass = ao(depth, scenePass.getTextureNode('normal'), camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.9;
      const shaded = vec4(color.rgb.mul(mix(float(1), aoPass.getTextureNode().r, 0.8)), 1);
      const aa = sharpen(traa(shaded, depth, scenePass.getTextureNode('velocity'), camera), 0.35); // TAA softens; sharpen back
      const glow = bloom(aa, 0.22, 0.35, 1.05); // only true highlights (sun, glitter, motes, fire) glow
      const lit = aa.add(glow);
      img = dof(lit, scenePass.getViewZNode(), focus.distance, focus.range, focus.bokeh);
      Object.assign(passes, { ao: aoPass, traa: aa, bloom: glow, dof: img });
    } else {
      const color = scenePass.getTextureNode('output');
      const glow = bloom(color, 0.2, 0.35, 1.05);
      img = color.add(glow);
      Object.assign(passes, { ao: null, traa: null, bloom: glow, dof: null });
    }
    pipeline.outputNode = grade(img);
    pipeline.needsUpdate = true;
  }

  let tierName = forced && TIERS[forced] ? forced : (matchMedia('(pointer: coarse)').matches || innerWidth < 700 ? 'medium' : 'high');
  let tier = TIERS[tierName];
  const listeners = [];
  function applyTier() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, tier.pixelRatio));
    renderer.shadowMap.enabled = tier.shadowMap > 0;
    sun.castShadow = tier.shadowMap > 0;
    if (tier.shadowMap && sun.shadow.mapSize.x !== tier.shadowMap) {
      sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    buildChain(tier.post);
    resize();
    for (const f of listeners) f(tier, tierName);
  }
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = Math.min(70, Math.max(40, (2 * Math.atan(Math.tan((58 * Math.PI) / 360) / camera.aspect) * 180) / Math.PI));
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  // shadow box follows the focus, snapped to shadow texels so edges don't shimmer
  const right = new THREE.Vector3().crossVectors(SUN_DIR, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, SUN_DIR).normalize();
  const f = new THREE.Vector3(), fwd = new THREE.Vector3(), tmpV = new THREE.Vector3();
  function followSun(at) {
    sky.position.copy(camera.position);
    fill.position.copy(camera.position).add(tmpV.set(0, 6, 0)); fill.target.position.copy(at);
    if (!sun.castShadow) return;
    const texel = (2 * S) / tier.shadowMap;
    const a = Math.round(at.dot(right) / texel) * texel, b = Math.round(at.dot(up) / texel) * texel, c = at.dot(SUN_DIR);
    f.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(SUN_DIR, c);
    sun.target.position.copy(f);
    sun.position.copy(f).addScaledVector(SUN_DIR, 110);
  }

  let acc = 0, frames = 0, lastDrop = 0;
  function watchFps(dt, now) {
    acc += dt; frames++;
    if (acc < 2.5) return;
    const fps = frames / acc; acc = 0; frames = 0;
    if (fps < 45 && now - lastDrop > 4000 && tierName !== 'low' && !forced) {
      tierName = ORDER[ORDER.indexOf(tierName) + 1]; tier = TIERS[tierName]; lastDrop = now;
      applyTier();
    }
  }

  applyTier();
  return {
    renderer, scene, camera, sun, backend: backendName, focus,
    get tier() { return tierName; },
    setTier(name) { if (TIERS[name]) { tierName = name; tier = TIERS[name]; applyTier(); } },
    /** shadow box half-size around the focus: small and sharp up close, wide from overhead */
    setShadowExtent(half) {
      half = Math.round(half);
      if (half === S) return;
      S = half;
      Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, far: 220 + S * 2 });
      sun.shadow.camera.updateProjectionMatrix();
    },
    onTier(fn) { listeners.push(fn); fn(tier, tierName); },
    render(at, dt, now) {
      followSun(at);
      focus.distance.value = camera.getWorldDirection(fwd).dot(tmpV.copy(at).sub(camera.position));
      renderer.info.reset();
      pipeline.render();
      watchFps(dt, now);
    },
    info: () => ({ tier: tierName, backend: backendName, shadows: renderer.shadowMap.enabled, post: tier.post, ao: !!passes.ao, traa: !!passes.traa, bloom: !!passes.bloom, dof: !!passes.dof, grade: true, calls: renderer.info.render.drawCalls ?? renderer.info.render.calls }),
  };
}
