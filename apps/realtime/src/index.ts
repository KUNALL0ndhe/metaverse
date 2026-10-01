import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg } from "@repo/world";
import { loadWorld, REPO_ROOT } from "./maps";
import { Room, send } from "./room";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIST = resolve(process.env.CLIENT_DIST ?? join(REPO_ROOT, "apps/client/dist"));

const world = loadWorld();
const rooms = new Map<string, Room>();

function getRoom(id: string) {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id, world, (r) => rooms.delete(r.id));
    rooms.set(id, room);
  }
  return room;
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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  if (url.pathname === "/api/spaces") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(
      JSON.stringify({
        map: { name: world.data.name, source: world.data.source },
        spaces: [...rooms.values()].map((r) => ({ id: r.id, online: r.size })),
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
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": file.includes(`${normalize("/assets/")}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
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
      room = getRoom(space || "lobby");
      playerId = room.join(ws, msg);
      if (!playerId) {
        if (room.size === 0) rooms.delete(room.id);
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
