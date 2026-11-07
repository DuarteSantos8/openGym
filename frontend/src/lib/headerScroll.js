// The iPhone's large-title header (components/ScreenHeader.jsx, Liquid Glass G3): how far the
// soft edge and the small title have come in at a scroll position. Pure, so a test can pin the
// numbers. T is the scroll distance at which the large title is fully under the edge.

const clamp = v => Math.min(1, Math.max(0, v))

// e: the edge's opacity. t: the small title's, which arrives 12 pt later; the large title leaves
// as it comes (titleOpacity). Reduce Motion: one threshold, end states only. iOS reports a
// negative scrollY while the page is pulled down past its top: that is the top, not progress.
export function headerProgress(y, T, reduceMotion) {
  if (!(y > 0) || !Number.isFinite(T)) return { e: 0, t: 0, titleOpacity: 1 }
  const e = reduceMotion ? +(y >= T - 8) : clamp((y - (T - 28)) / 16)
  const t = reduceMotion ? e : clamp((y - (T - 16)) / 16)
  return { e, t, titleOpacity: 1 - t }
}
