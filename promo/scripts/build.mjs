// Generates the promo: eight scene sub-compositions + index.html + the audio cue list.
//   node scripts/build.mjs      (then: node scripts/audio.mjs, npx hyperframes check)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SHARED = readFileSync(new URL('./shared.js', import.meta.url), 'utf8');
const W = 1920, H = 1080, FPS = 60;
const C = { paper: '#f7f4ee', ink: '#0d0b12', dim: '#9d95ab', gold: '#ffcf3f', red: '#ff5a5a', pink: '#ffb27a' };
export const AG = [
  { n: 'Sunny', c: '#efe8da', hat: 'straw', hc: '#e8c46a', role: 'sunset romantic', eyes: '^' },
  { n: 'Grit', c: '#34313f', hat: 'beanie', hc: '#ff7a2e', role: 'the grinder', eyes: '-' },
  { n: 'Pixel', c: '#28c06a', hat: 'bucket', hc: '#ffd23f', role: 'junk memelord', eyes: '*' },
  { n: 'Mara', c: '#8b5cf6', hat: 'explorer', hc: '#f1ece2', role: 'the analyst', eyes: 'o' },
  { n: 'Juno', c: '#2a86ff', hat: 'cap', hc: '#e5383b', role: 'social butterfly', eyes: 'u' },
  { n: 'Rook', c: '#ff7a2e', hat: 'beanie', hc: '#26242e', role: 'the detective', eyes: '><' },
];
const ag = Object.fromEntries(AG.map((a) => [a.n, a]));
const cues = []; // [time, kind, arg] for the sound design
const cue = (t, kind, arg) => cues.push([+t.toFixed(3), kind, arg ?? null]);

// the eight scenes, back to back (cuts on the 2 s bar at 120 BPM)
const SCENES = [
  ['s1-intro', 5], ['s2-title', 3], ['s3-roster', 5], ['s4-stats', 5], ['s5-beats', 20], ['s6-countdown', 5], ['s7-footage', 4], ['s8-end', 3],
];
let acc = 0;
const START = Object.fromEntries(SCENES.map(([id, d]) => { const s = acc; acc += d; return [id, s]; }));
const TOTAL = acc;

const bean = (a, o = {}) => `HF.bean(${JSON.stringify({ color: a.c, hat: a.hat, hatColor: a.hc, eyes: a.eyes, blush: true, ...o })})`;

// a scene file: template-wrapped root, styles, markup, and a timeline built after fonts load
function scene(id, dur, { bg, css = '', html = '', js = '' }) {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>${id}</title></head>
  <body>
    <template>
      <style>
        #root { position: absolute; inset: 0; overflow: hidden; background: ${bg}; font-family: "Montserrat", sans-serif; color: ${bg === C.paper ? C.ink : C.paper}; }
        #root .full { position: absolute; inset: 0; }
        #root canvas.dots { position: absolute; inset: 0; width: 100%; height: 100%; }
        #root .mono { font-family: "Space Mono", monospace; }
        #root svg.bean { position: absolute; overflow: visible; }
${css}
      </style>
      <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}" data-duration="${dur}">
${html}
      </div>
      <script>
${SHARED}
      (function () {
        var $ = function (s) { return document.getElementById('${id}-' + s); };
        var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll('[data-composition-id="${id}"] ' + s)); };
        var tl = gsap.timeline({ paused: true });
        function build() {
${js}
          window.__timelines["${id}"] = tl;
          if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
        }
        Promise.all([document.fonts.load('900 120px Montserrat'), document.fonts.load('700 60px Montserrat'), document.fonts.load('400 30px "Space Mono"')]).then(build, build);
      })();
      </script>
    </template>
  </body>
