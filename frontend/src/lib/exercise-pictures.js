// Extra pictures and demonstration videos for catalogue exercises, each with its licence and author
// shown beside it. Two folders ship next to the app and are never fetched from elsewhere:
//   exercise-photos/  start and end drawings (catalogue/photos, scripts/catalogue/everkinetic-pictures.mjs)
//   exercise-demos/   videos and step-by-step photos (catalogue/demos, scripts/catalogue/exercise-demos.mjs)
//
// Each folder has one small index.json, loaded once and only when an exercise sheet opens. A build
// without one (a missing file, or the SPA fallback answering with HTML) just shows fewer extras.
const ENV = import.meta.env || {}
export const PICTURE_BASE = ENV.VITE_PICTURE_BASE || 'exercise-photos/'
export const DEMO_BASE = ENV.VITE_DEMO_BASE || 'exercise-demos/'

export const LICENSE_INFO = {
  'CC-BY-SA-3.0': { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  'CC-BY-SA-4.0': { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'CC-BY-3.0': { name: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/' },
  'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  'CC0-1.0': { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'PD-USGov': { name: 'Public domain', url: 'https://www.usa.gov/government-copyright' },
}

const loadOne = (base, fetchImpl) => Promise.resolve()
  .then(() => fetchImpl(base + 'index.json'))
  .then(r => (r && r.ok ? r.json() : {}))
  .then(v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}))
  .catch(() => ({}))

let pending = null
/** Both indexes merged by exercise id; every entry remembers the folder it came from. */
export function loadPictureIndex(fetchImpl = globalThis.fetch) {
  if (!pending) {
    pending = Promise.all([loadOne(DEMO_BASE, fetchImpl), loadOne(PICTURE_BASE, fetchImpl)]).then(parts => {
      const out = {}
      parts.forEach((idx, i) => {
        const base = i === 0 ? DEMO_BASE : PICTURE_BASE
        for (const [id, list] of Object.entries(idx)) {
          if (!Array.isArray(list)) continue
          out[id] = [...(out[id] || []), ...list.map(p => (p && typeof p === 'object' ? { ...p, base } : p))]
        }
      })
      return out
    })
  }
  return pending
}
export const resetPictureIndex = () => { pending = null }

const valid = p => p && typeof p.f === 'string' && LICENSE_INFO[p.license] &&
  (p.kind !== 'video' || (/\.mp4$/.test(p.f) && (p.poster == null || typeof p.poster === 'string')))

/** Everything for one catalogue exercise; only entries with a known free licence and a file. */
export const picturesFor = (index, id) => (id && Array.isArray(index?.[id]) ? index[id] : []).filter(valid)

/**
 * What the exercise sheet shows: the sharpest video (if any), photo sequences of the whole movement,
 * then the remaining pictures as numbered steps (start position first, end position last).
 */
export function mediaFor(index, id) {
  const all = picturesFor(index, id)
  const videos = all.filter(p => p.kind === 'video').sort((a, b) => (b.h || 0) * (b.w || 0) - (a.h || 0) * (a.w || 0))
  const images = all.filter(p => p.kind !== 'video')
  const ORDER = { start: 0, end: 2 }
  return {
    video: videos[0] || null,
    sequences: images.filter(p => p.pose === 'sequence'),
    steps: images.filter(p => p.pose !== 'sequence').map((p, i) => [p, i]).sort((a, b) => (ORDER[a[0].pose] ?? 1) - (ORDER[b[0].pose] ?? 1) || a[1] - b[1]).map(x => x[0]),
  }
}

export const pictureSrc = p => (p.base || PICTURE_BASE) + p.f
export const posterSrc = p => (p.poster ? (p.base || PICTURE_BASE) + p.poster : undefined)
export const licenseOf = p => LICENSE_INFO[p?.license] || null
