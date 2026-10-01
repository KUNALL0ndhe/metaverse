# ◆ metaverse

A pixel-art copy of a **real neighbourhood** that you and your friends can walk around in. When you walk up to someone, a **video call** starts automatically. Step into a meeting room for a private conversation, or wave at people as you pass. It's in the same spirit as Gather and ZEP, but the map is generated from OpenStreetMap, so it's _your_ streets.

## Features

- 🗺️ **Real-world maps.** One command pulls the roads, buildings, parks, water, trees, street lamps and shop names around any address from OpenStreetMap and turns them into a walkable pixel-art map. Your HQ office is placed at the centre.
- 🎥 **Proximity video and voice.** WebRTC calls connect when players are within a few tiles and drop when they walk away. Voices fade with distance.
- 🔒 **Private rooms.** Inside a meeting room, only people in that room can hear each other, whatever the distance. Walls block sound.
- 🖥️ **Screen sharing**, speaking indicators, and click-to-spotlight on any video tile.
- 🧭 **Click-to-walk** using A* pathfinding. You can also click the minimap to travel, or use "Walk to" on anyone in the People list.
- 💬 **Chat** to everyone or only to people nearby, with speech bubbles over avatars, emotes (`1`–`6`) and a status line.
- 🧑‍🎨 **Avatar creator.** Every sprite is drawn in code, with no image assets.
- 🌙 **Live day/night cycle** that follows your local clock, with street lamps that light up after dark.
- 🛡️ **Server-checked movement.** The server checks speed and collisions, rate-limits chat, and enforces room caps.
- 🔗 **Shareable spaces.** `?space=team-standup` gives each group its own instance of the world.

## Architecture

```
apps/client      Vite + React UI, canvas renderer, WebRTC mesh
apps/realtime    Node WebSocket server: rooms, movement validation, chat, WebRTC signalling.
                 Also serves the built client, so production runs as one process on one port.
packages/world   Shared map format, wire protocol, avatar model, OSM importer, procedural town
maps/            Generated maps (maps/default.json is loaded by the server)
apps/http        REST API + Prisma (accounts/spaces). Not required by the world yet.
```

Each meeting is a WebRTC peer-to-peer mesh. The peer with the lower id always sends the offer, so the two sides never offer at the same time. Mic, camera and screen-share changes use `replaceTrack`, so they never need renegotiation.

## Quick start

```bash
pnpm install
pnpm map:import --place "Your Neighbourhood, Your City"   # optional — otherwise you get a procedural town
pnpm dev                                                   # client on :5173, realtime server on :8080
```

Open http://localhost:5173 in two browser windows and walk them towards each other.

### Map import options

```bash
pnpm map:import --place "Koregaon Park, Pune"
pnpm map:import --lat 18.5362 --lng 73.8940 --radius 350 --name "My Hood" --hq "Our HQ"
```

| flag       | default | meaning                                        |
| ---------- | ------- | ---------------------------------------------- |
| `--radius` | `300`   | half-width of the imported square, in metres   |
| `--mpt`    | `2.5`   | metres per tile (smaller = bigger, more detailed world) |
| `--name`   | place   | map name shown in the lobby                    |
| `--hq`     | `Metaverse HQ` | name of the office at the centre        |
| `--out`    | `default.json` | file written in `maps/`                 |

Restart the server after importing. `pnpm map:generate` brings back the procedural town.

## Putting it on the internet

### Option A — instant link from your PC (no account)

```bash
pnpm share
```

This builds the app, starts it and opens a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/). You get a link like `https://some-words.trycloudflare.com` with HTTPS, so camera and mic work. It stays up while that terminal is open. The URL changes every time you restart, and it goes down when your PC sleeps.
You need `cloudflared` installed (`winget install Cloudflare.cloudflared`, or `brew install cloudflared` on macOS).

### Option B — permanent free URL on Render

1. Push this repo to GitHub, including `maps/default.json` so your area ships with the deploy:
   ```bash
   git add -A && git commit -m "Metaverse: real-world map, proximity video, multiplayer"
   git remote add origin https://github.com/<you>/metaverse.git
   git push -u origin main
   ```
2. On [render.com](https://render.com), sign in with GitHub, then go to **New → Blueprint** and pick the repo. `render.yaml` configures everything (Docker, free plan, health check).
3. Wait for the build (about 3–5 minutes). Your world is then live at `https://metaverse-xxxx.onrender.com`, and every `git push` redeploys it.

Free Render instances sleep after 15 minutes without visitors, and the first visit afterwards takes about a minute to wake.

### Anywhere else

Production is a single Node process (or a Docker image), so it runs on any host with WebSocket support (Railway, Fly.io, Koyeb, a VPS…):

```bash
pnpm build && pnpm start          # serves everything on $PORT (default 8080)
docker build -t metaverse . && docker run -p 8080:8080 metaverse
```

> **Camera and mic need HTTPS** on any origin other than `localhost`. Hosting platforms provide it automatically.
>
> **TURN for strict networks.** Calls use public Google STUN, which works for most home and office networks. Users behind symmetric NAT or corporate firewalls need a TURN server (for example Twilio, Metered or coturn). Pass it at build time:
> `VITE_ICE_SERVERS='[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]' pnpm build`

## Controls

| key                    | action                       |
| ---------------------- | ---------------------------- |
| `WASD` / arrows        | walk                         |
| click / tap            | auto-walk there              |
| `Enter`                | chat                         |
| `1`–`6`                | emotes                       |
| `M` / `N`              | minimap / day-night          |
| scroll, `+` / `-`      | zoom                         |
| `?`                    | help                         |

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