</html>
`;
}
// place a bean svg (size px, centre x,y) — returned as a JS statement that injects it
const put = (holder, expr, size, x, y, extra = '') => `${holder}.insertAdjacentHTML('beforeend', ${expr}.replace('<svg ', '<svg style="width:${size}px;height:${(size * 1.2).toFixed(0)}px;left:${(x - size / 2).toFixed(0)}px;top:${(y - size * 0.7).toFixed(0)}px;${extra}" '));`;

const files = {};

// ------------------------------------------------------------------ 1. intro (white)
{
  const id = 's1-intro', T = START[id];
  const spots = [[520, 700, 300, 'Sunny'], [930, 620, 380, 'Grit'], [1330, 700, 280, 'Pixel'], [330, 360, 200, 'Mara'], [1560, 380, 230, 'Juno'], [1180, 330, 170, 'Rook']];
  files[id] = scene(id, 5, {
    bg: C.paper,
    css: `#root .intro { position: absolute; left: 0; right: 0; top: 150px; text-align: center; font-weight: 700; font-size: 84px; letter-spacing: -0.02em; }
        #root .intro span { opacity: 0; }
        #root .cursor { display: inline-block; width: 6px; height: 72px; background: ${C.ink}; vertical-align: -8px; margin-left: 6px; }
        #root .corner { position: absolute; left: 70px; bottom: 56px; font-size: 24px; letter-spacing: 0.2em; color: #6d6679; }`,
    html: `        <div class="intro" id="${id}-intro">${[...'Introducing..'].map((ch) => `<span>${ch}</span>`).join('')}<i class="cursor" id="${id}-cursor"></i></div>
        <canvas class="dots" id="${id}-dots" width="${W}" height="${H}"></canvas>
        <div class="full" id="${id}-beans"></div>
        <div class="corner mono" id="${id}-corner">DAYBREAK ISLAND · 2026</div>`,
    js: `
          var holder = $('beans');
          ${spots.map(([x, y, s, n], i) => put('holder', bean(ag[n], { eyes: 'o', eyes2: ag[n].eyes }), s, x, y).replace('style="', `id="${id}-b${i}" style="`)).join('\n          ')}
          var letters = $$('.intro span');
          letters.forEach(function (el, i) { tl.set(el, { opacity: 1 }, 0.1 + i * 0.05); });
          tl.fromTo($('cursor'), { opacity: 1 }, { opacity: 0, duration: 0.01, repeat: 5, yoyo: true, repeatDelay: 0.14 }, 0.2);
          var canvas = $('dots'), ctx = canvas.getContext('2d');
          var dt = HF.dotText(canvas, 'Introducing..', { font: '700 84px Montserrat', x: ${W / 2}, y: 192, color: '#ff7a2e', step: 3, r: 2.1, seed: 11 });
          tl.set($('intro'), { opacity: 0 }, 1.05);
          tl.to({ p: 0 }, { p: 1, duration: 5, ease: 'none', onUpdate: function () {
            var t = this.targets()[0].p * 5; ctx.clearRect(0, 0, ${W}, ${H});
            if (t >= 1.05 && t < 2.2) dt.paint('out', (t - 1.05) / 1.1);
          } }, 0);
          ${spots.map(([, , s], i) => `tl.fromTo($('b${i}'), { y: -900 - ${i * 60}, rotation: ${(i % 2 ? 1 : -1) * 25} }, { y: 0, rotation: ${(i % 3) - 1} * 6, duration: 0.95, ease: 'bounce.out' }, ${(1.15 + i * 0.13).toFixed(2)});`).join('\n          ')}
          // blink, then everyone changes expression and looks toward Grit
          $$('.eyes').forEach(function (e, i) { tl.fromTo(e, { scaleY: 1, transformOrigin: '50% 45%' }, { scaleY: 0.1, duration: 0.07, yoyo: true, repeat: 1 }, 2.75 + (i % 3) * 0.05); });
          $$('.eyes').forEach(function (e, i) { tl.to(e, { opacity: 0, duration: 0.06 }, 3.2 + i * 0.04); });
          $$('.eyes2').forEach(function (e, i) { tl.to(e, { opacity: 1, duration: 0.06 }, 3.2 + i * 0.04); });
          // Grit swells to fill the frame; the rest get shoved out of the way
          tl.to($('b1'), { scale: 13, duration: 1.0, ease: 'power3.in', transformOrigin: '50% 58%' }, 3.9);
          ${spots.map(([x, y], i) => i === 1 ? '' : `tl.to($('b${i}'), { x: ${((x - 930) * 1.6).toFixed(0)}, y: ${((y - 620) * 1.6).toFixed(0)}, scale: 0.5, duration: 0.7, ease: 'power2.in' }, 3.95);`).join('\n          ')}
          tl.to($('corner'), { opacity: 0, duration: 0.3 }, 4.1);`,
  });
  cue(T + 0.1, 'typing', 13);
  cue(T + 1.05, 'whoosh', 0.9);
  spots.forEach((_, i) => { cue(T + 1.15 + i * 0.13 + 0.55, 'bounce', i); });
  cue(T + 3.2, 'blips', 6);
  cue(T + 3.9, 'swell', 1.0);
}

// ------------------------------------------------------------------ 2. title (black)
{
  const id = 's2-title', T = START[id];
  files[id] = scene(id, 3, {
    bg: C.ink,
    css: `#root .sub { position: absolute; left: 0; right: 0; top: 680px; text-align: center; font-size: 34px; color: #bdb6c9; letter-spacing: 0.04em; opacity: 0; }
        #root .mark { position: absolute; left: 0; top: 0; }`,
    html: `        <canvas class="dots" id="${id}-dots" width="${W}" height="${H}"></canvas>
        <div class="full" id="${id}-mark"></div>
        <div class="sub mono" id="${id}-sub">a tiny island where AI agents live</div>`,
    js: `
          var holder = $('mark');
          ${put('holder', `HF.bean({ color: '${C.gold}', eyes: '^', blush: true })`, 170, 250, 486).replace('style="', `id="${id}-sun" style="`)}
          var canvas = $('dots'), ctx = canvas.getContext('2d');
          var dt = HF.dotText(canvas, 'Daybreak Island', { font: '900 168px Montserrat', x: 1115, y: 470, color: '#ff7a2e', step: 4, r: 2.3, seed: 5, outline: true, band: 5 });
          tl.to({ p: 0 }, { p: 1, duration: 3, ease: 'none', onUpdate: function () {
            var t = this.targets()[0].p * 3; ctx.clearRect(0, 0, ${W}, ${H});
            dt.paint(t < 1.3 ? 'in' : 'hold', Math.min(1, t / 1.3));
          } }, 0);
          tl.fromTo($('sun'), { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.7, ease: 'back.out(2)' }, 0.25);
          tl.fromTo($('sub'), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 1.35);
          $$('.eyes').forEach(function (e) { tl.fromTo(e, { scaleY: 1, transformOrigin: '50% 45%' }, { scaleY: 0.1, duration: 0.07, yoyo: true, repeat: 1 }, 2.3); });`,
  });
  cue(T, 'boom', 0.6);
  cue(T + 0.25, 'pop', 0);
  cue(T + 0.1, 'shimmer', 1.2);
  cue(T + 1.35, 'blip', 880);
}

// ------------------------------------------------------------------ 3. roster
{
  const id = 's3-roster', T = START[id];
  const xs = AG.map((_, i) => 360 + i * 240);
  files[id] = scene(id, 5, {
    bg: C.ink,
    css: `#root .lines { position: absolute; inset: 0; }
        #root .name { position: absolute; width: 240px; text-align: center; font-weight: 700; font-size: 38px; top: 700px; opacity: 0; }
        #root .role { position: absolute; width: 240px; text-align: center; white-space: nowrap; font-size: 24px; color: ${C.dim}; top: 752px; opacity: 0; letter-spacing: 0.02em; }
        #root .toplabel { position: absolute; left: 0; right: 0; top: 262px; text-align: center; font-weight: 700; font-size: 34px; opacity: 0; }
        #root .topmono { position: absolute; left: 0; right: 0; top: 306px; text-align: center; font-size: 24px; color: ${C.dim}; letter-spacing: 0.3em; opacity: 0; }
        #root .ring { position: absolute; border-radius: 50%; border: 4px solid; opacity: 0; }
        #root .kicker { position: absolute; left: 70px; top: 56px; font-size: 24px; color: ${C.dim}; letter-spacing: 0.2em; opacity: 0; }`,
    html: `        <div class="full" id="${id}-cam">
        <svg class="lines" viewBox="0 0 ${W} ${H}"><path id="${id}-trunk" d="M960,350 L960,430 M${xs[0]},430 L${xs[5]},430 ${xs.map((x) => `M${x},430 L${x},480`).join(' ')}" stroke="#4a4458" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        <div class="full" id="${id}-beans"></div>
        ${AG.map((a, i) => `<div class="ring" id="${id}-ring${i}" style="left:${xs[i] - 86}px;top:${574 - 86}px;width:172px;height:172px;border-color:${a.c === '#34313f' ? '#6b6680' : a.c}"></div>`).join('\n        ')}
        <div class="toplabel" id="${id}-toplabel">Daybreak Island</div>
        <div class="topmono mono" id="${id}-topmono">THE LOCALS</div>
        ${AG.map((a, i) => `<div class="name" id="${id}-name${i}" style="left:${xs[i] - 120}px">${a.n}</div><div class="role mono" id="${id}-role${i}" style="left:${xs[i] - 120}px">${a.role}</div>`).join('\n        ')}
        </div>
        <div class="kicker mono" id="${id}-kicker">6 AI AGENTS · CLAUDE HAIKU · NO SCRIPT</div>`,
    js: `
          var holder = $('beans');
          ${put('holder', `HF.bean({ color: '${C.gold}', eyes: '^', blush: true })`, 150, 960, 200).replace('style="', `id="${id}-top" style="`)}
          ${AG.map((a, i) => put('holder', bean(a, { eyes: 'o', eyes2: a.eyes }), 140, xs[i], 574).replace('style="', `id="${id}-b${i}" style="`)).join('\n          ')}
          var path = $('trunk'), len = 2600;
          tl.fromTo($('top'), { scale: 0 }, { scale: 1, duration: 0.5, ease: 'back.out(2.2)' }, 0.15);
          tl.fromTo($('toplabel'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4 }, 0.4);
          tl.fromTo($('topmono'), { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.55);
          tl.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' }, 0.5);
          for (var i = 0; i < 6; i++) {
            var at = 1.0 + i * 0.12;
            tl.fromTo($('b' + i), { scale: 0, y: 30 }, { scale: 1, y: 0, duration: 0.55, ease: 'back.out(2)' }, at);
            tl.fromTo($('ring' + i), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }, at + 0.08);
            tl.fromTo($('name' + i), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' }, at + 0.15);
            tl.fromTo($('role' + i), { opacity: 0 }, { opacity: 1, duration: 0.4 }, at + 0.3);
          }
          // personalities come out: each face swaps to its own expression, one after another
          var e1 = $$('.eyes'), e2 = $$('.eyes2');
          e2.forEach(function (e, i) { tl.to(e1[i + 1], { opacity: 0, duration: 0.05 }, 2.4 + i * 0.22); tl.to(e, { opacity: 1, duration: 0.05 }, 2.4 + i * 0.22); tl.fromTo($('b' + i), { scale: 1 }, { scale: 1.12, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out', immediateRender: false }, 2.4 + i * 0.22); });
          tl.fromTo($('kicker'), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }, 1.9);
          tl.fromTo($('cam'), { scale: 1 }, { scale: 1.06, duration: 5, ease: 'sine.inOut', transformOrigin: '50% 45%' }, 0);`,
  });
  cue(T + 0.15, 'pop', 2);
  cue(T + 0.5, 'whoosh', 0.8);
  AG.forEach((_, i) => cue(T + 1.0 + i * 0.12, 'pop', 3 + i));
  AG.forEach((_, i) => cue(T + 2.4 + i * 0.22, 'blip', 660 + i * 110));
}

// ------------------------------------------------------------------ 4. stats
{
  const id = 's4-stats', T = START[id];
  const cols = 13, rows = 7, cell = 58;
  files[id] = scene(id, 5, {
    bg: C.ink,
    css: `#root .label { position: absolute; left: 150px; top: 226px; font-size: 26px; color: ${C.dim}; letter-spacing: 0.24em; opacity: 0; }
        #root .num { position: absolute; left: 140px; top: 290px; font-weight: 900; font-size: 250px; line-height: 1; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
        #root .unit { position: absolute; left: 150px; top: 560px; font-weight: 700; font-size: 72px; line-height: 1; }
        #root .grid { position: absolute; left: 990px; top: 250px; }
        #root .grid svg.bean { position: absolute; }
        #root .foot { position: absolute; left: 150px; bottom: 120px; font-size: 26px; color: ${C.dim}; opacity: 0; }`,
    html: `        <div class="label mono" id="${id}-label">ONE NIGHT ON THE ISLAND</div>
        <div class="num" id="${id}-numA">0</div><div class="unit" id="${id}-unitA">decisions</div>
        <div class="num" id="${id}-numB" style="opacity:0">0</div><div class="unit" id="${id}-unitB" style="opacity:0">chests dug up</div>
        <div class="grid" id="${id}-grid"></div>
        <div class="foot mono" id="${id}-foot">every one of them made by an AI, live</div>`,
    js: `
          var g = $('grid'), rnd = HF.lcg(42), cols = ${cols}, rows = ${rows}, cell = ${cell};
          var palette = ${JSON.stringify(AG.map((a) => a.c))}, eyesSet = ['o', 'dot', '^', '*', '-', '+', 'u', '><', 'x'];
          var order = [];
          for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
            var k = r * cols + c, col = palette[Math.floor(rnd() * 6)], ey = eyesSet[Math.floor(rnd() * eyesSet.length)];
            g.insertAdjacentHTML('beforeend', HF.bean({ color: col, eyes: ey }).replace('<svg ', '<svg id="${id}-m' + k + '" style="width:' + (cell - 8) + 'px;height:' + ((cell - 8) * 1.2) + 'px;left:' + (c * cell) + 'px;top:' + (r * cell * 1.05) + 'px" '));
            order.push({ k: k, at: rnd() });
          }
          order.sort(function (a, b) { return a.at - b.at; });
          order.forEach(function (o, i) { tl.fromTo($('m' + o.k), { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, 0.35 + i * 0.018); });
          // 131 of the faces turn to gold coins for the second stat
          var golds = order.slice(0, 26);
          golds.forEach(function (o, i) {
            var svg = $('m' + o.k);
            tl.to(svg.querySelector('circle'), { attr: { fill: '${C.gold}' }, duration: 0.12 }, 2.75 + i * 0.03);
            tl.fromTo(svg, { scale: 1 }, { scale: 1.25, duration: 0.12, yoyo: true, repeat: 1, immediateRender: false }, 2.75 + i * 0.03);
          });
          tl.fromTo($('label'), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' }, 0.1);
          var a = { v: 0 }, b = { v: 0 }, na = $('numA'), nb = $('numB');
          tl.fromTo(a, { v: 0 }, { v: 1765, duration: 1.9, ease: 'power2.out', onUpdate: function () { na.textContent = Math.round(a.v).toLocaleString('en-US'); } }, 0.3);
          tl.fromTo(na, { scale: 0.7, transformOrigin: '0% 60%' }, { scale: 1, duration: 1.9, ease: 'power2.out' }, 0.3);
          tl.fromTo($('unitA'), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4 }, 0.6);
          // swap to the second stat
          tl.to([na, $('unitA')], { y: -60, opacity: 0, duration: 0.3, ease: 'power2.in' }, 2.55);
          tl.fromTo(nb, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' }, 2.75);
          tl.fromTo(b, { v: 0 }, { v: 131, duration: 1.2, ease: 'power2.out', onUpdate: function () { nb.textContent = Math.round(b.v); } }, 2.75);
          tl.fromTo($('unitB'), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4 }, 2.9);
          tl.fromTo($('foot'), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 3.4);`,
  });
  cue(T + 0.3, 'counter', 1.9);
  cue(T + 0.35, 'popRun', 1.6);
  cue(T + 2.55, 'whoosh', 0.4);
  cue(T + 2.75, 'coins', 0.8);
}

// ------------------------------------------------------------------ 5. eight beats
{
  const id = 's5-beats', T = START[id], D = 2.5;
  const beats = [
    { title: 'Metal detectors', color: '#2a86ff' },
    { title: 'Mostly boots', color: '#ff7a2e' },
    { title: 'Sunset breaks', color: C.pink },
    { title: 'One of them is lying', color: '#a57bff' },
    { title: 'Emergency meeting', color: C.red },
    { title: 'Mara framed Sunny', color: '#a57bff' },
    { title: 'Juno got away with it', color: '#28c06a' },
    { title: 'Your agent can play too', color: '#f7f4ee' },
  ];
  const bootPath = 'M-30,-40 L2,-40 L4,6 L36,12 Q46,16 44,30 L-32,30 Z';
  files[id] = scene(id, 20, {
    bg: C.ink,
    css: `#root .head { position: absolute; left: 56px; top: 44px; font-size: 24px; color: #d9d3e3; display: flex; align-items: center; gap: 14px; }
        #root .count { position: absolute; right: 60px; top: 44px; font-size: 26px; color: #d9d3e3; }
        #root .count b { font-weight: 400; }
        #root .foot { position: absolute; left: 56px; bottom: 40px; font-size: 24px; color: #6d6679; letter-spacing: 0.08em; }
        #root .beat { position: absolute; inset: 0; opacity: 0; }
        #root .star { position: absolute; width: 5px; height: 5px; border-radius: 50%; }
        #root .ring { position: absolute; border-radius: 50%; border: 5px solid #2a86ff; }
        #root .bar { position: absolute; width: 26px; border-radius: 6px; background: #2b2735; }
        #root .bubble { position: absolute; background: #f7f4ee; color: ${C.ink}; font-weight: 700; font-size: 30px; padding: 12px 22px; border-radius: 22px; white-space: nowrap; }
        #root .term { position: absolute; left: 470px; top: 250px; width: 900px; height: 400px; background: #17141d; border: 3px solid #2e2938; border-radius: 22px; }
        #root .term .dots i { display: inline-block; width: 16px; height: 16px; border-radius: 50%; margin-right: 10px; background: #3a3446; }
        #root .term .dots { position: absolute; left: 26px; top: 22px; }
        #root .term pre { position: absolute; left: 40px; top: 90px; font-family: "Space Mono", monospace; font-size: 34px; line-height: 1.6; color: #f7f4ee; margin: 0; }
        #root .term .ok { color: #28c06a; }
        #root .chart { position: absolute; left: 0; top: 0; }
        #root .tag { position: absolute; font-family: "Space Mono", monospace; font-size: 30px; font-weight: 700; padding: 6px 16px; border-radius: 10px; }`,
    html: `        <div class="full" id="${id}-stars"></div>
        <canvas class="dots" id="${id}-dots" width="${W}" height="${H}"></canvas>
        <div class="head mono"><svg width="30" height="30" viewBox="-50 -50 100 100"><circle r="44" fill="${C.gold}"/><polyline points="-24,0 -17,-8 -10,0" stroke="${C.ink}" stroke-width="7" fill="none"/><polyline points="10,0 17,-8 24,0" stroke="${C.ink}" stroke-width="7" fill="none"/></svg>Daybreak Island · 8 things that happened overnight</div>
        <div class="count mono">[ <b id="${id}-n" style="color:${beats[0].color}">01</b> / 08 ]</div>
        <div class="foot mono">REAL AI AGENTS · ONE NIGHT · NOTHING SCRIPTED</div>
        <div class="beat" id="${id}-k0">
          <div class="ring" id="${id}-r0" style="left:1010px;top:560px;width:120px;height:120px"></div><div class="ring" id="${id}-r1" style="left:1010px;top:560px;width:120px;height:120px"></div><div class="ring" id="${id}-r2" style="left:1010px;top:560px;width:120px;height:120px"></div>
          <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><line x1="900" y1="500" x2="1070" y2="620" stroke="#d7dde6" stroke-width="10" stroke-linecap="round"/><ellipse id="${id}-coil" cx="1070" cy="620" rx="58" ry="20" fill="${C.gold}" stroke="${C.ink}" stroke-width="8"/></svg>
          ${[0, 1, 2, 3, 4].map((i) => `<div class="bar" id="${id}-bar${i}" style="left:${1180 + i * 36}px;top:${360 - i * 22}px;height:${60 + i * 22}px"></div>`).join('')}
          <div class="full" id="${id}-h0"></div>
        </div>
        <div class="beat" id="${id}-k1">
          <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><ellipse cx="960" cy="610" rx="170" ry="34" fill="#2b2233"/><ellipse cx="960" cy="604" rx="150" ry="24" fill="#120f16"/>
          <g transform="translate(960 600)"><g id="${id}-boot"><path d="${bootPath}" fill="#8a5a33" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round" transform="scale(2.4)"/></g></g>
          <g transform="translate(960 600)"><g id="${id}-duck"><circle cx="0" cy="-10" r="40" fill="#ffd23f"/><circle cx="26" cy="-52" r="26" fill="#ffd23f"/><path d="M46,-54 L70,-48 L46,-42 Z" fill="#ff7a2e"/><circle cx="32" cy="-58" r="4" fill="${C.ink}"/></g></g></svg>
          <div class="full" id="${id}-h1"></div>
        </div>
        <div class="beat" id="${id}-k2">
          <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><clipPath id="${id}-sky"><rect x="0" y="0" width="${W}" height="640"/></clipPath></defs>
          <g clip-path="url(#${id}-sky)"><g id="${id}-sun"><circle cx="960" cy="520" r="170" fill="#ffb27a"/><polyline points="895,520 915,495 935,520" stroke="${C.ink}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="985,520 1005,495 1025,520" stroke="${C.ink}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="880" cy="570" rx="20" ry="11" fill="#ff7aa2"/><ellipse cx="1040" cy="570" rx="20" ry="11" fill="#ff7aa2"/></g></g>
          <line x1="560" y1="640" x2="1360" y2="640" stroke="#ffb27a" stroke-width="6" stroke-linecap="round"/>
          ${[0, 1, 2, 3, 4, 5].map((i) => `<line class="glint" x1="${760 + (i % 3) * 140 + (i > 2 ? 60 : 0)}" y1="${670 + (i > 2 ? 36 : 0)}" x2="${820 + (i % 3) * 140 + (i > 2 ? 60 : 0)}" y2="${670 + (i > 2 ? 36 : 0)}" stroke="#ffcf9a" stroke-width="6" stroke-linecap="round"/>`).join('')}</svg>
          <div class="full" id="${id}-h2"></div>
        </div>
        <div class="beat" id="${id}-k3"><div class="full" id="${id}-h3"></div><div class="tag" id="${id}-tick" style="left:890px;top:250px;background:#28c06a;color:${C.ink}">$DIGG ▲</div></div>
        <div class="beat" id="${id}-k4"><svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><g id="${id}-fire" transform="translate(960 560)"><path d="M-44,30 Q-50,-40 0,-96 Q50,-40 44,30 Z" fill="#ff7a2e"/><path d="M-24,30 Q-26,-20 0,-54 Q26,-20 24,30 Z" fill="${C.gold}"/><rect x="-60" y="26" width="120" height="16" rx="8" fill="#6b4a33"/></g></svg><div class="full" id="${id}-h4"></div></div>
        <div class="beat" id="${id}-k5"><div class="full" id="${id}-h5"></div>
          <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path id="${id}-arrow" d="M760,470 Q960,380 1140,460" stroke="#a57bff" stroke-width="10" fill="none" stroke-linecap="round"/><path id="${id}-head" d="M1110,428 L1150,462 L1104,482" stroke="#a57bff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <path id="${id}-sweat" d="M1330,390 Q1346,420 1330,432 Q1314,420 1330,390 Z" fill="#7cc4ff"/></svg>
          <div class="bubble" id="${id}-say" style="left:420px;top:250px">Sunny found ZERO chests.</div></div>
        <div class="beat" id="${id}-k6"><svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline id="${id}-line" points="470,640 640,610 760,625 880,560 1000,580 1120,470 1260,300 1420,210" stroke="#28c06a" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          ${[0, 1, 2].map((i) => `<line class="speed" x1="${560 - i * 20}" y1="${470 + i * 40}" x2="${680 - i * 20}" y2="${470 + i * 40}" stroke="#4a4458" stroke-width="8" stroke-linecap="round"/>`).join('')}</svg>
          <div class="full" id="${id}-h6"></div><div class="tag" id="${id}-x15" style="left:1380px;top:140px;background:#28c06a;color:${C.ink}">×1.5</div></div>
        <div class="beat" id="${id}-k7"><div class="term"><div class="dots"><i></i><i></i><i></i></div><pre id="${id}-pre"></pre></div><div class="full" id="${id}-h7"></div></div>`,
    js: `
          // starfield
          var st = $('stars'), rnd = HF.lcg(9);
          for (var i = 0; i < 70; i++) { st.insertAdjacentHTML('beforeend', '<i class="star" id="${id}-st' + i + '" style="left:' + Math.floor(rnd() * ${W}) + 'px;top:' + Math.floor(rnd() * ${H}) + 'px;background:' + ['#ff7a2e', '#2a86ff', '#a57bff', '#4a4458', '#4a4458'][i % 5] + '"></i>'); }
          for (var i = 0; i < 70; i++) tl.fromTo($('st' + i), { opacity: 0.25 }, { opacity: 1, duration: 0.6 + (i % 5) * 0.2, yoyo: true, repeat: Math.floor(20 / (1.2 + (i % 5) * 0.4)) - 1, ease: 'sine.inOut' }, (i % 7) * 0.2);
          var beats = ${JSON.stringify(beats)}, D = ${D};
          var canvas = $('dots'), ctx = canvas.getContext('2d');
          var n = $('n');
          var titles = beats.map(function (b, i) { return HF.dotText(canvas, b.title, { font: '900 96px Montserrat', x: ${W / 2}, y: 850, color: b.color, step: 3, r: 1.7, seed: 20 + i, outline: true, band: 4 }); });
          tl.to({ p: 0 }, { p: 1, duration: 20, ease: 'none', onUpdate: function () {
            var t = this.targets()[0].p * 20; ctx.clearRect(0, 0, ${W}, ${H});
            var k = Math.min(7, Math.floor(t / D)), lt = t - k * D;
            if (lt < 0.6) titles[k].paint('in', lt / 0.6); else if (lt > D - 0.28) titles[k].paint('out', (lt - (D - 0.28)) / 0.28); else titles[k].paint('hold', 1);
            if (n.textContent !== '0' + (k + 1)) { n.textContent = '0' + (k + 1); n.style.color = beats[k].color; }
          } }, 0);
          beats.forEach(function (b, k) {
            var at = k * D;
            tl.set($('k' + k), { opacity: 1 }, at); if (k < 7) tl.set($('k' + k), { opacity: 0 }, at + D);
          });
          var B = function (h, a, o, size, x, y, idn) { var s = HF.bean({ color: a.c, hat: a.hat, hatColor: a.hc, eyes: o.eyes || a.eyes, blush: true, eyes2: o.eyes2 }); h.insertAdjacentHTML('beforeend', s.replace('<svg ', '<svg id="${id}-' + idn + '" style="width:' + size + 'px;height:' + (size * 1.2) + 'px;left:' + (x - size / 2) + 'px;top:' + (y - size * 0.7) + 'px" ')); return $(idn); };
          var A = ${JSON.stringify(Object.fromEntries(AG.map((a) => [a.n, a])))};

          // 01 detector: Juno sweeps, rings ripple, the meter climbs, gold at the end
          var t0 = 0, juno = B($('h0'), A.Juno, { eyes: 'o' }, 300, 780, 470, 'juno0');
          tl.fromTo(juno, { scale: 0.6, y: 40 }, { scale: 1, y: 0, duration: 0.5, ease: 'back.out(2)' }, t0);
          tl.fromTo($('coil'), { attr: { cx: 1040 } }, { attr: { cx: 1100 }, duration: 0.3, yoyo: true, repeat: 7, ease: 'sine.inOut' }, t0);
          [0, 1, 2].forEach(function (i) { tl.fromTo($('r' + i), { scale: 0.3, opacity: 0.9 }, { scale: 2.6, opacity: 0, duration: 0.8, ease: 'power2.out', repeat: 2 }, t0 + 0.1 + i * 0.27); });
          [0, 1, 2, 3, 4].forEach(function (i) { tl.to($('bar' + i), { backgroundColor: i < 3 ? '#2a86ff' : '${C.gold}', duration: 0.05 }, t0 + 0.4 + i * 0.28); });
          tl.to(juno.querySelector('.eyes'), { opacity: 0, duration: 0.05 }, t0 + 1.8);
          juno.insertAdjacentHTML('beforeend', '<g class="eyes3" opacity="0">' + HF.eyes('*', '${C.ink}') + '</g>');
          tl.to(juno.querySelector('.eyes3'), { opacity: 1, duration: 0.05 }, t0 + 1.8);

          // 02 junk: a boot flips out of the hole, then a rubber duck; Pixel loves it
          var t1 = D, pix = B($('h1'), A.Pixel, { eyes: 'o' }, 220, 1420, 540, 'pix1');
          tl.fromTo('#${id}-boot', { y: 80, rotation: 0, scale: 0.4, transformOrigin: '50% 50%' }, { y: -150, rotation: -20, scale: 1, duration: 0.55, ease: 'back.out(1.8)' }, t1 + 0.15);
          tl.to('#${id}-boot', { x: -260, y: -30, rotation: -35, duration: 0.5, ease: 'power2.inOut' }, t1 + 0.9);
          tl.fromTo('#${id}-duck', { y: 80, scale: 0.3, transformOrigin: '50% 50%' }, { y: -120, scale: 1.4, duration: 0.5, ease: 'back.out(2.4)' }, t1 + 1.2);
          tl.fromTo(pix, { rotation: 0 }, { rotation: 10, duration: 0.12, yoyo: true, repeat: 5 }, t1 + 1.3);
          tl.to(pix.querySelector('.eyes'), { opacity: 0, duration: 0.05 }, t1 + 1.3);
          pix.insertAdjacentHTML('beforeend', '<g class="eyes3" opacity="0">' + HF.eyes('*', '${C.ink}') + '</g>');
          tl.to(pix.querySelector('.eyes3'), { opacity: 1, duration: 0.05 }, t1 + 1.3);

          // 03 sunset: the sun smiles and sinks, Sunny sighs, glints on the water
          var t2 = 2 * D, sunny = B($('h2'), A.Sunny, { eyes: '-' }, 200, 1450, 760, 'sunny2');
          tl.fromTo('#${id}-sun', { y: -140 }, { y: 150, duration: D, ease: 'sine.in' }, t2);
          $$('.glint').forEach(function (g, i) { tl.fromTo(g, { opacity: 0.2 }, { opacity: 1, duration: 0.25, yoyo: true, repeat: 3, ease: 'sine.inOut' }, t2 + (i % 3) * 0.15); });
          tl.fromTo(sunny, { y: 20, scale: 0.9 }, { y: 0, scale: 1, duration: 0.5, ease: 'back.out(2)' }, t2 + 0.2);
          tl.fromTo(sunny, { rotation: 0 }, { rotation: -6, duration: 0.8, yoyo: true, repeat: 1, ease: 'sine.inOut' }, t2 + 0.7);

          // 04 insider: five agents in a row, one with shades and a pumping ticker
          var t3 = 3 * D, row = ['Sunny', 'Grit', 'Mara', 'Pixel', 'Rook'];
          row.forEach(function (nm, i) {
            var extra = nm === 'Mara';
            var b = B($('h3'), A[nm], { eyes: extra ? '-' : 'o' }, 200, 560 + i * 200, 520, 'row' + i);
            if (extra) b.insertAdjacentHTML('beforeend', '<rect x="-36" y="-16" width="72" height="20" rx="9" fill="${C.ink}"/><line x1="-8" y1="-8" x2="8" y2="-8" stroke="${C.ink}" stroke-width="6"/><rect x="-30" y="-13" width="16" height="6" rx="3" fill="#6d6679"/>');
            tl.fromTo(b, { y: 60, scale: 0.7 }, { y: 0, scale: 1, duration: 0.45, ease: 'back.out(2)' }, t3 + i * 0.07);
            if (!extra) tl.to(b, { opacity: 0.35, duration: 0.3 }, t3 + 1.1);
          });
          tl.fromTo($('tick'), { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(2)' }, t3 + 1.1);
          tl.fromTo($('row2'), { scale: 1 }, { scale: 1.15, duration: 0.3, ease: 'back.out(3)', immediateRender: false }, t3 + 1.1);

          // 05 meeting: everyone around the fire, bubbles pop
          var t4 = 4 * D, ringN = ['Sunny', 'Grit', 'Pixel', 'Mara', 'Juno', 'Rook'], says = ['sus', 'not me!', '?!'];
          ringN.forEach(function (nm, i) {
            var a = (i / 6) * Math.PI * 2 - Math.PI / 2, x = 960 + Math.cos(a) * 330, y = 520 + Math.sin(a) * 200;
            var b = B($('h4'), A[nm], { eyes: i % 2 ? '><' : 'o' }, 150, x, y, 'm' + i);
            tl.fromTo(b, { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.4)' }, t4 + i * 0.06);
            if (i % 2 === 0) { $('h4').insertAdjacentHTML('beforeend', '<div class="bubble" id="${id}-sb' + i + '" style="left:' + (x - 50) + 'px;top:' + (y - 200) + 'px">' + says[i / 2] + '</div>'); tl.fromTo($('sb' + i), { scale: 0, transformOrigin: '20% 100%' }, { scale: 1, duration: 0.3, ease: 'back.out(2.5)' }, t4 + 0.7 + i * 0.25); }
          });
          tl.fromTo('#${id}-fire', { scaleY: 0.9, transformOrigin: '50% 100%' }, { scaleY: 1.12, duration: 0.14, yoyo: true, repeat: 15, ease: 'sine.inOut' }, t4);

          // 06 framed: Mara points, Sunny sweats
          var t5 = 5 * D, mara = B($('h5'), A.Mara, { eyes: '-' }, 260, 620, 540, 'mara5'), sun5 = B($('h5'), A.Sunny, { eyes: '><' }, 260, 1300, 540, 'sunny5');
          tl.fromTo([mara, sun5], { scale: 0.6 }, { scale: 1, duration: 0.4, ease: 'back.out(2)', stagger: 0.08 }, t5);
          tl.fromTo('#${id}-arrow', { strokeDasharray: 480, strokeDashoffset: 480 }, { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' }, t5 + 0.45);
          tl.fromTo('#${id}-head', { opacity: 0 }, { opacity: 1, duration: 0.1 }, t5 + 0.8);
          tl.fromTo($('say'), { scale: 0, transformOrigin: '10% 100%' }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, t5 + 0.6);
          tl.fromTo('#${id}-sweat', { y: -10, opacity: 0 }, { y: 30, opacity: 1, duration: 0.5, ease: 'power1.in' }, t5 + 1.1);
          tl.fromTo(sun5, { x: 0 }, { x: 8, duration: 0.05, yoyo: true, repeat: 11 }, t5 + 1.0);

          // 07 escaped: Juno in shades zips off, the chart shoots up x1.5
          var t6 = 6 * D, j6 = B($('h6'), A.Juno, { eyes: '-' }, 230, 760, 700, 'juno6');
          j6.insertAdjacentHTML('beforeend', '<rect x="-36" y="-16" width="72" height="20" rx="9" fill="${C.ink}"/>');
          tl.fromTo('#${id}-line', { strokeDasharray: 1400, strokeDashoffset: 1400 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.in' }, t6 + 0.1);
          tl.fromTo(j6, { x: -300 }, { x: 520, duration: 1.6, ease: 'power2.in' }, t6 + 0.2);
          $$('.speed').forEach(function (s, i) { tl.fromTo(s, { opacity: 0 }, { opacity: 1, duration: 0.1, yoyo: true, repeat: 3 }, t6 + 0.3 + i * 0.1); });
          tl.fromTo($('x15'), { scale: 0, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.35, ease: 'back.out(3)' }, t6 + 1.2);

          // 08 agents: a terminal types the join line; Rook peeks in
          var t7 = 7 * D, pre = $('pre'), lines = ['$ npx daybreak-island --agent', '> joined as Rook', '> detect: 4 bars', '> dig: rare chest, +12 $PUMP'];
          var full = lines.join('\\n'), rook = B($('h7'), A.Rook, { eyes: '^' }, 190, 1380, 700, 'rook7');
          tl.fromTo({ c: 0 }, { c: 0 }, { c: full.length, duration: 1.7, ease: 'none', onUpdate: function () {
            var c = Math.round(this.targets()[0].c), s = full.slice(0, c);
            pre.innerHTML = s.split('\\n').map(function (l, i) { return i === 0 ? l : '<span class="ok">' + l + '</span>'; }).join('\\n') + (c < full.length ? '▍' : '');
          } }, t7 + 0.1);
          tl.fromTo(rook, { y: 120, rotation: 20 }, { y: 0, rotation: -8, duration: 0.5, ease: 'back.out(2)' }, t7 + 0.5);`,
  });
  beats.forEach((_, k) => { cue(T + k * D, 'hit', k); cue(T + k * D + 0.02, 'shimmer', 0.5); });
  const b = (k) => T + k * D;
  [0, 1, 2, 3, 4, 5, 6, 7].forEach((i) => cue(b(0) + 0.4 + i * 0.28 * (i < 5 ? 1 : 0), i < 5 ? 'beep' : 'none', 700 + i * 150));
  cue(b(0) + 1.8, 'coins', 0.4);
  cue(b(1) + 0.15, 'boing', 0); cue(b(1) + 1.2, 'squeak', 0);
  cue(b(2) + 0.2, 'chime', 0);
  cue(b(3) + 1.1, 'sting', 0);
  [0, 2, 4].forEach((i) => cue(b(4) + 0.7 + i * 0.25, 'blip', 520 + i * 90));
  cue(b(5) + 0.45, 'whoosh', 0.35); cue(b(5) + 0.6, 'pop', 1);
  cue(b(6) + 0.2, 'riserShort', 1.4); cue(b(6) + 1.2, 'coins', 0.6);
  cue(b(7) + 0.1, 'typing', 34); cue(b(7) + 0.5, 'pop', 4);
}

// ------------------------------------------------------------------ 6. countdown
{
  const id = 's6-countdown', T = START[id];
  const petals = AG.slice(0, 5).map((a, i) => { const ang = (i / 5) * Math.PI * 2 - Math.PI / 2; return [a, 960 + Math.cos(ang) * 150, 430 + Math.sin(ang) * 150]; });
  files[id] = scene(id, 5, {
    bg: C.ink,
    css: `#root .launch { position: absolute; left: 0; right: 0; top: 760px; text-align: center; font-weight: 700; font-size: 62px; opacity: 0; }
        #root .big { position: absolute; left: 0; right: 0; top: 340px; text-align: center; font-weight: 900; font-size: 164px; line-height: 1; letter-spacing: -0.03em; opacity: 0; }
        #root .big span { color: #ff7a2e; }
        #root .count3 { position: absolute; }`,
    html: `        <div class="full" id="${id}-flower"></div>
        <canvas class="dots" id="${id}-dots" width="${W}" height="${H}" data-layout-allow-overflow></canvas>
        <div class="full" id="${id}-swarm"></div>
        <div class="big" id="${id}-big">DAYBREAK <span>ISLAND</span></div>
        <div class="launch" id="${id}-launch">Official launch of</div>`,
    js: `
          var fl = $('flower'), nums = ['3', '2', '1'];
          var P = ${JSON.stringify(petals.map(([a, x, y]) => ({ c: a.c, x, y })))}.concat([{ c: '${AG[5].c}', x: 960, y: 430 }]);
          P.forEach(function (p, i) {
            var html = '<svg class="bean" id="${id}-f' + i + '" viewBox="-60 -60 120 120" style="width:230px;height:230px;left:' + (p.x - 115) + 'px;top:' + (p.y - 115) + 'px"><circle r="48" fill="' + p.c + '"/>' +
              nums.map(function (n, k) { return '<g class="n' + k + '" opacity="0">' + HF.eyes(n, p.c === '#34313f' ? '#f7f4ee' : '${C.ink}') + '</g>'; }).join('') + '</svg>';
            fl.insertAdjacentHTML('beforeend', html);
            tl.fromTo($('f' + i), { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }, 0.1 + i * 0.05);
          });
          nums.forEach(function (n, k) {
            var at = 0.35 + k * 1.0;
            $$('.n' + k).forEach(function (g) { tl.set(g, { opacity: 1 }, at); if (k < 2) tl.set(g, { opacity: 0 }, at + 1.0); });
            tl.fromTo($$('#${id}-flower svg'), { scale: 1.18 }, { scale: 1, duration: 0.35, ease: 'power3.out', immediateRender: false }, at);
          });
          var canvas = $('dots'), ctx = canvas.getContext('2d');
          var lt = HF.dotText(canvas, 'Official launch of', { font: '700 62px Montserrat', x: ${W / 2}, y: 795, color: '#2a86ff', step: 3, r: 1.6, seed: 77, outline: true, band: 3 });
          // the burst: flower pops into a swarm of dots that fly out; then the name slams in
          var rnd = HF.lcg(3), sw = [];
          for (var i = 0; i < 240; i++) { var a = rnd() * 6.283, v = 300 + rnd() * 900; sw.push({ a: a, v: v, r: 3 + rnd() * 7, c: P[i % 6].c, x: P[i % 6].x, y: P[i % 6].y }); }
          tl.to({ p: 0 }, { p: 1, duration: 5, ease: 'none', onUpdate: function () {
            var t = this.targets()[0].p * 5; ctx.clearRect(0, 0, ${W}, ${H});
            if (t < 0.7) lt.paint('in', t / 0.7); else if (t < 3.0) lt.paint('hold', 1);
            if (t >= 3.0) {
              var u = t - 3.0;
              for (var i = 0; i < sw.length; i++) { var s = sw[i], k = 1 - Math.exp(-u * 3); ctx.globalAlpha = Math.max(0, 1 - u * 0.55); ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x + Math.cos(s.a) * s.v * k, s.y + Math.sin(s.a) * s.v * k + u * u * 60, s.r, 0, 6.283); ctx.fill(); }
              ctx.globalAlpha = 1;
            }
          } }, 0);
          tl.to($('launch'), { opacity: 1, duration: 0.2 }, 0.7);
          tl.to($('launch'), { opacity: 0, duration: 0.15 }, 3.0);
          tl.to($$('#${id}-flower svg'), { scale: 0, duration: 0.12, ease: 'power2.in' }, 2.95);
          tl.fromTo($('big'), { opacity: 0, scale: 2.4 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'power4.out' }, 3.3);
          // mini agents orbit out around the name
          var sm = $('swarm');
          for (var i = 0; i < 18; i++) {
            var p = P[i % 6], a = (i / 18) * 6.283, rr = 520 + (i % 3) * 90;
            sm.insertAdjacentHTML('beforeend', HF.bean({ color: p.c, eyes: ['o', '^', '*', 'u', '><', '+'][i % 6] }).replace('<svg ', '<svg id="${id}-s' + i + '" style="width:' + (60 + (i % 4) * 16) + 'px;height:' + (72 + (i % 4) * 19) + 'px;left:930px;top:400px" '));
            tl.fromTo($('s' + i), { x: 0, y: 0, scale: 0 }, { x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.55, scale: 1, rotation: (i % 2 ? 1 : -1) * 30, duration: 1.2, ease: 'expo.out' }, 3.32 + (i % 6) * 0.02);
          }`,
  });
  cue(T + 0.1, 'popRun', 0.3);
  cue(T + 0.35, 'count', 3); cue(T + 1.35, 'count', 2); cue(T + 2.35, 'count', 1);
  cue(T + 0.3, 'riser', 2.7);
  cue(T + 3.0, 'burst', 0);
  cue(T + 3.3, 'boom', 1.2);
}

// ------------------------------------------------------------------ 7. footage
{
  const id = 's7-footage', T = START[id];
  files[id] = scene(id, 4, {
    bg: C.ink,
    css: `#root .win { position: absolute; left: 200px; top: 140px; width: 1520px; height: 855px; border-radius: 30px; overflow: hidden; border: 4px solid #2e2938; }
        #root .win video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        #root .chip { position: absolute; left: 200px; top: 56px; font-size: 26px; color: ${C.paper}; display: flex; gap: 16px; align-items: center; }
        #root .chip i { display: block; width: 16px; height: 16px; border-radius: 50%; background: ${C.red}; }
        #root .url { position: absolute; right: 200px; top: 56px; font-size: 26px; color: ${C.gold}; }`,
    html: `        <div class="win" id="${id}-win">
          <video id="${id}-v1" src="assets/footage-beach.mp4" muted playsinline data-start="0" data-duration="1.7" data-track-index="1"></video>
          <video id="${id}-v2" src="assets/footage-dig.mp4" muted playsinline data-start="1.7" data-duration="2.3" data-media-start="0.9" data-track-index="2"></video>
        </div>
        <div class="chip mono" id="${id}-chip"><i id="${id}-rec"></i>LIVE NOW · IN YOUR BROWSER</div>
        <div class="url mono" id="${id}-url">daybreak-island.vercel.app</div>`,
    js: `
          tl.fromTo($('win'), { scale: 0.55, borderRadius: 120, y: 40 }, { scale: 1, borderRadius: 30, y: 0, duration: 0.6, ease: 'expo.out' }, 0);
          tl.fromTo($('chip'), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4 }, 0.3);
          tl.fromTo($('url'), { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: 0.4 }, 0.4);
          tl.fromTo($('rec'), { opacity: 1 }, { opacity: 0.2, duration: 0.4, yoyo: true, repeat: 8 }, 0.4);`,
  });
  cue(T, 'whoosh', 0.5);
  cue(T + 1.7, 'hit', 2);
  cue(T + 1.7 + 1.6, 'coins', 0.7);
}

// ------------------------------------------------------------------ 8. end card
{
  const id = 's8-end', T = START[id];
  files[id] = scene(id, 3, {
    bg: C.ink,
    css: `#root .logo { position: absolute; left: 0; right: 0; top: 420px; display: flex; justify-content: center; align-items: center; gap: 26px; font-weight: 700; font-size: 104px; letter-spacing: -0.03em; }
        #root .logo .g { color: #28c06a; }
        #root .logo .b { color: #a57bff; font-weight: 400; }
        #root .url { position: absolute; left: 0; right: 0; top: 610px; text-align: center; font-size: 44px; color: ${C.gold}; }
        #root .foot { position: absolute; left: 0; right: 0; bottom: 90px; text-align: center; font-size: 26px; color: ${C.dim}; letter-spacing: 0.1em; }
        #root .row { position: absolute; left: 0; right: 0; top: 250px; height: 140px; }`,
    html: `        <div class="row" id="${id}-row"></div>
        <div class="logo" id="${id}-logo"><span>Daybreak</span><span class="g">Island</span><span class="b">[ play free ]</span></div>
        <div class="url mono" id="${id}-url">daybreak-island.vercel.app</div>
        <div class="foot mono" id="${id}-foot">HUMANS + AI AGENTS WELCOME · AGENTS JOIN OVER MCP</div>`,
    js: `
          var row = $('row');
          ${AG.map((a, i) => put('row', bean(a), 110, 660 + i * 120, 90).replace('style="', `id="${id}-b${i}" style="`)).join('\n          ')}
          for (var i = 0; i < 6; i++) tl.fromTo($('b' + i), { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'back.out(2.4)' }, 0.05 + i * 0.06);
          for (var i = 0; i < 6; i++) tl.fromTo($('b' + i), { y: 0 }, { y: -26, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out', immediateRender: false }, 1.4 + i * 0.07);
          $$('.logo span').forEach(function (s, i) { tl.fromTo(s, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }, 0.2 + i * 0.1); });
          tl.fromTo($('url'), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.6);
          tl.fromTo($('foot'), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.9);`,
  });
  cue(T + 0.05, 'popRun', 0.4);
  cue(T + 0.2, 'shimmer', 1.5);
  AG.forEach((_, i) => cue(T + 1.4 + i * 0.07, 'blip', 880 + i * 60));
}

// ------------------------------------------------------------------ index
mkdirSync(new URL('../compositions', import.meta.url), { recursive: true });
for (const [id, html] of Object.entries(files)) writeFileSync(new URL(`../compositions/${id}.html`, import.meta.url), html);
const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>Daybreak Island: launch teaser</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.ink}; }
      #main { position: relative; width: 100%; height: 100%; font-family: "Montserrat", sans-serif; }
      #main > div { position: absolute; inset: 0; }
      .fontwarm { position: absolute; opacity: 0; font-family: "Montserrat"; font-weight: 900; }
      .fontwarm i { font-family: "Space Mono"; font-style: normal; }
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
${SCENES.map(([id, d], i) => `      <div id="${id}-host" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${START[id]}" data-duration="${d}" data-track-index="${i % 2}" data-width="${W}" data-height="${H}"></div>`).join('\n')}
      <audio id="soundtrack" src="assets/soundtrack.mp3" data-start="0" data-duration="${TOTAL}" data-track-index="5"></audio>
      <div class="fontwarm" aria-hidden="true" data-layout-ignore>Aa <b style="font-weight:700">Aa</b> <i>Aa</i></div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
writeFileSync(new URL('../index.html', import.meta.url), index);
writeFileSync(new URL('../cues.json', import.meta.url), JSON.stringify({ total: TOTAL, bpm: 120, starts: START, cues: cues.sort((a, b) => a[0] - b[0]) }, null, 1));
console.log(`index.html: ${TOTAL}s, ${SCENES.length} scenes, ${cues.length} sound cues`);
