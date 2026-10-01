import {
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  ROOF_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  Tile,
  type AvatarConfig,
  type Dir,
  type ObjectKind,
} from "@repo/world";

export const TS = 32; // pixels per tile

type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

/** Cheap hash → [0,1) used for per-tile texture variation. */
function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function speckle(ctx: Ctx, px: number, py: number, tx: number, ty: number, colors: string[], count: number, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length]!;
    const sx = Math.floor(hash(tx, ty, i * 3 + 1) * (TS - size));
    const sy = Math.floor(hash(tx, ty, i * 3 + 2) * (TS - size));
    ctx.fillRect(px + sx, py + sy, size, size);
  }
}

export type TileGetter = (x: number, y: number) => number;

const ROADS = new Set<number>([Tile.Road, Tile.RoadMajor]);

/** Paint one ground tile at pixel position (px, py). Neighbours drive edges, walls and shadows. */
export function paintTile(ctx: Ctx, get: TileGetter, variantAt: (x: number, y: number) => number, tx: number, ty: number, px: number, py: number) {
  const t = get(tx, ty);
  const below = get(tx, ty + 1);
  const above = get(tx, ty - 1);
  const left = get(tx - 1, ty);
  const right = get(tx + 1, ty);

  switch (t) {
    case Tile.Grass:
      ctx.fillStyle = "#79c25f";
      ctx.fillRect(px, py, TS, TS);
      speckle(ctx, px, py, tx, ty, ["#6cb253", "#8bd06d", "#5fa448"], 6);
      if (hash(tx, ty, 9) < 0.08) {
        ctx.fillStyle = "#4e9a3d";
        ctx.fillRect(px + 10, py + 14, 2, 5);
        ctx.fillRect(px + 13, py + 12, 2, 7);
        ctx.fillRect(px + 16, py + 15, 2, 4);
      }
      break;
    case Tile.Park:
      ctx.fillStyle = "#62b955";
      ctx.fillRect(px, py, TS, TS);
      speckle(ctx, px, py, tx, ty, ["#56a84a", "#78cc66", "#4d9c42"], 7);
      if (hash(tx, ty, 5) < 0.06) {
        ctx.fillStyle = ["#ffd166", "#ef476f", "#ffffff", "#c77dff"][Math.floor(hash(tx, ty, 6) * 4)]!;
        ctx.fillRect(px + 12, py + 12, 3, 3);
        ctx.fillRect(px + 20, py + 18, 3, 3);
      }
      break;
    case Tile.Forest:
      ctx.fillStyle = "#4a8a3f";
      ctx.fillRect(px, py, TS, TS);
      speckle(ctx, px, py, tx, ty, ["#3f7a35", "#5a9a4c", "#6b5a3a"], 8);
      break;
    case Tile.Field:
      ctx.fillStyle = "#cdb873";
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = "#b9a35f";
      for (let i = 0; i < TS; i += 8) ctx.fillRect(px, py + i, TS, 3);
      speckle(ctx, px, py, tx, ty, ["#9cb25a"], 3);
      break;
    case Tile.Sand:
      ctx.fillStyle = "#ecd9a0";
      ctx.fillRect(px, py, TS, TS);
      speckle(ctx, px, py, tx, ty, ["#dcc68a", "#f6e7b8"], 6);
      break;
    case Tile.Road:
    case Tile.RoadMajor: {
      ctx.fillStyle = t === Tile.RoadMajor ? "#41454d" : "#4d525b";
      ctx.fillRect(px, py, TS, TS);
      speckle(ctx, px, py, tx, ty, ["#565b64", "#3c4047"], 5);
      // Curbs where the road meets anything else.
      ctx.fillStyle = "#9aa0a8";
      if (!ROADS.has(above)) ctx.fillRect(px, py, TS, 2);
      if (!ROADS.has(below)) ctx.fillRect(px, py + TS - 2, TS, 2);
      if (!ROADS.has(left)) ctx.fillRect(px, py, 2, TS);
      if (!ROADS.has(right)) ctx.fillRect(px + TS - 2, py, 2, TS);
      // Dashed centre-line hints on major roads.
      if (t === Tile.RoadMajor && (tx + ty) % 3 === 0) {
        const horiz = ROADS.has(left) && ROADS.has(right) && !(ROADS.has(above) && ROADS.has(below));
        const vert = ROADS.has(above) && ROADS.has(below) && !(ROADS.has(left) && ROADS.has(right));
        ctx.fillStyle = "#e8c547";
        if (horiz) ctx.fillRect(px + 6, py + 15, 20, 2);
        else if (vert) ctx.fillRect(px + 15, py + 6, 2, 20);
      }
      break;
    }
    case Tile.Parking:
      ctx.fillStyle = "#666b74";
      ctx.fillRect(px, py, TS, TS);
      speckle(ctx, px, py, tx, ty, ["#5d626a"], 4);
      if (tx % 3 === 0) {
        ctx.fillStyle = "#d9dde2";
        ctx.fillRect(px, py + 4, 2, TS - 8);
      }
      break;
    case Tile.Path:
      ctx.fillStyle = "#cbc3b1";
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = "#b8af9b";
      ctx.fillRect(px, py + 15, TS, 1);
      ctx.fillRect(px + ((ty % 2) * 16 + 8), py, 1, 15);
      ctx.fillRect(px + (((ty + 1) % 2) * 16 + 8), py + 16, 1, 16);
      break;
    case Tile.Plaza:
      ctx.fillStyle = "#ddd3c0";
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = "#cdc2ad";
      ctx.fillRect(px, py, TS, 1);
      ctx.fillRect(px, py, 1, TS);
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = "#e6ddcc";
        ctx.fillRect(px + 1, py + 1, TS - 1, TS - 1);
      }
      break;
    case Tile.Water: {
      ctx.fillStyle = "#3a8fd6";
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = "#5aa8e8";
      const o = Math.floor(hash(tx, ty, 2) * 16);
      ctx.fillRect(px + o, py + 8, 10, 2);
      ctx.fillRect(px + ((o + 12) % 22), py + 22, 8, 2);
      ctx.fillStyle = "#d8f0ff";
      if (above !== Tile.Water) ctx.fillRect(px, py, TS, 3);
      if (left !== Tile.Water) ctx.fillRect(px, py, 3, TS);
      if (right !== Tile.Water) ctx.fillRect(px + TS - 3, py, 3, TS);
      if (below !== Tile.Water) ctx.fillRect(px, py + TS - 3, TS, 3);
      break;
    }
    case Tile.Rail:
      ctx.fillStyle = "#8d877c";
      ctx.fillRect(px, py, TS, TS);
      speckle(ctx, px, py, tx, ty, ["#7a746a", "#a39d92"], 8);
      ctx.fillStyle = "#6b4f36";
      for (let i = 2; i < TS; i += 8) ctx.fillRect(px + i, py + 4, 4, TS - 8);
      ctx.fillStyle = "#c8ccd2";
      ctx.fillRect(px, py + 9, TS, 2);
      ctx.fillRect(px, py + 21, TS, 2);
      break;
    case Tile.Building: {
      const roof = ROOF_COLORS[variantAt(tx, ty) % ROOF_COLORS.length]!;
      ctx.fillStyle = roof;
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = shade(roof, -0.06);
      for (let i = 4; i < TS; i += 8) ctx.fillRect(px, py + i, TS, 2);
      if (above !== Tile.Building) {
        ctx.fillStyle = shade(roof, 0.14);
        ctx.fillRect(px, py, TS, 4);
      }
      if (left !== Tile.Building) {
        ctx.fillStyle = shade(roof, 0.08);
        ctx.fillRect(px, py, 3, TS);
      }
      if (right !== Tile.Building) {
        ctx.fillStyle = shade(roof, -0.14);
        ctx.fillRect(px + TS - 3, py, 3, TS);
      }
      if (below !== Tile.Building) {
        // Front facade with a window — fakes a bit of height.
        ctx.fillStyle = "#e9dfcf";
        ctx.fillRect(px, py + 14, TS, 18);
        ctx.fillStyle = shade(roof, -0.22);
        ctx.fillRect(px, py + 12, TS, 3);
        ctx.fillStyle = "#c9bca6";
        ctx.fillRect(px, py + TS - 3, TS, 3);
        const lit = hash(tx, ty, 11) < 0.5;
        ctx.fillStyle = lit ? "#7fb6e0" : "#5b7f9e";
        ctx.fillRect(px + 9, py + 18, 14, 9);
        ctx.fillStyle = "#f5efe3";
        ctx.fillRect(px + 15, py + 18, 2, 9);
        ctx.fillRect(px + 9, py + 22, 14, 1);
      }
      break;
    }
    case Tile.FloorWood:
    case Tile.Door:
      ctx.fillStyle = "#c99a66";
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = "#b8895a";
      for (let i = 0; i < TS; i += 8) ctx.fillRect(px, py + i, TS, 1);
      ctx.fillRect(px + ((ty * 13) % 32), py, 1, TS);
      if (t === Tile.Door) {
        ctx.fillStyle = "#8a4b2e";
        ctx.fillRect(px + 3, py + 3, TS - 6, TS - 6);
        ctx.fillStyle = "#a35d3a";
        ctx.fillRect(px + 6, py + 6, TS - 12, TS - 12);
      }
      break;
    case Tile.FloorCarpet:
      ctx.fillStyle = "#4f5f9a";
      ctx.fillRect(px, py, TS, TS);
      ctx.fillStyle = "#56679f";
      if ((tx + ty) % 2 === 0) ctx.fillRect(px + 4, py + 4, TS - 8, TS - 8);
      break;
    case Tile.FloorTile:
      ctx.fillStyle = (tx + ty) % 2 === 0 ? "#ecebf2" : "#d9d7e3";
      ctx.fillRect(px, py, TS, TS);
      break;
    case Tile.Wall: {
      ctx.fillStyle = "#353a48";
      ctx.fillRect(px, py, TS, TS);
      if (below !== Tile.Wall) {
        ctx.fillStyle = "#9aa1b8";
        ctx.fillRect(px, py + 10, TS, 22);
        ctx.fillStyle = "#b4bbd0";
        ctx.fillRect(px, py + 10, TS, 3);
        ctx.fillStyle = "#7c8299";
        ctx.fillRect(px, py + TS - 3, TS, 3);
      } else {
        ctx.fillStyle = "#424858";
        ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4);
      }
      break;
    }
    default:
      ctx.fillStyle = "#79c25f";
      ctx.fillRect(px, py, TS, TS);
  }

  // Drop shadows cast by tall things to the north.
  if (t !== Tile.Building && t !== Tile.Wall && (above === Tile.Building || above === Tile.Wall)) {
    const g = ctx.createLinearGradient(0, py, 0, py + 10);
    g.addColorStop(0, "rgba(0,0,0,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(px, py, TS, 10);
  }
}

