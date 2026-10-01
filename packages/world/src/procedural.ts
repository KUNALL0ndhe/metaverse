import { MapBuilder, mulberry32 } from "./builder";
import type { MapData } from "./map";
import { ROOF_COLORS, Tile } from "./tiles";

const STREET_NAMES = [
  "Maple Avenue",
  "Harbor Road",
  "Sunset Boulevard",
  "Pixel Street",
  "Lantern Lane",
  "Cedar Drive",
  "Orchard Way",
  "Station Road",
];

/** A fully procedural town used when no real-world map has been imported. */
export function generateTown(seed = 7, name = "Pixel Town"): MapData {
  const W = 180;
  const H = 132;
  const rand = mulberry32(seed);
  const b = new MapBuilder(W, H, rand);
  const ri = (a: number, z: number) => a + Math.floor(rand() * (z - a + 1));

  const xs = [10, 46, 134, 170];
  const ys = [10, 44, 88, 122];
  const ROAD = 4;

  // Sidewalks first, then roads on top.
  for (const x of xs) b.fillRect(x - 1, 0, ROAD + 2, H, Tile.Path);
  for (const y of ys) b.fillRect(0, y - 1, W, ROAD + 2, Tile.Path);
  for (const [i, x] of xs.entries()) b.fillRect(x, 0, ROAD, H, i === 1 || i === 2 ? Tile.RoadMajor : Tile.Road);
  for (const [i, y] of ys.entries()) b.fillRect(0, y, W, ROAD, i === 1 || i === 2 ? Tile.RoadMajor : Tile.Road);
  // Re-draw major roads so they win at intersections.
  b.fillRect(xs[1]!, 0, ROAD, H, Tile.RoadMajor);
  b.fillRect(xs[2]!, 0, ROAD, H, Tile.RoadMajor);

  xs.forEach((x, i) => b.labels.push({ text: STREET_NAMES[i]!, x: x + ROAD / 2, y: ys[1]! + 22, kind: "street" }));
  ys.forEach((y, i) => b.labels.push({ text: STREET_NAMES[i + 4]!, x: xs[0]! + 18, y: y + ROAD / 2, kind: "street" }));

  // Street lamps along sidewalks.
  for (const x of xs)
    for (let y = 2; y < H; y += 9) if (b.get(x - 1, y) === Tile.Path) b.addObject("lamp", x - 1, y);
  for (const y of ys)
    for (let x = 4; x < W; x += 9) if (b.get(x, y + ROAD) === Tile.Path) b.addObject("lamp", x, y + ROAD);

  // Blocks between roads.
  const bxs = [0, ...xs.map((x) => x + ROAD + 1)];
  const bxe = [...xs.map((x) => x - 2), W - 1];
  const bys = [0, ...ys.map((y) => y + ROAD + 1)];
  const bye = [...ys.map((y) => y - 2), H - 1];

  const blockTypes = new Map<string, "park" | "lake" | "field" | "plaza">([
    ["2,2", "plaza"], // centre: HQ goes here
    ["0,2", "lake"],
    ["4,1", "park"],
    ["1,3", "field"],
    ["4,3", "lake"],
  ]);

  for (let by = 0; by < bys.length; by++) {
    for (let bx = 0; bx < bxs.length; bx++) {
      const x0 = bxs[bx]!;
      const x1 = bxe[bx]!;
      const y0 = bys[by]!;
      const y1 = bye[by]!;
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      if (w < 4 || h < 4) continue;
      const kind = blockTypes.get(`${bx},${by}`) ?? "buildings";

      if (kind === "park" || kind === "plaza") {
        b.fillRect(x0, y0, w, h, Tile.Park);
        // Cross paths.
        b.fillRect(x0, y0 + Math.floor(h / 2) - 1, w, 2, Tile.Path);
        b.fillRect(x0 + Math.floor(w / 2) - 1, y0, 2, h, Tile.Path);
        for (let i = 0; i < (w * h) / 22; i++) {
          const x = ri(x0, x1);
          const y = ri(y0, y1);
          if (b.get(x, y) === Tile.Park) b.addObject(rand() < 0.75 ? "tree" : rand() < 0.5 ? "bush" : "flowers", x, y);
        }
        if (kind === "park") {
          b.addObject("fountain", x0 + Math.floor(w / 2), y0 + Math.floor(h / 2) + 2);
          b.labels.push({ text: "Central Park", x: x0 + w / 2, y: y0 + 2, kind: "place" });
        }
      } else if (kind === "lake") {
        b.fillRect(x0, y0, w, h, Tile.Park);
        const cx = x0 + w / 2;
        const cy = y0 + h / 2;
        const rx = w / 2 - 3;
        const ry = h / 2 - 3;
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + (rand() - 0.5) * 0.08;
            if (d < 0.8) b.set(x, y, Tile.Water);
            else if (d < 1.05) b.set(x, y, Tile.Sand);
          }
        for (let i = 0; i < w; i++) {
          const x = ri(x0, x1);
          const y = ri(y0, y1);
          if (b.get(x, y) === Tile.Park) b.addObject(rand() < 0.5 ? "pine" : "tree", x, y);
        }
        b.labels.push({ text: bx === 0 ? "Mirror Lake" : "Blue Lagoon", x: cx, y: cy, kind: "place" });
      } else if (kind === "field") {
        b.fillRect(x0, y0, w, h, Tile.Field);
        b.labels.push({ text: "Community Farm", x: x0 + w / 2, y: y0 + h / 2, kind: "place" });
      } else {
        // Subdivide into lots and drop a building with a garden margin in each.
        let y = y0;
        while (y < y1 - 3) {
          const lh = Math.min(ri(7, 12), y1 - y + 1);
          let x = x0;
          while (x < x1 - 3) {
            const lw = Math.min(ri(7, 13), x1 - x + 1);
            if (lw >= 5 && lh >= 5) {
              const m = 1;
              const roof = Math.floor(rand() * ROOF_COLORS.length);
              b.fillRect(x + m, y + m, lw - m * 2, lh - m * 2 - 1, Tile.Building, roof);
              // Front path to the building.
              b.set(x + Math.floor(lw / 2), y + lh - 2, Tile.Path);
              if (rand() < 0.5) b.addObject(rand() < 0.5 ? "tree" : "bush", x, y + lh - 1);
            } else if (rand() < 0.6) {
              b.addObject("tree", x + 1, y + 1);
            }
            x += lw;
          }
          y += lh;
        }
      }
    }
  }

  const cx = (xs[1]! + xs[2]! + ROAD) / 2;
  const cy = (ys[1]! + ys[2]! + ROAD) / 2;
  b.stampHQ(cx, cy);

  return b.build(name, 3, { type: "procedural" });
}
