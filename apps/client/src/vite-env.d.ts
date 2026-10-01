/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the realtime WebSocket URL (defaults to same-origin /ws). */
  readonly VITE_WS_URL?: string;
  /** JSON array of RTCIceServer objects, e.g. to add a TURN server. */
  readonly VITE_ICE_SERVERS?: string;
}
