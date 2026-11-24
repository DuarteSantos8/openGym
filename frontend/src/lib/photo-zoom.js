// Pinch and drag on a custom exercise's photo, full screen (Discord "Zoom and pan on a custom
// exercise photo"). The view is { z, x, y }: a scale from the middle of the photo as it fits the
// screen, then a shift in screen pixels. Kept pure so the clamping is tested without a finger.
export const ZOOM_MAX = 4

const fin = (v, d) => (Number.isFinite(v) ? v : d)

/** The view held inside the photo: never smaller than it fits, never dragged off its own edge. */
export function clampView(view, w, h) {
  const z = Math.max(1, Math.min(ZOOM_MAX, fin(view?.z, 1)))
  const mx = Math.max(0, (fin(w, 0) * (z - 1)) / 2), my = Math.max(0, (fin(h, 0) * (z - 1)) / 2)
  const x = Math.max(-mx, Math.min(mx, fin(view?.x, 0))), y = Math.max(-my, Math.min(my, fin(view?.y, 0)))
  // -0 reads as 0 in a test and in a transform alike, but not in toEqual
  return { z, x: x || 0, y: y || 0 }
}

/** Two fingers that started `d0` apart are now `d1` apart: the view they started on, scaled. */
export function pinchTo(start, d0, d1, w, h) {
  const f = d0 > 0 && d1 > 0 ? d1 / d0 : 1
  const z = fin(start?.z, 1) * f
  const k = z / fin(start?.z, 1)
  return clampView({ z, x: fin(start?.x, 0) * k, y: fin(start?.y, 0) * k }, w, h)
}

/** One finger moved (dx, dy) since it went down on `start`. */
export const dragTo = (start, dx, dy, w, h) => clampView({ z: start?.z, x: fin(start?.x, 0) + dx, y: fin(start?.y, 0) + dy }, w, h)
