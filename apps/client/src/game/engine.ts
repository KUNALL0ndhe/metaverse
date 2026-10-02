import { MOVE_SPEED, type Dir, type MapObject, type World } from "@repo/world";
import type { Avatarish, Session } from "../session";
import { findPath } from "@repo/world";
import { AV_H, AV_W, FLAT_OBJECTS, MINIMAP_COLORS, TS, drawAvatar, makeCanvas, objectSprite, paintTile } from "./sprites";

const CHUNK = 16;
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5];

export type Lighting = "auto" | "day" | "night";

export class Engine {
  private ctx: CanvasRenderingContext2D;
  private chunks = new Map<number, HTMLCanvasElement>();
  private rows: MapObject[][] = [];
  private lamps: MapObject[] = [];
  private minimapBase: HTMLCanvasElement | null = null;
  private world: World | null = null;
  private raf = 0;
  private last = performance.now();
  private keys = new Set<string>();
  private path: [number, number][] = [];
  private target: { x: number; y: number; at: number } | null = null;
  private walkPhase = 0;
  private frames = new Map<string, number>();
  private cam = { x: 0, y: 0 };
  private zoomIdx = 4;
  private zoom = ZOOMS[4]!;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private lastMinimap = 0;
  minimap: HTMLCanvasElement | null = null;
  lighting: Lighting = "auto";
  onZoomChange?: (z: number) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private session: Session,
  ) {
    this.ctx = canvas.getContext("2d")!;
    if (innerWidth < 700) this.setZoomIdx(3);
    session.onCorrect = () => (this.path = []);
    this.resize();
    addEventListener("resize", this.resize);
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onPointer);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.bgTimer);
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.onKeyDown);
    removeEventListener("keyup", this.onKeyUp);
    removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointer);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }

  // ---------------------------------------------------------------- setup

  private setWorld(world: World) {
    this.world = world;
    this.chunks.clear();
    this.rows = Array.from({ length: world.height }, () => []);
    this.lamps = [];
    for (const o of world.data.objects) {
      this.rows[o.y]?.push(o);
      if (o.k === "lamp") this.lamps.push(o);
    }
    for (const r of this.rows) r.sort((a, b) => a.x - b.x);
    // 1px-per-tile minimap image.
    const { c, ctx } = makeCanvas(world.width, world.height);
    const img = ctx.createImageData(world.width, world.height);
    for (let i = 0; i < world.ground.length; i++) {
      const hex = MINIMAP_COLORS[world.ground[i]!] ?? "#79c25f";
      const n = parseInt(hex.slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = "#2f7d32";
    for (const o of world.data.objects) if (o.k === "tree" || o.k === "pine") ctx.fillRect(o.x, o.y, 1, 1);
    this.minimapBase = c;
    this.cam = { x: this.session.me.x * TS, y: this.session.me.y * TS };
  }

  private resize = () => {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  };

  private chunk(cx: number, cy: number) {
    const world = this.world!;
    const key = cy * 4096 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    const { c: canvas, ctx } = makeCanvas(CHUNK * TS, CHUNK * TS);
    const get = (x: number, y: number) => world.tileAt(Math.max(0, Math.min(world.width - 1, x)), Math.max(0, Math.min(world.height - 1, y)));
    const variantAt = (x: number, y: number) => world.variant[y * world.width + x] ?? 0;
    for (let ty = 0; ty < CHUNK; ty++)
      for (let tx = 0; tx < CHUNK; tx++) {
        const wx = cx * CHUNK + tx;
        const wy = cy * CHUNK + ty;
        if (!world.inBounds(wx, wy)) continue;
        paintTile(ctx, get, variantAt, wx, wy, tx * TS, ty * TS);
      }
    this.chunks.set(key, canvas);
    return canvas;
  }

  // ---------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping()) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      this.keys.add(k);
      this.path = [];
      this.target = null;
      e.preventDefault();
    } else if (k === "=" || k === "+") this.setZoomIdx(this.zoomIdx + 1);
    else if (k === "-") this.setZoomIdx(this.zoomIdx - 1);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => this.keys.clear();

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.setZoomIdx(this.zoomIdx + (e.deltaY < 0 ? 1 : -1));
  };

  setZoomIdx(i: number) {
    this.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, i));
    this.zoom = ZOOMS[this.zoomIdx]!;
    this.onZoomChange?.(this.zoom);
  }
  zoomBy(d: number) {
    this.setZoomIdx(this.zoomIdx + d);
  }

  private screenToWorld(sx: number, sy: number) {
    return {
      x: (this.cam.x + (sx - this.w / 2) / this.zoom) / TS,
      y: (this.cam.y + (sy - this.h / 2) / this.zoom) / TS,
    };
  }

  private onPointer = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const r = this.canvas.getBoundingClientRect();
    const p = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    this.walkTo(p.x, p.y);
  };

  /** Pathfind to a world position (tile units). */
  walkTo(x: number, y: number) {
    const world = this.world;
    if (!world) return;
    const me = this.session.me;
    const path = findPath(world, Math.floor(me.x), Math.floor(me.y), Math.floor(x), Math.floor(y));
    if (!path) return;
    this.path = path;
    const end = path[path.length - 1];
    this.target = end ? { x: end[0], y: end[1], at: performance.now() } : null;
  }

  walkToPlayer(id: string) {
    const p = this.session.players.get(id);
    if (p) this.walkTo(p.tx, p.ty + 1);
  }

  // ---------------------------------------------------------------- loop

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    // Catch size/DPR changes that don't fire "resize" (moving between monitors, layout changes).
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h || Math.min(2, devicePixelRatio || 1) !== this.dpr)
      this.resize();
    this.step(now, true);
  };

  /** Browsers pause rAF in background tabs; keep calls and movement alive while hidden. */
  private bgTimer = window.setInterval(() => {
    const now = performance.now();
    if (now - this.last > 400) this.step(now, false);
  }, 250);

  private step(now: number, draw: boolean) {
    // Movement is sub-stepped, so larger background steps are still collision-safe.
    const dt = Math.min(draw ? 0.25 : 1, (now - this.last) / 1000);
    this.last = now;
    const s = this.session;
    if (s.world && s.world !== this.world) this.setWorld(s.world);
    if (!this.world) return;

    this.updateSelf(dt);
    this.updateRemotes(dt, now);
    s.tick(now);
    if (!draw) return;
    this.render(now, dt);
    if (this.minimap && now - this.lastMinimap > 100) {
      this.lastMinimap = now;
      this.renderMinimap();
    }
  }

  private updateSelf(dt: number) {
    const world = this.world!;
    const me = this.session.me;
    let vx = 0;
    let vy = 0;
    const k = this.keys;
    if (k.has("a") || k.has("arrowleft")) vx -= 1;
    if (k.has("d") || k.has("arrowright")) vx += 1;
    if (k.has("w") || k.has("arrowup")) vy -= 1;
    if (k.has("s") || k.has("arrowdown")) vy += 1;

    // Move `dist` tiles along a unit vector in 0.2-tile sub-steps, sliding along walls.
    const move = (ux: number, uy: number, dist: number) => {
      while (dist > 1e-6) {
        const step = Math.min(0.2, dist);
        dist -= step;
        const nx = me.x + ux * step;
        const ny = me.y + uy * step;
        if (world.canStand(nx, ny)) {
          me.x = nx;
          me.y = ny;
        } else if (ux && world.canStand(nx, me.y)) me.x = nx;
        else if (uy && world.canStand(me.x, ny)) me.y = ny;
        else return false;
      }
      return true;
    };
    const face = (ux: number, uy: number): Dir =>
      Math.abs(ux) > Math.abs(uy) ? (ux < 0 ? "left" : "right") : uy < 0 ? "up" : "down";

    let moved = false;
    const budget = MOVE_SPEED * dt;
    if (vx || vy) {
      const len = Math.hypot(vx, vy);
      move(vx / len, vy / len, budget);
      me.dir = face(vx, vy);
      moved = true;
    } else if (this.path.length) {
      // Spend this frame's distance across as many waypoints as it covers — never overshoot.
      let left = budget;
      while (left > 1e-6 && this.path.length) {
        const [px, py] = this.path[0]!;
        const dx = px - me.x;
        const dy = py - me.y;
        const d = Math.hypot(dx, dy);
        if (d < 1e-3) {
          this.path.shift();
          continue;
        }
        const step = Math.min(left, d);
        if (!move(dx / d, dy / d, step)) {
          this.path = [];
          break;
        }
        me.dir = face(dx, dy);
        left -= step;
        if (step >= d - 1e-6) this.path.shift();
      }
      if (!this.path.length) this.target = null;
      moved = true;
    }

    if (moved) {
      me.moving = true;
      this.walkPhase += dt * 8;
    } else {
      me.moving = false;
      this.walkPhase = 0;
    }
    this.frames.set(me.id, me.moving ? Math.floor(this.walkPhase) % 4 : 0);
  }

  private updateRemotes(dt: number, now: number) {
    for (const p of this.session.players.values()) {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        const a = Math.min(1, dt * 12);
        p.x += dx * a;
        p.y += dy * a;
      }
      const walking = p.moving || d > 0.05;
      this.frames.set(p.id, walking ? Math.floor(now / 125) % 4 : 0);
    }
  }

  // ---------------------------------------------------------------- render

  nightFactor() {
    if (this.lighting === "day") return 0;
    if (this.lighting === "night") return 1;
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    // 0 during the day, ramps at dusk (18–20h) and dawn (5–7h).
    if (h >= 7 && h <= 18) return 0;
    if (h > 18 && h < 20) return (h - 18) / 2;
    if (h > 5 && h < 7) return 1 - (h - 5) / 2;
    return 1;
  }

  private render(now: number, dt: number) {
    const { ctx, world } = this;
    if (!world) return;
    const me = this.session.me;
    const z = this.zoom;

    // Camera eases towards the player.
    const tx = me.x * TS;
    const ty = me.y * TS - 12;
    const ease = 1 - Math.exp(-dt * 10); // frame-rate independent follow
    this.cam.x += (tx - this.cam.x) * ease;
    this.cam.y += (ty - this.cam.y) * ease;
    const camX = Math.round(this.cam.x * z) / z;
    const camY = Math.round(this.cam.y * z) / z;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b3a2a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;

    const scale = z * this.dpr;
    ctx.setTransform(scale, 0, 0, scale, Math.round((this.w / 2 - camX * z) * this.dpr), Math.round((this.h / 2 - camY * z) * this.dpr));

    const halfW = this.w / 2 / z;
    const halfH = this.h / 2 / z;
    const x0 = Math.floor((camX - halfW) / TS) - 1;
    const x1 = Math.ceil((camX + halfW) / TS) + 1;
    const y0 = Math.floor((camY - halfH) / TS) - 1;
    const y1 = Math.ceil((camY + halfH) / TS) + 3;

    // Ground chunks.
    for (let cy = Math.max(0, Math.floor(y0 / CHUNK)); cy <= Math.min(Math.floor((world.height - 1) / CHUNK), Math.floor(y1 / CHUNK)); cy++)
      for (let cx = Math.max(0, Math.floor(x0 / CHUNK)); cx <= Math.min(Math.floor((world.width - 1) / CHUNK), Math.floor(x1 / CHUNK)); cx++)
        ctx.drawImage(this.chunk(cx, cy), cx * CHUNK * TS, cy * CHUNK * TS);

    // Click target marker.
    if (this.target) {
      const t = (now - this.target.at) / 1000;
      ctx.strokeStyle = `rgba(255,255,255,${0.9 - (t % 1) * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(this.target.x * TS, this.target.y * TS, 6 + (t % 1) * 6, 3 + (t % 1) * 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Zone floor highlight for the room we're in.
    const zid = world.zoneAt(me.x, me.y);

    // Y-sorted drawables: objects + avatars.
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    const flat: MapObject[] = [];
    for (let y = Math.max(0, y0); y <= Math.min(world.height - 1, y1); y++) {
      for (const o of this.rows[y]!) {
        if (o.x < x0 - 2 || o.x > x1 + 2) continue;
        if (FLAT_OBJECTS.has(o.k)) flat.push(o);
        else list.push({ y: o.y + 0.95, draw: () => this.drawObject(o) });
      }
    }
    for (const o of flat) this.drawObject(o);

    const avatars: Avatarish[] = [me, ...this.session.players.values()];
    for (const a of avatars) {
      if (a.x < x0 - 2 || a.x > x1 + 2 || a.y < y0 - 2 || a.y > y1 + 2) continue;
      list.push({ y: a.y, draw: () => this.drawAvatar(a, a === me) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    // Lighting.
    const night = this.nightFactor();
    if (night > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(14,18,52,${0.55 * night})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = (x: number, y: number, r: number, a: number) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,200,110,${a * night})`);
        g.addColorStop(1, "rgba(255,200,110,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (const l of this.lamps) {
        if (l.x < x0 - 4 || l.x > x1 + 4 || l.y < y0 - 4 || l.y > y1 + 4) continue;
        glow(l.x * TS + 16, l.y * TS - 20, 90, 0.32);
      }
      // A soft personal light so you can always see yourself.
      glow(me.x * TS, me.y * TS - 16, 70, 0.18);
      ctx.restore();
    }

    // Screen-space overlays: labels, name tags, bubbles, emotes.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const toScreen = (wx: number, wy: number) => ({
      x: (wx * TS - camX) * z + this.w / 2,
      y: (wy * TS - camY) * z + this.h / 2,
    });
    this.drawLabels(toScreen, zid);
    for (const a of avatars) {
      const s = toScreen(a.x, a.y);
      if (s.x < -200 || s.x > this.w + 200 || s.y < -200 || s.y > this.h + 200) continue;
      this.drawOverlay(a, s.x, s.y, now, a === me);
    }
  }

  private drawObject(o: MapObject) {
    const v = this.world!.variant[o.y * this.world!.width + o.x] ?? 0;
    const s = objectSprite(o.k, v);
    this.ctx.drawImage(s.c, o.x * TS + s.ox, o.y * TS + s.oy);
  }

  private drawAvatar(a: Avatarish, self: boolean) {
    const ctx = this.ctx;
    const x = a.x * TS;
    const y = a.y * TS;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (self) {
      ctx.strokeStyle = "rgba(124,92,255,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 14, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawAvatar(ctx, a.avatar, a.dir as Dir, this.frames.get(a.id) ?? 0, Math.round(x - AV_W / 2), Math.round(y - AV_H + 4));
  }

  private drawLabels(toScreen: (x: number, y: number) => { x: number; y: number }, zid: number) {
    const ctx = this.ctx;
    const world = this.world!;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const l of world.data.labels) {
      const s = toScreen(l.x, l.y);
      if (s.x < -150 || s.x > this.w + 150 || s.y < -30 || s.y > this.h + 30) continue;
      if (l.kind === "street") {
        if (this.zoom < 0.8) continue;
        ctx.font = "italic 600 12px Outfit, sans-serif";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(20,20,30,0.85)";
        ctx.strokeText(l.text, s.x, s.y);
        ctx.fillStyle = "#f4f1ea";
        ctx.fillText(l.text, s.x, s.y);
      } else if (l.kind === "zone") {
        const def = world.data.zoneDefs.find((d) => d.name === l.text);
        const active = def && def.id === zid;
        ctx.font = "10px Silkscreen, monospace";
        const w = ctx.measureText(l.text).width + 16;
        ctx.fillStyle = active ? "rgba(124,92,255,0.95)" : "rgba(20,22,35,0.6)";
        roundRect(ctx, s.x - w / 2, s.y - 9, w, 18, 9);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText((def?.kind === "stage" ? "🎤 " : "🔒 ") + l.text, s.x, s.y + 1);
      } else {
        if (l.kind === "poi" && this.zoom < 1) continue;
        const big = l.kind === "place";
        ctx.font = big ? "700 14px Outfit, sans-serif" : "600 11px Outfit, sans-serif";
        const text = big ? l.text : `📍 ${l.text}`;
        const w = ctx.measureText(text).width + 14;
        const h = big ? 24 : 20;
        ctx.fillStyle = big ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.8)";
        roundRect(ctx, s.x - w / 2, s.y - h / 2, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = "#1d1b2e";
        ctx.fillText(text, s.x, s.y + 1);
      }
    }
  }

  private drawOverlay(a: Avatarish, sx: number, sy: number, now: number, self: boolean) {
    const ctx = this.ctx;
    const z = this.zoom;
    const headY = sy - (AV_H - 2) * z;

    // Name tag.
    ctx.font = "600 12px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const micIcon = a.bot ? "🤖 " : a.media.mic ? "" : "🔇 ";
    const label = `${micIcon}${a.name}${a.bot ? " · bot" : ""}${a.status ? " · " + a.status : ""}`;
    const tw = ctx.measureText(label).width + 14;
    ctx.fillStyle = self ? "rgba(124,92,255,0.92)" : a.bot ? "rgba(20,110,120,0.85)" : "rgba(18,18,30,0.72)";
    roundRect(ctx, sx - tw / 2, headY - 22, tw, 19, 9.5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, sx, headY - 12);

    // In-call ring indicator.
    if (!self && this.session.inCall.includes(a.id)) {
      ctx.fillStyle = "#3ddc97";
      ctx.beginPath();
      ctx.arc(sx - tw / 2 - 6, headY - 12, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Chat bubble.
    if (a.bubble && a.bubble.until > now) {
      ctx.font = "500 13px Outfit, sans-serif";
      const lines = wrap(ctx, a.bubble.text, 200).slice(0, 4);
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
      const bh = lines.length * 17 + 12;
      const by = headY - 30 - bh;
      const fade = Math.min(1, (a.bubble.until - now) / 400);
      ctx.globalAlpha = fade;
      ctx.fillStyle = "#fff";
      roundRect(ctx, sx - bw / 2, by, bw, bh, 10);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - 6, by + bh);
      ctx.lineTo(sx, by + bh + 7);
      ctx.lineTo(sx + 6, by + bh);
      ctx.fill();
      ctx.fillStyle = "#1d1b2e";
      lines.forEach((l, i) => ctx.fillText(l, sx, by + 14 + i * 17));
      ctx.globalAlpha = 1;
    }

    // Floating emote.
    if (a.emote) {
      const t = (now - a.emote.start) / 2000;
      if (t >= 1) a.emote = undefined;
      else {
        ctx.globalAlpha = 1 - t * t;
        ctx.font = `${28 + Math.sin(t * Math.PI) * 8}px serif`;
        ctx.fillText(a.emote.emoji, sx + Math.sin(t * 9) * 6, headY - 40 - t * 50);
        ctx.globalAlpha = 1;
      }
    }
  }

  private renderMinimap() {
    const m = this.minimap;
    const base = this.minimapBase;
    const world = this.world;
    if (!m || !base || !world) return;
    const ctx = m.getContext("2d")!;
    const W = m.width;
    const H = m.height;
    ctx.imageSmoothingEnabled = false;
    const s = Math.min(W / world.width, H / world.height);
    const ox = (W - world.width * s) / 2;
    const oy = (H - world.height * s) / 2;
    ctx.fillStyle = "#101320";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(base, ox, oy, world.width * s, world.height * s);
    const night = this.nightFactor();
    if (night > 0) {
      ctx.fillStyle = `rgba(14,18,52,${0.45 * night})`;
      ctx.fillRect(ox, oy, world.width * s, world.height * s);
    }
    // Viewport rectangle.
    const vw = this.w / this.zoom / TS;
    const vh = this.h / this.zoom / TS;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + (this.cam.x / TS - vw / 2) * s, oy + (this.cam.y / TS - vh / 2) * s, vw * s, vh * s);
    const dot = (x: number, y: number, col: string, r: number) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(ox + x * s, oy + y * s, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of this.session.players.values()) dot(p.x, p.y, this.session.inCall.includes(p.id) ? "#3ddc97" : "#ffd166", 2.5);
    const me = this.session.me;
    dot(me.x, me.y, "#fff", 4);
    dot(me.x, me.y, "#7c5cff", 3);
  }

  /** Minimap click → walk there. Coordinates are in minimap canvas pixels. */
  minimapClick(px: number, py: number) {
    const m = this.minimap;
    const world = this.world;
    if (!m || !world) return;
    const s = Math.min(m.width / world.width, m.height / world.height);
    const ox = (m.width - world.width * s) / 2;
    const oy = (m.height - world.height * s) / 2;
    this.walkTo((px - ox) / s, (py - oy) / s);
  }
}


function isTyping() {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  // ctx.roundRect needs iOS 16+ / Chrome 99+; draw it by hand on older phones.
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
