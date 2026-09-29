// Original soundtrack for the promo, synthesised offline (no samples, no licences):
// a bouncy 120 BPM marimba/bass/drums track shaped to the edit (soft intro, groove,
// breakdown + riser under the countdown, drop on the title) plus sound effects placed
// from cues.json. Writes assets/soundtrack.wav and .mp3 (loudness-normalised).
//   node scripts/audio.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { total: TOTAL, cues, starts } = JSON.parse(readFileSync(new URL('../cues.json', import.meta.url)));
const SR = 44100, N = Math.ceil(TOTAL * SR), BEAT = 0.5, BAR = 2;
const M = [new Float32Array(N), new Float32Array(N)]; // music
const X = [new Float32Array(N), new Float32Array(N)]; // effects
let seed = 99;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const add = (B, i, l, r = l) => { if (i >= 0 && i < N) { B[0][i] += l; B[1][i] += r; } };
const T_COUNT = starts['s6-countdown'], T_DROP = T_COUNT + 3.3, T_GROOVE = starts['s2-title'];

// ------------------------------------------------------------------ instruments
function marimba(B, t, m, g, pan = 0.5) {
  const i0 = Math.floor(t * SR), len = Math.floor(0.7 * SR), f = hz(m);
  for (let k = 0; k < len; k++) {
    const u = k / SR, v = (Math.sin(2 * Math.PI * f * u) + 0.35 * Math.sin(2 * Math.PI * f * 4 * u) * Math.exp(-u * 30) + 0.12 * Math.sin(2 * Math.PI * f * 10 * u) * Math.exp(-u * 60)) * Math.exp(-u * 7) * g;
    add(B, i0 + k, v * (1 - pan) * 1.4, v * pan * 1.4);
  }
}
function bass(B, t, m, dur, g) {
  const i0 = Math.floor(t * SR), len = Math.floor(dur * SR), f = hz(m);
  let lp = 0;
  for (let k = 0; k < len; k++) {
    const u = k / SR, env = Math.min(1, u / 0.005) * Math.exp(-u * 3.5) * Math.min(1, (dur - u) / 0.02);
    const raw = Math.tanh((Math.sin(2 * Math.PI * f * u) + 0.4 * Math.sin(2 * Math.PI * f * 2 * u)) * 1.6);
    lp += (raw - lp) * 0.25;
    add(B, i0 + k, lp * env * g);
  }
}
function pad(B, t, notes, dur, g) {
  const i0 = Math.floor(t * SR), len = Math.floor(dur * SR);
  for (let k = 0; k < len; k++) {
    const u = k / SR, env = Math.min(1, u / 0.3) * Math.min(1, (dur - u) / 0.4);
    let v = 0;
    for (const [j, m] of notes.entries()) v += Math.sin(2 * Math.PI * hz(m) * u + j) + 0.5 * Math.sin(2 * Math.PI * hz(m) * 1.004 * u);
    add(B, i0 + k, (v / notes.length) * env * g * 0.9, (v / notes.length) * env * g);
  }
}
function kick(B, t, g) {
  const i0 = Math.floor(t * SR), len = Math.floor(0.32 * SR);
  let ph = 0;
  for (let k = 0; k < len; k++) { const u = k / SR, f = 48 + 110 * Math.exp(-u * 32); ph += (2 * Math.PI * f) / SR; add(B, i0 + k, Math.sin(ph) * Math.exp(-u * 8) * g); }
}
function clap(B, t, g) {
  const i0 = Math.floor(t * SR), len = Math.floor(0.18 * SR);
  let bp = 0, lp = 0;
  for (let k = 0; k < len; k++) {
    const u = k / SR, n = rnd() * 2 - 1;
    lp += (n - lp) * 0.35; bp = n - lp; // crude band
    const env = (u < 0.03 ? (Math.floor(u / 0.01) % 2 ? 0.5 : 1) : 1) * Math.exp(-u * 22);
    add(B, i0 + k, bp * env * g * 0.9, bp * env * g);
  }
}
function hat(B, t, g, open = false) {
  const i0 = Math.floor(t * SR), len = Math.floor((open ? 0.2 : 0.05) * SR);
  let prev = 0;
  for (let k = 0; k < len; k++) { const n = rnd() * 2 - 1, hp = n - prev; prev = n; add(B, i0 + k, hp * Math.exp(-(k / SR) * (open ? 14 : 70)) * g * 0.8, hp * Math.exp(-(k / SR) * (open ? 14 : 70)) * g); }
}
function noiseSweep(B, t, dur, g, up = true) {
  const i0 = Math.floor(t * SR), len = Math.floor(dur * SR);
  let lp = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len, a = up ? 0.02 + 0.5 * u * u : 0.5 - 0.48 * u, env = up ? u * u : Math.sin(Math.PI * u);
    lp += ((rnd() * 2 - 1) - lp) * a;
    add(B, i0 + k, lp * env * g, lp * env * g * 0.9);
  }
}
function tone(B, t, f0, f1, dur, g, shape = 'sine', pan = 0.5) {
  const i0 = Math.floor(t * SR), len = Math.floor(dur * SR);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len, f = f0 * (f1 / f0) ** u; ph += (2 * Math.PI * f) / SR;
    let s = Math.sin(ph); if (shape === 'square') s = Math.tanh(s * 3) * 0.6; if (shape === 'tri') s = Math.asin(Math.sin(ph)) * 0.64;
    const env = Math.min(1, k / (0.004 * SR)) * (1 - u) ** 1.5;
    add(B, i0 + k, s * env * g * (1 - pan) * 2, s * env * g * pan * 2);
  }
}

