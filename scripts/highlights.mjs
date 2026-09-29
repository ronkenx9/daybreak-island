// Cut highlight clips for the montage: match interesting journal moments to the
// footage segment that was filming that agent (or the meeting circle) at that
// moment, and cut a short clip around it with the line as a caption.
//   node scripts/highlights.mjs [--dir data/night] [--max 40] [--len 6]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('dir', 'data/night'), MAX = Number(arg('max', 40)), LEN = Number(arg('len', 6));
const read = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const journal = read(`${DIR}/journal.jsonl`);
// only finished segments: the mp4 exists and really has a video stream (the recorder compresses in the background)
const hasVideo = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', f]).toString().trim()) > 60; } catch { return false; } };
const segs = read(`${DIR}/footage/index.jsonl`).filter((s) => existsSync(s.file) && hasVideo(s.file));
mkdirSync(`${DIR}/clips`, { recursive: true });

// what counts as a moment, and how much we want it
const score = (e) => {
  if (e.kind === 'find') return e.rarity === 'legendary' ? 10 : e.rarity === 'rare' ? 5 : 2;
  if (e.kind === 'junk') return 6;
  if (e.kind === 'sunset') return 7;
  if (e.kind === 'say' && e.meeting) return 6 + (/insider|sus|lying|voting|vote/i.test(e.text) ? 2 : 0);
  if (e.kind === 'vote') return 4;
  if (e.kind === 'rumor') return 5;
  if (e.kind === 'say') return /!|\?/.test(e.text) ? 2 : 1;
  return 0;
};
const moments = journal.map((e) => ({ ...e, s: score(e) })).filter((e) => e.s > 0);
const picked = [];
for (const e of moments.sort((a, b) => b.s - a.s)) {
  // footage that was filming this agent (meeting lines: any segment, the camera frames the circle)
  const seg = segs.find((s) => e.t >= s.start + 1500 && e.t <= s.end - 1000 && (e.meeting || s.follow === e.agent));
  if (!seg) continue;
  if (picked.some((p) => p.seg.file === seg.file && Math.abs(p.t - e.t) < LEN * 1000)) continue; // no overlapping clips
  picked.push({ ...e, seg });
  if (picked.length >= MAX) break;
}
picked.sort((a, b) => a.t - b.t);
const manifest = picked.map((p, i) => {
  const at = Math.max(0, (p.t - p.seg.start) / 1000 - LEN * 0.35);
  const out = `${DIR}/clips/clip-${String(i).padStart(3, '0')}-${p.kind}-${p.agent}.mp4`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(2), '-i', p.seg.file, '-t', String(LEN), '-c:v', 'h264_videotoolbox', '-b:v', '5M', '-an', out]);
  if (!hasVideo(out)) return null; // cut failed: leave it out
  const caption = p.kind === 'say' ? `${p.agent}: “${p.text}”` : p.kind === 'find' ? `${p.agent} ${p.text}` : p.kind === 'junk' ? `${p.agent} ${p.text}` : p.kind === 'sunset' ? `${p.agent} stops to watch the sunset` : p.kind === 'vote' ? `${p.agent} ${p.text}` : p.kind === 'rumor' ? `${p.agent} plants a rumour: “${p.text}”` : p.text;
  return { file: out, kind: p.kind, agent: p.agent, caption, meeting: !!p.meeting, role: p.role ?? null, t: p.t, score: p.s };
}).filter(Boolean);
writeFileSync(`${DIR}/clips/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`${moments.length} moments, ${segs.length} segments -> ${manifest.length} clips`);
for (const m of manifest.slice(0, 12)) console.log(`  ${m.kind.padEnd(7)} ${m.caption.slice(0, 100)}`);
