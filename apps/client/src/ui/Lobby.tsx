import { useEffect, useRef, useState } from "react";
import {
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  decodeBytes,
  randomAvatar,
  type AvatarConfig,
  type SpotInfo,
} from "@repo/world";
import { MINIMAP_COLORS } from "../game/sprites";
import type { LocalMedia } from "../rtc";
import { AvatarPreview } from "./AvatarPreview";

export interface Profile {
  name: string;
  avatar: AvatarConfig;
  space: string;
  /** Demo spot (map) id; empty means "the first one". */
  spot: string;
}

const PARTS: { key: keyof AvatarConfig; label: string; options: readonly string[]; swatch: boolean }[] = [
  { key: "skin", label: "Skin", options: SKIN_TONES, swatch: true },
  { key: "hairStyle", label: "Hair", options: HAIR_STYLES, swatch: false },
  { key: "hair", label: "Hair colour", options: HAIR_COLORS, swatch: true },
  { key: "shirt", label: "Top", options: SHIRT_COLORS, swatch: true },
  { key: "pants", label: "Bottom", options: PANTS_COLORS, swatch: true },
];

interface SpacesInfo {
  spots: SpotInfo[];
  spaces: { id: string; online: number; spot: string }[];
}

/** Pixel thumbnail of a spot, drawn from its downsampled tiles. */
function SpotThumb({ spot }: { spot: SpotInfo }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    const tiles = decodeBytes(spot.preview);
    for (let i = 0; i < tiles.length; i++) {
      ctx.fillStyle = MINIMAP_COLORS[tiles[i]!] ?? "#79c25f";
      ctx.fillRect(i % spot.pw, Math.floor(i / spot.pw), 1, 1);
    }
  }, [spot]);
  return <canvas ref={ref} width={spot.pw} height={spot.ph} className="spot-thumb" />;
}

