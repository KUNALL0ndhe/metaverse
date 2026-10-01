import { useEffect, useRef, useState } from "react";
import type { AvatarConfig } from "@repo/world";
import { AvatarPreview } from "./AvatarPreview";

let audioCtx: AudioContext | null = null;

/** Lights up the tile while the stream's audio is above a speaking threshold. */
function useSpeaking(stream: MediaStream | null, enabled: boolean) {
  const [speaking, setSpeaking] = useState(false);
  const track = stream?.getAudioTracks()[0];
  useEffect(() => {
    if (!enabled || !track) {
      setSpeaking(false);
      return;
    }
    audioCtx ??= new AudioContext();
    void audioCtx.resume();
    const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let on = false;
    let quietSince = 0;
    const id = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > 6) {
        quietSince = now;
        if (!on) setSpeaking((on = true));
      } else if (on && now - quietSince > 350) setSpeaking((on = false));
    }, 80);
    return () => {
      clearInterval(id);
      src.disconnect();
    };
  }, [track, enabled]);
  return speaking;
}

export function VideoTile(props: {
  name: string;
  avatar: AvatarConfig;
  stream: MediaStream | null;
  showVideo: boolean;
  mic: boolean;
  self?: boolean;
  screen?: boolean;
  connecting?: boolean;
  big?: boolean;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const speaking = useSpeaking(props.stream, props.mic);

  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== props.stream) v.srcObject = props.stream;
  });

  return (
    <div
      className={`tile ${speaking ? "speaking" : ""} ${props.big ? "big" : ""} ${props.onClick ? "clickable" : ""}`}
      onClick={props.onClick}
    >
      {props.showVideo && props.stream ? (
        <video ref={ref} autoPlay playsInline muted className={props.self && !props.screen ? "mirror" : ""} />
      ) : (
        <div className="tile-avatar">
          <AvatarPreview avatar={props.avatar} size={props.big ? 5 : 2} animate={false} />
        </div>
      )}
      <div className="tile-name">
        {!props.mic && <span title="Muted">🔇</span>}
        {props.screen && <span title="Sharing screen">🖥️</span>}
        {props.name}
        {props.self && " (you)"}
      </div>
      {props.connecting && <div className="tile-connecting">connecting…</div>}
    </div>
  );
}
