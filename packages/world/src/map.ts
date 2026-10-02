import { isSolidObject, isSolidTile, type ObjectKind } from "./tiles";

export type ZoneKind = "private" | "stage";

export interface ZoneDef {
  id: number;
  name: string;
  kind: ZoneKind;
}

export interface MapObject {
  k: ObjectKind;
  x: number;
  y: number;
}

export interface MapLabel {
  text: string;
  x: number;
  y: number;
  kind: "place" | "street" | "zone" | "poi";
}

/** Serialized map, as stored on disk and sent to clients. */
export interface MapData {
  version: 1;
  name: string;
  width: number;
  height: number;
  metersPerTile: number;
  ground: string; // base64 Uint8Array(width*height)
  variant: string; // base64 Uint8Array(width*height)
  zones: string; // base64 Uint8Array(width*height), 0 = none
  zoneDefs: ZoneDef[];
  objects: MapObject[];
  labels: MapLabel[];
  spawn: { x: number; y: number };
  /** One-line description shown in the lobby's spot picker. */
  blurb?: string;
  /** Sort order in the spot picker (lower first). */
  order?: number;
  source: {
    type: "osm" | "procedural";
    lat?: number;
    lng?: number;
    attribution?: string;
  };
}

export function encodeBytes(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function decodeBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Decoded, queryable world used by both the server (collision) and client (render). */
export class World {
  readonly width: number;
  readonly height: number;
  readonly ground: Uint8Array;
  readonly variant: Uint8Array;
  readonly zones: Uint8Array;
  readonly solid: Uint8Array;

  constructor(readonly data: MapData) {
    this.width = data.width;
    this.height = data.height;
    this.ground = decodeBytes(data.ground);
    this.variant = decodeBytes(data.variant);
    this.zones = decodeBytes(data.zones);
    this.solid = new Uint8Array(this.width * this.height);
    for (let i = 0; i < this.ground.length; i++) {
      if (isSolidTile(this.ground[i]!)) this.solid[i] = 1;
    }
    for (const o of data.objects) {
      if (isSolidObject(o.k) && this.inBounds(o.x, o.y)) {
        this.solid[o.y * this.width + o.x] = 1;
      }
    }
  }

  inBounds(tx: number, ty: number) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  tileAt(tx: number, ty: number) {
    return this.inBounds(tx, ty) ? this.ground[ty * this.width + tx]! : 255;
  }

  isBlocked(tx: number, ty: number) {
    return !this.inBounds(tx, ty) || this.solid[ty * this.width + tx] === 1;
  }

  /** Player positions are in tile units; the avatar's feet occupy a small box. */
  canStand(x: number, y: number, r = 0.28) {
    return (
      !this.isBlocked(Math.floor(x - r), Math.floor(y - r * 0.5)) &&
      !this.isBlocked(Math.floor(x + r), Math.floor(y - r * 0.5)) &&
      !this.isBlocked(Math.floor(x - r), Math.floor(y + r * 0.5)) &&
      !this.isBlocked(Math.floor(x + r), Math.floor(y + r * 0.5))
    );
  }

  zoneAt(x: number, y: number) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return this.inBounds(tx, ty) ? this.zones[ty * this.width + tx]! : 0;
  }

  zoneDef(id: number) {
    return this.data.zoneDefs.find((z) => z.id === id);
  }
}
