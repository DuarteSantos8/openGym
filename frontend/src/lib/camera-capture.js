// The frame on a <video> as a JPEG blob, for the progress-photo camera (#951). The canvas is the
// only part of the camera that needs a browser, so it lives here and the screen can be tested with
// this swapped out.
import { captureSize } from './camera-overlay.js'

/** The current frame of `video` as a JPEG blob (at most 1600 px on a side), or null if it cannot be made. */
export async function frameToBlob(video, max = 1600, quality = 0.92) {
  const { width, height } = captureSize(video && video.videoWidth, video && video.videoHeight, max)
  if (!width) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, width, height)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
}