export function Lobby({ initial, media, onJoin }: { initial: Profile; media: LocalMedia; onJoin: (p: Profile) => void }) {
  const [name, setName] = useState(initial.name);
  const [avatar, setAvatar] = useState(initial.avatar);
  const [spot, setSpot] = useState(initial.spot);
  // The space follows the chosen spot unless the visitor typed their own (e.g. a private team room).
  const [space, setSpace] = useState(initial.space && initial.space !== initial.spot && initial.space !== "lobby" ? initial.space : "");
  const [info, setInfo] = useState<SpacesInfo | null>(null);
  const [mic, setMic] = useState(media.micOn);
  const [cam, setCam] = useState(media.camOn);
  const [mediaErr, setMediaErr] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch("/api/spaces")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = media.preview;
  }, [cam, media]);

  const toggle = async (kind: "mic" | "cam") => {
    setMediaErr("");
    try {
      if (kind === "mic") {
        await media.setMic(!mic);
        setMic(media.micOn);
      } else {
        await media.setCam(!cam);
        setCam(media.camOn);
      }
    } catch (e) {
      setMediaErr(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Permission denied — allow access in your browser's address bar."
          : "Couldn't access that device.",
      );
    }
  };

  const cycle = (key: keyof AvatarConfig, n: number, d: number) => setAvatar((a) => ({ ...a, [key]: (a[key] + d + n) % n }));
  const spots = info?.spots ?? [];
  const chosen = spots.find((s) => s.id === spot) ?? spots[0];
  const spaceId = normalise(space) || chosen?.id || "lobby";
  const online = info?.spaces.find((s) => s.id === spaceId)?.online ?? 0;
  const totalOnline = info?.spaces.reduce((n, s) => n + s.online, 0) ?? 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onJoin({ name: name.trim() || "Guest", avatar, space: spaceId, spot: chosen?.id ?? spot });
  };

  return (
    <div className="lobby">
      <div className="lobby-bg" />
      <form className="lobby-card" onSubmit={submit}>
        <header className="lobby-head">
          <div className="brand">
            <span className="brand-mark">◆</span> metaverse
          </div>
          <h1>
            Walk into <span className="grad">{chosen?.name ?? "the neighbourhood"}</span>.
          </h1>
          <p className="muted">
            Pixel-perfect copies of real places, built from OpenStreetMap. Walk up to someone to start a video call, step
            into a meeting room for privacy, and wave at strangers.
          </p>
          {totalOnline > 0 && (
            <div className="live-pill">
              <span className="live-dot" /> {totalOnline} {totalOnline === 1 ? "person" : "people"} exploring right now
            </div>
          )}
        </header>

        {spots.length > 1 && (
          <section className="spots" aria-label="Choose a spot">
            {spots.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`spot ${s.id === chosen?.id ? "selected" : ""}`}
                onClick={() => setSpot(s.id)}
                aria-pressed={s.id === chosen?.id}
              >
                <SpotThumb spot={s} />
                <span className="spot-name">{s.name}</span>
                {s.blurb && <span className="spot-blurb">{s.blurb}</span>}
                {s.online > 0 && (
                  <span className="spot-online">
                    <span className="live-dot" /> {s.online} online
                  </span>
                )}
              </button>
            ))}
          </section>
        )}

        <div className="lobby-grid">
          <section className="panel creator">
            <div className="creator-stage">
              <AvatarPreview avatar={avatar} size={4} />
              <button type="button" className="btn ghost small" onClick={() => setAvatar(randomAvatar())}>
                🎲 Randomise
              </button>
            </div>
            <div className="parts">
              {PARTS.map((p) => (
                <div className="part" key={p.key}>
                  <span className="part-label">{p.label}</span>
                  <div className="part-ctl">
                    <button type="button" className="arrow" onClick={() => cycle(p.key, p.options.length, -1)} aria-label={`Previous ${p.label}`}>
                      ‹
                    </button>
                    {p.swatch ? (
                      <span className="swatch" style={{ background: p.options[avatar[p.key]] }} />
                    ) : (
                      <span className="part-value">{p.options[avatar[p.key]]}</span>
                    )}
                    <button type="button" className="arrow" onClick={() => cycle(p.key, p.options.length, 1)} aria-label={`Next ${p.label}`}>
                      ›
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel join">
            <label className="field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Alex" autoFocus />
            </label>
            <label className="field">
              <span>
                Room <em className="muted">· optional — pick a name for a private room with friends</em>
              </span>
              <div className="space-input">
                <span className="prefix">/</span>
                <input value={space} onChange={(e) => setSpace(e.target.value)} maxLength={32} placeholder={chosen?.id ?? "lobby"} />
                {online > 0 && <span className="online-badge">{online} online</span>}
              </div>
            </label>

            <div className="preflight">
              <div className={`preflight-video ${cam ? "on" : ""}`}>
                {cam ? <video ref={videoRef} autoPlay playsInline muted /> : <AvatarPreview avatar={avatar} size={2} animate={false} />}
              </div>
              <div className="preflight-ctl">
                <button type="button" className={`toggle ${mic ? "on" : ""}`} onClick={() => toggle("mic")}>
                  {mic ? "🎙️ Mic on" : "🔇 Mic off"}
                </button>
                <button type="button" className={`toggle ${cam ? "on" : ""}`} onClick={() => toggle("cam")}>
                  {cam ? "📹 Camera on" : "📷 Camera off"}
                </button>
              </div>
              {mediaErr && <p className="err">{mediaErr}</p>}
            </div>

            <button className="btn primary big" type="submit">
              Enter the world →
            </button>
            <p className="tiny muted">
              WASD / arrows to walk · click anywhere to auto-walk · Enter to chat
              {chosen?.source === "osm" && <> · Map data © OpenStreetMap contributors (ODbL)</>}
            </p>
          </section>
        </div>
      </form>
    </div>
  );
}

export function normalise(space: string) {
  return space
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}
