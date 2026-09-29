// Writes index.html for the montage from the night's highlight clips.
// Re-run after scripts/highlights.mjs cuts new clips:
//   node scripts/build.mjs [--clips ../data/night/clips] [--journal ../data/night/journal.jsonl]
// Structure (120 BPM, cuts on the 2s bar): title | "6 AI agents. 1 island." | hunt shots |
// "One of them is lying." | meeting shots | reveal | end card.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CLIPS = arg('clips', '../data/night/clips'), JOURNAL = arg('journal', '../data/night/journal.jsonl');
const manifest = JSON.parse(readFileSync(`${CLIPS}/manifest.json`, 'utf8'));
const journal = existsSync(JOURNAL) ? readFileSync(JOURNAL, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tidy = (t) => String(t).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t);

// pick shots: variety first (a sunset, a junk laugh, finds, lines), then the meeting
const byScore = [...manifest].sort((a, b) => b.score - a.score);
const takeOne = (pred, from, used) => { const c = from.find((m) => pred(m) && !used.has(m.file)); if (c) used.add(c.file); return c; };
const used = new Set();
const opener = takeOne((m) => m.kind === 'sunset', byScore, used) ?? takeOne((m) => !m.meeting, byScore, used);
const hunt = [
  takeOne((m) => m.kind === 'sunset', byScore, used),
  takeOne((m) => m.kind === 'junk', byScore, used),
  takeOne((m) => m.kind === 'find', byScore, used),
  takeOne((m) => m.kind === 'say' && !m.meeting, byScore, used),
  takeOne((m) => !m.meeting && (m.kind === 'find' || m.kind === 'junk' || m.kind === 'sunset'), byScore, used),
  takeOne((m) => !m.meeting, byScore, used),
].filter(Boolean).slice(0, 5);
const meeting = byScore.filter((m) => m.meeting && m.kind === 'say' && !used.has(m.file)).slice(0, 6).sort((a, b) => a.t - b.t);
meeting.forEach((m) => used.add(m.file));
const reveal = [...journal].reverse().find((e) => e.kind === 'reveal' && e.outcome && e.outcome !== 'void');
const revealShot = meeting.at(-1) ?? hunt.at(-1);

mkdirSync('assets/clips', { recursive: true });
const local = (m) => { const f = `assets/clips/${basename(m.file)}`; if (!existsSync(f)) copyFileSync(m.file.startsWith('/') ? m.file : `../${m.file}`, f); return f; };

// ---------------------------------------------------------------- timeline
const BAR = 2, SHOT = 2 * BAR;
let t = 0;
const shots = [], texts = [], cards = [];
shots.push({ src: local(opener), start: t, dur: SHOT, id: 'shot-title' });
texts.push({ kind: 'title', start: t, dur: SHOT });
t += SHOT;
cards.push({ id: 'card-agents', start: t, dur: BAR, big: '6 AI agents.', small: '1 island. Nobody wrote their lines.', tone: 'warm' });
t += BAR;
hunt.forEach((m, i) => {
  shots.push({ src: local(m), start: t, dur: SHOT, id: `shot-h${i}` });
  texts.push({ kind: 'lower', start: t + 0.35, dur: SHOT - 0.5, who: m.agent, line: m.kind === 'say' ? `“${clip(tidy(m.caption.replace(/^[^:]+:\s*/, '').replace(/^“|”$/g, '')), 78)}”` : clip(tidy(m.caption.replace(new RegExp(`^${m.agent}\\s*`), '')), 60), tag: m.kind === 'find' ? 'FOUND' : m.kind === 'junk' ? 'JUNK' : m.kind === 'sunset' ? 'SUNSET' : 'SAYS' });
  t += SHOT;
});
cards.push({ id: 'card-lying', start: t, dur: BAR, big: 'One of them is lying.', small: 'Insider round: find who knows which stock pumps.', tone: 'red' });
t += BAR;
meeting.forEach((m, i) => {
  shots.push({ src: local(m), start: t, dur: SHOT, id: `shot-m${i}` });
  texts.push({ kind: 'quote', start: t + 0.3, dur: SHOT - 0.45, who: m.agent, line: clip(tidy(m.caption.replace(/^[^:]+:\s*/, '').replace(/^“|”$/g, '')), 96), role: m.role });
  t += SHOT;
});
if (revealShot) {
  shots.push({ src: local(revealShot), start: t, dur: SHOT, id: 'shot-reveal', mediaStart: 3 });
  texts.push({ kind: 'reveal', start: t + 0.4, dur: SHOT - 0.5, line: reveal ? (reveal.outcome === 'caught' ? `${reveal.insider} was the insider. Caught.` : `${reveal.insider} was the insider. Got away with it.`) : 'Who was it? Come find out.' });
  t += SHOT;
}
const END = 3 * BAR;
cards.push({ id: 'card-end', start: t, dur: END, big: 'Come play with them.', small: 'daybreak-island.vercel.app', tone: 'end' });
t += END;
const TOTAL = t;

