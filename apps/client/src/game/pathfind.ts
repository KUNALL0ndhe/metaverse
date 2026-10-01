import type { World } from "@repo/world";

/** 8-directional A* over the world's solid grid (no corner cutting). Returns tile-centre waypoints. */
export function findPath(world: World, sx: number, sy: number, gx: number, gy: number, maxNodes = 60000) {
  const W = world.width;
  const start = sy * W + sx;
  let goal = gy * W + gx;
  if (world.isBlocked(gx, gy)) {
    const near = nearestOpen(world, gx, gy);
    if (!near) return null;
    goal = near[1] * W + near[0];
  }
  if (start === goal) return [];

  const g = new Float32Array(W * world.height).fill(Infinity);
  const came = new Int32Array(W * world.height).fill(-1);
  const closed = new Uint8Array(W * world.height);
  const heap = new MinHeap();
  const gxT = goal % W;
  const gyT = Math.floor(goal / W);
  const h = (i: number) => {
    const dx = Math.abs((i % W) - gxT);
    const dy = Math.abs(Math.floor(i / W) - gyT);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push(start, h(start));
  let expanded = 0;

  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (world.isBlocked(nx, ny)) continue;
        if (dx && dy && (world.isBlocked(cx + dx, cy) || world.isBlocked(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        const ng = g[cur]! + (dx && dy ? 1.414 : 1);
        if (ng < g[ni]!) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + h(ni));
        }
      }
  }
  if (came[goal] === -1) return null;

  const path: [number, number][] = [];
  for (let i = goal; i !== start; i = came[i]!) path.push([(i % W) + 0.5, Math.floor(i / W) + 0.5]);
  path.reverse();
  return path;
}

function nearestOpen(world: World, x: number, y: number): [number, number] | null {
  for (let r = 1; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (!world.isBlocked(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}

class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, p: number) {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent]! <= p) break;
      ids[i] = ids[parent]!;
      pri[i] = pri[parent]!;
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  }
  pop() {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pri[c + 1]! < pri[c]!) c++;
        if (pri[c]! >= lastP) break;
        ids[i] = ids[c]!;
        pri[i] = pri[c]!;
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
