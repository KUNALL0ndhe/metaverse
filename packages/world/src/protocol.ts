import type { AvatarConfig } from "./avatar";
import type { MapData } from "./map";

export type Dir = "down" | "up" | "left" | "right";

export interface MediaState {
  mic: boolean;
  cam: boolean;
  screen: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  avatar: AvatarConfig;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  media: MediaState;
  status: string;
  /** Server-run guide avatars; never part of calls and always labelled as bots. */
  bot?: boolean;
}

/** Proximity calls connect within this radius (tiles) and drop beyond the hangup radius. */
export const CALL_RADIUS = 4.5;
export const HANGUP_RADIUS = 6;
export const MOVE_SPEED = 5.2; // tiles per second
export const MAX_ROOM_SIZE = 60;

export type ClientMsg =
  | { t: "join"; space: string; spot?: string; name: string; avatar: AvatarConfig }
  | { t: "move"; x: number; y: number; dir: Dir; moving: boolean }
  | { t: "chat"; text: string; scope: "global" | "nearby" }
  | { t: "emote"; emoji: string }
  | { t: "media"; media: MediaState }
  | { t: "status"; status: string }
  | { t: "signal"; to: string; data: unknown }
  | { t: "ping"; ts: number };

export type ServerMsg =
  | { t: "welcome"; selfId: string; space: string; spot: string; map: MapData; players: PlayerInfo[] }
  | { t: "joined"; player: PlayerInfo }
  | { t: "left"; id: string }
  | { t: "state"; p: [id: string, x: number, y: number, dir: Dir, moving: 0 | 1][] }
  | { t: "correct"; x: number; y: number }
  | { t: "chat"; from: string; name: string; text: string; scope: "global" | "nearby"; ts: number }
  | { t: "emote"; from: string; emoji: string }
  /** A speech bubble only (not added to the chat log), used by bots. */
  | { t: "say"; from: string; text: string }
  | { t: "media"; from: string; media: MediaState }
  | { t: "status"; from: string; status: string }
  | { t: "signal"; from: string; data: unknown }
  | { t: "pong"; ts: number }
  | { t: "error"; message: string };

export const EMOTES = ["👋", "❤️", "😂", "🎉", "👍", "🔥"];

/** A demo spot (one map) as listed in the lobby. */
export interface SpotInfo {
  id: string;
  name: string;
  blurb?: string;
  /** Downsampled ground tiles (base64, pw×ph bytes) for a lobby thumbnail. */
  preview: string;
  pw: number;
  ph: number;
  online: number;
  source: "osm" | "procedural";
}
