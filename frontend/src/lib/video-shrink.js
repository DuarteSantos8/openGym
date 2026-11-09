/* A video picked or filmed for an exercise, made smaller on the device before it is kept and
 * uploaded (v1.4.5). A phone films a minute of 4K at 50 to 400 MB; the server takes 100 MB at
 * most by default (MEDIA_VIDEO_MAX_MB), and a form video needs nowhere near that.
 *
 * The browser's own encoder does it, with no dependency: the clip plays once, unseen and muted,
 * its frames are drawn onto a canvas at most MAX_EDGE on the long side, and a MediaRecorder writes
 * that canvas at a bitrate that fits the server's cap. So it takes as long as the clip, which is
 * what the progress line says. MP4 (H.264) where the browser can write it (Safari, Chrome 126+):
 * it plays everywhere, so any clip over SHRINK_ABOVE_MB is shrunk. Where only WebM can be written
 * (older Chrome, Firefox), only a clip the server would refuse is shrunk, since a WebM does not
 * play on every phone. The sound is left out: a form video is watched, not listened to.
 *
 * Anything that goes wrong (no MediaRecorder, a codec the browser cannot play, a clip that does
 * not say how long it is, a result no smaller) gives null, and the clip is taken as it was. */

import { MB } from './media-limits.js'

export const MAX_EDGE = 1280            // px, the long edge of a shrunk clip
export const MAX_BITRATE = 2_500_000    // bit/s: 1280 px of gym footage looks fine at this
export const MIN_BITRATE = 400_000
export const SHRINK_ABOVE_MB = 12       // an MP4 clip smaller than this is kept as it is
const FPS = 30

const MP4 = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
const WEBM = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/** The type a MediaRecorder here can write, MP4 first; null where there is no recorder at all. */
export function recorderType (MR = globalThis.MediaRecorder) {
  if (typeof MR !== 'function' || typeof MR.isTypeSupported !== 'function') return null
  for (const t of [...MP4, ...WEBM]) { try { if (MR.isTypeSupported(t)) return t } catch { /* next */ } }
  return null
}

const looksLikeVideo = file => /^video\//.test(file?.type || '') || /\.(mp4|m4v|mov|webm)$/i.test(file?.name || '')

/** Whether a picked file is worth shrinking here: a video, big enough, with a recorder that helps. */
export function shouldShrink (file, limits, type = recorderType()) {
  if (!file || !type || !looksLikeVideo(file)) return false
  const cap = (Number(limits?.videoMB) || 0) * MB
  if (/^video\/mp4/.test(type)) return file.size > Math.min(SHRINK_ABOVE_MB * MB, cap || Infinity)
  return cap > 0 && file.size > cap
}

/** w × h scaled to fit `edge` on its long side, even numbers (encoders want them), never upscaled. */
export function scaledSize (w, h, edge = MAX_EDGE) {
  if (!(w > 0) || !(h > 0)) return null
  const k = Math.min(1, edge / Math.max(w, h))
  const even = v => Math.max(2, Math.round(v * k / 2) * 2)
  return { width: even(w), height: even(h) }
}

/** A bitrate that lands a clip of `sec` seconds well inside `capMB`, between the floor and MAX_BITRATE. */
export function bitrateFor (sec, capMB) {
  if (!(sec > 0)) return MAX_BITRATE
  const fit = capMB > 0 ? Math.floor(capMB * MB * 8 * 0.8 / sec) : MAX_BITRATE
  return Math.max(MIN_BITRATE, Math.min(MAX_BITRATE, fit))
}

const once = (el, ev, ms) => new Promise((resolve, reject) => {
  const tm = setTimeout(() => { cleanup(); reject(new Error('timeout')) }, ms)
  const ok = () => { cleanup(); resolve() }
  const bad = () => { cleanup(); reject(new Error('error')) }
  const cleanup = () => { clearTimeout(tm); el.removeEventListener(ev, ok); el.removeEventListener('error', bad) }
  el.addEventListener(ev, ok)
  el.addEventListener('error', bad)
})

/**
 * The clip again, smaller, as a File (MP4 or WebM), or null to keep the original. `onProgress`
 * hears 0 to 1 as it plays through. `limits` are lib/media-limits.js's (videoMB, videoSec).
 */
export async function shrinkVideo (file, { limits = {}, onProgress = () => {}, doc = globalThis.document, MR = globalThis.MediaRecorder } = {}) {
  const type = recorderType(MR)
  if (!type || !doc) return null
  const video = doc.createElement('video')
  const url = URL.createObjectURL(file)
  let frame = 0
  let rec = null
  try {
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.preload = 'auto'
    video.src = url
    await once(video, 'loadedmetadata', 10000)
    const sec = video.duration
    // Without a length there is no bitrate to aim for and no progress to show: keep it as it is.
    if (!Number.isFinite(sec) || sec <= 0) return null
    if (limits.videoSec > 0 && sec > limits.videoSec + 1) return null
    const size = scaledSize(video.videoWidth, video.videoHeight)
    if (!size) return null
    const canvas = doc.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof canvas.captureStream !== 'function') return null
    const stream = canvas.captureStream(FPS)
    rec = new MR(stream, { mimeType: type, videoBitsPerSecond: bitrateFor(sec, limits.videoMB) })
    const chunks = []
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
    const stopped = new Promise(resolve => { rec.onstop = resolve })
    const draw = () => {
      ctx.drawImage(video, 0, 0, size.width, size.height)
      onProgress(Math.min(1, video.currentTime / sec))
      if (!video.ended) frame = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw)
    }
    ctx.drawImage(video, 0, 0, size.width, size.height)
    rec.start(1000)
    const ended = once(video, 'ended', Math.ceil(sec * 3000) + 15000)
    await video.play()
    draw()
    await ended
    ctx.drawImage(video, 0, 0, size.width, size.height)
    rec.stop()
    await stopped
    onProgress(1)
    const mime = type.split(';')[0]
    const out = new Blob(chunks, { type: mime })
    if (!out.size || out.size >= file.size) return null
    const File_ = globalThis.File
    return typeof File_ === 'function' ? new File_([out], mime === 'video/mp4' ? 'video.mp4' : 'video.webm', { type: mime }) : out
  } catch {
    try { if (rec && rec.state !== 'inactive') rec.stop() } catch { /* stopped */ }
    return null
  } finally {
    try { if (video.cancelVideoFrameCallback && frame) video.cancelVideoFrameCallback(frame); else if (frame) cancelAnimationFrame(frame) } catch { /* gone */ }
    try { video.pause() } catch { /* never played */ }
    video.removeAttribute('src')
    try { video.load() } catch { /* nothing loaded */ }
    URL.revokeObjectURL(url)
  }
}
