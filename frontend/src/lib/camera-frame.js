// The numbers behind the progress-photo camera (#951). The live view is the camera's frame shown
// whole (object-fit: contain) and the overlay, the earlier photo, is laid exactly over that
// frame, cropped to its shape the way the gallery crops a thumbnail. The frame is also what is
// saved, so the overlay lines up with the picture that is kept. Pure.

/** Where a srcW x srcH picture sits when shown whole in a boxW x boxH box: { x, y, w, h }. */
export function containRect(srcW, srcH, boxW, boxH) {
  if (!(srcW > 0 && srcH > 0 && boxW > 0 && boxH > 0)) return { x: 0, y: 0, w: Math.max(0, boxW || 0), h: Math.max(0, boxH || 0) }
  const s = Math.min(boxW / srcW, boxH / srcH)
  const w = srcW * s, h = srcH * s
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/** The size a captured frame is saved at: the camera's own, no edge past `max` (the ingest keeps 1600 px anyway). */
export function captureSize(w, h, max = 1600) {
  if (!(w > 0 && h > 0)) return null
  const s = Math.min(1, max / Math.max(w, h))
  return { w: Math.round(w * s), h: Math.round(h * s) }
}

/** The overlay's opacity as kept: from 0.1 to 0.9, 0.4 when unknown. */
export const overlayOpacity = v => (Number.isFinite(+v) && v !== '' && v != null ? Math.max(0.1, Math.min(0.9, +v)) : 0.4)

/** A file name for a captured photo, by its day. */
export const captureName = d => `progress-${d}.jpg`
