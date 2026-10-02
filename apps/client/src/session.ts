import {
  CALL_RADIUS,
  HANGUP_RADIUS,
  World,
  type AvatarConfig,
  type Dir,
  type MediaState,
  type PlayerInfo,
  type ServerMsg,
  type ZoneDef,
} from "@repo/world";
import { Net } from "./net";
import { LocalMedia, PeerManager } from "./rtc";

export interface Avatarish {
  id: string;
  name: string;
  avatar: AvatarConfig;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  media: MediaState;
  status: string;
  bot?: boolean;
  bubble?: { text: string; until: number };
  emote?: { emoji: string; start: number };
}

export interface RemotePlayer extends Avatarish {
  /** Latest authoritative position; x/y are smoothed towards it every frame. */
  tx: number;
  ty: number;
}

export interface ChatMsg {
  key: number;
  from: string;
  name: string;
  text: string;
  scope: "global" | "nearby";
  ts: number;
  self: boolean;
}

export interface Toast {
  key: number;
  text: string;
}

export type Status = "connecting" | "connected" | "reconnecting" | "error";

let keySeq = 1;

export class Session {
  status: Status = "connecting";
  error = "";
  selfId = "";
  space: string;
  /** Map (demo spot) id this space uses. */
  spot: string;
  world: World | null = null;
  me: Avatarish;
  players = new Map<string, RemotePlayer>();
  chat: ChatMsg[] = [];
  unread = 0;
  toasts: Toast[] = [];
  /** Ids of players we are currently in a call with. */
  inCall: string[] = [];
  zone: ZoneDef | null = null;
  ping = 0;
  /** Consecutive connection attempts that failed; reset on a successful join. */
  failedAttempts = 0;

  readonly media: LocalMedia;
  peers: PeerManager | null = null;
  private net = new Net();
  private listeners = new Set<() => void>();
  private version = 0;
  private lastSent = { x: 0, y: 0, dir: "down" as Dir, moving: false, at: 0 };
  private left = false;
  private pingTimer = 0;

  constructor(name: string, avatar: AvatarConfig, space: string, spot: string, media = new LocalMedia()) {
    this.spot = spot;
    this.media = media;
    this.space = space;
    this.me = {
      id: "",
      name,
      avatar,
      x: 0,
      y: 0,
      dir: "down",
      moving: false,
      media: { mic: media.micOn, cam: media.camOn, screen: !!media.screen },
      status: "",
    };
    this.media.onChange = () => {
      this.me.media = { mic: this.media.micOn, cam: this.media.camOn, screen: !!this.media.screen };
      this.net.send({ t: "media", media: this.me.media });
      this.emit();
    };
    this.net.on((m) => this.onMessage(m));
    this.net.onOpen = () => this.net.send({ t: "join", space, spot, name, avatar });
    this.net.onClose = () => {
      if (this.left) return;
      this.status = "reconnecting";
      this.failedAttempts++;
      this.peers?.closeAll();
      this.emit();
      setTimeout(() => !this.left && this.net.connect(), 1500);
    };
    this.net.connect();
    this.pingTimer = window.setInterval(() => this.net.send({ t: "ping", ts: performance.now() }), 3000);
  }