// ------------------------------------------------------------------ the track
// C major, I-V-vi-IV; a bouncy marimba hook, bass on the 8ths
const CH = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]];
const HOOK = [[0, 0], [0.5, 1], [1, 2], [1.5, 1], [2.25, 2], [2.75, 0], [3, 1], [3.5, 2]]; // one bar: [beat, chord tone]
const bars = Math.ceil(TOTAL / BAR);
for (let b = 0; b < bars; b++) {
  const t = b * BAR, ch = CH[b % 4];
  const intro = t < T_GROOVE - 0.01, breakdown = t >= T_COUNT && t < T_DROP - 0.3, outroFade = t >= TOTAL - 2;
  pad(M, t, ch.map((m) => m + 12), BAR + 0.3, intro ? 0.05 : 0.035);
  // marimba: arpeggio in the intro, hook in the groove
  if (intro) for (let s = 0; s < 8; s++) marimba(M, t + s * 0.25, ch[[0, 1, 2, 1, 0, 2, 1, 2][s]] + 24, 0.06, s % 2 ? 0.35 : 0.65);
  else if (!breakdown) for (const [bt, k] of HOOK) marimba(M, t + bt * BEAT, ch[k] + 24 + (b % 2 && bt >= 3 ? 12 : 0), 0.07, 0.5);
  if (!intro && !breakdown) {
    for (let e = 0; e < 8; e++) bass(M, t + e * 0.25, ch[0] - 12 + (e === 6 ? 7 : 0), 0.22, 0.2);
    for (let q = 0; q < 4; q++) { kick(M, t + q * BEAT, 0.55); hat(M, t + q * BEAT + 0.25, 0.06); if (q % 2) clap(M, t + q * BEAT, 0.16); }
    if (b % 4 === 3) hat(M, t + 1.75, 0.08, true);
  }
}
// breakdown: kick on each count, snare roll into the drop
for (let k = 0; k < 3; k++) kick(M, T_COUNT + 0.35 + k, 0.7);
for (let k = 0; k < 16; k++) clap(M, T_COUNT + 2.35 + k * (0.95 / 16), 0.03 + k * 0.006);

// sidechain pump: music ducks under each kick of the groove
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const inGroove = t >= T_GROOVE && !(t >= T_COUNT && t < T_DROP - 0.3);
  const ph = (t % BEAT) / BEAT, duck = inGroove ? 0.72 + 0.28 * Math.min(1, ph / 0.35) : 1;
  M[0][i] *= duck; M[1][i] *= duck;
}

