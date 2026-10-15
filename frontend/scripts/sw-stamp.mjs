// What vite.config.js writes into the built public/sw.js. Kept here so the worker's tests can
// stamp a copy exactly the way a build does.

// Language, instruction and exercise-name packs: a few hundred kB each, seventeen of them, and
// the worker already keeps the one in use once it has loaded. Everything else that is split off
// and loaded on demand (the photo and video ingest, the QR reader, the local Coach) is small,
// and offline it was simply missing until the page had needed it once with a network: the first
// photo after an update, added at the gym, failed.
const PACK = /[\\/]src[\\/](?:locales|instr|exercise-names)[\\/]/
// …except the English steps: every language falls back to them, they are no longer in the main
// bundle (i18n.js loads them on the first exercise opened), and left out, a phone that had not
// opened one with a network showed no steps at all offline. exercise-desc/ is not a PACK and
// stays in the list, English descriptions included.
const KEEP = /[\\/]src[\\/]instr[\\/]en\.js$/

/** The built files the worker fetches at install besides what index.html names: every chunk and
 *  stylesheet but the packs, as './assets/…' the way index.html writes them. */
export function lazyAssets(bundle) {
  const out = []
  for (const [file, item] of Object.entries(bundle)) {
    if (!/\.(?:js|css)$/.test(file)) continue
    const ids = item.type === 'chunk' ? (item.moduleIds?.length ? item.moduleIds : Object.keys(item.modules || {})) : []
    if (ids.length && ids.every(id => PACK.test(id) && !KEEP.test(id))) continue
    out.push('./' + file)
  }
  return out.sort()
}

/** The worker with its build stamp and its list in place of the two placeholders. */
export function stampSw(source, { stamp, lazy = [] }) {
  return source
    .replace('__BUILD__', () => stamp)
    .replace("'__LAZY__'", () => JSON.stringify(JSON.stringify(lazy)))
}
