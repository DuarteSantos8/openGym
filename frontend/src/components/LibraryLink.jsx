// A routines-library link that came into the app (lib/library-link.js): a tap on
// https://opengym.ch/routines/<slug>/ in a chat, the phone camera on the page's QR code, or
// Plan > Scan a QR code. The routine's plan file is fetched and shown in the same import sheet
// as Plan > Import a plan file, with the author's name on it. Anything that is not a routine, or
// a routine that cannot be fetched, goes to the website.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { nativeFetch } from '../lib/capacitor-fetch.js'
import { fetchLibraryRoutine, authorFromEntries } from '../lib/library-link.js'
import { confirmSheet, planImportSheet } from '../sheets.jsx'

const ui = () => useUI.getState()

/** The website for a library address: index.html, which no app filter claims, so it stays there. */
export function openInBrowser(url) {
  try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* nothing to open with */ }
}

const ERRORS = {
  offline: () => t('No signal, or the library is having a nap. The website has it too.'),
  missing: () => t('That routine isn’t in the library anymore. The website might know where it went.'),
  'bad-file': () => t('That routine came back scrambled. The website has the real thing.'),
}

let last = { key: null, at: 0 }

async function indexAddress() {
  try { return (await import('../lib/routine-library.js')).indexUrl() } catch { return null }
}

/**
 * Opens a library link: { kind: 'routine' } fetches and previews it, { kind: 'page' } opens the
 * website. Resolves true when the import sheet opened. `deps` is for tests.
 */
export async function openLibraryLink(link, { fetchImpl = nativeFetch, now = Date.now(), authorOf } = {}) {
  if (!link) return false
  // The cold-start link can arrive twice (getLaunchUrl and the retained appUrlOpen event).
  const key = link.pageUrl || link.browserUrl
  if (last.key === key && now - last.at < 5000) return false
  last = { key, at: now }
  if (link.kind !== 'routine') { openInBrowser(link.browserUrl); return false }
  ui().toast(t('Fetching the routine…'))
  const author = authorOf || (async l => {
    const lib = await import('../lib/routine-library.js')
    const at = await indexAddress()
    return authorFromEntries(await lib.communityEntries({ url: at || undefined }), l, at)
  })
  try {
    const bundle = await fetchLibraryRoutine(link, { fetchImpl, unit: useStore.getState().S?.unit || 'kg', authorOf: author })
    planImportSheet(bundle)
    return true
  } catch (e) {
    confirmSheet({
      title: t('Couldn’t fetch that routine'),
      message: (ERRORS[e?.code] || ERRORS.offline)(),
      confirmText: t('Open in browser'),
      onConfirm: () => openInBrowser(link.browserUrl),
    })
    return false
  }
}

export function _resetLibraryLinksForTests() { last = { key: null, at: 0 } }
