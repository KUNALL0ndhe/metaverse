import { useEffect, useMemo, useState } from "react";
import { randomAvatar, sanitizeAvatar } from "@repo/world";
import { LocalMedia } from "./rtc";
import { Session } from "./session";
import { Lobby, normalise, type Profile } from "./ui/Lobby";
import { WorldView } from "./ui/WorldView";

const STORE_KEY = "metaverse.profile";

/** Invite links carry ?spot=…&space=…; otherwise remember the visitor's last choice. */
function loadProfile(): Profile {
  const params = new URLSearchParams(location.search);
  const urlSpot = normalise(params.get("spot") ?? "");
  const urlSpace = normalise(params.get("space") ?? "");
  let saved: Partial<Profile> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Partial<Profile>;
  } catch {
    /* storage unavailable */
  }
  const fromLink = !!(urlSpot || urlSpace);
  return {
    name: saved.name ?? "",
    avatar: saved.avatar ? sanitizeAvatar(saved.avatar) : randomAvatar(),
    spot: urlSpot || (fromLink ? "" : (saved.spot ?? "")),
    space: fromLink ? urlSpace : (saved.space ?? ""),
  };
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
    url.searchParams.set("spot", p.spot);
    url.searchParams.set("space", p.space);
    history.replaceState(null, "", url);
    setSession(new Session(p.name, p.avatar, p.space, p.spot, media));
  };

  const leave = () => {
    session?.leave();
    setSession(null);
    setMedia(new LocalMedia());
  };

  useEffect(() => () => session?.leave(), [session]);

  return session ? <WorldView session={session} onLeave={leave} /> : <Lobby initial={profile} media={media} onJoin={join} />;
}
