import { useEffect, useRef, useState } from "react";
import {
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  randomAvatar,
  type AvatarConfig,
} from "@repo/world";
import type { LocalMedia } from "../rtc";
import { AvatarPreview } from "./AvatarPreview";

export interface Profile {
  name: string;
  avatar: AvatarConfig;
  space: string;
}

const PARTS: { key: keyof AvatarConfig; label: string; options: readonly string[]; swatch: boolean }[] = [
  { key: "skin", label: "Skin", options: SKIN_TONES, swatch: true },
  { key: "hairStyle", label: "Hair", options: HAIR_STYLES, swatch: false },
  { key: "hair", label: "Hair colour", options: HAIR_COLORS, swatch: true },
  { key: "shirt", label: "Top", options: SHIRT_COLORS, swatch: true },
  { key: "pants", label: "Bottom", options: PANTS_COLORS, swatch: true },
];

interface SpacesInfo {
  map: { name: string; source: { type: string; attribution?: string } };
  spaces: { id: string; online: number }[];
}

export function Lobby({ initial, media, onJoin }: { initial: Profile; media: LocalMedia; onJoin: (p: Profile) => void }) {
  const [name, setName] = useState(initial.name);
  const [avatar, setAvatar] = useState(initial.avatar);
  const [space, setSpace] = useState(initial.space);
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
  const online = info?.spaces.find((s) => s.id === normalise(space))?.online ?? 0;
  const totalOnline = info?.spaces.reduce((n, s) => n + s.online, 0) ?? 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onJoin({ name: name.trim() || "Guest", avatar, space: normalise(space) || "lobby" });
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
            Walk into <span className="grad">{info?.map.name ?? "the neighbourhood"}</span>.
          </h1>
          <p className="muted">
            A pixel-perfect copy of a real place. Walk up to someone to start a video call, step into a meeting room for
            privacy, and wave at strangers.
          </p>
          {totalOnline > 0 && (
            <div className="live-pill">
              <span className="live-dot" /> {totalOnline} {totalOnline === 1 ? "person" : "people"} exploring right now
            </div>
          )}
        </header>

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
                Space <em className="muted">· everyone with the same space name meets in the same world</em>
              </span>
              <div className="space-input">
                <span className="prefix">/</span>
                <input value={space} onChange={(e) => setSpace(e.target.value)} maxLength={32} placeholder="lobby" />
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
              {info?.map.source.attribution && <> · {info.map.source.attribution}</>}
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
