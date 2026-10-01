import { useEffect, useRef } from "react";
import type { AvatarConfig, Dir } from "@repo/world";
import { AV_H, AV_W, drawAvatar } from "../game/sprites";

const SPIN: Dir[] = ["down", "right", "up", "left"];

/** Animated (walking + turning) or static avatar preview. */
export function AvatarPreview({ avatar, size = 4, animate = true }: { avatar: AvatarConfig; size?: number; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      const dir = animate ? SPIN[Math.floor(now / 1600) % 4]! : "down";
      const frame = animate ? Math.floor(now / 150) % 4 : 0;
      drawAvatar(ctx, avatar, dir, frame, (c.width - AV_W * size) / 2, (c.height - AV_H * size) / 2 + size * 2, size);
      if (animate) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [avatar, size, animate]);

  return <canvas ref={ref} width={AV_W * size + 8} height={AV_H * size + 8} className="avatar-preview" />;
}
