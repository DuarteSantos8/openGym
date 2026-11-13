// The phone's side of Forgotten workouts (lib/forgotten-workout.js decides, this follows): a check
// every 30 s while a workout runs and whenever the app comes to the front, the in-app card
// (components/ForgottenPrompt.jsx), a local notification planned for the moment the question is
// due (Keep going / Finish right on it), the gym leave the native gym reminder noticed, and the
// finish itself. Phone apps only: a laptop's tab never ends a phone's workout.
//
// The page sleeps with the app in the background, so the notification is planned ahead (at
// askAt) and the finish happens when the app wakes: the end saved is the last set plus its rest
// either way, so a late finish loses nothing. A notification that went out counts as asked.
import { MOBILE } from './mobile.js'
import { t } from './i18n-core.js'
import { fmtClock } from './format.js'
import { withoutAlarmPrompt } from './exact-alarm.js'
import {
  decideForgotten, readForgottenPrefs, readForgottenState, writeForgottenState, keepGoingPatch, leaveGymOn,
} from './forgotten-workout.js'

export const ASK_NOTIFICATION_ID = 3100
export const LEFT_NOTIFICATION_ID = 3001   // posted by the native gym reminder (GymReminder.java, GymReminderPlugin.swift)
export const ASK_ACTIONS = 'og-forgotten'
export const LEFT_ACTIONS = 'og-left'
const CHECK_MS = 30 * 1000

let deps = null          // { useStore, useUI, finish, discard, openPrompt, closePrompt, gymOn }
let timer = null
let shown = null         // the card on screen: { wid, state }
let planned = ''         // the notification planned last ("wid|at")

// Handed out inside an object: a Capacitor plugin proxy answers `then` with a native call that
// never settles, so a promise resolved with the bare proxy hangs (#42, the Coach's hang).
// `deps.notifications`: the tests' stand-in.
const ln = async () => {
  if (!MOBILE) return null
  if (deps?.notifications) return { L: deps.notifications }
  try { return { L: (await import('@capacitor/local-notifications')).LocalNotifications } } catch { return null }
}

/** The texts, in the app's language (also handed to the native gym reminder for its notification). */
export function forgottenCopy(prefs = readForgottenPrefs()) {
  return {
    askTitle: t('Still training?'),
    askBody: t('No set for {0} minutes. If you’re done, I’ll wrap it up in {1} minutes, ending at your last set.', prefs.askMin, prefs.graceMin),
    leftTitle: t('Looks like you left the gym'),
    leftBody: t('Finish the workout now? Otherwise it ends by itself in {0} minutes.', prefs.graceMin),
    keep: t('Keep going'),
    finish: t('Finish'),
    finishNow: t('Finish now'),
    discard: t('Discard'),
  }
}

let actionsRegistered = false
async function registerActions(L) {
  if (actionsRegistered || !L?.registerActionTypes) return
  const c = forgottenCopy()
  try {
    await L.registerActionTypes({ types: [
      // Both open the app: a Keep going the page never heard (iOS runs no page for a background
      // action) would let the workout end by itself after all.
      { id: ASK_ACTIONS, actions: [{ id: 'keep', title: c.keep, foreground: true }, { id: 'finish', title: c.finish, foreground: true }] },
      { id: LEFT_ACTIONS, actions: [{ id: 'finish', title: c.finishNow, foreground: true }, { id: 'keep', title: c.keep, foreground: true }] },
    ] })
    actionsRegistered = true
  } catch { /* an older shell: the notification still opens the app */ }
}

/** The notification for "Still training?", planned for `at`; or none (`at` 0). Never asks for permission. */
async function planNotification(wid, at) {
  const key = wid && at ? wid + '|' + at : ''
  if (key === planned) return
  const L = (await ln())?.L
  if (!L) return
  planned = key
  try {
    await L.cancel({ notifications: [{ id: ASK_NOTIFICATION_ID }] }).catch(() => {})
    if (!key) { writeForgottenState(wid, { notifyAt: 0 }); return }
    if ((await L.checkPermissions()).display !== 'granted') { writeForgottenState(wid, { notifyAt: 0 }); return }
    await registerActions(L)
    const c = forgottenCopy()
    await L.schedule({ notifications: await withoutAlarmPrompt(L, [{
      id: ASK_NOTIFICATION_ID, title: c.askTitle, body: c.askBody,
      schedule: { at: new Date(at), allowWhileIdle: true },
      actionTypeId: ASK_ACTIONS, extra: { forgotten: wid },
    }]) })
    // Went out at `at` unless the workout moves on before: then this is planned again, later.
    writeForgottenState(wid, { notifyAt: at })
  } catch { planned = '' }
}

/** When the question counts as asked: shown here, or its notification gone out. */
function askedAtOf(st, now) {
  if (st.askedAt) return st.askedAt
  return st.notifyAt && st.notifyAt <= now ? st.notifyAt : 0
}

