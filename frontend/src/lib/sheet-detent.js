// Where a bottom sheet settles when the finger lets go (iPhone sheets, Liquid Glass G4,
// components/Modals.jsx). Pure, so a test can pin the numbers. Heights are in px: `a` the small
// detent, `z` the large one, `raw` where the finger has pulled the top edge to, `v` the
// release speed in px/ms with down positive.

// Above large the sheet gives only a sixth of the pull back; below small it stays at `a`
// and the whole sheet follows the finger down (`ty`).
export function pull(raw, a, z) {
  return { h: Math.min(Math.max(raw, a), z + Math.max(0, raw - z) * 0.15), ty: raw < a ? a - raw : 0 }
}

// 'close' | 'm' | 'l'. The landing point 180 ms on decides, not where the finger let go: a
// flick down from medium closes, a flick up goes large, a slow drag past the midpoint goes to
// the nearer detent. A single-size sheet never goes large; a sheet holding edited text never
// closes by a gesture.
export function releaseDetent({ raw, v, a, z, single, dirty }) {
  const top = single ? a : z
  const score = raw - v * 180
  if (score < a - 90 && !dirty) return 'close'
  return top > a && score > (a + top) / 2 ? 'l' : 'm'
}
