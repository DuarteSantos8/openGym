// The maths behind the progress-photo camera (#951): which photo starts as the overlay, the shape of
// the frame it sits on, and how big the saved picture is. Pure, so the camera screen only handles
// the video and the shutter.

export const DEFAULT_OPACITY = 0.45

/** The overlay a camera opens with: the most recent photo (`photos` newest first), or none. */
export function defaultOverlay(photos) {
  return Array.isArray(photos) && photos.length ? photos[0] : null
}

/** The shape of a video frame, width over height, or null while the camera has not sent one. */
export function frameRatio(width, height) {
  return width > 0 && height > 0 ? width / height : null
}

/**
 * Whether a camera's preview is shown mirrored, as every camera app does for the front one. The
 * picture that is kept is mirrored the same way: what is on the screen is what is saved. The camera
 * says which it is (`reported`, from the track's settings); when it does not, what was asked for
 * decides.
 */
export const isMirrored = (reported, requested) => (reported ? reported === 'user' : requested === 'user')

/** The saved picture's size: the video frame, brought down to `max` on its longer side. */
export function captureSize(width, height, max = 1600) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const k = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

/** The name of a photo taken on `day` ('YYYY-MM-DD'). */
export const photoFileName = day => `progress-${day}.jpg`
