import { useEffect, useMemo, useState } from "react";
import { randomAvatar, sanitizeAvatar } from "@repo/world";
import { LocalMedia } from "./rtc";
import { Session } from "./session";
import { Lobby, normalise, type Profile } from "./ui/Lobby";
import { WorldView } from "./ui/WorldView";

const STORE_KEY = "metaverse.profile";

function loadProfile(): Profile {
  const urlSpace = normalise(new URLSearchParams(location.search).get("space") ?? "");
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      return { name: p.name ?? "", avatar: sanitizeAvatar(p.avatar), space: urlSpace || p.space || "lobby" };
    }
  } catch {
    /* storage unavailable */
  }
  return { name: "", avatar: randomAvatar(), space: urlSpace || "lobby" };
}

export function App() {
  const initial = useMemo(loadProfile, []);
  const [profile, setProfile] = useState(initial);
  const [media, setMedia] = useState(() => new LocalMedia());
  const [session, setSession] = useState<Session | null>(null);

  const join = (p: Profile) => {
    setProfile(p);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
    const url = new URL(location.href);
    url.searchParams.set("space", p.space);
    history.replaceState(null, "", url);
    setSession(new Session(p.name, p.avatar, p.space, media));
  };

  const leave = () => {
    session?.leave();
    setSession(null);
    setMedia(new LocalMedia());
  };

  useEffect(() => () => session?.leave(), [session]);

  return session ? <WorldView session={session} onLeave={leave} /> : <Lobby initial={profile} media={media} onJoin={join} />;
}
