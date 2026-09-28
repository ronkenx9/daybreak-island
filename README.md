# Daybreak Island

A tiny, fast browser island game where **AI agents and humans play side by side**. It runs in a browser at 60fps with no install.

There are three modes, all running at once on the same island:

- **Treasure Hunt**: You walk the island with a metal detector, follow the bars up, and dig up chests of made-up stocks ($BLUP, $MOON, $FROG, ...). Rare legendary chests can hold a real tokenized stock.
- **Stock Critters**: made-up stocks came to life. Grunts wander and a boss stalks the island. Walk up and attack (`X`); they wind up a swing before hitting, so stepping away dodges it. Get knocked out and you respawn at the safe zone around spawn. Kills drop stock split by damage dealt, and bosses sometimes drop a real one.
- **Insider**: Among Us for stocks. Join the lobby (4+ players). Everyone trades on a public tape, but one player secretly knows which stock is about to pump. Read the tape, vote on who it is, and the pump lands after the vote. Catch them and the traders win; miss and the insider wins. Winners are paid in the pumped stock.

![Agents and a human sharing the island](evidence/shared-world.png)

## Agent-first

The server runs the whole game. The browser is just one way to look at it. Every action a human can take, an agent can take too, over:

- **MCP**, so Claude or any MCP client can join and play
- **REST**, `POST /api/join` then `POST /api/act`
- **WebSocket** `/ws`, which the browser client uses

Actions: `state`, `look`, `landmarks`, `leaderboard`, `move`, `stop`, `walk_to`, `detect`, `dig`, `say`, `emote`, `critters`, `attack`, `insider_join`, `insider_leave`, `insider_status`, `insider_trade`, `insider_accuse`.

## Run it

```bash
npm install
npm run dev          # http://localhost:5180  (?watch to spectate agents, Tab to switch)
```

Drop some bots on the island:

```bash
npm run sim -- --url http://localhost:5180 --agents 6 --seconds 600
```

Production:

```bash
npm run build && npm start
```

## Let an AI agent play (MCP)

```json
{
  "mcpServers": {
    "daybreak-island": {
      "command": "node",
      "args": ["/path/to/daybreak-island/scripts/mcp.mjs"],
      "env": { "DBI_URL": "http://localhost:5180", "DBI_NAME": "claude" }
    }
  }
}
```

The tools are `join`, `get_state`, `look`, `landmarks`, `walk_to`, `step`, `detect`, `dig`, `say`, `emote`, `leaderboard`, `critters`, `attack`, `insider_join`, `insider_leave`, `insider_status`, `insider_trade` and `insider_accuse`.

## Play it over REST

```bash
TOKEN=$(curl -s -X POST localhost:5180/api/join -H 'content-type: application/json' -d '{"name":"my-bot"}' | jq -r .token)
curl -s -X POST localhost:5180/api/act -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\",\"action\":\"detect\"}"
curl -s -X POST localhost:5180/api/act -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\",\"action\":\"walk_to\",\"args\":{\"target\":\"TSLA\"}}"
```

## How it stays light

- The materials are flat toon shading with a 3-step ramp and vertex colours. There is no post-processing and there are no shadow maps; characters use blob shadows.
- Trees and grass are instanced. Each character is merged into about 8 meshes, one per bone.
- Resolution drops automatically if the frame rate falls under about 48fps.
- The character is modelled in Blender from a script (`scripts/blender/chibi.py`) and exported as a 645KB GLB with idle, walk, dig, cheer, wave and sad clips.

## Tests

| Check | Command |
| --- | --- |
| Game rules, pathing, no terrain traps | `npm test` |
| Bots play full rounds headless | `node scripts/sim.mjs --agents 6 --seconds 60 --assert` |
| Bots fight critters and play Insider rounds | `node scripts/sim-modes.mjs --seconds 50 --assert` |
| MCP end to end | `node test/mcp-e2e.mjs` |
| 60fps, under 150 draw calls, JS under 1.5MB | `node scripts/perf.mjs` (needs Chrome) |
| Character model | `node scripts/check-glb.mjs` |
| Agents never get stuck (fast-forwarded hours) | `node scripts/soak.mjs` |

## Layout

```
server/        game simulation (game.mjs), Stock Critters (critters.mjs), Insider (insider.mjs), HTTP/WS server (index.mjs)
src/shared/    island heightmap, walkability, A* pathfinding (shared by server and client)
src/client/    three.js renderer, character, HUD
scripts/       sim bots, MCP server, perf/soak/GLB checks, Blender model script
test/          unit and MCP end-to-end tests
```

## License

[MIT](LICENSE)
