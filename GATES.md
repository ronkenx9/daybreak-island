# Gates: Daybreak Island, slice 1 (Treasure Hunt, agent-first)

OWNS: src/**, server/**, scripts/**, test/**, public/**, index.html, package.json, vite.config.js, README.md

Scope: A lightweight island game where the server owns the whole Treasure Hunt simulation (detector, digging, chests of made-up stock plus rare real drops). AI agents can join and play every action through HTTP/MCP with no browser. A Bruno-style low-cost renderer lets humans play or watch.

- [x] G1: The server simulation is correct: walkability and pathing, detector signal rising toward chests, digging only claiming nearby chests, chest respawn, and portfolio accounting.
  CHECK: node test/run.mjs
  EXPECT: ALL TESTS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=39a32a6de008cf322b8e05085a00f6a3df80d15f869a0318c7e77d59adb4a4e4; exit=0; EXPECT=matched; output-sha256=1ed7a03b0789a4d9cc3fa90554270d835d37ae9c41a2365ce19236db441e2deb; output-bytes=314; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=119a07387374/26 entries

- [x] G2: Agents alone can play full rounds headlessly. N bot agents joining over HTTP find and dig chests with no human and no browser.
  CHECK: node scripts/sim.mjs --agents 6 --seconds 60 --assert
  EXPECT: SIM OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=b4db0616896698516ce3d34fd076be195a4c98de6930625be3431b5b8883f610; exit=0; EXPECT=matched; output-sha256=662cee3408200401001c0e8334f41fb6272c2bad605a5c8fdd6f1dc359648706; output-bytes=199; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=119a07387374/26 entries

- [x] G3: The MCP server exposes every player action (join, state, look, walk_to, move, detect, dig, say, emote, leaderboard) and a real MCP client can call them end to end.
  CHECK: node test/mcp-e2e.mjs
  EXPECT: MCP OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=b487a3bf854d2f6d5f52e8a01958934361918ff1ffeb414cdab8a8f98634ed47; exit=0; EXPECT=matched; output-sha256=b2777ef7e19bed0adcd95c04e3784766ae31b5a93bb5265d7d1e6f318d9e1084; output-bytes=450; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=119a07387374/26 entries

- [x] G4: The client renders lightweight: 60fps or better in headless Chrome at 1280x720, under 150 draw calls, and a JS bundle under 1.5MB.
  CHECK: node scripts/perf.mjs
  EXPECT: PERF OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c75e17706f6438f6e04faa9ce95723a19cadd56172bc2617d9671dc1226f4965; exit=0; EXPECT=matched; output-sha256=53bfbb456b316adeee19f0f62d97de7b673f0a9ff33ffd5ca630a4c52182128c; output-bytes=67; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=119a07387374/26 entries

- [x] G5: A human in the browser and agents share the same world live: the human sees agents moving and digging, and agents see the human (screenshot evidence).
  EVIDENCE: evidence/shared-world.png: human "perf-human" plus 8 agents in one world, rendered from live server snapshots

- [x] G6: The Blender-modeled chibi Daybreak character (ushanka, chrome glasses, full body, walk/dig/cheer animations) loads as a GLB under 1MB (screenshot evidence).
  CHECK: node scripts/check-glb.mjs
  EXPECT: GLB OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=fbf801ffb8015ac96f830cd8a7033635dcd69c6f32dee89f0a262952f2347bc3; exit=0; EXPECT=matched; output-sha256=6d9877090e9219a62f403812cf11607825b504d7f57f23051d349d8b3aeb86a2; output-bytes=66; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=119a07387374/26 entries

- [x] G7: Agents never get stuck. 12 bots playing 10 fast-forwarded game-hours (5 runs x 2h) never hang on an action, never get trapped in terrain, and never get kicked as idle.
  CHECK: node scripts/soak.mjs --bots 12 --hours 2 --runs 5
  EXPECT: SOAK OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=ff6c25212c452ac11f20c571f377f43638a7f77f42c36ac6aa6df161ef9620a3; exit=0; EXPECT=matched; output-sha256=0305b93068a4d032dd2c0f87b397c20c6d14c87be58f3384a46a78c2b2333dbd; output-bytes=278; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=119a07387374/26 entries

## Slice 2: public deploy (Vercel page + VPS game server)

- [x] G8: The server is safe to expose publicly: a player cap, per-IP join rate limit, one player per WebSocket connection, small max message size, and stale agent tokens are cleaned up.
  CHECK: node test/public.mjs
  EXPECT: PUBLIC OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=b8d359bfda70964c8310b6c92b89c5c48a7047d8d32139ca0fa9dd2bfa06e230; exit=0; EXPECT=matched; output-sha256=0eb9cf176e3f038f73dd288479aec03f715d0e410479c0bd150fa83d71fa72aa; output-bytes=291; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G9: The live game server on the VPS answers over HTTPS with resident agents playing.
  CHECK: curl -s https://198-96-95-46.sslip.io/api/health
  EXPECT: "ok":true
  EVIDENCE: automatic-evidence=v1; definition-sha256=cf45da37daf708ffc0475202c99525fa2da3b89c54782224bd3a2ec95d8ebf74; exit=0; EXPECT=matched; output-sha256=7c2770ce866bef2b3406393dc779bea60a68b648a4f08cc3aa62695948b55bcb; output-bytes=48; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G10: The Vercel site loads in a real browser, connects to the VPS server over secure WebSocket, shows live characters and the chibi model, with no page errors.
  CHECK: node scripts/check-live.mjs
  EXPECT: LIVE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=3043cbdfc22e82ab9685795d33d8eb64e2e1be6818da155332e48ecf8fd69c29; exit=0; EXPECT=matched; output-sha256=5c19a0557296f51a6914bb1bfb5599ad203bac187a1e8b48557f31f63a23f599; output-bytes=143; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries
