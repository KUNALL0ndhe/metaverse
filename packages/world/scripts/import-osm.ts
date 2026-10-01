/**
 * Import a real-world area from OpenStreetMap into a playable map.
 *
 *   pnpm map:import --place "Koregaon Park, Pune"
 *   pnpm map:import --lat 18.5362 --lng 73.8940 --radius 350 --name "My Hood"
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

async function main() {
  const place = arg("place");
  let lat = Number(arg("lat"));
  let lng = Number(arg("lng"));
  if (place) ({ lat, lng } = await geocode(place));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error('Usage: pnpm map:import --place "Your Neighbourhood, City"  |  --lat <lat> --lng <lng>');
    console.error("Options: --radius <m, default 300>  --mpt <metres per tile, default 2.5>  --name <map name>  --hq <HQ name>");
    process.exit(1);
  }
  const radius = Number(arg("radius") ?? 300);
  const metersPerTile = Number(arg("mpt") ?? 2.5);
  const name = arg("name") ?? place?.split(",")[0] ?? "My Area";
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../maps", arg("out") ?? "default.json");

  console.log(`🛰️  Fetching OpenStreetMap data around ${lat.toFixed(5)}, ${lng.toFixed(5)} (±${radius} m)…`);
  const elements = await fetchOsm(overpassQuery(lat, lng, radius));
  console.log(`🧱 ${elements.length} OSM elements — rasterising at ${metersPerTile} m/tile…`);

  const map = mapFromOsm(elements, { lat, lng, radius, metersPerTile, name, hqName: arg("hq") });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(map));
  console.log(
    `✅ ${map.width}×${map.height} tiles, ${map.objects.length} objects, ${map.labels.length} labels → ${out}`,
  );
  console.log("   Restart the realtime server to load it.");
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
