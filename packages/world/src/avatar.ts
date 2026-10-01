export const SKIN_TONES = ["#f9d7b9", "#eab68f", "#d39a6a", "#a86b45", "#7a4a2c", "#4e2f1d"];
export const HAIR_COLORS = ["#1f1a17", "#4a3020", "#8a5a2b", "#d8b25a", "#b8462e", "#e8e4dc", "#5b6ee1", "#e85d9b"];
export const SHIRT_COLORS = ["#e94f37", "#3f88c5", "#44bba4", "#f6ae2d", "#7b5ea7", "#2d2d34", "#f2f2f2", "#e56399", "#1b998b"];
export const PANTS_COLORS = ["#2b2d42", "#3d5a80", "#5c4033", "#6b705c", "#1d3557", "#8d99ae"];
export const HAIR_STYLES = ["short", "long", "spiky", "bun", "bald", "cap"] as const;

export interface AvatarConfig {
  skin: number;
  hair: number;
  hairStyle: number;
  shirt: number;
  pants: number;
}

export function randomAvatar(): AvatarConfig {
  const r = (n: number) => Math.floor(Math.random() * n);
  return {
    skin: r(SKIN_TONES.length),
    hair: r(HAIR_COLORS.length),
    hairStyle: r(HAIR_STYLES.length),
    shirt: r(SHIRT_COLORS.length),
    pants: r(PANTS_COLORS.length),
  };
}

const clampIdx = (v: unknown, n: number) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < n ? (v as number) : 0;

export function sanitizeAvatar(a: Partial<AvatarConfig> | undefined): AvatarConfig {
  return {
    skin: clampIdx(a?.skin, SKIN_TONES.length),
    hair: clampIdx(a?.hair, HAIR_COLORS.length),
    hairStyle: clampIdx(a?.hairStyle, HAIR_STYLES.length),
    shirt: clampIdx(a?.shirt, SHIRT_COLORS.length),
    pants: clampIdx(a?.pants, PANTS_COLORS.length),
  };
}
