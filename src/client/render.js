// Renderer, lighting, sun shadows that follow the camera, and the finishing
// pass (tone mapping, miniature-style blur at the top and bottom of the
// screen, vignette). Three quality tiers; the game steps down automatically
// when a device can't hold the frame rate.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const TIERS = {
  high: { pixelRatio: 1.5, shadowMap: 2048, post: true, grass: 1 },
  medium: { pixelRatio: 1, shadowMap: 1024, post: false, grass: 0.5 },
  low: { pixelRatio: 0.75, shadowMap: 0, post: false, grass: 0.2 },
};
const ORDER = ['high', 'medium', 'low'];

// Separable blur whose radius grows away from a horizontal focus band. The
// second (vertical) pass also adds a vignette and a touch of saturation.
const TiltShift = (horizontal) => ({
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.5 }, uBand: { value: 0.24 }, uMax: { value: 2.2 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uFocus, uBand, uMax; varying vec2 vUv;
    void main(){
      float d = vUv.y > uFocus ? vUv.y - uFocus : (uFocus - vUv.y) * 0.6; // blur the far (top) edge more than the near one
      float r = uMax * smoothstep(uBand, uBand + 0.32, d);
      vec2 dir = ${horizontal ? 'vec2(1.0, 0.0)' : 'vec2(0.0, 1.0)'} * r / uRes;
      vec4 c = texture2D(tDiffuse, vUv) * 0.2270270270;
      c += (texture2D(tDiffuse, vUv + dir * 1.3846153846) + texture2D(tDiffuse, vUv - dir * 1.3846153846)) * 0.3162162162;
      c += (texture2D(tDiffuse, vUv + dir * 3.2307692308) + texture2D(tDiffuse, vUv - dir * 3.2307692308)) * 0.0702702703;
      ${horizontal ? '' : `
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.12);                       // a little more colour
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - dot(q, q) * 0.55;                         // soft vignette`}
      gl_FragColor = c;
    }`,
});

export function makeRenderer(container, { tier: forced } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // count the whole frame (shadow + scene + finishing passes)
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = new THREE.Color('#9fd3ef');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 70, 190);
  const hemi = new THREE.HemisphereLight('#d8ecff', '#7f9a3c', 1.25);
  const sun = new THREE.DirectionalLight('#fff0d2', 2.9);
  const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();
  const S = 34; // shadow box half-size around the focus
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 160 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);

  // finishing pass
  const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const blurH = new ShaderPass(TiltShift(true)), blurV = new ShaderPass(TiltShift(false));
  composer.addPass(blurH); composer.addPass(blurV);
  composer.addPass(new OutputPass());

  let tierName = forced && TIERS[forced] ? forced : (matchMedia('(pointer: coarse)').matches || innerWidth < 700 ? 'medium' : 'high');
  let tier = TIERS[tierName];
  const listeners = [];
  function applyTier() {
    const pr = Math.min(devicePixelRatio, tier.pixelRatio);
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    renderer.shadowMap.enabled = tier.shadowMap > 0;
    sun.castShadow = tier.shadowMap > 0;
    if (tier.shadowMap && sun.shadow.mapSize.x !== tier.shadowMap) {
      sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); // shadow on/off changes shaders
    resize();
    for (const f of listeners) f(tier, tierName);
  }
  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    // tall phone screens: keep ~52 deg of horizontal view
    camera.fov = Math.min(70, Math.max(36, (2 * Math.atan(Math.tan((52 * Math.PI) / 360) / camera.aspect) * 180) / Math.PI));
    camera.updateProjectionMatrix();
    const w = innerWidth * renderer.getPixelRatio(), h = innerHeight * renderer.getPixelRatio();
    blurH.uniforms.uRes.value.set(w, h); blurV.uniforms.uRes.value.set(w, h);
  }
  addEventListener('resize', resize);

  // keep the shadow box centred on what we look at, snapped to shadow texels so edges don't shimmer
  const right = new THREE.Vector3().crossVectors(SUN_DIR, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, SUN_DIR).normalize();
  const f = new THREE.Vector3();
  function followSun(focus) {
    if (!sun.castShadow) return;
    const texel = (2 * S) / tier.shadowMap;
    const a = Math.round(focus.dot(right) / texel) * texel, b = Math.round(focus.dot(up) / texel) * texel, c = focus.dot(SUN_DIR);
    f.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(SUN_DIR, c);
    sun.target.position.copy(f);
    sun.position.copy(f).addScaledVector(SUN_DIR, 80);
  }

  // automatic step-down: average frame time over ~2.5s windows
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
    renderer, scene, camera, sun,
    get tier() { return tierName; },
    setTier(name) { if (TIERS[name]) { tierName = name; tier = TIERS[name]; applyTier(); } },
    onTier(fn) { listeners.push(fn); fn(tier, tierName); },
    render(focus, dt, now) {
      followSun(focus);
      renderer.info.reset();
      if (tier.post) composer.render(); else renderer.render(scene, camera);
      watchFps(dt, now);
    },
    info: () => ({ tier: tierName, shadows: renderer.shadowMap.enabled, post: tier.post, calls: renderer.info.render.calls }),
  };
}
