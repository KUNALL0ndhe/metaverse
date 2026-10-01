import { MapBuilder, mulberry32, type Pt } from "./builder";
import type { MapData, MapLabel } from "./map";
import { ROOF_COLORS, Tile } from "./tiles";

/** Subset of the Overpass `out geom` JSON we consume. */
export interface OsmLatLon {
  lat: number;
  lon: number;
}
export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: (OsmLatLon | null)[];
  members?: { type: string; role: string; geometry?: (OsmLatLon | null)[] }[];
}

export interface OsmOptions {
  lat: number;
  lng: number;
  /** Half-size of the imported square, metres. */
  radius: number;
  metersPerTile: number;
  name: string;
  hqName?: string;
}

export function overpassQuery(lat: number, lng: number, radius: number) {
  const dLat = radius / 110540;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng}`;
  return `[out:json][timeout:90];
(
  way(${bbox});
  relation["type"="multipolygon"](${bbox});
  node["natural"="tree"](${bbox});
  node["highway"="street_lamp"](${bbox});
  node["amenity"](${bbox});
  node["shop"](${bbox});
  node["tourism"](${bbox});
  node["leisure"](${bbox});
  node["historic"](${bbox});
);
out geom;`;
}

type AreaKind = "park" | "forest" | "field" | "sand" | "parking" | "plaza" | "water";

function areaKind(tags: Record<string, string>): AreaKind | null {
  const { landuse, leisure, natural, amenity, place, highway, waterway, water, area } = tags;
  if (natural === "water" || water || waterway === "riverbank" || landuse === "reservoir" || landuse === "basin")
    return "water";
  if (landuse === "forest" || natural === "wood" || natural === "scrub") return "forest";
  if (landuse === "farmland" || landuse === "orchard" || landuse === "vineyard" || landuse === "allotments")
    return "field";
  if (natural === "sand" || natural === "beach") return "sand";
  if (amenity === "parking") return "parking";
  if (place === "square" || (highway === "pedestrian" && area === "yes") || amenity === "marketplace") return "plaza";
  if (
    leisure === "park" ||
    leisure === "garden" ||
    leisure === "playground" ||
    leisure === "pitch" ||
    leisure === "golf_course" ||
    landuse === "grass" ||
    landuse === "meadow" ||
    landuse === "recreation_ground" ||
    landuse === "village_green" ||
    landuse === "cemetery" ||
    natural === "grassland"
  )
    return "park";
  return null;
}

const AREA_TILE: Record<AreaKind, number> = {
  park: Tile.Park,
  forest: Tile.Forest,
  field: Tile.Field,
  sand: Tile.Sand,
  parking: Tile.Parking,
  plaza: Tile.Plaza,
  water: Tile.Water,
};

/** Road width in metres, and whether it is a "major" road. */
function roadSpec(hw: string): { m: number; tile: number } | null {
  switch (hw) {
    case "motorway":
    case "trunk":
      return { m: 14, tile: Tile.RoadMajor };
    case "primary":
      return { m: 12, tile: Tile.RoadMajor };
    case "secondary":
      return { m: 10, tile: Tile.RoadMajor };
    case "tertiary":
      return { m: 8.5, tile: Tile.Road };
    case "motorway_link":
    case "trunk_link":
    case "primary_link":
    case "secondary_link":
    case "tertiary_link":
      return { m: 7, tile: Tile.Road };
    case "residential":
    case "unclassified":
    case "road":
      return { m: 7, tile: Tile.Road };
    case "living_street":
      return { m: 5.5, tile: Tile.Road };
    case "service":
      return { m: 4.5, tile: Tile.Road };
    case "pedestrian":
      return { m: 5, tile: Tile.Plaza };
    case "footway":
    case "path":
    case "cycleway":
    case "steps":
    case "track":
    case "bridleway":
      return { m: 2.2, tile: Tile.Path };
    default:
      return null;
  }
}

function polygonArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1]);
  return Math.abs(a / 2);
}

function centroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** Join open member ways of a multipolygon into closed rings. */
function joinRings(lines: Pt[][]): Pt[][] {
  const rings: Pt[][] = [];
  const pool = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  while (pool.length) {
    const ring = pool.shift()!;
    let grew = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i]!;
        const end = ring[ring.length - 1]!;
        if (same(end, l[0]!)) ring.push(...l.slice(1));
        else if (same(end, l[l.length - 1]!)) ring.push(...l.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

const POI_KEYS = ["amenity", "shop", "tourism", "leisure", "historic", "office"];
const BORING_AMENITIES = new Set([
  "parking",
  "bench",
  "waste_basket",
  "bicycle_parking",
  "parking_space",
  "toilets",
  "vending_machine",
  "recycling",
  "post_box",
  "telephone",
  "drinking_water",
  "parking_entrance",
  "motorcycle_parking",
]);

/** Convert raw Overpass JSON into a playable map. */
export function mapFromOsm(elements: OsmElement[], opts: OsmOptions): MapData {
  const mpt = opts.metersPerTile;
  const size = Math.round((opts.radius * 2) / mpt);
  const W = size;
  const H = size;
  const cosLat = Math.cos((opts.lat * Math.PI) / 180);
  const project = (p: OsmLatLon): Pt => [
    ((p.lon - opts.lng) * cosLat * 111320) / mpt + W / 2,
    ((opts.lat - p.lat) * 110540) / mpt + H / 2,
  ];
  const line = (g?: (OsmLatLon | null)[]) => (g ?? []).filter((p): p is OsmLatLon => !!p).map(project);

  const rand = mulberry32(Math.round(opts.lat * 1e4) ^ Math.round(opts.lng * 1e4));
  const b = new MapBuilder(W, H, rand);

  const areas: { poly: Pt[]; kind: AreaKind; area: number }[] = [];
  const buildings: { poly: Pt[]; name?: string }[] = [];
  const roads: { line: Pt[]; w: number; tile: number; name?: string }[] = [];
  const waterways: { line: Pt[]; w: number }[] = [];
  const rails: Pt[][] = [];
  const pois: MapLabel[] = [];

  const ringsOf = (el: OsmElement): Pt[][] => {
    if (el.type === "way") {
      const l = line(el.geometry);
      return l.length >= 4 ? [l] : [];
    }
    if (el.type === "relation") {
      return joinRings((el.members ?? []).filter((m) => m.role === "outer").map((m) => line(m.geometry)));
    }
    return [];
  };

  for (const el of elements) {
    const tags = el.tags ?? {};

    if (el.type === "node") {
      if (el.lat === undefined || el.lon === undefined) continue;
      const [x, y] = project({ lat: el.lat, lon: el.lon });
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (tags.natural === "tree") b.addObject("tree", tx, ty);
      else if (tags.highway === "street_lamp") b.addObject("lamp", tx, ty);
      else if (tags.amenity === "bench") b.addObject("bench", tx, ty);
      else if (tags.amenity === "fountain") b.addObject("fountain", tx, ty);
      if (tags.name && POI_KEYS.some((k) => tags[k]) && !BORING_AMENITIES.has(tags.amenity ?? "")) {
        pois.push({ text: tags.name, x, y, kind: "poi" });
      }
      continue;
    }

    if (tags.building || tags["building:part"]) {
      if (tags.tunnel || tags.location === "underground") continue;
      for (const poly of ringsOf(el)) buildings.push({ poly, name: tags.name });
      continue;
    }

    if (tags.highway && el.type === "way") {
      if (tags.tunnel === "yes" || tags.highway === "construction" || tags.highway === "proposed") continue;
      const spec = roadSpec(tags.highway);
      const l = line(el.geometry);
      if (spec && l.length >= 2) {
        if (tags.area === "yes") areas.push({ poly: l, kind: "plaza", area: polygonArea(l) });
        else roads.push({ line: l, w: Math.max(1, spec.m / mpt), tile: spec.tile, name: tags.name });
      }
      continue;
    }

    if (tags.waterway && el.type === "way" && tags.waterway !== "riverbank") {
      const w = tags.waterway === "river" ? 18 : tags.waterway === "canal" ? 10 : 3;
      if (tags.tunnel !== "culvert" && tags.tunnel !== "yes") waterways.push({ line: line(el.geometry), w: Math.max(1, w / mpt) });
      continue;
    }

    if (tags.railway === "rail" || tags.railway === "light_rail" || tags.railway === "tram") {
      if (el.type === "way" && tags.tunnel !== "yes") rails.push(line(el.geometry));
      continue;
    }

    const kind = areaKind(tags);
    if (kind) {
      for (const poly of ringsOf(el)) {
        areas.push({ poly, kind, area: polygonArea(poly) });
        if (tags.name && kind !== "parking") {
          const [cx, cy] = centroid(poly);
          pois.push({ text: tags.name, x: cx, y: cy, kind: "place" });
        }
      }
    }
  }

  // 1. Land use, largest first so smaller features paint over bigger ones.
  areas.sort((a, c) => c.area - a.area);
  for (const a of areas) b.fillPolygon(a.poly, AREA_TILE[a.kind]);

  // 2. Waterways and rails.
  for (const w of waterways) b.strokeLine(w.line, w.w, Tile.Water);
  for (const r of rails) b.strokeLine(r, 1.4, Tile.Rail);

  // 3. Roads: sidewalks for wider roads, then carriageways, major roads last.
  const softGround = new Set<number>([Tile.Grass, Tile.Park, Tile.Field, Tile.Forest, Tile.Sand]);
  for (const r of roads) if (r.w >= 2.5 && r.tile !== Tile.Path) b.strokeLine(r.line, r.w + 2, Tile.Path, { onlyOver: softGround });
  const order: number[] = [Tile.Path, Tile.Plaza, Tile.Road, Tile.RoadMajor];
  roads.sort((a, c) => order.indexOf(a.tile) - order.indexOf(c.tile));
  for (const r of roads) b.strokeLine(r.line, r.w, r.tile);

  // 4. Buildings, never over roads.
  const notRoad = new Set<number>(
    Object.values(Tile).filter((t) => t !== Tile.Road && t !== Tile.RoadMajor && t !== Tile.Rail),
  );
  for (const bd of buildings) {
    const roof = Math.floor(rand() * ROOF_COLORS.length);
    b.fillPolygon(bd.poly, Tile.Building, { variant: roof, onlyOver: notRoad });
    if (bd.name) {
      const [cx, cy] = centroid(bd.poly);
      pois.push({ text: bd.name, x: cx, y: cy, kind: "poi" });
    }
  }

  // 5. Vegetation scatter.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = b.get(x, y);
      const r = rand();
      if (t === Tile.Forest && r < 0.28) b.addObject(rand() < 0.5 ? "pine" : "tree", x, y);
      else if (t === Tile.Park && r < 0.025) b.addObject(rand() < 0.6 ? "tree" : rand() < 0.5 ? "bush" : "flowers", x, y);
      else if (t === Tile.Grass && r < 0.006) b.addObject("bush", x, y);
    }

  // 6. Street labels: one per name, on that street's longest way.
  const byName = new Map<string, { line: Pt[]; len: number }>();
  for (const r of roads) {
    if (!r.name) continue;
    let len = 0;
    for (let i = 0; i + 1 < r.line.length; i++)
      len += Math.hypot(r.line[i + 1]![0] - r.line[i]![0], r.line[i + 1]![1] - r.line[i]![1]);
    const prev = byName.get(r.name);
    if (!prev || prev.len < len) byName.set(r.name, { line: r.line, len });
  }
  const inMap = (l: { x: number; y: number }) => l.x > 2 && l.y > 2 && l.x < W - 2 && l.y < H - 2;
  const candidates: MapLabel[] = [];
  for (const [name, { line: l }] of [...byName].sort((a, c) => c[1].len - a[1].len)) {
    const mid = l[Math.floor(l.length / 2)]!;
    candidates.push({ text: name, x: mid[0], y: mid[1], kind: "street" });
  }
  // Places (parks, squares) first, then streets, then shops & amenities.
  const rank = { place: 0, street: 1, poi: 2, zone: 3 };
  candidates.push(...pois);
  candidates.sort((a, c) => rank[a.kind] - rank[c.kind]);
  // Keep labels readable: no duplicates, and a minimum spacing between them.
  const seen = new Set<string>();
  const kept: MapLabel[] = [];
  for (const l of candidates) {
    if (!inMap(l) || seen.has(l.text) || l.text.length > 40) continue;
    const gap = l.kind === "poi" ? 7 : 10;
    if (kept.some((k) => Math.abs(k.x - l.x) < gap * 1.6 && Math.abs(k.y - l.y) < gap * 0.5)) continue;
    seen.add(l.text);
    kept.push(l);
  }
  b.labels.push(...kept);

  // 7. Your HQ right at the centre of your area.
  b.stampHQ(W / 2, H / 2, opts.hqName);

  return b.build(opts.name, mpt, {
    type: "osm",
    lat: opts.lat,
    lng: opts.lng,
    attribution: "Map data © OpenStreetMap contributors (ODbL)",
  });
}
