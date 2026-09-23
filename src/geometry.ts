import type { Equipment } from "./core";
export const geometry = {
  tank: { width: 170, height: 230, inlet: [79, 3], outlet: [170, 184], out: [1, 0], into: [0, -1] },
  pump: { width: 220, height: 170, inlet: [0, 96], outlet: [76, 0], out: [0, -1], into: [-1, 0] },
  valve: { width: 160, height: 164, inlet: [0, 102], outlet: [160, 102], out: [1, 0], into: [-1, 0] },
  plc: { width: 160, height: 150, inlet: [0, 75], outlet: [160, 75], out: [1, 0], into: [-1, 0] },
} as const;
/** Port-aligned orthogonal MVP routing; this is not an obstacle-avoidance solver. */
export function route(from: Equipment, to: Equipment): string {
  const a = geometry[from.kind], b = geometry[to.kind];
  const start = [from.x + a.outlet[0], from.y + a.outlet[1]];
  const end = [to.x + b.inlet[0], to.y + b.inlet[1]];
  const lead = [start[0]! + a.out[0] * 24, start[1]! + a.out[1] * 24];
  const tail = [end[0]! + b.into[0] * 24, end[1]! + b.into[1] * 24];
  const mid = a.out[0] ? [(lead[0]! + tail[0]!) / 2, lead[1]!] : [lead[0]!, tail[1]!];
  const points = [start, lead, mid, [mid[0]!, tail[1]!], tail, end];
  return points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
}