/** Colour used for each tile on the minimap. */
export const MINIMAP_COLORS: Record<number, string> = {
  [Tile.Grass]: "#79c25f",
  [Tile.Park]: "#5bb24e",
  [Tile.Forest]: "#3f7a35",
  [Tile.Road]: "#5a5f69",
  [Tile.RoadMajor]: "#3e424a",
  [Tile.Path]: "#d4ccba",
  [Tile.Plaza]: "#e3d9c6",
  [Tile.Water]: "#3a8fd6",
  [Tile.Sand]: "#ecd9a0",
  [Tile.Building]: "#b5523b",
  [Tile.Parking]: "#80858e",
  [Tile.FloorWood]: "#c99a66",
  [Tile.FloorCarpet]: "#4f5f9a",
  [Tile.Wall]: "#2c303b",
  [Tile.Door]: "#a35d3a",
  [Tile.Rail]: "#8d877c",
  [Tile.Field]: "#cdb873",
  [Tile.FloorTile]: "#e2e1ea",
};

// ---------------------------------------------------------------------------
// Objects

export interface ObjectSprite {
  c: HTMLCanvasElement;
  /** Offset from the tile's top-left to the sprite's top-left. */
  ox: number;
  oy: number;
}

const objectCache = new Map<string, ObjectSprite>();

