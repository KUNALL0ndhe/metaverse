/**
 * Import a real-world area from OpenStreetMap into a playable map.
 *
 *   pnpm map:import --place "Koregaon Park, Pune"
 *   pnpm map:import --lat 18.5362 --lng 73.8940 --radius 350 --name "My Hood"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mapFromOsm, overpassQuery, type OsmElement } from "../src/index";

const UA = "metaverse-side-project/1.0 (OSM map importer)";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function geocode(place: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
  const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!hits.length) throw new Error(`No match for "${place}"`);
  console.log(`📍 ${hits[0]!.display_name}`);
  return { lat: Number(hits[0]!.lat), lng: Number(hits[0]!.lon) };
}

async function fetchOsm(query: string): Promise<OsmElement[]> {
  let lastErr: unknown;
  // Public Overpass servers are often busy: try every mirror, twice, with backoff.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const endpoint of OVERPASS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
          body: "data=" + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
        const json = (await res.json()) as { elements: OsmElement[] };
        return json.elements;
      } catch (e) {
        lastErr = e;
        console.warn(`⚠️  ${String(e)} — trying next mirror`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(HERE, "../../../maps");
const CACHE_DIR = resolve(HERE, "../.osm-cache");

export interface ImportOptions {
  lat: number;
  lng: number;
  radius: number;
  metersPerTile: number;
  name: string;
  /** File name in maps/ (also the spot id), e.g. "gateway-of-india.json". */
  out: string;
  hqName?: string;
  landmark?: string;
  blurb?: string;
  order?: number;
  spawnAt?: { lat: number; lng: number };
  /** Re-download from Overpass even if a cached response exists. */
  refresh?: boolean;
}

/** Fetch (or reuse cached) OSM data for an area and write the playable map to maps/. */
export async function importArea(o: ImportOptions) {
  const cacheFile = resolve(CACHE_DIR, `${o.lat.toFixed(5)}_${o.lng.toFixed(5)}_${o.radius}.json`);
  let elements: OsmElement[];
  if (!o.refresh && existsSync(cacheFile)) {
    elements = JSON.parse(readFileSync(cacheFile, "utf8"));
    console.log(`📦 ${o.name}: using cached OSM data (${elements.length} elements)`);
  } else {
    console.log(`🛰️  ${o.name}: fetching OpenStreetMap data around ${o.lat.toFixed(5)}, ${o.lng.toFixed(5)} (±${o.radius} m)…`);
    elements = await fetchOsm(overpassQuery(o.lat, o.lng, o.radius));
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(elements));
  }

  const map = mapFromOsm(elements, { ...o });
  const out = resolve(MAPS_DIR, o.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(map));
  console.log(`✅ ${o.name}: ${map.width}×${map.height} tiles, ${map.objects.length} objects, ${map.labels.length} labels → maps/${o.out}`);
  return map;
}

async function main() {
  const place = arg("place");
  let lat = Number(arg("lat"));
  let lng = Number(arg("lng"));
  if (place) ({ lat, lng } = await geocode(place));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error('Usage: pnpm map:import --place "Your Neighbourhood, City"  |  --lat <lat> --lng <lng>');
    console.error(
      "Options: --radius <m, default 300>  --mpt <metres per tile, default 2.5>  --name <map name>  --out <file.json>\n" +
        '         --hq <HQ name>  --landmark <label at spawn>  --blurb "<lobby description>"  --order <n>  --refresh',
    );
    process.exit(1);
  }
  await importArea({
    lat,
    lng,
    radius: Number(arg("radius") ?? 300),
    metersPerTile: Number(arg("mpt") ?? 2.5),
    name: arg("name") ?? place?.split(",")[0] ?? "My Area",
    out: arg("out") ?? "default.json",
    hqName: arg("hq"),
    landmark: arg("landmark"),
    blurb: arg("blurb"),
    order: arg("order") !== undefined ? Number(arg("order")) : undefined,
    refresh: process.argv.includes("--refresh"),
  });
  console.log("   Restart the realtime server to load it.");
}

// Run as a CLI only when executed directly (not when imported by import-spots.ts).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