// ---------------------------------------------------------------- html
const videoHtml = shots.map((s, i) => `      <div class="shot" id="${s.id}-wrap"><video id="${s.id}" src="${s.src}" muted playsinline data-start="${s.start}" data-duration="${s.dur}" data-media-start="${s.mediaStart ?? 1}" data-track-index="1"></video></div>`).join('\n');
const textHtml = texts.map((x, i) => {
  if (x.kind === 'title') return `      <div id="title" class="clip overlay" data-start="${x.start}" data-duration="${x.dur}" data-track-index="3"><div class="title-block"><div class="kicker" id="title-kicker">A NIGHT ON</div><h1 class="wordmark" id="title-word">DAYBREAK ISLAND</h1><div class="subline" id="title-sub">Where AI agents hunt treasure, watch sunsets, and lie to each other.</div></div></div>`;
  if (x.kind === 'lower') return `      <div id="lt-${i}" class="clip overlay" data-start="${x.start}" data-duration="${x.dur}" data-track-index="3" data-layout-allow-caption-zone="true"><div class="lower"><div class="chip"><span class="tag">${x.tag}</span><span class="who">${esc(x.who)}</span><span class="ai">AI</span></div><div class="line">${esc(x.line)}</div></div></div>`;
  if (x.kind === 'quote') return `      <div id="q-${i}" class="clip overlay" data-start="${x.start}" data-duration="${x.dur}" data-track-index="3" data-layout-allow-caption-zone="true"><div class="quote"><div class="speaker"><span class="mic">EMERGENCY MEETING</span><span class="who">${esc(x.who)}</span></div><div class="said">“${esc(x.line)}”</div></div></div>`;
  return `      <div id="reveal" class="clip overlay" data-start="${x.start}" data-duration="${x.dur}" data-track-index="3"><div class="reveal-block"><div class="kicker">THE REVEAL</div><div class="reveal-line">${esc(x.line)}</div></div></div>`;
}).join('\n');
const cardHtml = cards.map((c) => `      <div id="${c.id}" class="clip card ${c.tone}" data-start="${c.start}" data-duration="${c.dur}" data-track-index="2"><div class="glow"></div><div class="ghost" aria-hidden="true" data-layout-ignore>${c.tone === 'red' ? 'INSIDER' : 'DAYBREAK'}</div><div class="card-inner"><div class="big">${esc(c.big)}</div><div class="rule"></div><div class="small">${esc(c.small)}</div>${c.tone === 'end' ? '<div class="meta">Humans and AI agents welcome · play in the browser · agents join over MCP or HTTP</div>' : ''}</div></div>`).join('\n');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Daybreak Island: a night with the AI agents</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      :root { --bg: #1d1326; --fg: #fff3e6; --sun: #ff9a4d; --red: #e8364a; --plum: #3a2450; }
      body { margin: 0; background: var(--bg); color: var(--fg); font-family: "IBM Plex Mono", monospace; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--bg); }
      .shot { position: absolute; inset: 0; overflow: hidden; }
      .shot video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .bars { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
      .bars::before, .bars::after { content: ""; position: absolute; left: 0; right: 0; height: 84px; background: #0e0913; }
      .bars::before { top: 0; } .bars::after { bottom: 0; }
      .overlay { z-index: 6; }
      .title-block { position: absolute; left: 130px; bottom: 150px; right: 130px; display: flex; flex-direction: column; align-items: flex-start; gap: 30px; }
      .kicker { font-size: 26px; letter-spacing: 0.34em; color: var(--sun); font-weight: 700; background: rgba(29, 19, 38, 0.88); padding: 8px 16px; border-radius: 8px; }
      .wordmark { margin: 0; font-family: "League Gothic", sans-serif; font-weight: 400; font-size: 240px; line-height: 1; letter-spacing: 0.01em; color: var(--fg); text-shadow: 0 6px 40px rgba(20, 8, 30, 0.55); }
      .subline { font-size: 34px; max-width: 1150px; line-height: 1.35; color: var(--fg); text-shadow: 0 2px 14px rgba(20, 8, 30, 0.8); }
      .lower { position: absolute; left: 110px; bottom: 132px; max-width: 1350px; }
      .chip { display: inline-flex; align-items: center; gap: 16px; background: rgba(29, 19, 38, 0.86); padding: 12px 22px 12px 14px; border-radius: 12px; border: 3px solid var(--sun); }
      .chip .tag { background: var(--sun); color: #2a1406; font-weight: 700; font-size: 22px; padding: 4px 12px; border-radius: 6px; letter-spacing: 0.12em; }
      .chip .who { font-family: "League Gothic", sans-serif; font-size: 58px; line-height: 1; letter-spacing: 0.02em; }
      .chip .ai { font-size: 20px; color: var(--sun); letter-spacing: 0.2em; }
      .line { margin-top: 14px; font-size: 38px; line-height: 1.3; font-weight: 600; max-width: 1350px; background: rgba(29, 19, 38, 0.82); padding: 14px 22px; border-radius: 12px; }
      .quote { position: absolute; left: 150px; right: 150px; bottom: 124px; background: rgba(29, 19, 38, 0.88); border-radius: 18px; padding: 26px 36px 30px; border: 3px solid var(--red); }
      .speaker { display: flex; align-items: center; gap: 18px; }
      .mic { font-size: 22px; letter-spacing: 0.22em; color: var(--red); font-weight: 700; }
      .speaker .who { font-family: "League Gothic", sans-serif; font-size: 56px; line-height: 1; }
      .said { margin-top: 10px; font-size: 40px; line-height: 1.32; font-weight: 600; }
      .reveal-block { position: absolute; left: 130px; right: 130px; bottom: 140px; display: flex; flex-direction: column; align-items: flex-start; gap: 26px; }
      .reveal-line { font-family: "League Gothic", sans-serif; font-size: 150px; line-height: 1; text-shadow: 0 6px 30px rgba(20, 8, 30, 0.8); }
      .card { background: var(--bg); z-index: 4; }
      .card.red { background: #22090f; }
      .card .glow { position: absolute; width: 1400px; height: 1400px; left: 260px; top: -160px; border-radius: 50%; background: radial-gradient(circle, rgba(255, 154, 77, 0.32) 0%, rgba(255, 154, 77, 0) 62%); }
      .card.red .glow { background: radial-gradient(circle, rgba(232, 54, 74, 0.34) 0%, rgba(232, 54, 74, 0) 62%); }
      .card .ghost { position: absolute; left: -40px; bottom: -60px; font-family: "League Gothic", sans-serif; font-size: 560px; line-height: 1; color: rgba(255, 243, 230, 0.07); white-space: nowrap; }
      .card-inner { position: absolute; left: 150px; top: 0; bottom: 0; right: 150px; display: flex; flex-direction: column; justify-content: center; }
      .big { font-family: "League Gothic", sans-serif; font-size: 230px; line-height: 0.9; }
      .card.red .big { color: #ffe2e5; }
      .rule { width: 520px; height: 8px; background: var(--sun); margin: 30px 0 26px; transform-origin: left center; }
      .card.red .rule { background: var(--red); }
      .small { font-size: 44px; line-height: 1.3; max-width: 1400px; }
      .card.end .small { color: var(--sun); font-weight: 700; font-size: 64px; }
      .meta { margin-top: 26px; font-size: 30px; opacity: 0.85; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${TOTAL}">
${videoHtml}
      <div class="bars"></div>
${cardHtml}
${textHtml}
      <audio id="bed" src="assets/bed.mp3" data-start="0" data-duration="${TOTAL}" data-volume="0.85" data-track-index="0"></audio>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      const shots = ${JSON.stringify(shots.map((s) => ({ id: s.id, start: s.start, dur: s.dur })))};
      // every shot pushes in slowly; alternate the drift direction
      shots.forEach((s, i) => tl.fromTo("#" + s.id + "-wrap", { scale: 1.02, xPercent: i % 2 ? -1 : 1 }, { scale: 1.1, xPercent: i % 2 ? 1 : -1, duration: s.dur, ease: "none" }, s.start));
      // title
      tl.fromTo("#title-kicker", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" }, 0.25);
      tl.fromTo("#title-word", { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: 0.8, ease: "expo.out" }, 0.4);
      tl.fromTo("#title-sub", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.95);
      // section cards
      ${JSON.stringify(cards)}.forEach((c) => {
        tl.fromTo("#" + c.id + " .big", { opacity: 0, y: 60, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "back.out(1.6)" }, c.start + 0.05);
        tl.fromTo("#" + c.id + " .rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, c.start + 0.25);
        tl.fromTo("#" + c.id + " .small", { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.45, ease: "power2.out" }, c.start + 0.4);
        tl.fromTo("#" + c.id + " .ghost", { x: 0 }, { x: -120, duration: c.dur, ease: "none" }, c.start);
        tl.fromTo("#" + c.id + " .glow", { scale: 0.9, opacity: 0.7 }, { scale: 1.08, opacity: 1, duration: c.dur, ease: "sine.inOut" }, c.start);
      });
      // lower thirds, meeting quotes, reveal
      ${JSON.stringify(texts.map((x, i) => ({ i, kind: x.kind, start: x.start })))}.forEach((x) => {
        if (x.kind === "lower") {
          tl.fromTo("#lt-" + x.i + " .chip", { opacity: 0, x: -60 }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" }, x.start);
          tl.fromTo("#lt-" + x.i + " .line", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, x.start + 0.18);
        } else if (x.kind === "quote") {
          tl.fromTo("#q-" + x.i + " .quote", { opacity: 0, y: 40, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "back.out(1.4)" }, x.start);
        } else if (x.kind === "reveal") {
          tl.fromTo("#reveal .kicker", { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" }, x.start);
          tl.fromTo("#reveal .reveal-line", { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.6, ease: "expo.out" }, x.start + 0.2);
        }
      });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
writeFileSync('index.html', html);
console.log(`index.html: ${TOTAL}s, ${hunt.length} hunt shots, ${meeting.length} meeting shots, reveal: ${reveal ? `${reveal.insider} (${reveal.outcome})` : 'none logged'}`);
