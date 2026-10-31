// The maths behind the progress-photo camera (#951): which photo starts as the overlay, how it is
// moved and scaled on the live view, and how big the saved picture is. Pure, so the camera screen
// only handles the video, the fingers and the shutter.

export const MIN_SCALE = 0.3
export const MAX_SCALE = 3
export const DEFAULT_OPACITY = 0.45

/** The overlay a camera opens with: the most recent photo (`photos` newest first), or none. */
export function defaultOverlay(photos) {
  return Array.isArray(photos) && photos.length ? photos[0] : null
}

export const clampScale = s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(s) ? s : 1))

/** Keeps a drag from carrying the overlay entirely off the view: at most `limit` × the size away. */
export const clampPan = (v, size, limit = 0.9) => {
  const max = Math.max(0, size) * limit
  return Math.min(max, Math.max(-max, Number.isFinite(v) ? v : 0))
}

/** The scale after a pinch: the scale it started at, grown by how much the fingers moved apart. */
export function pinchScale(startScale, startDistance, distance) {
  if (!(startDistance > 0) || !(distance > 0)) return clampScale(startScale)
  return clampScale(startScale * (distance / startDistance))
}

/** The distance between two touch points. */
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** The CSS transform that places the overlay: moved by (x, y) pixels from the centre, then scaled. */
export function overlayTransform({ x = 0, y = 0, scale = 1 } = {}) {
  return `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${clampScale(scale).toFixed(3)})`
}

/** The saved picture's size: the video frame, brought down to `max` on its longer side. */
export function captureSize(width, height, max = 1600) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const k = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

/** The name of a photo taken on `day` ('YYYY-MM-DD'). */
export const photoFileName = day => `progress-${day}.jpg`
