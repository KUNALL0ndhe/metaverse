import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  EMOTES,
  MAX_ROOM_SIZE,
  MOVE_SPEED,
  sanitizeAvatar,
  type ClientMsg,
  type Dir,
  type PlayerInfo,
  type ServerMsg,
  type World,
} from "@repo/world";

const NEARBY_CHAT_RADIUS = 10;
const DIRS = new Set<Dir>(["down", "up", "left", "right"]);

interface Conn {
  ws: WebSocket;
  info: PlayerInfo;
  moveBudget: number;
  lastMoveAt: number;
  chatTimes: number[];
  dirty: boolean;
}

export class Room {
  readonly players = new Map<string, Conn>();
  private timer: NodeJS.Timeout;

  constructor(
    readonly id: string,
    readonly world: World,
    private onEmpty: (room: Room) => void,
  ) {
    // Broadcast batched position updates at 20 Hz.
    this.timer = setInterval(() => this.flush(), 50);
  }

  get size() {
    return this.players.size;
  }

  join(ws: WebSocket, msg: Extract<ClientMsg, { t: "join" }>): string | null {
    if (this.players.size >= MAX_ROOM_SIZE) {
      send(ws, { t: "error", message: "This space is full." });
      return null;
    }
    const id = randomUUID().slice(0, 8);
    const spawn = this.findSpawn();
    const info: PlayerInfo = {
      id,
      name: cleanText(msg.name, 24) || "Guest",
      avatar: sanitizeAvatar(msg.avatar),
      x: spawn.x,
      y: spawn.y,
      dir: "down",
      moving: false,
      media: { mic: false, cam: false, screen: false },
      status: "",
    };
    const conn: Conn = { ws, info, moveBudget: 2, lastMoveAt: Date.now(), chatTimes: [], dirty: false };

    send(ws, {
      t: "welcome",
      selfId: id,
      space: this.id,
      map: this.world.data,
      players: [...[...this.players.values()].map((c) => c.info), info],
    });
    this.broadcast({ t: "joined", player: info });
    this.players.set(id, conn);
    return id;
  }

  leave(id: string) {
    if (!this.players.delete(id)) return;
    this.broadcast({ t: "left", id });
    if (this.players.size === 0) {
      clearInterval(this.timer);
      this.onEmpty(this);
    }
  }

  handle(id: string, msg: ClientMsg) {
    const c = this.players.get(id);
    if (!c) return;
    const p = c.info;

    switch (msg.t) {
      case "move": {
        if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y) || !DIRS.has(msg.dir)) return;
        const now = Date.now();
        // Token bucket: you may travel as far as your speed allows (+ slack for jitter).
        c.moveBudget = Math.min(8, c.moveBudget + ((now - c.lastMoveAt) / 1000) * MOVE_SPEED * 1.5);
        c.lastMoveAt = now;
        const dist = Math.hypot(msg.x - p.x, msg.y - p.y);
        if (dist > c.moveBudget + 0.05 || !this.world.canStand(msg.x, msg.y)) {
          send(c.ws, { t: "correct", x: p.x, y: p.y });
          return;
        }
        c.moveBudget -= dist;
        p.x = msg.x;
        p.y = msg.y;
        p.dir = msg.dir;
        p.moving = !!msg.moving;
        c.dirty = true;
        return;
      }
      case "chat": {
        const text = cleanText(msg.text, 300);
        if (!text) return;
        const now = Date.now();
        c.chatTimes = c.chatTimes.filter((t) => now - t < 5000);
        if (c.chatTimes.length >= 6) return;
        c.chatTimes.push(now);
        const scope = msg.scope === "nearby" ? "nearby" : "global";
        const out: ServerMsg = { t: "chat", from: id, name: p.name, text, scope, ts: now };
        if (scope === "global") this.broadcast(out);
        else for (const o of this.players.values()) if (this.canHear(p, o.info)) send(o.ws, out);
        return;
      }
      case "emote":
        if (EMOTES.includes(msg.emoji)) this.broadcast({ t: "emote", from: id, emoji: msg.emoji });
        return;
      case "media":
        p.media = { mic: !!msg.media?.mic, cam: !!msg.media?.cam, screen: !!msg.media?.screen };
        this.broadcast({ t: "media", from: id, media: p.media }, id);
        return;
      case "status":
        p.status = cleanText(msg.status, 40);
        this.broadcast({ t: "status", from: id, status: p.status }, id);
        return;
      case "signal": {
        const target = this.players.get(msg.to);
        if (target && target !== c) send(target.ws, { t: "signal", from: id, data: msg.data });
        return;
      }
      case "ping":
        send(c.ws, { t: "pong", ts: msg.ts });
        return;
    }
  }

  private canHear(a: PlayerInfo, b: PlayerInfo) {
    const za = this.world.zoneAt(a.x, a.y);
    const zb = this.world.zoneAt(b.x, b.y);
    if (za || zb) return za === zb;
    return Math.hypot(a.x - b.x, a.y - b.y) <= NEARBY_CHAT_RADIUS;
  }

  private findSpawn() {
    const { x, y } = this.world.data.spawn;
    for (let i = 0; i < 30; i++) {
      const cx = x + (Math.random() - 0.5) * 6;
      const cy = y + (Math.random() - 0.5) * 3;
      if (this.world.canStand(cx, cy)) return { x: cx, y: cy };
    }
    return { x, y };
  }

  private flush() {
    const p: Extract<ServerMsg, { t: "state" }>["p"] = [];
    for (const c of this.players.values()) {
      if (!c.dirty) continue;
      c.dirty = false;
      const i = c.info;
      p.push([i.id, round2(i.x), round2(i.y), i.dir, i.moving ? 1 : 0]);
    }
    if (p.length) this.broadcast({ t: "state", p });
  }

  /** Send to everyone in the room, optionally skipping one player. */
  broadcast(msg: ServerMsg, except?: string) {
    const raw = JSON.stringify(msg);
    for (const [pid, c] of this.players) if (pid !== except && c.ws.readyState === c.ws.OPEN) c.ws.send(raw);
  }
}

export function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function cleanText(s: unknown, max: number) {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
