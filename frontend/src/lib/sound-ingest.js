/* A sound of one's own for the end of a rest (Settings → Sound, v1.4.5), from a picked file to the
 * WAV that is kept. Whatever was picked (MP3, M4A/AAC, WAV, OGG, whatever this browser decodes) is
 * decoded, mixed down to mono, resampled to RATE, its silence trimmed off both ends, cut at
 * MAX_SEC with a short fade, its loudest moment brought to PEAK, and written again as a 16-bit
 * PCM WAV. One format for every place that plays it: Web Audio, Android's AudioTrack (RestTone
 * .java reads exactly this) and an iPhone notification, which takes a WAV of at most 30 s from
 * Library/Sounds. The file name and every tag of the original are gone by construction.
 *
 * Refusals are MediaErrors with a code the Settings sheet turns into a sentence: 'too-large' (the
 * picked file, `mb`), 'unreadable' (nothing here can decode it), 'silent' (nothing left after the
 * trim). */
import { MediaError } from './media-ingest.js'
import { MB } from './media-limits.js'
import { sha256Hex } from './sha256.js'
import { normalizeMediaRef } from './media-refs.js'

export const RATE = 22050
export const MAX_SEC = 30
export const RAW_MAX_MB = 15
export const PEAK = 0.9
const THRESHOLD = 0.01          // about -40 dB: quieter than this at either end is trimmed
const KEEP = 0.01               // s of quiet kept before the first and after the last sound
const FADE = 0.05               // s of fade where a long sound is cut

/** [start, end) of the part of `x` louder than THRESHOLD, with KEEP either side; null when silent. */
export function audibleRange (x, rate = RATE, threshold = THRESHOLD) {
  let a = 0, b = x.length - 1
  while (a < x.length && Math.abs(x[a]) < threshold) a++
  if (a >= x.length) return null
  while (b > a && Math.abs(x[b]) < threshold) b--
  const pad = Math.round(KEEP * rate)
  return [Math.max(0, a - pad), Math.min(x.length, b + 1 + pad)]
}

/** The samples trimmed, cut at `maxSec` (with a fade) and brought to PEAK. Null when silent. */
export function shapeSound (x, rate = RATE, maxSec = MAX_SEC) {
  const r = audibleRange(x, rate)
  if (!r) return null
  let out = x.slice(r[0], Math.min(r[1], r[0] + Math.round(maxSec * rate)))
  if (r[1] - r[0] > out.length) {
    const n = Math.min(out.length, Math.round(FADE * rate))
    for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n
  }
  let max = 0
  for (const v of out) max = Math.max(max, Math.abs(v))
  if (max > 0) { const k = PEAK / max; out = out.map(v => v * k) }
  return out
}

/** 16-bit mono PCM WAV of `x` (-1..1) at `rate`. */
export function encodeWav (x, rate = RATE) {
  const data = x.length * 2
  const buf = new ArrayBuffer(44 + data)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, data, true)
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), true)
  return new Uint8Array(buf)
}

/** The picked file decoded, in mono at RATE. Uses an OfflineAudioContext, so nothing plays. */
export async function decodeToMono (file, { Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext } = {}) {
  if (typeof Offline !== 'function') throw new MediaError('unreadable')
  const bytes = await file.arrayBuffer()
  let decoded
  try {
    const probe = new Offline(1, 1, RATE)
    decoded = await new Promise((resolve, reject) => {
      const p = probe.decodeAudioData(bytes, resolve, reject)
      if (p && typeof p.then === 'function') p.then(resolve, reject)
    })
  } catch { throw new MediaError('unreadable') }
  if (!decoded || !(decoded.length > 0)) throw new MediaError('unreadable')
  // Rendering through a mono context at RATE mixes down and resamples in one go.
  const frames = Math.max(1, Math.ceil(Math.min(decoded.duration, MAX_SEC + 10) * RATE))
  const ctx = new Offline(1, frames, RATE)
  const src = ctx.createBufferSource()
  src.buffer = decoded
  src.connect(ctx.destination)
  src.start(0)
  const out = await ctx.startRendering()
  return out.getChannelData(0)
}

/**
 * A picked file → { media, blob, dur }: `media` a MediaRef of kind 'audio' (width and height 1)
 * and `blob` the WAV for the local store. Throws MediaError.
 */
// `maxSec`: a shorter cut for a voice clip (lib/voice-clips.js CLIP_SEC).
export async function ingestSoundFile (file, { decode = decodeToMono, maxSec = MAX_SEC } = {}) {
  if (!file) throw new MediaError('unreadable')
  if (file.size > RAW_MAX_MB * MB) throw new MediaError('too-large', { mb: RAW_MAX_MB })
  const mono = await decode(file)
  const shaped = shapeSound(mono, RATE, Math.min(MAX_SEC, maxSec))
  if (!shaped) throw new MediaError('silent')
  const wav = encodeWav(shaped)
  const blob = new Blob([wav], { type: 'audio/wav' })
  const hash = await sha256Hex(blob)
  const dur = Math.round(shaped.length / RATE * 10) / 10
  const media = normalizeMediaRef({ kind: 'audio', hash, mime: 'audio/wav', size: blob.size, width: 1, height: 1, dur, at: Date.now() })
  return { media, blob, dur }
}
