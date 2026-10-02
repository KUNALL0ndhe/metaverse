import { EMOTES, findPath, randomAvatar, type Dir, type PlayerInfo, type World } from "@repo/world";

const NAMES = ["Aarav", "Priya", "Rohan", "Ananya", "Kabir", "Meera", "Vikram", "Isha", "Zoya", "Arjun"];
const SPEED = 2.6; // tiles per second — a relaxed stroll
const HOME_RADIUS = 18; // bots wander this close to the spawn so visitors meet them
const GREET_RADIUS = 3.5;
const GREET_COOLDOWN = 120_000;

const greetings = (who: string, spot: string) => [
  `Hi ${who}! Welcome to ${spot} 👋`,
  `Namaste ${who}! 🙏 First time at ${spot}?`,
  `Hey ${who}! Walk up to a friend to start a video call 🎥`,
  `Hello ${who}! The HQ nearby has private meeting rooms 🔒`,
];

const chatter = (spot: string) => [
  `${spot} looks lovely at sunset 🌅`,
  "Anyone up for cutting chai? ☕",
  "Press 1–6 to emote! 🎉",
  "Click the minimap to travel 🗺️",
  "Every street here is real OpenStreetMap data 🛰️",
  "Vada pav break? 😋",
  "I'm a bot 🤖 — invite a friend for a real chat!",
  "Try night mode — press N 🌙",
];

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;

interface Bot {
  info: PlayerInfo;
  path: [number, number][];
  idleUntil: number;
  nextLine: number;
  greeted: Map<string, number>;
  dirty: boolean;
}

export interface BotEvents {
  say(id: string, text: string): void;
  emote(id: string, emoji: string): void;
}

/**
 * Guide avatars that make a quiet world feel alive. They are flagged `bot: true`, so clients label
 * them and never try to call them.
 */
export class Bots {
  readonly list: Bot[] = [];

  constructor(
    private world: World,
    count: number,
  ) {
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const at = this.randomSpot() ?? world.data.spawn;
      const now = Date.now();
      this.list.push({
        info: {
          id: `bot-${i}-${Math.random().toString(36).slice(2, 7)}`,
          name: names[i % names.length]!,
          avatar: randomAvatar(),
          x: at.x,
          y: at.y,
          dir: "down",
          moving: false,
          media: { mic: false, cam: false, screen: false },
          status: "",
          bot: true,
        },
        path: [],
        idleUntil: now + Math.random() * 3000,
        nextLine: now + 8000 + Math.random() * 20000,
        greeted: new Map(),
        dirty: false,
      });
    }
  }

  /** A random standable tile near the spawn point. */
  private randomSpot() {
    const { x, y } = this.world.data.spawn;
    for (let i = 0; i < 25; i++) {
      const tx = Math.floor(x + (Math.random() * 2 - 1) * HOME_RADIUS);
      const ty = Math.floor(y + (Math.random() * 2 - 1) * HOME_RADIUS);
      if (!this.world.isBlocked(tx, ty) && this.world.canStand(tx + 0.5, ty + 0.5)) return { x: tx + 0.5, y: ty + 0.5 };
    }
    return null;
  }

  tick(now: number, dt: number, humans: PlayerInfo[], spotName: string, ev: BotEvents) {
    for (const b of this.list) {
      const p = b.info;

      // Greet anyone who walks up, then pause and face them.
      for (const h of humans) {
        if (Math.hypot(h.x - p.x, h.y - p.y) > GREET_RADIUS) continue;
        if (now - (b.greeted.get(h.id) ?? -Infinity) < GREET_COOLDOWN) continue;
        b.greeted.set(h.id, now);
        b.path = [];
        b.idleUntil = now + 4000;
        p.dir = facing(h.x - p.x, h.y - p.y);
        p.moving = false;
        b.dirty = true;
        ev.say(p.id, pick(greetings(h.name, spotName)));
        if (Math.random() < 0.5) ev.emote(p.id, "👋");
        b.nextLine = now + 15000;
        break;
      }

      // Occasional chatter or an emote.
      if (now > b.nextLine) {
        b.nextLine = now + 25000 + Math.random() * 30000;
        if (Math.random() < 0.6) ev.say(p.id, pick(chatter(spotName)));
        else ev.emote(p.id, pick(EMOTES));
      }

      // Wander: idle a bit, then stroll to a new spot near the landmark.
      if (!b.path.length) {
        if (p.moving) {
          p.moving = false;
          b.dirty = true;
        }
        if (now < b.idleUntil) continue;
        const target = this.randomSpot();
        const path = target && findPath(this.world, Math.floor(p.x), Math.floor(p.y), Math.floor(target.x), Math.floor(target.y), 4000);
        if (path && path.length) b.path = path;
        else b.idleUntil = now + 2000;
        continue;
      }

      let left = SPEED * dt;
      while (left > 1e-6 && b.path.length) {
        const [tx, ty] = b.path[0]!;
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 1e-3) {
          b.path.shift();
          continue;
        }
        const step = Math.min(left, d);
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        p.dir = facing(dx, dy);
        left -= step;
        if (step >= d - 1e-6) b.path.shift();
      }
      p.moving = b.path.length > 0;
      if (!p.moving) b.idleUntil = now + 2000 + Math.random() * 6000;
      b.dirty = true;
    }
  }
}

function facing(dx: number, dy: number): Dir {
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
}
