// When the first-run question ("How much app do you want?" / "Want a 1-minute tour?") or the
// "Finish the tour?" one may open: once the app is idle. It used to open a fixed 1.2 s after the
// first screen, whatever the person was doing, so a tap on "Load starter plan" in that moment put
// the sheet underneath the question.
//
// Idle means: nothing open (no sheet, no dialog, no viewer), no finger on the screen, no field
// with the keyboard, and nothing touched, typed or scrolled for a moment. Someone who just sits
// on Home still gets it after the same 1.2 s. Someone who is busy gets it once they stop.
// The watch only stamps a time on each event; one timer does the asking.
import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { tourState, openTour, readTour, shouldOffer, resumeAt } from './tour.js'

/** After the first screen settles: the wait for someone who touches nothing. */
export const OFFER_SETTLE_MS = 1200
/** How long the app has to be left alone after the last touch, key, scroll or closed sheet. */
export const OFFER_QUIET_MS = 1500

const STUCK_MS = 5000

const EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'wheel', 'scroll', 'hashchange', 'popstate']

/** Which question is due for this profile, { kind: 'resume', at } or { kind: 'offer' }, or null. */
export function offerDue(st = useStore.getState()) {
  if (!st.S || st.S.active) return null
  const rec = readTour()
  const at = resumeAt(rec)
  if (at) return { kind: 'resume', at }
  const synced = !st.user || (st.sync?.status === 'ok' && st.sync.lastSynced > 0)
  return shouldOffer(rec, st.S, { synced }) ? { kind: 'offer' } : null
}

const inField = () => {
  const a = typeof document !== 'undefined' ? document.activeElement : null
  return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '') || !!a.isContentEditable)
}
// Anything modal that is not one of the store's sheets: the photo viewer, the camera, the circuit
// timer, the recap, the "still training?" prompt.
const dialogOpen = () => typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"], [role="alertdialog"]')

/**
 * Why the question has to wait right now, or '' when the app is idle.
 * `touch`: { at, down } from the watch, the last interaction and whether a finger is still down.
 */
export function offerBlocked(touch, now = Date.now()) {
  if (tourState()) return 'tour'
  if (useStore.getState().S?.active || /^#\/workout/.test(globalThis.location?.hash || '')) return 'workout'
  if (useUI.getState().sheets.length) return 'sheet'
  if (dialogOpen()) return 'dialog'
  if (inField()) return 'field'
  // A finger that went down and was never heard of again (a release outside the window) is gone.
  if (touch?.down && now - touch.at < STUCK_MS) return 'finger'
  if (touch && now - touch.at < OFFER_QUIET_MS) return 'busy'
  return ''
}

/**
 * Watches for the idle moment and opens the due question in it, once.
 * `preload`: fetches the question's chunk first, so nothing can be tapped between the decision
 * and the card. Returns stop().
 */
export function watchTourOffer({ onAsked, preload, settle = OFFER_SETTLE_MS } = {}) {
  let stopped = false
  let tm = null
  // Nothing touched yet: the settle wait alone decides for someone who just looks at Home.
  const touch = { at: -Infinity, down: 0 }
  const stamp = e => {
    touch.at = Date.now()
    if (e?.type === 'pointerdown') touch.down += 1
    else if (e?.type === 'pointerup' || e?.type === 'pointercancel') touch.down = Math.max(0, touch.down - 1)
  }
  const opts = { capture: true, passive: true }
  for (const ev of EVENTS) window.addEventListener(ev, stamp, opts)
  // A sheet that opened or closed is something that just happened, whoever did it.
  const unsub = useUI.subscribe((s, prev) => { if (s.sheets !== prev.sheets) touch.at = Date.now() })
  const stop = () => {
    stopped = true
    clearTimeout(tm)
    for (const ev of EVENTS) window.removeEventListener(ev, stamp, opts)
    unsub()
  }
  const again = ms => { tm = setTimeout(check, Math.max(50, ms)) }
  async function check() {
    if (stopped) return
    const due = offerDue()
    if (!due) return             // nothing to ask (any more): the caller starts a new watch when the profile changes
    const why = offerBlocked(touch)
    if (why) { again(why === 'busy' ? touch.at + OFFER_QUIET_MS - Date.now() : OFFER_QUIET_MS); return }
    if (preload) {
      try { await preload() } catch { /* offline: the card shows when its chunk arrives */ }
      // The chunk took a moment: only if the app is still idle, and the same question still due.
      if (stopped) return
      if (offerBlocked(touch) || !offerDue()) { again(OFFER_QUIET_MS); return }
    }
    openTour(due)
    onAsked?.()
    stop()
  }
  tm = setTimeout(check, settle)
  return stop
}

/** App's side: asks once per start, after the first setup (`ready`), in the first idle moment. */
export function useTourOffer(ready, preload) {
  const asked = useRef(false)
  const S = useStore(s => s.S)
  const synced = useStore(s => !s.user || (s.sync?.status === 'ok' && s.sync.lastSynced > 0))
  const due = ready && !asked.current && !!S && !!offerDue()
  useEffect(() => {
    if (!due || asked.current) return
    return watchTourOffer({ onAsked: () => { asked.current = true }, preload })
  }, [due, synced])
}
