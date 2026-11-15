// Extra pictures for catalogue exercises (catalogue/photos/, built by
// scripts/catalogue/everkinetic-pictures.mjs): start and end drawings, each with its licence and
// author shown beside it. Served next to the app (exercise-photos/), never fetched from elsewhere.
//
// The index is one small JSON file, loaded once and only when an exercise sheet opens. A build
// without it (a missing file, or the SPA fallback answering with HTML) just shows no extra pictures.
const ENV = import.meta.env || {}
export const PICTURE_BASE = ENV.VITE_PICTURE_BASE || 'exercise-photos/'

export const LICENSE_INFO = {
  'CC-BY-SA-3.0': { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  'CC-BY-SA-4.0': { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  'CC0-1.0': { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
}

let pending = null
export function loadPictureIndex(fetchImpl = globalThis.fetch) {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => fetchImpl(PICTURE_BASE + 'index.json'))
      .then(r => (r && r.ok ? r.json() : {}))
      .then(v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}))
      .catch(() => ({}))
  }
  return pending
}
export const resetPictureIndex = () => { pending = null }

/** Pictures for one catalogue exercise id; only entries with a known free licence and a file. */
export const picturesFor = (index, id) =>
  (id && Array.isArray(index?.[id]) ? index[id] : []).filter(p => p && typeof p.f === 'string' && LICENSE_INFO[p.license])

export const pictureSrc = p => PICTURE_BASE + p.f
export const licenseOf = p => LICENSE_INFO[p?.license] || null
