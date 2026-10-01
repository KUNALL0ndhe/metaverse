import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateTown, World, type MapData } from "@repo/world";

// Works both from src/ (tsx) and dist/ (bundled): both sit two levels below apps/realtime.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function loadWorld(): World {
  // Relative MAP_FILE paths are taken from the repo root.
  const file = resolve(REPO_ROOT, process.env.MAP_FILE ?? "maps/default.json");
  let data: MapData;
  if (existsSync(file)) {
    data = JSON.parse(readFileSync(file, "utf8")) as MapData;
    console.log(`🗺️  Loaded map "${data.name}" (${data.width}×${data.height}, ${data.source.type}) from ${file}`);
  } else {
    data = generateTown();
    console.log(`🗺️  No map at ${file} — using procedural "${data.name}". Run \`pnpm map:import --place "..."\` to use your area.`);
  }
  return new World(data);
}