  // --- store plumbing for React (useSyncExternalStore) ---
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  private toast(text: string) {
    const t = { key: keySeq++, text };
    this.toasts = [...this.toasts.slice(-3), t];
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x !== t);
      this.emit();
    }, 3500);
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case "welcome": {
        this.selfId = m.selfId;
        this.space = m.space;
        this.spot = m.spot;
        this.me.id = m.selfId;
        this.world = new World(m.map);
        const self = m.players.find((p) => p.id === m.selfId);
        this.players.clear();
        for (const p of m.players) if (p.id !== m.selfId) this.players.set(p.id, toRemote(p));
        if (self) {
          this.me.x = self.x;
          this.me.y = self.y;
        } else {
          this.me.x = m.map.spawn.x;
          this.me.y = m.map.spawn.y;
        }
        this.peers?.closeAll();
        this.peers = new PeerManager(this.selfId, this.media, (to, data) => this.net.send({ t: "signal", to, data }));
        this.peers.onChange = () => this.emit();
        this.status = "connected";
        this.failedAttempts = 0;
        // Re-announce media state after (re)connecting.
        this.net.send({ t: "media", media: this.me.media });
        if (this.me.status) this.net.send({ t: "status", status: this.me.status });
        this.emit();
        return;
      }
      case "joined":
        this.players.set(m.player.id, toRemote(m.player));
        this.toast(`👋 ${m.player.name} joined`);
        this.emit();
        return;
      case "left": {
        const p = this.players.get(m.id);
        this.players.delete(m.id);
        this.peers?.hangup(m.id, false);
        if (p) this.toast(`${p.name} left`);
        this.emit();
        return;
      }
      case "state":
        for (const [id, x, y, dir, moving] of m.p) {
          if (id === this.selfId) continue;
          const p = this.players.get(id);
          if (!p) continue;
          p.tx = x;
          p.ty = y;
          p.dir = dir;
          p.moving = moving === 1;
        }
        return;
      case "correct":
        this.me.x = m.x;
        this.me.y = m.y;
        this.onCorrect?.();
        return;
      case "chat": {
        const self = m.from === this.selfId;
        this.chat = [
          ...this.chat.slice(-199),
          { key: keySeq++, from: m.from, name: m.name, text: m.text, scope: m.scope, ts: m.ts, self },
        ];
        const who = self ? this.me : this.players.get(m.from);
        if (who) who.bubble = { text: m.text, until: performance.now() + 5000 + m.text.length * 40 };
        if (!self) this.unread++;
        this.emit();
        return;
      }
      case "say": {
        const who = this.players.get(m.from);
        if (who) who.bubble = { text: m.text, until: performance.now() + 4500 + m.text.length * 40 };
        return;
      }
      case "emote": {
        const who = m.from === this.selfId ? this.me : this.players.get(m.from);
        if (who) who.emote = { emoji: m.emoji, start: performance.now() };
        return;
      }
      case "media": {
        const p = this.players.get(m.from);
        if (p) p.media = m.media;
        this.emit();
        return;
      }
      case "status": {
        const p = this.players.get(m.from);
        if (p) p.status = m.status;
        this.emit();
        return;
      }
      case "signal":
        this.peers?.onSignal(m.from, m.data as never);
        return;
      case "pong":
        this.ping = Math.round(performance.now() - m.ts);
        return;
      case "error":
        this.status = "error";
        this.error = m.message;
        this.emit();
        return;
    }
  }

  onCorrect?: () => void;

  /** Called by the game loop after local movement each frame. */
  tick(now: number) {
    const w = this.world;
    if (!w || this.status !== "connected") return;

    // Send our position at ~15 Hz while moving, and once when we stop.
    const ls = this.lastSent;
    const changed = ls.x !== this.me.x || ls.y !== this.me.y || ls.dir !== this.me.dir || ls.moving !== this.me.moving;
    if (changed && (now - ls.at > 66 || (!this.me.moving && ls.moving))) {
      this.net.send({ t: "move", x: this.me.x, y: this.me.y, dir: this.me.dir, moving: this.me.moving });
      Object.assign(ls, { x: this.me.x, y: this.me.y, dir: this.me.dir, moving: this.me.moving, at: now });
    }

    // Zone we're standing in.
    const zid = w.zoneAt(this.me.x, this.me.y);
    const zone = zid ? (w.zoneDef(zid) ?? null) : null;
    if (zone?.id !== this.zone?.id) {
      this.zone = zone;
      this.emit();
    }

    // Who should we be talking to?
    const peers = this.peers;
    if (!peers) return;
    const wanted = new Set<string>();
    for (const p of this.players.values()) {
      if (p.bot) continue; // bots are never part of calls
      const d = Math.hypot(p.tx - this.me.x, p.ty - this.me.y);
      const pz = w.zoneAt(p.tx, p.ty);
      let ok: boolean;
      if (zid || pz) ok = zid === pz;
      else ok = d <= (peers.peers.has(p.id) ? HANGUP_RADIUS : CALL_RADIUS);
      if (ok) wanted.add(p.id);
      // Spatial audio: fade with distance outside private zones.
      if (peers.peers.has(p.id)) {
        const v = zid && zid === pz ? 1 : 1 - Math.max(0, Math.min(1, (d - 2) / (HANGUP_RADIUS - 2)));
        peers.setVolume(p.id, 0.08 + v * 0.92);
      }
    }
    peers.sync(wanted);

    const inCall = [...peers.peers.keys()].sort();
    if (inCall.join() !== this.inCall.join()) {
      this.inCall = inCall;
      this.emit();
    }
  }

  sendChat(text: string, scope: "global" | "nearby") {
    this.net.send({ t: "chat", text, scope });
  }

  emote(emoji: string) {
    this.net.send({ t: "emote", emoji });
  }

  /** Real people in this space, including you. */
  get humans() {
    let n = 1;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  setStatus(status: string) {
    this.me.status = status;
    this.net.send({ t: "status", status });
    this.emit();
  }

  markRead() {
    if (this.unread) {
      this.unread = 0;
      this.emit();
    }
  }

  leave() {
    this.left = true;
    clearInterval(this.pingTimer);
    this.peers?.closeAll();
    this.media.stopAll();
    this.net.close();
  }
}

function toRemote(p: PlayerInfo): RemotePlayer {
  return { ...p, tx: p.x, ty: p.y };
}
