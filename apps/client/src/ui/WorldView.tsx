import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EMOTES } from "@repo/world";
import { Engine, type Lighting } from "../game/engine";
import type { Session } from "../session";
import { AvatarPreview } from "./AvatarPreview";
import { VideoTile } from "./VideoTile";

type Panel = "chat" | "people" | null;

const STATUSES = ["", "🎧 Focusing", "☕ On a break", "💬 Up for a chat", "🍕 Lunch", "🚶 Exploring"];

export function WorldView({ session, onLeave }: { session: Session; onLeave: () => void }) {
  useSyncExternalStore(session.subscribe, session.getVersion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const [panel, setPanel] = useState<Panel>(innerWidth > 1100 ? "chat" : null);
  const [scope, setScope] = useState<"global" | "nearby">("global");
  const [draft, setDraft] = useState("");
  const [showMap, setShowMap] = useState(innerWidth > 700);
  const [lighting, setLighting] = useState<Lighting>("auto");
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [emotes, setEmotes] = useState(false);
  const [help, setHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mediaErr, setMediaErr] = useState("");

  useEffect(() => {
    const e = new Engine(canvasRef.current!, session);
    engineRef.current = e;
    if (import.meta.env.DEV) Object.assign(window, { __engine: e, __session: session });
    return () => e.destroy();
  }, [session]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.minimap = showMap ? minimapRef.current : null;
  }, [showMap]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.lighting = lighting;
  }, [lighting]);

  useEffect(() => {
    if (panel === "chat") {
      session.markRead();
      chatEnd.current?.scrollIntoView({ block: "end" });
    }
  }, [panel, session.chat.length, session]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === "INPUT";
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
        setSpotlight(null);
        setHelp(false);
        return;
      }
      if (typing) return;
      if (e.key === "Enter") {
        e.preventDefault();
        setPanel("chat");
        setTimeout(() => chatInput.current?.focus(), 0);
      } else if (/^[1-6]$/.test(e.key)) session.emote(EMOTES[Number(e.key) - 1]!);
      else if (e.key.toLowerCase() === "m") setShowMap((v) => !v);
      else if (e.key.toLowerCase() === "n") setLighting((l) => (l === "auto" ? "night" : l === "night" ? "day" : "auto"));
      else if (e.key === "?") setHelp((v) => !v);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [session]);

  const media = session.media;
  const run = async (fn: () => Promise<void>) => {
    setMediaErr("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") setMediaErr("Permission denied — check your browser's site settings.");
      else if (!(e instanceof DOMException && e.name === "AbortError")) setMediaErr("Couldn't access that device.");
    }
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    session.sendChat(text, scope);
    setDraft("");
  };

  const invite = async () => {
    const url = `${location.origin}/?space=${encodeURIComponent(session.space)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Share this link:", url);
    }
  };

  const me = session.me;
  const peers = session.peers?.peers;
  const callTiles = session.inCall.map((id) => {
    const p = session.players.get(id);
    const peer = peers?.get(id);
    return p && peer ? { id, p, peer } : null;
  });
  const showStrip = session.inCall.length > 0 || media.camOn || !!media.screen;
  const players = [...session.players.values()].sort((a, b) => a.name.localeCompare(b.name));
  const spot = spotlight === "self" ? null : spotlight ? session.players.get(spotlight) : null;
  const spotPeer = spotlight && spotlight !== "self" ? peers?.get(spotlight) : null;
  const world = session.world;

  return (
    <div className="world">
      <canvas ref={canvasRef} className="world-canvas" />

      {/* Top-left: space info */}
      <div className="hud-top-left glass">
        <div className="brand small">
          <span className="brand-mark">◆</span> {world?.data.name ?? "metaverse"}
        </div>
        <div className="space-meta">
          <span>/{session.space}</span>
          <span className="dot-sep">·</span>
          <span>
            <span className="live-dot" /> {session.players.size + 1} online
          </span>
          {session.status === "connected" && (
            <>
              <span className="dot-sep">·</span>
              <span className={session.ping > 200 ? "warn" : ""}>{session.ping}ms</span>
            </>
          )}
        </div>
        <button className="btn ghost small" onClick={invite}>
          {copied ? "✓ Link copied" : "🔗 Invite"}
        </button>
      </div>

      {/* Connection state */}
      {session.status !== "connected" && (
        <div className="overlay-center">
          <div className="glass status-card">
            {session.status === "error" ? (
              <>
                <p>⚠️ {session.error}</p>
                <button className="btn primary" onClick={onLeave}>
                  Back to lobby
                </button>
              </>
            ) : (
              <>
                <p>
                  <span className="spinner" /> {session.status === "reconnecting" ? "Reconnecting…" : "Entering the world…"}
                </p>
                {session.failedAttempts >= 3 && (
                  <p className="muted tiny status-hint">
                    Still can't reach the server. Ad-blockers, private DNS or some in-app browsers (WhatsApp, Instagram)
                    can block it — try opening the link in Chrome or Safari.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Top-centre: proximity video strip */}
      {showStrip && (
        <div className="video-strip">
          <VideoTile
            name={me.name}
            avatar={me.avatar}
            stream={media.preview}
            showVideo={media.camOn || !!media.screen}
            mic={media.micOn}
            screen={!!media.screen}
            self
          />
          {callTiles.map(
            (t) =>
              t && (
                <VideoTile
                  key={t.id}
                  name={t.p.name}
                  avatar={t.p.avatar}
                  stream={t.peer.stream}
                  showVideo={t.p.media.cam || t.p.media.screen}
                  mic={t.p.media.mic}
                  screen={t.p.media.screen}
                  connecting={t.peer.state !== "connected"}
                  onClick={() => setSpotlight(t.id)}
                />
              ),
          )}
        </div>
      )}

      {session.zone && (
        <div className="zone-badge glass">
          {session.zone.kind === "stage" ? "🎤" : "🔒"} <strong>{session.zone.name}</strong>
          <span className="muted"> · only people in this room can hear you</span>
        </div>
      )}

      {/* Spotlight */}
      {spot && spotPeer && (
        <div className="spotlight" onClick={() => setSpotlight(null)}>
          <VideoTile
            name={spot.name}
            avatar={spot.avatar}
            stream={spotPeer.stream}
            showVideo={spot.media.cam || spot.media.screen}
            mic={spot.media.mic}
            screen={spot.media.screen}
            big
          />
          <p className="muted tiny">Click anywhere or press Esc to close</p>
        </div>
      )}

      {/* Toasts */}
      <div className="toasts">
        {session.toasts.map((t) => (
          <div key={t.key} className="toast glass">
            {t.text}
          </div>
        ))}
      </div>

      {/* Minimap */}
      {showMap && world && (
        <div className="minimap glass">
          <canvas
            ref={(el) => {
              minimapRef.current = el;
              if (engineRef.current) engineRef.current.minimap = el;
            }}
            width={220}
            height={220}
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              engineRef.current?.minimapClick(
                ((e.clientX - r.left) / r.width) * e.currentTarget.width,
                ((e.clientY - r.top) / r.height) * e.currentTarget.height,
              );
            }}
          />
          <div className="minimap-foot">
            <button className="icon-btn" onClick={() => engineRef.current?.zoomBy(-1)} aria-label="Zoom out">
              −
            </button>
            <span className="tiny muted">{world.data.source.type === "osm" ? "© OpenStreetMap" : "procedural town"}</span>
            <button className="icon-btn" onClick={() => engineRef.current?.zoomBy(1)} aria-label="Zoom in">
              +
            </button>
          </div>
        </div>
      )}

      {/* Side panel */}
      {panel && (
        <aside className="side glass">
          <div className="side-tabs">
            <button className={panel === "chat" ? "active" : ""} onClick={() => setPanel("chat")}>
              💬 Chat
            </button>
            <button className={panel === "people" ? "active" : ""} onClick={() => setPanel("people")}>
              👥 People <span className="count">{session.players.size + 1}</span>
            </button>
            <button className="close" onClick={() => setPanel(null)} aria-label="Close panel">
              ×
            </button>
          </div>

          {panel === "chat" ? (
            <>
              <div className="chat-log">
                {session.chat.length === 0 && <p className="muted empty">Say hi 👋 — messages also pop up above your head.</p>}
                {session.chat.map((m) => (
                  <div key={m.key} className={`msg ${m.self ? "self" : ""}`}>
                    <div className="msg-head">
                      <strong>{m.self ? "You" : m.name}</strong>
                      {m.scope === "nearby" && <span className="scope">nearby</span>}
                      <span className="time">{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="msg-text">{m.text}</div>
                  </div>
                ))}
                <div ref={chatEnd} />
              </div>
              <form className="chat-form" onSubmit={sendChat}>
                <select value={scope} onChange={(e) => setScope(e.target.value as "global" | "nearby")} aria-label="Chat scope">
                  <option value="global">Everyone</option>
                  <option value="nearby">Nearby</option>
                </select>
                <input
                  ref={chatInput}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Message…"
                  maxLength={300}
                />
                <button className="btn primary small" type="submit">
                  ↑
                </button>
              </form>
            </>
          ) : (
            <div className="people">
              <div className="person self">
                <AvatarPreview avatar={me.avatar} size={1} animate={false} />
                <div className="person-info">
                  <strong>{me.name} (you)</strong>
                  <select value={me.status} onChange={(e) => session.setStatus(e.target.value)} aria-label="Status">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s || "Set a status…"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {players.length === 0 && (
                <p className="muted empty">
                  It's just you for now. <button className="linkish" onClick={invite}>Copy an invite link</button> and bring
                  friends.
                </p>
              )}
              {players.map((p) => (
                <div key={p.id} className="person">
                  <AvatarPreview avatar={p.avatar} size={1} animate={false} />
                  <div className="person-info">
                    <strong>
                      {session.inCall.includes(p.id) && <span className="incall" title="In a call with you" />}
                      {p.name}
                    </strong>
                    <span className="muted tiny">
                      {p.status || (world?.zoneAt(p.tx, p.ty) ? world.zoneDef(world.zoneAt(p.tx, p.ty))?.name : "Roaming")}
                      {p.media.mic ? "" : " · muted"}
                    </span>
                  </div>
                  <button className="btn ghost small" onClick={() => engineRef.current?.walkToPlayer(p.id)}>
                    Walk to
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      {/* Emote picker */}
      {emotes && (
        <div className="emote-picker glass">
          {EMOTES.map((e, i) => (
            <button
              key={e}
              onClick={() => {
                session.emote(e);
                setEmotes(false);
              }}
              title={`Press ${i + 1}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {mediaErr && (
        <div className="media-err glass" onClick={() => setMediaErr("")}>
          {mediaErr}
        </div>
      )}

      {/* Dock */}
      <nav className="dock glass">
        <button className={`dock-btn ${media.micOn ? "on" : "off"}`} onClick={() => run(() => media.setMic(!media.micOn))} title="Microphone">
          {media.micOn ? "🎙️" : "🔇"}
          <span>{media.micOn ? "Mute" : "Unmute"}</span>
        </button>
        <button className={`dock-btn ${media.camOn ? "on" : "off"}`} onClick={() => run(() => media.setCam(!media.camOn))} title="Camera">
          {media.camOn ? "📹" : "📷"}
          <span>{media.camOn ? "Stop video" : "Start video"}</span>
        </button>
        {"getDisplayMedia" in (navigator.mediaDevices ?? {}) && (
          <button
            className={`dock-btn ${media.screen ? "on" : ""}`}
            onClick={() => run(async () => (media.screen ? media.stopScreen() : await media.startScreen()))}
            title="Share screen"
          >
            🖥️<span>{media.screen ? "Stop share" : "Share"}</span>
          </button>
        )}
        <div className="dock-sep" />
        <button className={`dock-btn ${emotes ? "active" : ""}`} onClick={() => setEmotes((v) => !v)} title="Emotes (1–6)">
          😊<span>React</span>
        </button>
        <button
          className={`dock-btn ${panel === "chat" ? "active" : ""}`}
          onClick={() => setPanel((p) => (p === "chat" ? null : "chat"))}
          title="Chat (Enter)"
        >
          💬<span>Chat</span>
          {session.unread > 0 && panel !== "chat" && <em className="badge">{session.unread}</em>}
        </button>
        <button
          className={`dock-btn ${panel === "people" ? "active" : ""}`}
          onClick={() => setPanel((p) => (p === "people" ? null : "people"))}
          title="People"
        >
          👥<span>People</span>
        </button>
        <button className={`dock-btn ${showMap ? "active" : ""}`} onClick={() => setShowMap((v) => !v)} title="Minimap (M)">
          🗺️<span>Map</span>
        </button>
        <button
          className="dock-btn"
          onClick={() => setLighting((l) => (l === "auto" ? "night" : l === "night" ? "day" : "auto"))}
          title="Day / night (N)"
        >
          {lighting === "auto" ? "🕰️" : lighting === "night" ? "🌙" : "☀️"}
          <span>{lighting === "auto" ? "Live time" : lighting === "night" ? "Night" : "Day"}</span>
        </button>
        <button className="dock-btn" onClick={() => setHelp(true)} title="Help (?)">
          ❔<span>Help</span>
        </button>
        <div className="dock-sep" />
        <button className="dock-btn leave" onClick={onLeave} title="Leave">
          🚪<span>Leave</span>
        </button>
      </nav>

      {help && (
        <div className="overlay-center" onClick={() => setHelp(false)}>
          <div className="glass help-card" onClick={(e) => e.stopPropagation()}>
            <h2>How it works</h2>
            <ul>
              <li>
                <kbd>WASD</kbd> / <kbd>↑←↓→</kbd> walk · <strong>click</strong> or <strong>tap</strong> anywhere to auto-walk
              </li>
              <li>Walk within a few steps of someone to start a video call. Voices fade as you walk away.</li>
              <li>
                🔒 <strong>Meeting rooms</strong> are private: only people inside the same room hear each other.
              </li>
              <li>
                <kbd>Enter</kbd> chat · <kbd>1</kbd>–<kbd>6</kbd> emotes · <kbd>M</kbd> minimap · <kbd>N</kbd> day/night ·{" "}
                <kbd>+</kbd>/<kbd>−</kbd> or scroll to zoom
              </li>
              <li>Click a minimap spot to travel there. In the People tab, "Walk to" finds anyone.</li>
            </ul>
            <button className="btn primary" onClick={() => setHelp(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
