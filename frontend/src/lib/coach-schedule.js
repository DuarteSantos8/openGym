// Automatic reviews on a phone that brings its own API key (Discord, 10-19).
//
// On a server the cadence tick runs them (api/coach/cadence.js). A phone in BYOK mode has no
// server, and nothing ran them: "Weekly" and "After every few workouts" saved, and no review ever
// came. There is no running JavaScript while the app is closed, so the phone asks while it is
// open, with the server's rule (api/coach/core/due.js): on start, on every return to the
// foreground, and once a minute while on screen. That last one is what catches a workout the
// moment it is finished, and a weekly slot that passes with the app open.
//
// A phone paired with a server leaves the running to the server, which has no way to reach the
// phone app (no web push there): on start and on every return to the foreground the phone asks
// whether a scheduled review left a proposal, and says so once.
//
// The check itself is cheap and says no early: without automatic reviews on, or with the Coach
// off on this phone, it stops here, before the Coach's code is even loaded.
import { MOBILE } from './mobile.js'

const TICK_MS = 60000

/** Whether this state could have a review due here at all, before anything is loaded. */
export function mayBeDue(store) {
  const cadence = store?.S?.coach?.cadence
  return store?.coachLocal?.mode === 'byok' && !!cadence && cadence !== 'off'
}
/** Whether the paired server could have run one this phone has not heard of. */
export function mayHaveNews(store) {
  const cadence = store?.S?.coach?.cadence
  // A paired phone without a key of its own uses its server's Coach (coachAvailable, lib/coach.js).
  return store?.coachLocal?.mode !== 'byok' && !!store?.config?.coach?.enabled && !!store?.user && !!cadence && cadence !== 'off'
}

let running = false
/** One look: runs the review when it is due (own key), or, on the way back to the foreground,
 *  asks the paired server whether one is waiting. Resolves to what it found, or null. */
export async function checkScheduledReview(getStore, foreground = false) {
  const store = getStore()
  const own = mayBeDue(store), paired = foreground && mayHaveNews(store)
  if (running || (!own && !paired)) return null
  running = true
  try {
    const api = await import('./coach-api.js')
    return await (own ? api.scheduledReview() : api.scheduledNotice())
  } catch { return null } finally { running = false }
}

let started = false
export function initCoachSchedule(getStore) {
  if (!MOBILE || started) return
  started = true
  const look = (foreground = false) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    checkScheduledReview(getStore, foreground)
  }
  setTimeout(() => look(true), 5000)      // after start-up, not in the middle of it
  setInterval(() => look(), TICK_MS)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => look(true))
  // The same promise rule as initReminderSync (lib/mobile.js): returned into the catch.
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) look(true) })
  ).catch(() => {})
}
