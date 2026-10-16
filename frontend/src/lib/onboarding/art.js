// Helpers the onboarding's line-art scenes share (ui-onboarding-round2.md §1: a 320-unit canvas,
// 1 unit about 1px; the floor `M16 {H-16} H304`; two strokes, three inks).

/** A path that draws in: its place in the scene's order, back to front, accent last. */
export const at = i => ({ pathLength: 1, style: { '--i': i } })

/** A rounded rect as path data, so several can share one path. */
export function rrPath(x, y, w, h, r) {
  return `M${x + r} ${y}H${x + w - r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h - r}a${r} ${r} 0 0 1 -${r} ${r}H${x + r}a${r} ${r} 0 0 1 -${r} -${r}V${y + r}a${r} ${r} 0 0 1 ${r} -${r}Z`
}
