# Gates: Daybreak Island, slice 1 (Treasure Hunt, agent-first)

OWNS: src/**, server/**, scripts/**, test/**, public/**, contracts/**, deploy/**, index.html, package.json, vite.config.js, vercel.json, README.md

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

## Slice 3: real-stock prizes on Robinhood Chain testnet

Design: legendary chests no longer drop real stock directly. A fixed daily prize pool (funded by anyone, e.g. the token-fee flywheel) pays out at most N prizes a day, at most one per wallet per day, and only to players who proved they own a wallet. The game server never holds funds: it signs a single-use, expiring voucher, and the winner (human or agent) collects from the PrizeVault contract. The contract enforces its own daily cap, per-wallet limit, one-time use, expiry and a pause switch, so a stolen signing key costs at most one day's cap. Modes: off (default), testnet (Robinhood Chain 46630), later mainnet.

- [x] G11: PrizeVault contract is correct under unit and fuzz tests: valid voucher pays; replayed, expired, wrong-signer, wrong-chain, over-daily-cap, over-wallet-limit, unlisted-token and paused claims all revert; only admin can withdraw or change settings; anyone can fund.
  CHECK: cd contracts && forge test
  EXPECT: 0 failed
  EVIDENCE: automatic-evidence=v1; definition-sha256=78f54098fec56beb60e15d5985529a61145090fda11fd1060a3b4580b6b68d23; exit=0; EXPECT=matched; output-sha256=e6c644f1fbd2ba85d8a68ecc551958769cdc08f732518a106bcdae8b33eebe3f; output-bytes=1204; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G12: Server prize logic: no wallet means no real prize; wallet linking requires a valid signature over a fresh single-use challenge; the daily pool and one-per-wallet-per-day hold across a server restart (persisted); vouchers verify against the signer; mode off never issues vouchers.
  CHECK: node test/prizes.mjs
  EXPECT: PRIZES OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=50292d537486a02f2522e91db10646b0aa36588a8285074babfc8d1e866157dc; exit=0; EXPECT=matched; output-sha256=d23a4b8f24503443a5af656016cc9ddf3009987dd5d7fa328b1530528f85066e; output-bytes=620; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G13: End to end on a local fork of Robinhood Chain testnet with the real stock token contracts: an agent joins over the public API, links a wallet, digs a legendary chest, gets a voucher and collects a real TSLA token on-chain; replay and paused-vault collections fail.
  CHECK: node test/chain-e2e.mjs
  EXPECT: CHAIN E2E OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=025482194377f3a877f8d1390346064aa6bfb4aa53f49701fc1056d7d40eada7; exit=0; EXPECT=matched; output-sha256=758d86de29621e10166eb8adbb424f0d7b9c5fb31987fbc3dc30a33af2b64b9c; output-bytes=371; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G14: In the browser, a player with a wallet links it, sees the won prize and collects it on the fork (injected test wallet).
  CHECK: node test/browser-prize.mjs
  EXPECT: BROWSER PRIZE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=98dca490ed6aa772d45669e7d1bda80901047e6afaadcc11b1b1f97c1c8919ab; exit=0; EXPECT=matched; output-sha256=221ecfa875ebd4f6b636b06e8379aebaddc1a0d31de9b9b7b5bc1c3bf401a506; output-bytes=108; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [ ] G15: The vault is deployed on Robinhood Chain testnet, funded with faucet stock tokens, with the expected signer, caps and guardian (needs the owner to fund the deployer from the faucet).
  CHECK: node scripts/check-vault.mjs
  EXPECT: VAULT OK
  EVIDENCE: pending

## Slice 4: visual quality (close the gap to the reference video / Bruno Simon)

Target: sun shadows, dense wind-blown grass and props, forest clumps, finishing pass (tone mapping, miniature-style blur, vignette), a closer 3/4 camera, a real metal detector that sweeps with a ground pulse, and real digging (growing hole, flying dirt, chest reveal). Quality drops automatically on slow devices.

- [x] G16: Still light: 60fps or better in headless Chrome at 1280x720 on the high tier, under 150 draw calls, JS under 1.5MB.
  CHECK: node scripts/perf.mjs
  EXPECT: PERF OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c75e17706f6438f6e04faa9ce95723a19cadd56172bc2617d9671dc1226f4965; exit=0; EXPECT=matched; output-sha256=96cb8455cd71eee7e1e5bbc53e0d92cfeb6b70a3b1dee21a94da94961886fe2a; output-bytes=68; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G17: The visual systems are really on and react to play: shadows, finishing pass, dense grass, props; scanning shows the detector sweep and a ground pulse; digging grows a hole and throws dirt; a found chest rises out of the hole. Screenshot strip as evidence.
  CHECK: node scripts/check-visuals.mjs
  EXPECT: VISUALS OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=6c3b170f94b5eb6da5cf438d26732ff5b4cfd32c1932c15d94f50c0e0272da07; exit=0; EXPECT=matched; output-sha256=9f3bffadc8c3503b283673e01a149ff9ba68af076190dcd4205048371bd12a45; output-bytes=187; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G18: Automatic quality tiers: a slow device drops to a cheaper tier (no blur pass, smaller shadows, less grass) instead of lagging.
  CHECK: node scripts/check-visuals.mjs --tiers
  EXPECT: TIERS OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d0d6cf74f2bfd83f317a43de0a82d144ef6106d58e0d2d9d2da8c5a0d6ec3a67; exit=0; EXPECT=matched; output-sha256=8eb5b5935fcdca835e970400909d8da498fb41d236552b3a368d79a1e3e0fe10; output-bytes=223; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [ ] G19: (manual) side-by-side before/after screenshot against the reference video frame; the owner judges.
  EVIDENCE: evidence/before-after.png (before | now | reference frame); awaiting owner judgement

## Slice 5: gameplay feel (detector, digging, rewards)

- [x] G20: Server mechanics: detector readings are rate-limited per player (fast repeat calls get the last reading, not an error); digging where there is no chest can turn up funny junk; consecutive finds build a streak that multiplies made-up loot (not real prizes) and a miss resets it; if someone else digs your chest first you're told.
  CHECK: node test/mechanics.mjs
  EXPECT: MECHANICS OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=2fd5911b478b6ba754fe058673c796554cc55c3cb75ade33effbc02f18fe7f5c; exit=0; EXPECT=matched; output-sha256=17130a2de3eaf926a84bced7428823b756abf7af062f223848e3b14cbd3c26b9; output-bytes=382; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G21: In the browser: holding Space sweeps the detector continuously (several readings and pulses, faster beeps when close) and releasing stops it; an empty dig pops a junk item out of the hole; a chest shakes and glows its rarity colour before it opens, and a legendary shakes the camera; the streak shows in the HUD.
  CHECK: node scripts/check-visuals.mjs --mechanics
  EXPECT: MECHANICS UI OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=eed0675d183d355a54814b10135d45ad511456779dbbfbc0dee2533567945f81; exit=0; EXPECT=matched; output-sha256=f6bc5bb00f3c404bfa3ec109375059aa98c954214144a58b38637a778545a514; output-bytes=128; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

## Slice 6: WebGPU renderer + AAA polish

Target: three.js WebGPURenderer with TSL node materials (WebGL2 fallback on devices without WebGPU), and a cinematic finish: ambient occlusion, bloom, real depth of field, temporal anti-aliasing, colour grading, character rim light, drifting cloud shadows, sunlight dust motes, water sun glint. Same gameplay, same speed budget.

- [x] G22: The game runs on the WebGPU backend when available and on the WebGL2 fallback when forced, with no page errors on either; all visual effects and mechanics checks pass on WebGPU.
  CHECK: node scripts/check-visuals.mjs --backends && node scripts/check-visuals.mjs --backends --webgl
  EXPECT: BACKEND OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=02cc259908c4960bb01e1b16faccb70374ad85d4477344e3f807ba7b735aec76; exit=0; EXPECT=matched; output-sha256=a5149fc4379bc8c18f309c874f56ec6ad4b5752a2afc5640bfdc3e1675c3c89d; output-bytes=305; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G23: The high tier's finishing chain really contains ambient occlusion, bloom, depth of field, temporal anti-aliasing and colour grading; cloud shadows, dust motes and rim light are on; cheaper tiers drop the heavy passes.
  CHECK: node scripts/check-visuals.mjs --polish
  EXPECT: POLISH OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=e8b8efced5d6dc77068314a25744d73c242a3df7dc958bcf2aa16b9e5d081751; exit=0; EXPECT=matched; output-sha256=efd11ce37fb7275ca8b8b2910c7c81d749dbe7206d9ce5f784cdbc6fde6287b3; output-bytes=346; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

- [x] G24: Still fast on the new renderer: 60fps on the high tier in headless Chrome (WebGPU, 1280x720, 9 characters), under 150 draw calls, JS under 1.5MB.
  CHECK: node scripts/perf.mjs
  EXPECT: PERF OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c75e17706f6438f6e04faa9ce95723a19cadd56172bc2617d9671dc1226f4965; exit=0; EXPECT=matched; output-sha256=58483ea2e856b073b775c337710ee13da552a6e03adcf49db8f8ba86b03de2ed; output-bytes=69; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries

## Slice 7: free camera

- [x] G25: The player can move the camera: dragging orbits around the character (and tilts within limits), the wheel zooms within limits, C puts the camera straight behind the character; third-person steering (A/D turn on the spot, W walks where the character looks) with a follow camera that rides behind the character.
  CHECK: node scripts/check-visuals.mjs --camera
  EXPECT: CAMERA OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=f37323ecae7e3ebfd3d5002b50f64a7f4529dfdb30c66b2a8b1cdf3bee923121; exit=0; EXPECT=matched; output-sha256=d6b00a59578c434c76c0e18871e594ead8e953ee66855b2629af2b3ba2fe1901; output-bytes=84; shell=/bin/sh; cwd=/Users/gadgetplug/Documents/vibecoding/daybreak-island; path=64ef29d9c940/21 entries
