// A small original music bed for the montage, synthesised offline (no samples,
// no licences): warm pad chords, a soft pluck arpeggio, a gentle kick/hat groove.
// 120 BPM, so every 2-second bar is a clean place to cut.
//   node scripts/make-bed.mjs [seconds=66] [out=assets/bed.wav]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SECONDS = Number(process.argv[2] ?? 66), OUT = process.argv[3] ?? 'assets/bed.wav';
const SR = 44100, N = Math.floor(SECONDS * SR), BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4;
const L = new Float32Array(N), R = new Float32Array(N);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Fmaj7 - Em7 - Dm7 - Cmaj7 (MIDI notes), one chord per bar
const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
const add = (buf, i, v) => { if (i >= 0 && i < N) buf[i] += v; };

function pad(t0, dur, notes, gain) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(dur * SR);
  for (let k = 0; k < len; k++) {
    const t = k / SR, env = Math.min(1, t / 0.6) * Math.min(1, (dur - t) / 0.8);
    let v = 0;
    for (const [j, m] of notes.entries()) {
      const f = hz(m);
      v += Math.sin(2 * Math.PI * f * t + j) * 0.6 + Math.sin(2 * Math.PI * f * 1.003 * t) * 0.4; // gently detuned
    }
    const s = (v / notes.length) * env * gain;
    add(L, i0 + k, s * 0.9); add(R, i0 + k, s * 1.0);
  }
}
function pluck(t0, m, gain, pan) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.9 * SR), f = hz(m);
  for (let k = 0; k < len; k++) {
    const t = k / SR, env = Math.exp(-t * 5.5);
    const s = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 9)) * env * gain;
    add(L, i0 + k, s * (1 - pan)); add(R, i0 + k, s * pan);
  }
}
function kick(t0, gain) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.35 * SR);
  let ph = 0;
  for (let k = 0; k < len; k++) {
    const t = k / SR, f = 50 + 70 * Math.exp(-t * 28);
    ph += (2 * Math.PI * f) / SR;
    const s = Math.sin(ph) * Math.exp(-t * 9) * gain;
    add(L, i0 + k, s); add(R, i0 + k, s);
  }
}
function hat(t0, gain) {
  const i0 = Math.floor(t0 * SR), len = Math.floor(0.06 * SR);
  let prev = 0;
  for (let k = 0; k < len; k++) {
    const n = rnd() * 2 - 1, hp = n - prev; prev = n; // crude high-pass on noise
    const s = hp * Math.exp(-(k / SR) * 60) * gain;
    add(L, i0 + k, s * 0.8); add(R, i0 + k, s);
  }
}

const bars = Math.ceil(SECONDS / BAR);
for (let b = 0; b < bars; b++) {
  const t = b * BAR, chord = CHORDS[b % 4];
  const intro = b < 2, outro = b >= bars - 2;
  pad(t, BAR + 0.4, chord, 0.16);
  // arpeggio: 8 notes a bar, up an octave, skipping around the chord
  if (!intro) for (let s = 0; s < 8; s++) if (s !== 7 || b % 2) pluck(t + s * BEAT / 2, chord[[0, 2, 1, 3, 2, 1, 3, 2][s]] + 12, 0.07, s % 2 ? 0.35 : 0.65);
  // groove from bar 3; drops out for the last two bars
  if (!intro && !outro) for (let q = 0; q < 4; q++) { kick(t + q * BEAT, q % 2 ? 0.28 : 0.4); hat(t + q * BEAT + BEAT / 2, 0.05); }
}

// soft room: two feedback delays, then a gentle master fade in/out and normalise
for (const [buf, d1, d2] of [[L, 0.113, 0.171], [R, 0.127, 0.157]]) {
  const a = Math.floor(d1 * SR), b = Math.floor(d2 * SR);
  for (let i = 0; i < N; i++) buf[i] += (i >= a ? buf[i - a] * 0.28 : 0) + (i >= b ? buf[i - b] * 0.2 : 0);
}
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, fade = Math.min(1, t / 1.5) * Math.min(1, (SECONDS - t) / 2.5);
  L[i] *= fade; R[i] *= fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.8 / (peak || 1);
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * norm * 32767))), 44 + i * 4);
  pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * norm * 32767))), 46 + i * 4);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, pcm);
console.log(`wrote ${OUT}: ${SECONDS}s at ${BPM} BPM (${bars} bars)`);
