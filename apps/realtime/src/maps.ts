import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeBytes, generateTown, World, type MapData } from "@repo/world";

// Works both from src/ (tsx) and dist/ (bundled): both sit two levels below apps/realtime.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** One playable map ("demo spot"). Every space is bound to exactly one spot. */
export interface Spot {
  id: string;
  world: World;
  /** Downsampled ground tiles for the lobby thumbnail. */
  preview: { data: string; w: number; h: number };
}

const PREVIEW = 72;

function makeSpot(id: string, data: MapData): Spot {
  const world = new World(data);
  const s = Math.max(world.width, world.height) / PREVIEW;
  const w = Math.round(world.width / s);
  const h = Math.round(world.height / s);
  const bytes = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) bytes[y * w + x] = world.tileAt(Math.floor(x * s), Math.floor(y * s));
  return { id, world, preview: { data: encodeBytes(bytes), w, h } };
}

/**
 * Load every maps/*.json as a spot (files starting with "_" are scratch maps and skipped).
 * MAP_FILE=path loads a single map instead; with no maps at all, a procedural town is generated.
 */
export function loadSpots(): Spot[] {
  const files: string[] = [];
  if (process.env.MAP_FILE) {
    files.push(resolve(REPO_ROOT, process.env.MAP_FILE));
  } else {
    const dir = resolve(REPO_ROOT, process.env.MAPS_DIR ?? "maps");
    if (existsSync(dir))
      for (const f of readdirSync(dir)) if (f.endsWith(".json") && !f.startsWith("_")) files.push(resolve(dir, f));
  }

  const spots = files
    .filter((f) => existsSync(f))
    .map((f) => makeSpot(basename(f, ".json"), JSON.parse(readFileSync(f, "utf8")) as MapData));
  if (!spots.length) {
    console.log('🗺️  No maps found — using a procedural town. Run `pnpm map:spots` or `pnpm map:import --place "..."`.');
    spots.push(makeSpot("pixel-town", generateTown()));
  }
  spots.sort(
    (a, b) => (a.world.data.order ?? 999) - (b.world.data.order ?? 999) || a.world.data.name.localeCompare(b.world.data.name),
  );
  for (const s of spots)
    console.log(`🗺️  ${s.id}: "${s.world.data.name}" (${s.world.width}×${s.world.height}, ${s.world.data.source.type})`);
  return spots;
}
