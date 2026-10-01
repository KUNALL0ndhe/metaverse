/** Write the procedural fallback town to maps/default.json (handy for resetting or offline demos). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateTown } from "../src/index";

const seed = Number(process.argv[2] ?? 7);
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../maps/default.json");
const map = generateTown(seed);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(map));
console.log(`✅ Procedural town (seed ${seed}) ${map.width}×${map.height} → ${out}`);
