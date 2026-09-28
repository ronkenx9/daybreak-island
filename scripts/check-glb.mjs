// G6: the Blender chibi ships as a GLB under 1MB with the clips the game plays.
//   node scripts/check-glb.mjs
import { readFileSync } from 'node:fs';

const buf = readFileSync('public/models/chibi.glb');
const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)));
const clips = (json.animations ?? []).map((a) => a.name);
const need = ['idle', 'walk', 'dig', 'cheer', 'wave', 'sad'];
const missing = need.filter((n) => !clips.includes(n));
const names = new Set(json.nodes.map((n) => n.name));
const parts = ['Crown', 'Band', 'Frame', 'EyeWhite', 'Mouth', 'Torso', 'ShovelBlade'].filter((p) => !names.has(p));
console.log(`size=${(buf.length / 1024).toFixed(0)}KB clips=${clips.join(',')} missing=${[...missing, ...parts].join(',') || 'none'}`);
const ok = buf.length < 1024 * 1024 && !missing.length && !parts.length;
console.log(ok ? 'GLB OK' : 'GLB FAILED');
process.exit(ok ? 0 : 1);
