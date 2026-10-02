/**
 * Render maps/*.json to small PNG previews (1 px per tile) — handy for checking an import.
 *
 *   pnpm --filter @repo/world exec tsx scripts/preview.ts [outDir]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { decodeBytes, Tile, type MapData } from "../src/index";

const COLORS: Record<number, [number, number, number]> = {
  [Tile.Grass]: [121, 194, 95],
  [Tile.Park]: [91, 178, 78],
  [Tile.Forest]: [63, 122, 53],
  [Tile.Road]: [90, 95, 105],
  [Tile.RoadMajor]: [62, 66, 74],
  [Tile.Path]: [212, 204, 186],
  [Tile.Plaza]: [227, 217, 198],
  [Tile.Water]: [58, 143, 214],
  [Tile.Sand]: [236, 217, 160],
  [Tile.Building]: [181, 82, 59],
  [Tile.Parking]: [128, 133, 142],
  [Tile.FloorWood]: [201, 154, 102],
  [Tile.FloorCarpet]: [79, 95, 154],
  [Tile.Wall]: [44, 48, 59],
  [Tile.Door]: [163, 93, 58],
  [Tile.Rail]: [141, 135, 124],
  [Tile.Field]: [205, 184, 115],
  [Tile.FloorTile]: [226, 225, 234],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function mapToPng(map: MapData, scale = 2): Buffer {
  const ground = decodeBytes(map.ground);
  const W = map.width * scale;
  const H = map.height * scale;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const t = ground[Math.floor(y / scale) * map.width + Math.floor(x / scale)]!;
      const [r, g, b] = COLORS[t] ?? [121, 194, 95];
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  // Trees as dark dots, spawn as a white square.
  const dot = (tx: number, ty: number, c: [number, number, number], size: number) => {
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const px = tx * scale + dx;
        const py = ty * scale + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = py * (W * 3 + 1) + 1 + px * 3;
        [raw[o], raw[o + 1], raw[o + 2]] = c;
      }
  };
  for (const o of map.objects) if (o.k === "tree" || o.k === "pine") dot(o.x, o.y, [40, 100, 45], scale);
  dot(Math.floor(map.spawn.x) - 2, Math.floor(map.spawn.y) - 2, [255, 255, 255], scale * 4);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mapsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../maps");
const outDir = resolve(process.argv[2] ?? resolve(mapsDir, "previews"));
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(mapsDir).filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
  const map = JSON.parse(readFileSync(resolve(mapsDir, f), "utf8")) as MapData;
  const out = resolve(outDir, f.replace(/\.json$/, ".png"));
  writeFileSync(out, mapToPng(map));
  console.log(`🖼️  ${map.name} → ${out}`);
}
