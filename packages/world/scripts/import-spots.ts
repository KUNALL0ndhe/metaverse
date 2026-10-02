/**
 * Import the curated demo spots (iconic Mumbai locations) into maps/.
 *
 *   pnpm map:spots            # uses cached OSM data when available
 *   pnpm map:spots --refresh  # re-download everything from OpenStreetMap
 *
 * Each spot becomes its own world; the lobby lets visitors pick one.
 */
import { importArea, type ImportOptions } from "./import-osm";

type Spot = Omit<ImportOptions, "metersPerTile" | "refresh"> & { metersPerTile?: number };

const SPOTS: Spot[] = [
  {
    out: "gateway-of-india.json",
    name: "Gateway of India",
    landmark: "Gateway of India",
    blurb: "Colaba waterfront: the Taj, the harbour and the arch that greeted a century of ships.",
    lat: 18.92196,
    lng: 72.83456,
    radius: 350,
    order: 1,
  },
  {
    out: "marine-drive.json",
    name: "Marine Drive",
    landmark: "Marine Drive",
    blurb: "The Queen's Necklace: Mumbai's sea-face promenade on the Arabian Sea.",
    lat: 18.9412,
    lng: 72.8235,
    radius: 350,
    order: 2,
  },
  {
    out: "csmt-fort.json",
    name: "CSMT & Fort",
    landmark: "Chhatrapati Shivaji Maharaj Terminus",
    blurb: "A Gothic railway palace and the heritage lanes of old Bombay.",
    lat: 18.93985,
    lng: 72.83551,
    radius: 350,
    order: 3,
  },
  {
    out: "bandra-fort.json",
    name: "Bandra Fort & Bandstand",
    landmark: "Bandra Fort",
    blurb: "A 17th-century Portuguese fort above the sea, and the Bandstand sea-face.",
    lat: 19.044,
    lng: 72.8195,
    spawnAt: { lat: 19.04186, lng: 72.81837 },
    radius: 400,
    order: 4,
  },
  {
    out: "juhu-beach.json",
    name: "Juhu Beach",
    landmark: "Juhu Beach",
    blurb: "Sand, sea breeze and the city's favourite street food.",
    lat: 19.099,
    lng: 72.8262,
    radius: 350,
    order: 5,
  },
];

const refresh = process.argv.includes("--refresh");
for (const s of SPOTS) {
  await importArea({ metersPerTile: 2.5, ...s, refresh });
  // Be polite to the public Overpass servers between downloads.
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`\n🏙️  ${SPOTS.length} spots ready. Restart the realtime server to load them.`);