export function objectSprite(k: ObjectKind, variant: number): ObjectSprite {
  const v = variant % 3;
  const key = `${k}:${v}`;
  let s = objectCache.get(key);
  if (!s) {
    s = drawObject(k, v);
    objectCache.set(key, s);
  }
  return s;
}

function drawObject(k: ObjectKind, v: number): ObjectSprite {
  switch (k) {
    case "tree": {
      const { c, ctx } = makeCanvas(56, 72);
      const greens = [
        ["#2f7d32", "#3f9a3f", "#58b553"],
        ["#3b7f2a", "#4f9b37", "#6bb74c"],
        ["#2c6e45", "#3a8a57", "#50a86e"],
      ][v]!;
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(28, 66, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6b4426";
      ctx.fillRect(24, 42, 8, 24);
      ctx.fillStyle = "#58361d";
      ctx.fillRect(24, 42, 3, 24);
      const blob = (x: number, y: number, r: number, col: string) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      blob(28, 32, 22, "#1f5a24");
      blob(28, 30, 21, greens[0]!);
      blob(20, 26, 13, greens[1]!);
      blob(34, 22, 12, greens[1]!);
      blob(24, 18, 8, greens[2]!);
      blob(33, 33, 9, greens[1]!);
      return { c, ox: -12, oy: -40 };
    }
    case "pine": {
      const { c, ctx } = makeCanvas(48, 76);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.ellipse(24, 70, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5b3a20";
      ctx.fillRect(21, 56, 6, 14);
      const tri = (y: number, w: number, h: number, col: string) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(24, y);
        ctx.lineTo(24 - w, y + h);
        ctx.lineTo(24 + w, y + h);
        ctx.closePath();
        ctx.fill();
      };
      const g = ["#1e6b46", "#256f3a", "#2a5f4a"][v]!;
      tri(26, 20, 32, "#174d33");
      tri(24, 19, 31, g);
      tri(12, 15, 26, g);
      tri(2, 10, 20, shade(g, 0.08));
      return { c, ox: -8, oy: -44 };
    }
    case "bush": {
      const { c, ctx } = makeCanvas(32, 32);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.ellipse(16, 27, 13, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [x, y, r, col] of [
        [10, 18, 8, "#3c8a37"],
        [22, 18, 8, "#3c8a37"],
        [16, 13, 9, "#4fa346"],
        [13, 12, 4, "#69bf5c"],
      ] as const) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (v === 1) {
        ctx.fillStyle = "#e63946";
        ctx.fillRect(9, 15, 3, 3);
        ctx.fillRect(20, 12, 3, 3);
        ctx.fillRect(17, 20, 3, 3);
      }
      return { c, ox: 0, oy: 0 };
    }
    case "flowers": {
      const { c, ctx } = makeCanvas(32, 32);
      const cols = [["#ff6b9a", "#ffd166"], ["#ffffff", "#c77dff"], ["#ffb703", "#fb5607"]][v]!;
      for (let i = 0; i < 7; i++) {
        const x = 4 + ((i * 11) % 24);
        const y = 8 + ((i * 7) % 18);
        ctx.fillStyle = "#3f8f3a";
        ctx.fillRect(x + 1, y + 2, 1, 4);
        ctx.fillStyle = cols[i % 2]!;
        ctx.fillRect(x, y, 3, 3);
      }
      return { c, ox: 0, oy: 0 };
    }
    case "lamp": {
      const { c, ctx } = makeCanvas(16, 64);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(3, 60, 10, 3);
      ctx.fillStyle = "#2d3142";
      ctx.fillRect(7, 12, 3, 50);
      ctx.fillRect(4, 58, 9, 4);
      ctx.fillStyle = "#3d4256";
      ctx.fillRect(3, 6, 11, 7);
      ctx.fillStyle = "#ffe8a3";
      ctx.fillRect(5, 8, 7, 4);
      return { c, ox: 8, oy: -32 };
    }
    case "bench": {
      const { c, ctx } = makeCanvas(32, 32);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(3, 26, 26, 3);
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(4, 18, 2, 9);
      ctx.fillRect(26, 18, 2, 9);
      ctx.fillStyle = "#9c6a3e";
      ctx.fillRect(2, 10, 28, 4);
      ctx.fillStyle = "#b07a48";
      ctx.fillRect(2, 17, 28, 5);
      return { c, ox: 0, oy: 0 };
    }
    case "fountain": {
      const { c, ctx } = makeCanvas(48, 48);
      ctx.fillStyle = "#9aa3ad";
      ctx.beginPath();
      ctx.ellipse(24, 30, 22, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4aa3e8";
      ctx.beginPath();
      ctx.ellipse(24, 29, 18, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c3cad2";
      ctx.fillRect(21, 12, 6, 17);
      ctx.fillStyle = "#bfe6ff";
      ctx.fillRect(18, 6, 3, 10);
      ctx.fillRect(27, 6, 3, 10);
      ctx.fillRect(22, 2, 4, 8);
      return { c, ox: -8, oy: -16 };
    }
    case "desk": {
      const { c, ctx } = makeCanvas(32, 40);
      ctx.fillStyle = "#7a5534";
      ctx.fillRect(1, 18, 30, 4);
      ctx.fillRect(2, 22, 3, 14);
      ctx.fillRect(27, 22, 3, 14);
      ctx.fillStyle = "#9b6e45";
      ctx.fillRect(1, 12, 30, 7);
      ctx.fillStyle = "#22252e";
      ctx.fillRect(8, 0, 16, 11);
      ctx.fillStyle = ["#4cc9f0", "#80ed99", "#f8961e"][v]!;
      ctx.fillRect(10, 2, 12, 7);
      ctx.fillStyle = "#22252e";
      ctx.fillRect(14, 11, 4, 2);
      return { c, ox: 0, oy: -8 };
    }
    case "chair": {
      const { c, ctx } = makeCanvas(32, 32);
      ctx.fillStyle = "#2b2f3a";
      ctx.fillRect(10, 22, 2, 7);
      ctx.fillRect(20, 22, 2, 7);
      ctx.fillStyle = ["#e76f51", "#2a9d8f", "#6c63ff"][v]!;
      ctx.fillRect(8, 16, 16, 7);
      ctx.fillRect(9, 6, 14, 10);
      return { c, ox: 0, oy: 0 };
    }
    case "table": {
      const { c, ctx } = makeCanvas(32, 32);
      ctx.fillStyle = "#e9e4da";
      ctx.fillRect(0, 6, 32, 18);
      ctx.fillStyle = "#cfc8ba";
      ctx.fillRect(0, 22, 32, 4);
      ctx.fillStyle = "#8a8378";
      ctx.fillRect(2, 26, 3, 6);
      ctx.fillRect(27, 26, 3, 6);
      return { c, ox: 0, oy: 0 };
    }
    case "sofa": {
      const { c, ctx } = makeCanvas(32, 32);
      const col = ["#e07a5f", "#3d405b", "#81b29a"][v]!;
      ctx.fillStyle = shade(col, -0.15);
      ctx.fillRect(1, 6, 30, 12);
      ctx.fillStyle = col;
      ctx.fillRect(1, 16, 30, 10);
      ctx.fillRect(0, 12, 4, 14);
      ctx.fillRect(28, 12, 4, 14);
      return { c, ox: 0, oy: 0 };
    }
    case "plant": {
      const { c, ctx } = makeCanvas(32, 44);
      ctx.fillStyle = "#b5651d";
      ctx.fillRect(9, 30, 14, 12);
      ctx.fillStyle = "#cd7f32";
      ctx.fillRect(8, 28, 16, 4);
      ctx.fillStyle = "#2f9e44";
      for (const [x, y, r] of [
        [16, 18, 9],
        [10, 22, 6],
        [22, 22, 6],
        [16, 9, 6],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#51cf66";
      ctx.fillRect(13, 8, 3, 3);
      return { c, ox: 0, oy: -12 };
    }
    case "whiteboard": {
      const { c, ctx } = makeCanvas(64, 32);
      ctx.fillStyle = "#c0c4cc";
      ctx.fillRect(0, 4, 64, 24);
      ctx.fillStyle = "#fbfbfd";
      ctx.fillRect(2, 6, 60, 20);
      ctx.strokeStyle = "#4361ee";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, 20);
      ctx.lineTo(18, 12);
      ctx.lineTo(28, 18);
      ctx.lineTo(40, 10);
      ctx.stroke();
      ctx.fillStyle = "#ef476f";
      ctx.fillRect(46, 12, 10, 3);
      ctx.fillRect(46, 18, 7, 3);
      return { c, ox: -16, oy: 2 };
    }
    case "screen": {
      const { c, ctx } = makeCanvas(96, 36);
      ctx.fillStyle = "#14161c";
      ctx.fillRect(0, 2, 96, 30);
      const g = ctx.createLinearGradient(0, 0, 96, 30);
      g.addColorStop(0, "#5f0fff");
      g.addColorStop(1, "#00c2ff");
      ctx.fillStyle = g;
      ctx.fillRect(3, 5, 90, 24);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "bold 10px Silkscreen, monospace";
      ctx.fillText("HELLO, WORLD", 14, 21);
      return { c, ox: -32, oy: 0 };
    }
    case "coffee": {
      const { c, ctx } = makeCanvas(32, 44);
      ctx.fillStyle = "#3d3d46";
      ctx.fillRect(4, 8, 24, 34);
      ctx.fillStyle = "#585864";
      ctx.fillRect(6, 10, 20, 10);
      ctx.fillStyle = "#e63946";
      ctx.fillRect(8, 12, 4, 3);
      ctx.fillStyle = "#f1faee";
      ctx.fillRect(12, 28, 8, 7);
      ctx.fillStyle = "#6f4518";
      ctx.fillRect(13, 29, 6, 3);
      return { c, ox: 0, oy: -12 };
    }
  }
}

/** Objects drawn flat on the floor (never occlude avatars). */
export const FLAT_OBJECTS = new Set<ObjectKind>(["flowers", "whiteboard", "screen"]);

// ---------------------------------------------------------------------------
// Avatars: 16×24 logical pixels at 2× scale, 4 directions × 4 walk frames.

export const AV_W = 32;
export const AV_H = 48;
const DIR_ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };
const sheetCache = new Map<string, HTMLCanvasElement>();

export function avatarKey(a: AvatarConfig) {
  return `${a.skin}-${a.hair}-${a.hairStyle}-${a.shirt}-${a.pants}`;
}

export function avatarSheet(a: AvatarConfig): HTMLCanvasElement {
  const key = avatarKey(a);
  let sheet = sheetCache.get(key);
  if (!sheet) {
    sheet = buildSheet(a);
    sheetCache.set(key, sheet);
  }
  return sheet;
}

export function drawAvatar(ctx: Ctx, a: AvatarConfig, dir: Dir, frame: number, x: number, y: number, scale = 1) {
  const sheet = avatarSheet(a);
  ctx.drawImage(sheet, (frame % 4) * AV_W, DIR_ROW[dir] * AV_H, AV_W, AV_H, x, y, AV_W * scale, AV_H * scale);
}

function buildSheet(a: AvatarConfig) {
  const { c, ctx } = makeCanvas(AV_W * 4, AV_H * 4);
  for (const dir of ["down", "left", "right", "up"] as Dir[]) {
    for (let f = 0; f < 4; f++) {
      const { c: frame, ctx: fctx } = makeCanvas(AV_W, AV_H);
      paintFigure(fctx, a, dir, f);
      outline(ctx, frame, f * AV_W, DIR_ROW[dir] * AV_H);
    }
  }
  return c;
}

/** Composite a sprite with a 2px dark outline for readability on any background. */
function outline(dst: Ctx, src: HTMLCanvasElement, x: number, y: number) {
  const { c: sil, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#1a1423";
  ctx.fillRect(0, 0, sil.width, sil.height);
  for (const [dx, dy] of [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ])
    dst.drawImage(sil, x + dx, y + dy);
  dst.drawImage(src, x, y);
}

function paintFigure(ctx: Ctx, a: AvatarConfig, dir: Dir, f: number) {
  const P = 2;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x * P, y * P, w * P, h * P);
  };
  const skin = SKIN_TONES[a.skin]!;
  const hair = HAIR_COLORS[a.hair]!;
  const shirt = SHIRT_COLORS[a.shirt]!;
  const pants = PANTS_COLORS[a.pants]!;
  const style = HAIR_STYLES[a.hairStyle]!;
  const shoe = "#2a2230";
  const step = f === 1 ? 1 : f === 3 ? -1 : 0;
  const bob = f === 1 || f === 3 ? 1 : 0; // body dips mid-stride

  const side = dir === "left" || dir === "right";
  const flip = dir === "left";
  // Helper for side view: mirror x within the 16px frame.
  const sx = (x: number, w: number) => (flip ? 16 - x - w : x);

  // Legs
  if (!side) {
    px(5, 18 + bob - (step > 0 ? 1 : 0), 3, 4, pants);
    px(8, 18 + bob - (step < 0 ? 1 : 0), 3, 4, pants);
    px(5, 22 - (step > 0 ? 1 : 0), 3, 1, shoe);
    px(8, 22 - (step < 0 ? 1 : 0), 3, 1, shoe);
  } else {
    px(sx(6 + step, 3), 18 + bob, 3, 4, pants);
    px(sx(7 - step, 3), 18 + bob, 3, 4, shade(pants, -0.08));
    px(sx(6 + step, 3), 22, 3, 1, shoe);
    px(sx(7 - step, 4), 22, 4, 1, shoe);
  }

  // Torso
  const ty = 11 + bob;
  if (!side) {
    px(4, ty, 8, 7, shirt);
    px(4, ty + 6, 8, 1, shade(shirt, -0.12));
    // Arms swing opposite to legs.
    px(3, ty + 1 + (step > 0 ? 1 : 0), 1, 4, shirt);
    px(12, ty + 1 + (step < 0 ? 1 : 0), 1, 4, shirt);
    px(3, ty + 5 + (step > 0 ? 1 : 0), 1, 1, skin);
    px(12, ty + 5 + (step < 0 ? 1 : 0), 1, 1, skin);
    if (dir === "down") px(7, ty, 2, 1, shade(shirt, 0.15)); // collar
  } else {
    px(sx(5, 6), ty, 6, 7, shirt);
    px(sx(7 + step, 2), ty + 1, 2, 4, shade(shirt, -0.12));
    px(sx(7 + step, 2), ty + 5, 2, 1, skin);
  }

  // Head
  const hy = 2 + bob;
  if (!side) {
    px(4, hy, 8, 9, skin);
    if (dir === "down") {
      px(6, hy + 5, 1, 2, "#1d1a24");
      px(9, hy + 5, 1, 2, "#1d1a24");
      px(5, hy + 7, 1, 1, shade(skin, -0.08));
      px(10, hy + 7, 1, 1, shade(skin, -0.08));
      px(7, hy + 8, 2, 1, shade(skin, -0.18));
    }
  } else {
    px(sx(5, 7), hy, 7, 9, skin);
    px(sx(10, 1), hy + 5, 1, 2, "#1d1a24");
    px(sx(12, 1), hy + 6, 1, 1, shade(skin, -0.1));
  }

  // Hair
  const back = dir === "up";
  switch (style) {
    case "short":
      px(4, hy - 1, 8, 3, hair);
      if (!side) {
        px(4, hy + 2, 1, 2, hair);
        px(11, hy + 2, 1, 2, hair);
      } else px(sx(5, 3), hy + 2, 3, 3, hair);
      if (back) px(4, hy, 8, 7, hair);
      break;
    case "long":
      px(3, hy - 1, 10, 4, hair);
      if (!side) {
        px(3, hy + 3, 2, 8, hair);
        px(11, hy + 3, 2, 8, hair);
      } else px(sx(4, 4), hy + 2, 4, 9, hair);
      if (back) px(3, hy, 10, 11, hair);
      break;
    case "spiky":
      px(4, hy - 1, 8, 3, hair);
      px(4, hy - 2, 2, 1, hair);
      px(7, hy - 3, 2, 2, hair);
      px(10, hy - 2, 2, 1, hair);
      if (back) px(4, hy, 8, 6, hair);
      else if (side) px(sx(5, 2), hy + 2, 2, 2, hair);
      break;
    case "bun":
      px(4, hy - 1, 8, 3, hair);
      px(6, hy - 4, 4, 3, hair);
      if (!side) {
        px(4, hy + 2, 1, 3, hair);
        px(11, hy + 2, 1, 3, hair);
      } else px(sx(5, 3), hy + 2, 3, 3, hair);
      if (back) px(4, hy, 8, 7, hair);
      break;
    case "bald":
      px(5, hy, 6, 1, shade(skin, 0.08));
      break;
    case "cap":
      px(4, hy - 1, 8, 3, shirt);
      px(4, hy + 1, 8, 1, shade(shirt, -0.2));
      if (dir === "down") px(4, hy + 2, 8, 1, shade(shirt, -0.3));
      else if (side) px(sx(11, 3), hy + 1, 3, 1, shade(shirt, -0.3));
      if (back) px(4, hy + 2, 8, 4, hair);
      break;
  }
}
