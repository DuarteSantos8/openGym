/* How big a photo, GIF or video of a custom exercise may be, and the device-side constants.
 *
 * The caps are the server's to set (MEDIA_* in .env, handed out as `media` in GET /api/config):
 * when the server says, its numbers win, so the editor refuses a file here rather than after an
 * upload the server would refuse anyway. Without a server — a guest, the demo, a phone in local
 * mode — the defaults below apply; they are the server's defaults too (api/media.js mediaLimits).
 * Every MB is 2^20 bytes on both sides, and the server's values may be fractional.
 */

import { dateLocale } from './i18n-core.js'

export const MB = 1024 * 1024

export const DEFAULT_LIMITS = Object.freeze({
  imageMB: 2,       // a photo after it has been re-encoded here
  rawPhotoMB: 40,   // a photo as picked, before decoding; the pixel guard below applies as well
  gifMB: 8,
  videoMB: 40,      // videos are not transcoded, so this is the file as picked
  videoSec: 60,
  quotaMB: 200      // per profile on the server; 0 = no cap
})

export const IMAGE_MAX_EDGE = 1600        // px, the long edge of a stored photo
export const POSTER_EDGE = 480            // px, the long edge of every poster (list thumbnails)
export const LOOP_MAX_SEC = 15            // a video up to this long loops silently like a GIF
export const MAX_PHOTO_MP = 52            // megapixels a photo may have before it is even decoded
export const LOCAL_CACHE_MAX_MB = 300     // signed in: the local copies beyond this are evicted
export const LOCAL_GC_GRACE_MS = 3600000  // a file picked in the last hour is never collected
export const BG_UPLOAD_METERED_MAX_MB = 5 // bigger uploads wait for a connection that is not metered

const pos = v => typeof v === 'number' && Number.isFinite(v) && v > 0

/** The limits in force: the server's `config.media` over the defaults, one number at a time. */
export function limitsFrom(config) {
  const m = config && typeof config === 'object' ? config.media : null
  const out = { ...DEFAULT_LIMITS }
  if (!m || typeof m !== 'object') return out
  for (const k of ['imageMB', 'gifMB', 'videoMB', 'videoSec']) if (pos(m[k])) out[k] = m[k]
  // 0 is a real answer for the quota (no cap), not a missing one.
  if (typeof m.quotaMB === 'number' && Number.isFinite(m.quotaMB) && m.quotaMB >= 0) out.quotaMB = m.quotaMB
  return out
}

/** "2", "0.5", "40" — a size in MB to one decimal, with the language's own decimal mark ("0,5"
 *  in German and French). `fixed` keeps the one decimal on a whole number ("2.0"), for a line
 *  that lists sizes. */
export const fmtMB = (mb, { fixed = false } = {}) =>
  (Math.round(mb * 10) / 10).toLocaleString(dateLocale(), { minimumFractionDigits: fixed ? 1 : 0, maximumFractionDigits: 1 })
