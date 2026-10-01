import { encodeBytes, type MapData, type MapLabel, type MapObject, type ZoneDef, type ZoneKind } from "./map";
import { Tile, isSolidTile, type ObjectKind } from "./tiles";

export type Pt = [number, number];

/** Small deterministic PRNG so generated maps are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MapBuilder {
  readonly ground: Uint8Array;
  readonly variant: Uint8Array;
  readonly zones: Uint8Array;
  objects: MapObject[] = [];
  labels: MapLabel[] = [];
  zoneDefs: ZoneDef[] = [];
  spawn = { x: 0, y: 0 };

  constructor(
    readonly width: number,
    readonly height: number,
    readonly rand: () => number,
  ) {
    this.ground = new Uint8Array(width * height);
    this.variant = new Uint8Array(width * height);
    this.zones = new Uint8Array(width * height);
    for (let i = 0; i < this.variant.length; i++) this.variant[i] = Math.floor(rand() * 256);
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number) {
    return this.inBounds(x, y) ? this.ground[y * this.width + x]! : Tile.Water;
  }

  set(x: number, y: number, t: number, variant?: number) {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    this.ground[i] = t;
    if (variant !== undefined) this.variant[i] = variant;
  }

  fillRect(x0: number, y0: number, w: number, h: number, t: number, variant?: number) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, t, variant);
  }

  /** Scanline fill of a polygon given in (fractional) tile coordinates; samples tile centres. */
  fillPolygon(poly: Pt[], t: number, opts: { variant?: number; onlyOver?: Set<number> } = {}) {
    if (poly.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of poly) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(this.height - 1, Math.ceil(maxY));
    for (let ty = yStart; ty <= yEnd; ty++) {
      const cy = ty + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i]!;
        const [xj, yj] = poly[j]!;
        if (yi > cy !== yj > cy) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
        const xb = Math.min(this.width - 1, Math.floor(xs[k + 1]! - 0.5));
        for (let tx = xa; tx <= xb; tx++) {
          if (opts.onlyOver && !opts.onlyOver.has(this.get(tx, ty))) continue;
          this.set(tx, ty, t, opts.variant);
        }
      }
    }
  }

  /** Draw a thick polyline by stamping discs along each segment. */
  strokeLine(line: Pt[], width: number, t: number, opts: { onlyOver?: Set<number> } = {}) {
    const r = width / 2;
    for (let i = 0; i + 1 < line.length; i++) {
      const [x0, y0] = line[i]!;
      const [x1, y1] = line[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(len * 2));
      for (let s = 0; s <= steps; s++) {
        const px = x0 + ((x1 - x0) * s) / steps;
        const py = y0 + ((y1 - y0) * s) / steps;
        for (let ty = Math.floor(py - r); ty <= Math.ceil(py + r); ty++) {
          for (let tx = Math.floor(px - r); tx <= Math.ceil(px + r); tx++) {
            if (Math.hypot(tx + 0.5 - px, ty + 0.5 - py) > r + 0.15) continue;
            if (opts.onlyOver && !opts.onlyOver.has(this.get(tx, ty))) continue;
            this.set(tx, ty, t);
          }
        }
      }
    }
  }

  addObject(k: ObjectKind, x: number, y: number) {
    if (!this.inBounds(x, y)) return;
    this.objects.push({ k, x, y });
  }

  addZone(name: string, kind: ZoneKind, x0: number, y0: number, w: number, h: number) {
    const id = this.zoneDefs.length + 1;
    this.zoneDefs.push({ id, name, kind });
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) if (this.inBounds(x, y)) this.zones[y * this.width + x] = id;
    this.labels.push({ text: name, x: x0 + w / 2, y: y0 + 0.9, kind: "zone" });
    return id;
  }

  /** Remove objects sitting on solid ground or outside the map, and de-duplicate. */
  cleanObjects() {
    const seen = new Set<number>();
    this.objects = this.objects.filter((o) => {
      if (!this.inBounds(o.x, o.y)) return false;
      const i = o.y * this.width + o.x;
      if (seen.has(i)) return false;
      const g = this.ground[i]!;
      if (isSolidTile(g) && o.k !== "whiteboard" && o.k !== "screen") return false;
      seen.add(i);
      return true;
    });
  }

  /**
   * Stamp the "HQ" — a Gather-style office with private meeting rooms — centred at (cx, cy).
   * Returns the HQ rectangle.
   */
  stampHQ(cx: number, cy: number, name = "Metaverse HQ") {
    const W = 36;
    const H = 24;
    const x0 = Math.round(cx - W / 2);
    const y0 = Math.round(cy - H / 2);

    // Clear surroundings into a plaza so the building is reachable.
    const pad = 4;
    const covered = (x: number, y: number) => x >= x0 - pad && x < x0 + W + pad && y >= y0 - pad && y < y0 + H + pad;
    this.objects = this.objects.filter((o) => !covered(o.x, o.y));
    this.labels = this.labels.filter((l) => !covered(l.x, l.y));
    this.fillRect(x0 - pad, y0 - pad, W + pad * 2, H + pad * 2, Tile.Plaza);
    for (let y = y0 - pad; y < y0 + H + pad; y++)
      for (let x = x0 - pad; x < x0 + W + pad; x++) if (this.inBounds(x, y)) this.zones[y * this.width + x] = 0;

    this.fillRect(x0, y0, W, H, Tile.FloorWood);

    const wallH = (y: number, xa: number, xb: number) => {
      for (let x = xa; x <= xb; x++) this.set(x0 + x, y0 + y, Tile.Wall);
    };
    const wallV = (x: number, ya: number, yb: number) => {
      for (let y = ya; y <= yb; y++) this.set(x0 + x, y0 + y, Tile.Wall);
    };
    const door = (x: number, y: number) => this.set(x0 + x, y0 + y, Tile.Door);

    // Outer shell + doors on every side.
    wallH(0, 0, W - 1);
    wallH(H - 1, 0, W - 1);
    wallV(0, 0, H - 1);
    wallV(W - 1, 0, H - 1);
    for (const x of [17, 18]) {
      door(x, 0);
      door(x, H - 1);
    }
    for (const y of [11, 12]) {
      door(0, y);
      door(W - 1, y);
    }

    // Rooms: [label, x, y, w, h, doorX, doorY(wall row), floor]
    const room = (label: string, rx: number, ry: number, rw: number, rh: number, floor: number, kind: ZoneKind) => {
      this.fillRect(x0 + rx, y0 + ry, rw, rh, floor);
      return this.addZone(label, kind, x0 + rx, y0 + ry, rw, rh);
    };

    // Meeting Room A (top-left)
    wallH(9, 0, 13);
    wallV(13, 0, 9);
    room("Meeting Room A", 1, 1, 12, 8, Tile.FloorCarpet, "private");
    door(6, 9);
    door(7, 9);
    // Meeting Room B (top-right)
    wallH(9, 22, W - 1);
    wallV(22, 0, 9);
    room("Meeting Room B", 23, 1, 12, 8, Tile.FloorCarpet, "private");
    door(28, 9);
    door(29, 9);
    // Focus pods (bottom-left)
    wallH(14, 0, 11);
    wallV(11, 14, H - 1);
    room("Focus Pod", 1, 15, 10, 8, Tile.FloorCarpet, "private");
    door(5, 14);
    door(6, 14);
    // Town Hall stage (bottom-right)
    wallH(14, 23, W - 1);
    wallV(23, 14, H - 1);
    room("Town Hall", 24, 15, 11, 8, Tile.FloorTile, "stage");
    door(25, 14);
    door(26, 14);

    const o = (k: ObjectKind, x: number, y: number) => this.addObject(k, x0 + x, y0 + y);

    // Meeting tables with chairs.
    for (const [bx] of [[1], [23]] as const) {
      for (let x = bx + 3; x <= bx + 8; x++) {
        o("table", x, 4);
        o("table", x, 5);
        o("chair", x, 3);
        o("chair", x, 6);
      }
      o("screen", bx + 5, 0);
      o("whiteboard", bx + 2, 0);
      o("plant", bx, 1);
      o("plant", bx + 11, 1);
    }
    // Focus pod desks.
    for (const y of [16, 19]) {
      o("desk", 2, y);
      o("chair", 2, y + 1);
      o("desk", 5, y);
      o("chair", 5, y + 1);
      o("desk", 8, y);
      o("chair", 8, y + 1);
    }
    // Town Hall stage: screen + rows of chairs.
    o("screen", 29, H - 1);
    for (const y of [17, 19]) for (let x = 25; x <= 33; x++) if (x !== 29) o("chair", x, y);
    o("plant", 24, 22);
    o("plant", 34, 22);
    // Reception / kitchen between the two meeting rooms.
    o("coffee", 15, 1);
    o("coffee", 16, 1);
    o("plant", 14, 1);
    o("plant", 21, 1);
    o("sofa", 15, 6);
    o("sofa", 16, 6);
    o("sofa", 19, 6);
    o("sofa", 20, 6);
    o("table", 17, 4);
    o("table", 18, 4);
    // Open office desks.
    for (const x of [14, 17, 20]) {
      o("desk", x, 16);
      o("chair", x, 17);
      o("desk", x, 20);
      o("chair", x, 21);
    }
    o("plant", 1, 10);
    o("plant", W - 2, 10);
    o("plant", 1, 13);
    o("plant", W - 2, 13);

    // Plaza decor.
    for (const [x, y] of [
      [-3, -3],
      [W + 2, -3],
      [-3, H + 2],
      [W + 2, H + 2],
    ] as const)
      o("lamp", x, y);
    o("fountain", 17, H + 3);
    o("bench", 13, H + 3);
    o("bench", 22, H + 3);
    o("flowers", 10, -2);
    o("flowers", 25, -2);

    this.labels.push({ text: name, x: x0 + W / 2, y: y0 - 1.6, kind: "place" });
    this.spawn = { x: x0 + 17.5 + 0.5, y: y0 + 12 };
    return { x0, y0, W, H };
  }

  /** If spawn ended up blocked, spiral outwards to the nearest free tile. */
  fixSpawn() {
    const solid = new Uint8Array(this.width * this.height);
    for (let i = 0; i < solid.length; i++) if (isSolidTile(this.ground[i]!)) solid[i] = 1;
    const sx = Math.floor(this.spawn.x);
    const sy = Math.floor(this.spawn.y);
    for (let r = 0; r < Math.max(this.width, this.height); r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = sx + dx;
          const y = sy + dy;
          if (this.inBounds(x, y) && !solid[y * this.width + x]) {
            this.spawn = { x: x + 0.5, y: y + 0.5 };
            return;
          }
        }
    }
  }

  build(name: string, metersPerTile: number, source: MapData["source"]): MapData {
    this.cleanObjects();
    this.fixSpawn();
    return {
      version: 1,
      name,
      width: this.width,
      height: this.height,
      metersPerTile,
      ground: encodeBytes(this.ground),
      variant: encodeBytes(this.variant),
      zones: encodeBytes(this.zones),
      zoneDefs: this.zoneDefs,
      objects: this.objects,
      labels: this.labels,
      spawn: this.spawn,
      source,
    };
  }
}