// ------------------------------------------------------------------ effects from the cues
const pop = (t, i = 0) => { tone(X, t, 700 + (i % 5) * 90, 260, 0.08, 0.28, 'sine', 0.3 + (i % 3) * 0.2); tone(X, t, 2400, 1800, 0.01, 0.05); };
const blip = (t, f) => tone(X, t, f, f * 1.02, 0.09, 0.14, 'tri');
for (const [t, kind, a] of cues) {
  switch (kind) {
    case 'typing': for (let k = 0; k < a; k++) { tone(X, t + k * 0.05, 3200 + (k % 3) * 400, 2600, 0.012, 0.07, 'square', 0.4 + (k % 2) * 0.2); } break;
    case 'whoosh': noiseSweep(X, t, a, 0.35, false); break;
    case 'bounce': tone(X, t, 420 - a * 30, 180, 0.14, 0.3, 'sine', 0.2 + a * 0.12); break;
    case 'blips': for (let k = 0; k < a; k++) blip(t + k * 0.04, 900 + k * 120); break;
    case 'blip': blip(t, a); break;
    case 'swell': noiseSweep(X, t, a, 0.4, true); tone(X, t, 60, 30, a + 0.3, 0.35); break;
    case 'boom': tone(X, t, 90, 32, a, 0.8); noiseSweep(X, t, 0.25, 0.3, false); break;
    case 'pop': pop(t, a); break;
    case 'shimmer': for (let k = 0; k < 6; k++) tone(X, t + k * a / 8, 2093 * (1 + (k % 3) * 0.25), 2093 * (1 + (k % 3) * 0.25), 0.25, 0.035, 'sine', k % 2 ? 0.2 : 0.8); break;
    case 'counter': for (let k = 0; k < 24; k++) tone(X, t + a * (1 - (1 - k / 24) ** 2), 1800, 1700, 0.015, 0.06, 'square'); break;
    case 'popRun': for (let k = 0; k < 14; k++) pop(t + (k / 14) * a, k); break;
    case 'coins': for (let k = 0; k < 6; k++) { const tt = t + k * (a / 6); tone(X, tt, 1976, 1976, 0.08, 0.06, 'tri', 0.3); tone(X, tt + 0.05, 2637, 2637, 0.14, 0.06, 'tri', 0.7); } break;
    case 'hit': tone(X, t, 180, 60, 0.18, 0.35); hat(X, t, 0.18); break;
    case 'beep': tone(X, t, a, a, 0.07, 0.1, 'square'); break;
    case 'boing': { const i0 = Math.floor(t * SR), len = Math.floor(0.45 * SR); let ph = 0; for (let k = 0; k < len; k++) { const u = k / SR; ph += (2 * Math.PI * (220 + 90 * Math.sin(u * 50) * Math.exp(-u * 6) + 160 * (1 - u / 0.45))) / SR; add(X, i0 + k, Math.sin(ph) * Math.exp(-u * 6) * 0.3); } break; }
    case 'squeak': tone(X, t, 900, 1500, 0.12, 0.15, 'tri'); tone(X, t + 0.14, 1400, 1000, 0.1, 0.12, 'tri'); break;
    case 'chime': for (const [k, m] of [76, 79, 84].entries()) marimba(X, t + k * 0.12, m, 0.12, 0.3 + k * 0.2); break;
    case 'sting': tone(X, t, 110, 104, 0.6, 0.3, 'square'); tone(X, t, 116.5, 110, 0.6, 0.2, 'square'); break;
    case 'riserShort': noiseSweep(X, t, a, 0.25, true); tone(X, t, 300, 1200, a, 0.08, 'tri'); break;
    case 'riser': noiseSweep(X, t, a, 0.4, true); tone(X, t, 200, 1600, a, 0.07, 'tri'); break;
    case 'count': tone(X, t, a === 1 ? 1320 : 880, a === 1 ? 1320 : 880, 0.18, 0.2, 'tri'); tone(X, t, 110, 55, 0.2, 0.4); break;
    case 'burst': for (let k = 0; k < 30; k++) pop(t + k * 0.012, k); noiseSweep(X, t, 0.5, 0.35, false); break;
    default: break;
  }
}

// ------------------------------------------------------------------ mix, room, master
const out = [new Float32Array(N), new Float32Array(N)];
for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) out[c][i] = M[c][i] * 0.8 + X[c][i];
for (const [c, d1, d2] of [[0, 0.097, 0.149], [1, 0.113, 0.131]]) {
  const a = Math.floor(d1 * SR), b = Math.floor(d2 * SR), buf = out[c];
  for (let i = 0; i < N; i++) buf[i] += (i >= a ? buf[i - a] * 0.16 : 0) + (i >= b ? buf[i - b] * 0.11 : 0);
}
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / 0.05) * Math.min(1, (TOTAL - t) / 1.8);
  for (let c = 0; c < 2; c++) { out[c][i] = Math.tanh(out[c][i] * fade * 1.2); peak = Math.max(peak, Math.abs(out[c][i])); }
}
const norm = 0.89 / (peak || 1), pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { pcm.writeInt16LE(Math.round(out[0][i] * norm * 32767), 44 + i * 4); pcm.writeInt16LE(Math.round(out[1][i] * norm * 32767), 46 + i * 4); }
mkdirSync(new URL('../assets', import.meta.url), { recursive: true });
const wav = new URL('../assets/soundtrack.wav', import.meta.url).pathname, mp3 = wav.replace(/\.wav$/, '.mp3');
writeFileSync(wav, pcm);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', 'loudnorm=I=-14:TP=-1.2:LRA=9', '-ar', '44100', '-b:a', '256k', mp3]);
console.log(`soundtrack: ${TOTAL}s, ${cues.length} cues -> assets/soundtrack.mp3`);
