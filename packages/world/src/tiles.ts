/** Ground tile types. Stored as one byte per tile. */
export const Tile = {
  Grass: 0,
  Park: 1,
  Forest: 2,
  Road: 3,
  RoadMajor: 4,
  Path: 5,
  Plaza: 6,
  Water: 7,
  Sand: 8,
  Building: 9,
  Parking: 10,
  FloorWood: 11,
  FloorCarpet: 12,
  Wall: 13,
  Door: 14,
  Rail: 15,
  Field: 16,
  FloorTile: 17,
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

const SOLID_TILES = new Set<number>([Tile.Water, Tile.Building, Tile.Wall]);
export const isSolidTile = (t: number) => SOLID_TILES.has(t);

/** Decorative / furniture objects placed on top of the ground. */
export type ObjectKind =
  | "tree"
  | "pine"
  | "bush"
  | "flowers"
  | "lamp"
  | "bench"
  | "desk"
  | "chair"
  | "table"
  | "sofa"
  | "plant"
  | "whiteboard"
  | "fountain"
  | "screen"
  | "coffee";

const SOLID_OBJECTS = new Set<ObjectKind>([
  "tree",
  "pine",
  "bush",
  "lamp",
  "desk",
  "table",
  "sofa",
  "plant",
  "fountain",
  "coffee",
  "screen",
]);
export const isSolidObject = (k: ObjectKind) => SOLID_OBJECTS.has(k);

/** Roof colour palette indexed by the `variant` layer on building tiles. */
export const ROOF_COLORS = [
  "#b5523b",
  "#8c5a3c",
  "#5d6b7a",
  "#7a4e6b",
  "#4f6d5a",
  "#a8774a",
  "#6b5f8a",
  "#9a4747",
  "#56707f",
  "#8a8a5c",
];
