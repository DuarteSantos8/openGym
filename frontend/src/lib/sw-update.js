/* What the page hears from its service worker (public/sw.js).
 *
 *   gains-sw-updated   a newer build has taken over. The page keeps the JavaScript it loaded, so it
 *                      offers a Reload and leaves the moment to the person: a set may be half typed.
 *   gains-sw-navigate  a notification tap focused this window; it goes to the route by setting its
 *                      own location.hash, which is a route change, not a reload.
 *
 * Which build the page is running is the stamp in <meta name="gains-build"> (scripts/sw-stamp.mjs).
 * The worker's message carries the build that is now active; a page that already runs it, such as
 * the one whose fresh index.html started the install, has nothing to reload into and is not asked.
 * It is asked once: a build after that one still reloads into the newest, and a second prompt
 * would only stack on the first. Without a stamp (a dev server, the phone build) there is no worker
 * to hear and nothing to compare with, so the update is never offered. */
import { useUI } from '../store/useUI.js'
import { t } from './i18n.js'

export const UPDATED_MSG = 'gains-sw-updated'
export const NAVIGATE_MSG = 'gains-sw-navigate'
// Long enough to be read after a rest timer or a set, short enough not to sit there for good.
const PROMPT_MS = 60_000

export const pageBuild = (doc = document) => doc.querySelector('meta[name="gains-build"]')?.getAttribute('content') || ''

// The hash route a navigate message names, or null: same origin and a `#/…` route only.
function routeOf(raw, loc) {
  if (typeof raw !== 'string') return null
  try {
    const u = new URL(raw, loc.href)
    return u.origin === loc.origin && u.hash.startsWith('#/') ? u.hash : null
  } catch { return null }
}

/** Listens on the service worker container; returns a function that stops it. */
export function startSwMessages({
  container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  build = pageBuild(),
  ui = useUI,
  reload = () => location.reload(),
  loc = location,
} = {}) {
  if (!container) return () => {}
  let prompted = false
  const onMessage = e => {
    const msg = e.data
    if (!msg || typeof msg !== 'object') return
    if (msg.type === NAVIGATE_MSG) {
      const hash = routeOf(msg.url, loc)
      if (hash && loc.hash !== hash) loc.hash = hash
      return
    }
    if (msg.type !== UPDATED_MSG || prompted) return
    if (!build || typeof msg.build !== 'string' || !msg.build || msg.build === build) return
    prompted = true
    ui.getState().toast(t('A new version is ready'), { action: t('Reload'), onAction: reload, ms: PROMPT_MS, icon: 'reset' })
  }
  container.addEventListener('message', onMessage)
  return () => container.removeEventListener('message', onMessage)
}
