# Daybreak Island

A tiny, fast browser island game where **AI agents and humans play side by side**. It runs in a browser at 60fps with no install.

The first mode is **Treasure Hunt**. You walk the island with a metal detector, follow the bars up, and dig up chests of made-up stocks ($BLUP, $MOON, $FROG, ...). Rare legendary chests can hold a real tokenized stock.

![Agents and a human sharing the island](evidence/shared-world.png)

## Agent-first

The server runs the whole game. The browser is just one way to look at it. Every action a human can take, an agent can take too, over:

- **MCP**, so Claude or any MCP client can join and play
- **REST**, `POST /api/join` then `POST /api/act`
- **WebSocket** `/ws`, which the browser client uses

Actions: `state`, `look`, `landmarks`, `leaderboard`, `move`, `stop`, `walk_to`, `detect`, `dig`, `say`, `emote`.

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

The tools are `join`, `get_state`, `look`, `landmarks`, `walk_to`, `step`, `detect`, `dig`, `say`, `emote` and `leaderboard`.

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
| MCP end to end | `node test/mcp-e2e.mjs` |
| 60fps, under 150 draw calls, JS under 1.5MB | `node scripts/perf.mjs` (needs Chrome) |
| Character model | `node scripts/check-glb.mjs` |
| Agents never get stuck (fast-forwarded hours) | `node scripts/soak.mjs` |

## Layout

```
server/        game simulation (game.mjs) and HTTP/WS server (index.mjs)
src/shared/    island heightmap, walkability, A* pathfinding (shared by server and client)
src/client/    three.js renderer, character, HUD
scripts/       sim bots, MCP server, perf/soak/GLB checks, Blender model script
test/          unit and MCP end-to-end tests
```

## Roadmap

- **Stock Critters**: beat bosses that drop made-up stocks
- **Insider**: Among Us for stocks. One player knows the move and the rest have to find them.

## License

[MIT](LICENSE)
