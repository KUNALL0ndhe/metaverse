import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg, SpotInfo } from "@repo/world";
import { loadSpots, REPO_ROOT, type Spot } from "./maps";
import { Room, send } from "./room";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = resolve(process.env.CLIENT_DIST ?? join(REPO_ROOT, "apps/client/dist"));

const spots = loadSpots();
const spotById = new Map(spots.map((s) => [s.id, s]));
const rooms = new Map<string, Room>();

/** A space is bound to the spot chosen by whoever opened it; later joiners share that map. */
function getRoom(id: string, spot: Spot) {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, spot, (r) => rooms.delete(r.id));
    rooms.set(id, room);
  }
  return room;
}

function spotList(): SpotInfo[] {
  return spots.map((s) => ({
    id: s.id,
    name: s.world.data.name,
    blurb: s.world.data.blurb,
    preview: s.preview.data,
    pw: s.preview.w,
    ph: s.preview.h,
    online: [...rooms.values()].filter((r) => r.spot === s).reduce((n, r) => n + r.size, 0),
    source: s.world.data.source.type,
  }));
}

// Free hosting (e.g. Render) sleeps after ~15 idle minutes; KEEP_AWAKE=1 pings our public URL so
// the first visitor never waits for a cold start. Render provides RENDER_EXTERNAL_URL automatically.
const KEEP_AWAKE_URL = process.env.KEEP_AWAKE === "1" ? (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL) : undefined;
if (KEEP_AWAKE_URL) {
  setInterval(() => fetch(`${KEEP_AWAKE_URL}/health`).catch(() => {}), 10 * 60 * 1000);
  console.log(`⏰ Keep-awake: pinging ${KEEP_AWAKE_URL}/health every 10 minutes`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg"]);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, spots: spots.length, keepAwake: !!KEEP_AWAKE_URL, uptime: Math.round(process.uptime()) }));
    return;
  }
  if (url.pathname === "/api/spaces") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(
      JSON.stringify({
        spots: spotList(),
        spaces: [...rooms.values()].map((r) => ({ id: r.id, online: r.size, spot: r.spot.id })),
      }),
    );
    return;
  }

  // Static client (production). In dev, Vite serves the client and proxies here.
  let file = normalize(join(CLIENT_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(CLIENT_DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIST, "index.html");
  if (!existsSync(file)) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Realtime server is running. Start the client with `pnpm dev` or build it with `pnpm build`.");
    return;
  }
  const ext = extname(file);
  // The whole client is one inlined index.html; gzip it (~270 KB → ~90 KB) for phones on mobile data.
  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": file.includes(`${normalize("/assets/")}`) ? "public, max-age=31536000, immutable" : "no-cache",
    Vary: "Accept-Encoding",
    ...(gzip ? { "Content-Encoding": "gzip" } : {}),
  });
  const stream = createReadStream(file);
  if (gzip) stream.pipe(createGzip()).pipe(res);
  else stream.pipe(res);
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
const alive = new WeakMap<WebSocket, boolean>();

wss.on("connection", (ws) => {
  alive.set(ws, true);
  ws.on("pong", () => alive.set(ws, true));

  let room: Room | null = null;
  let playerId: string | null = null;

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.t === "join") {
      if (room) return;
      const space = String(msg.space ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 32);
      const spot = spotById.get(String(msg.spot ?? "")) ?? spots[0]!;
      room = getRoom(space || spot.id, spot);
      playerId = room.join(ws, msg);
      if (!playerId) {
        if (room.size === 0) {
          room.dispose();
          rooms.delete(room.id);
        }
        room = null;
      }
      return;
    }
    if (room && playerId) room.handle(playerId, msg);
    else send(ws, { t: "error", message: "Join a space first." });
  });

  ws.on("close", () => {
    if (room && playerId) room.leave(playerId);
  });
});

// Drop dead connections.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 20_000);

server.listen(PORT, () => {
  console.log(`🚀 Realtime server on http://localhost:${PORT}  (ws: /ws)`);
});