/** One look at the running workout. Exported for the tests. */
export function checkForgotten(now = Date.now()) {
  if (!deps) return null
  const { useStore, useUI } = deps
  const S = useStore.getState().S
  const A = S?.active
  if (!A || useStore.getState().tourSandbox) { hide(); if (planned) planNotification(null, 0); return null }
  const prefs = readForgottenPrefs()
  const st = readForgottenState(A.id)
  const ui = useUI.getState()
  const resting = !!(ui.timer && !ui.timer.ready && !ui.timer.paused) || !!(ui.work && !ui.work.paused)
  const d = decideForgotten({
    A, now, prefs, leaveGym: leaveGymOn(prefs, deps.gymOn()), leftAt: st.leftAt, askedAt: askedAtOf(st, now),
    snoozeAt: st.snoozeAt, activeAt: Number(A.reopenedAt) || 0, resting, restSec: Number(S.restSec) || 0,
  })
  if (d.state === 'end') {
    hide()
    planNotification(null, 0)
    writeForgottenState(null)
    deps.finish({ end: d.endAt, auto: d.reason })
    return d
  }
  if (d.state === 'ask' || d.state === 'left') {
    if (d.askNow) writeForgottenState(A.id, { askedAt: now })
    show(A.id, d)
    return d
  }
  hide()
  planNotification(A.id, d.state === 'active' && d.askAt ? d.askAt : 0)
  return d
}

function show(wid, d) {
  if (shown && shown.wid === wid && shown.state === d.state) return
  hide()
  shown = { wid, state: d.state, handle: deps.openPrompt({ state: d.state, deadline: d.deadline, copy: forgottenCopy(), clock: fmtClock }) }
}
function hide() {
  if (!shown) return
  try { shown.handle?.close?.() } catch { /* gone already */ }
  shown = null
}

/** "Keep going", from the card, the notification or a watch (`at`: when it was tapped). */
export function keepGoing(at = Date.now()) {
  const A = deps?.useStore.getState().S?.active
  if (!A) return
  writeForgottenState(A.id, keepGoingPatch(at))
  hide()
  deps.noteUse?.(A.id, at)
  checkForgotten()
}

/** "Finish" / "Finish now": the ordinary finish, with the summary, ending now. */
export function finishFromPrompt() {
  const A = deps?.useStore.getState().S?.active
  hide()
  if (!A) return
  writeForgottenState(null)
  deps.finish()
}

/** "Discard" (left the gym only): asked once more by the screen that offers it. */
export function discardFromPrompt() {
  hide()
  writeForgottenState(null)
  deps?.discard?.()
}

/**
 * The native gym reminder saw the phone leave a gym at `at`; `answer`: what was tapped on its
 * notification ('finish', 'keep'), if the app was opened from one of its buttons.
 */
export function noteLeftGym(at, answer = '') {
  const A = deps?.useStore.getState().S?.active
  if (!A || !(at > 0)) return
  const st = readForgottenState(A.id)
  // A leave from before this workout (or before its last Keep going) is old news.
  if (at <= Math.max(Number(A.start) || 0, st.snoozeAt)) return
  if (at > st.leftAt) writeForgottenState(A.id, { leftAt: at })
  if (answer === 'finish') { finishFromPrompt(); return }
  if (answer === 'keep') { keepGoing(); return }
  checkForgotten()
}

/**
 * Starts looking after forgotten workouts. `opts`: finish(opts?), discard(), openPrompt(props)
 * returning { close }, gymOn() (the gym reminder set up here), noteUse(wid) for the watches,
 * readLeft() → the native side's last gym leave { at } or null, onLeft(cb) → stop.
 */
export function startForgotten({ useStore, useUI, ...rest }) {
  if (!MOBILE) return () => {}
  deps = { useStore, useUI, gymOn: () => false, ...rest }
  let lastId = useStore.getState().S?.active?.id || null
  const tick = () => {
    clearTimeout(timer)
    const run = !!useStore.getState().S?.active
    if (run) timer = setTimeout(() => { checkForgotten(); tick() }, CHECK_MS)
  }
  const readLeft = async () => {
    try { const r = await deps.readLeft?.(); if (r?.at) noteLeftGym(Number(r.at), r.answer) } catch { /* no gym reminder here */ }
  }
  const offStore = useStore.subscribe((s, prev) => {
    if (s.S === prev.S) return
    const id = s.S?.active?.id || null
    // Another workout (or none): this one's question and leave are not its business.
    if (id !== lastId) { lastId = id; hide(); if (!id) writeForgottenState(null) }
    // Something changed in the workout (a set): the planned question moves, a shown card goes.
    if (id && s.S.active !== prev.S?.active) checkForgotten()
    else if (!id) checkForgotten()
    tick()
  })
  const onVisible = () => { if (document.visibilityState === 'visible') { readLeft(); checkForgotten(); tick() } }
  document.addEventListener('visibilitychange', onVisible)
  let offLeft = () => {}
  try { offLeft = deps.onLeft?.((at, answer) => noteLeftGym(at, answer)) || (() => {}) } catch { /* none */ }
  // The notification's buttons (and a tap on it, which just opens the app on the card).
  let handle = null
  let gone = false
  ln().then(x => x?.L && Promise.resolve(x.L.addListener('localNotificationActionPerformed', e => {
    const n = e?.notification
    const ours = n?.id === ASK_NOTIFICATION_ID || n?.id === LEFT_NOTIFICATION_ID || n?.extra?.forgotten
    if (!ours) return
    if (e.actionId === 'keep') keepGoing()
    else if (e.actionId === 'finish') finishFromPrompt()
    else checkForgotten()
  })).then(h => { if (gone) h?.remove?.(); else handle = h })).catch(() => {})
  readLeft()
  checkForgotten()
  tick()
  return () => {
    gone = true
    clearTimeout(timer)
    offStore(); offLeft()
    document.removeEventListener('visibilitychange', onVisible)
    try { handle?.remove?.() } catch { /* gone */ }
    hide()
    deps = null
  }
}

/** For the tests. */
export function _resetForgottenPhone() { deps = null; shown = null; planned = ''; actionsRegistered = false; clearTimeout(timer) }
