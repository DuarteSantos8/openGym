import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { chime, countdown, holdSession, hush, restOver, vibrate } from '../lib/sound.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { deviceId } from '../lib/push.js'
import { MOBILE } from '../lib/mobile.js'
import { armRestAlert, bindNativeRest, disarmRestAlert, holdRestAlert } from '../lib/rest-alert.js'
import { useStore } from './useStore.js'

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline. The device id keeps the
// timer this browser's own: a desktop tab finishing its rest on screen used to cancel the
// alert the phone in the gym was waiting for, because the server held one timer per account.
const pushRestTimer = sec => { if (useStore.getState().user) api('/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ seconds: sec, deviceId: deviceId() }) }).catch(() => {}) }
const cancelPushRestTimer = () => { if (useStore.getState().user) api('/api/push/rest-timer/cancel', { method: 'POST', body: JSON.stringify({ deviceId: deviceId() }) }).catch(() => {}) }

// Books the end of a rest with whatever can announce it while the app is not looking: in the
// Android app a native alarm and the countdown notification, everywhere else (and wherever that
// alarm could not be set) the server's push. The web build books the push at once, as before.
const bookRestEnd = (endsAt, totalSec) => {
  if (!MOBILE) { pushRestTimer(Math.max(1, Math.round((endsAt - Date.now()) / 1000))); return }
  const { S } = useStore.getState()
  armRestAlert(endsAt, { title: t('Rest over — next set!'), countdownTitle: t('Rest'), totalSec, accent: S.accent, sound: !!S.sound, vibrate: S.vibrate !== false })
    .then(ok => {
      // Only for the rest that asked: one skipped or moved since then has booked its own end.
      const tm = useUI.getState().timer
      if (!ok && tm && !tm.paused && !tm.ready && tm.endsAt === endsAt) pushRestTimer(Math.max(1, Math.round((endsAt - Date.now()) / 1000)))
    })
}

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window

// Set the moment the tab goes hidden, never cleared here — timerTick/workTick read and
// clear it themselves once they're running visible again. Lets a completion tick tell
// "the countdown hit zero while the app was actually open" from "it hit zero while
// backgrounded/closed and we're only just catching up now that it's open again" — the
// latter must skip beep/vibrate/flash and rely on the alert armed when the rest started
// (a native alarm on the mobile build, Web Push on the web build). The toast still shows
// on reopen so a countdown that vanished does not look like a bug.
let pageHiddenAt = null
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) pageHiddenAt = Date.now() })
}

// The Push switch in Settings is the one place notifications are turned on, and "on" means this
// browser holds a push subscription. This local alert used to ignore it: every rest asked for the
// permission by itself, and once granted — a page cannot hand a permission back — it fired with the
// switch off (issue #239). Off is off now; the permission is only ever asked for by the switch.
const restAlertsOn = async reg => {
  if (Notification.permission !== 'granted') return false
  try { return !!(await reg?.pushManager?.getSubscription?.()) } catch { return false }
}

const maybeRestNotification = async () => {
  if (!notificationsSupported()) return
  if (!document.hidden && document.visibilityState !== 'hidden') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (!(await restAlertsOn(reg))) return
    // Same tag as the server's push (api/push-messages.js): whichever lands second replaces the
    // first instead of stacking a second banner. No body — it only repeated the title.
    // Android Chrome forbids the Notification constructor (Illegal constructor) - the
    // service-worker registration path is the one that actually pops there.
    const opts = { tag: 'rest-timer', icon: 'icon-512.png' }
    if (reg?.showNotification) { reg.showNotification(t('Rest over — next set!'), opts); return }
    new Notification(t('Rest over — next set!'), opts)
  } catch {
    // Intentionally ignore: notification APIs vary by browser and policy in edge cases.
  }
}

let toastTm = null
let timerInt = null
let timerTick = null
// What a rest hands over to when it is over (a timed exercise's next hold, Workout.startTimed).
// Fires when the rest runs out on screen or is skipped — never when it ran out while the app
// was hidden (a hold nobody watched start would still be logged), never on a plain stopRest().
let restDone = null
let workInt = null
let workTick = null
let workDone = null
const MAX_WORK_OVERTIME_SEC = 15 * 60

const stopRestTicking = () => {
  if (timerInt) clearInterval(timerInt); timerInt = null
  if (timerTick) document.removeEventListener('visibilitychange', timerTick); timerTick = null
}
// The rest countdown's tick, from a start or from a resume: the same endsAt-based count either
// way, so a paused rest carries on exactly as a started one runs.
const runRest = (set, get) => {
  stopRestTicking()
  timerTick = () => {
    const tm = get().timer
    if (!tm || tm.ready || tm.paused) return
    const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000))
    const seenLive = !document.hidden && pageHiddenAt === null
    if (!document.hidden) pageHiddenAt = null
    // Back on screen after a lock or an app switch. The queued countdown froze with the audio
    // clock while the page was away, so it would now tick late; queue it again against the
    // time that is really left. Fires once, on the first tick back.
    if (!seenLive && !document.hidden && left > 0) countdown(useStore.getState().S.sound, left)
    if (left === tm.left) return
    const snd = useStore.getState().S.sound
    if (left <= 0) {
      if (seenLive) {
        // The Android alarm for this end stays quiet while the app is on screen, so this sound is
        // the only one. Locked, this branch never runs and the alarm's tone does.
        restOver(snd, tm.kind)
        vibrate([200, 100, 200]); get().flashTimer()
      }
      // The toast stays even when the rest ran out while the app was hidden: a guest, or anyone
      // without push permission, gets no notification, and a countdown that silently vanishes
      // on reopen reads like a bug. Only the loud parts (beep, vibration, flash) are gated.
      // The native alarm is left armed: this tick can come a little early, and with the screen
      // locked it never runs at all.
      get().toast(t('Rest over — next set!'))
      if (!MOBILE) maybeRestNotification()
      // The hand-over, once: the rest stays on Ready below, and Dismiss has nothing left to hand
      // over. It is told whether the countdown actually ran out on screen: a rest that expired in
      // your pocket must not start a hold nobody watched, but moving the screen on to the next
      // exercise is exactly what you want waiting for you when you unlock the phone.
      const done = restDone
      restDone = null
      cancelPushRestTimer()
      stopRestTicking()
      hush()               // nothing left to count, so the volume buttons can go back to the ringer
      holdSession(false)
      set({ timer: { ...tm, left: 0, ready: true } })
      // After Ready is set, so a hold the hand-over starts replaces it (startWork stops the rest).
      // It gets the rest's owner as it is now, not as it was when the rest started: an exercise
      // added, removed or moved above it re-pointed forIdx along the way.
      if (done) done(tm.forIdx, seenLive)
      return
    }
    set({ timer: { ...tm, left } })
  }
  timerInt = setInterval(timerTick, 1000)
  document.addEventListener('visibilitychange', timerTick)
}

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked }
  toastMsg: '',
  timer: null,         // rest countdown between sets — { left, total, endsAt, forIdx, kind, ready?, paused? }
                       // forIdx: index of the active entry whose set started the rest (undefined when unknown)
                       // kind: which rest-over sound plays — 'set' | 'round' | 'block' (supersetFlow.restKind)
                       // phase: the set a 'set' rest leads into — 'warmup' | 'work' | null (supersetFlow.restSetPhase)
                       // paused: held at `left`; `endsAt` means nothing until resumeRest sets it again
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label, overtime?, set, forIdx }
                       // set: { phase: 'warmup' | 'work', n, of } — which hold of the exercise (workout-model.holdPosition)
                       // forIdx: index of the active entry being held (undefined when unknown); kept current like the rest's
  timerFlashId: 0,     // changing the id retriggers the theme-blink visual alert

  flashTimer() {
    if (!useStore.getState().S.timerFlash) return
    set(s => ({ timerFlashId: s.timerFlashId + 1 }))
  },

  openSheet(render, { kind = 'sheet', locked = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { set({ sheets: [] }) },

  toast(msg) {
    set({ toastMsg: msg })
    clearTimeout(toastTm)
    toastTm = setTimeout(() => set({ toastMsg: '' }), 2200)
  },

  startRest(sec, forIdx, kind, phase, onDone) {
    get().stopRest()
    // Rest timer set to Off. Stopping and returning rather than starting a zero-length timer
    // keeps every caller honest: the four places that start a rest do not each need to know.
    // Off also drops onDone: a hand-over rides on the rest, so with no rest the next hold waits
    // for a tap like any other.
    if (!(sec > 0)) return
    // And the hold, the other way round from startWork: the two must never run together (see the
    // work timer below). A set ticked by hand while its hold ran used to leave both going — the
    // rest bar with its Skip and ±15 s hidden behind the hold bar, and then the hold reaching
    // zero under a rest that was still counting down, beeping its own end and logging the full
    // target for a set nobody was holding any more. Below the guard, not above it: a rest that
    // does not start has nothing to run alongside the hold, and taking the hold down for it
    // would throw away a plank in progress for nothing. What it held is kept either way —
    // abandonWork, not stopWork.
    get().abandonWork()
    // Nothing clears pageHiddenAt but a tick, so an app switch with no timer running left it set
    // for good. The next timer's first tick then read it as "this countdown ran out while the app
    // was away" and finished in silence — a one-second rest, started on screen, over on screen,
    // with no beep, no vibration and no flash. Each timer starts from where the page is now.
    pageHiddenAt = document.hidden ? Date.now() : null
    restDone = typeof onDone === 'function' ? onDone : null
    const endsAt = Date.now() + sec * 1000
    set({ timer: { left: sec, total: sec, endsAt, forIdx, kind, phase } })
    // The last seconds are queued now, inside the tap that finished the set, rather than beeped
    // by the ticks below — the ticks stop running when the phone goes in a pocket (lib/sound.js
    // countdown). Every exit from this timer calls stopRest, which calls them off; a pause calls
    // them off too and a resume queues them again (pauseRest, resumeRest).
    countdown(useStore.getState().S.sound, sec)
    holdSession(true)      // so the phone's volume buttons reach the timer, not the ringer
    bookRestEnd(endsAt, sec)
    runRest(set, get)
  },
  // Holding the rest where it is — a longer break than planned, a machine to wait for, a phone
  // call (#193). Paused time does not count: the countdown stops, and so does everything that
  // would announce its end — the server's push and the alert this tab shows are cancelled, not
  // left to fire at the old time, and the Android notification stops its clock at the same time
  // with its alarm called off. The timed hold is a different timer and is not touched.
  pauseRest() {
    const tm = get().timer
    if (!tm || tm.ready || tm.paused) return
    stopRestTicking()
    cancelPushRestTimer()
    // The count-in queued for the old end would tick on through the pause; and a held rest has no
    // tone to reach with the volume buttons, so the audio session goes back too.
    hush()
    holdSession(false)
    const left = Math.max(1, Math.round((tm.endsAt - Date.now()) / 1000))
    holdRestAlert(left, tm.total)
    set({ timer: { ...tm, left, paused: true } })
  },
  // Carrying on from where the pause held it: the end moves out by however long the pause was,
  // and the push that announces it is booked again for the new time.
  resumeRest() {
    const tm = get().timer
    if (!tm?.paused) return
    const { paused, ...rest } = tm
    // As in startRest: the page may have been hidden and shown while paused, and that is no
    // catch-up of a countdown that was not running.
    pageHiddenAt = document.hidden ? Date.now() : null
    const endsAt = Date.now() + tm.left * 1000
    set({ timer: { ...rest, endsAt } })
    countdown(useStore.getState().S.sound, tm.left)
    holdSession(true)
    bookRestEnd(endsAt, tm.total)
    runRest(set, get)
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm) return
    if (tm.ready) { if (sec > 0) get().startRest(sec, tm.forIdx, tm.kind, tm.phase); else get().stopRest(); return }
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().skipRest(); return }
    // Paused, there is no end to move and nothing booked on the server: the time is simply held,
    // and the notification holds the new figure.
    if (tm.paused) { set({ timer: { ...tm, left, total: tm.total + sec } }); holdRestAlert(left, tm.total + sec); return }
    const endsAt = tm.endsAt + sec * 1000
    set({ timer: { ...tm, left, total: tm.total + sec, endsAt } })
    bookRestEnd(endsAt, tm.total + sec)
    countdown(useStore.getState().S.sound, left)   // the end moved; so do the last five seconds
  },
  // The active list changed shape (an exercise removed or inserted at `at`): keep the rest
  // pointing at the same exercise. Returns nothing; the caller decides whether to stop instead.
  shiftRestOwner(at, delta) {
    const tm = get().timer
    if (tm && tm.forIdx >= at) set({ timer: { ...tm, forIdx: tm.forIdx + delta } })
    const wk = get().work
    if (wk && wk.forIdx >= at) set({ work: { ...wk, forIdx: wk.forIdx + delta } })
  },
  // Android: the rest notification's own Pause, −15 s and +15 s (#296) change the countdown there
  // first, and this brings the bar in the app to the same place — a pause stops the ticking here
  // too, a resume starts it again from the notification's end, and +15 s on a rest the app had
  // already called Ready opens it again. Nothing is sent back: the notification already shows it.
  followNativeRest({ endsAt, left, total, paused }) {
    const tm = get().timer
    const forIdx = tm?.forIdx
    const kind = tm?.kind
    const phase = tm?.phase
    if (paused) {
      stopRestTicking()
      hush()
      holdSession(false)
      set({ timer: { left, total, endsAt, forIdx, kind, phase, paused: true } })
      return
    }
    const ticking = !!timerInt && !!tm && !tm.paused && !tm.ready
    set({ timer: { left, total, endsAt, forIdx, kind, phase } })
    countdown(useStore.getState().S.sound, left)   // against the notification's end, as addRest does
    holdSession(true)
    if (ticking) return
    // As in resumeRest: a hide from while it was held or over is no catch-up of this countdown.
    pageHiddenAt = document.hidden ? Date.now() : null
    runRest(set, get)
  },
  // "I'm ready now": the rest is over early, and whatever it was going to hand over to happens
  // now. The Skip button and −15 s past zero come here; everything else that ends a rest (a new
  // rest, a hold starting, an exercise removed, the workout discarded) uses stopRest. Dismiss on
  // Ready comes here too, with nothing left to hand over: the end already did that.
  skipRest() {
    const done = restDone
    const at = get().timer?.forIdx
    get().stopRest()
    if (done) done(at, true)             // you are looking at it — you tapped Skip
  },
  // Sounds or the volume changed in Settings while a timer runs: the countdown for this timer
  // was queued at its loudness, seconds ago, so re-queue it at the new one. Without this a
  // change made mid-rest — which is exactly when you make it, because that is when you heard
  // the timer — would not be audible until the next rest.
  restartCountdown() {
    // A paused rest has no count-in queued (pauseRest called it off) and must not get one: it
    // would tick a frozen clock down to nothing. Resuming queues it again at the level set now.
    const tm = get().timer
    const left = tm ? (tm.paused ? null : tm.left) : get().work?.left
    if (left != null) countdown(useStore.getState().S.sound, left)
  },
  stopRest() {
    restDone = null
    hush()
    holdSession(false)
    stopRestTicking()
    // Skip, Dismiss, a rest replacing this one and "rest off" all take the native alarm and
    // its notifications down with it, or the alert fires after the user already moved on.
    disarmRestAlert()
    if (get().timer) cancelPushRestTimer()
    set({ timer: null })
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec, { chimed, abandoned, forIdx })` is called both when the countdown reaches
     zero and on an early finish; the elapsed time is what actually gets logged, so stopping at
     0:38 of a 0:45 hold records 0:38 rather than crediting the full target. `chimed` is true when
     the countdown ran out in front of you and the end chime and buzz have just played; `abandoned`
     when a rest displaced the hold (abandonWork). `forIdx` is the held entry's index as it is
     then — an exercise added above it during the hold moved it (shiftRestOwner). */
  startWork(sec, label, onDone, setInfo, forIdx) {
    get().abandonWork()   // a hold this one replaces keeps what it held, same as a rest replacing one
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    pageHiddenAt = document.hidden ? Date.now() : null   // see startRest: a stale hide is not a catch-up
    set({ work: { left: total, total, endsAt, label, overtime: useStore.getState().S.timedSetOvertime === true, set: setInfo || null, forIdx } })
    countdown(useStore.getState().S.sound, total)
    holdSession(true)
    workTick = () => {
      const wk = get().work
      if (!wk) return
      const left = Math.max(wk.overtime ? -MAX_WORK_OVERTIME_SEC : 0, Math.round((wk.endsAt - Date.now()) / 1000))
      const seenLive = !document.hidden && pageHiddenAt === null
      if (!document.hidden) pageHiddenAt = null
      // Back on screen after a lock or an app switch. The queued countdown froze with the audio
      // clock while the page was away, so it would now tick late; queue it again against the
      // time that is really left. Fires once, on the first tick back.
      if (!seenLive && !document.hidden && left > 0) countdown(useStore.getState().S.sound, left)
      if (left === wk.left) return
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        if (seenLive && !wk.alerted) {
          chime(snd)
          vibrate([200, 100, 200]); get().flashTimer()
        }
        if (wk.overtime && left > -MAX_WORK_OVERTIME_SEC) { set({ work: { ...wk, left, alerted: true } }); return }
        const done = workDone
        get().stopWork()
        // `chimed` tells the set's own tick that this end has already sounded and buzzed — not
        // so when overtime ran out, whose end chime played when the target was reached.
        if (done) done(wk.total - left, { chimed: seenLive && !wk.alerted, forIdx: wk.forIdx })
        return
      }
      set({ work: { ...wk, left } })
    }
    workInt = setInterval(workTick, 1000)
    document.addEventListener('visibilitychange', workTick)
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const startedAt = wk.endsAt - wk.total * 1000
    const elapsed = Math.max(1, Math.min(wk.total + (wk.overtime ? MAX_WORK_OVERTIME_SEC : 0), Math.round((Date.now() - startedAt) / 1000)))
    const done = workDone
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed, { forIdx: wk.forIdx })
  },
  // A rest is starting while a hold runs that is not the one being ticked — a set finished on
  // another row, or on another exercise, which the List layout puts one tap away. The hold cannot
  // survive (the two must never run together) but the time it held is real, so it is handed back
  // before it goes and its own row keeps it. The `abandoned` flag tells the owner this was not a
  // finish: the row is not ticked off and earns no rest of its own, since the rest that displaced
  // the hold is the one now running.
  abandonWork() {
    const wk = get().work
    if (!wk) { get().stopWork(); return }
    const elapsed = wk.total - wk.left
    const done = workDone
    get().stopWork()
    // Under two seconds there is nothing to keep: that is a play button tapped by accident, or
    // tapped and thought better of, and rounding it up to one second the way an early finish does
    // would write a one-second plank over a real plan. (finishWorkEarly's Math.max(1, …) is right
    // for what it is: you pressed Done, so you held it, however briefly.)
    if (done && elapsed >= 2) done(elapsed, { abandoned: true, forIdx: wk.forIdx })
  },
  // Abandon without logging anything.
  stopWork() {
    hush()
    holdSession(false)
    if (workInt) clearInterval(workInt); workInt = null
    if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
    workDone = null
    set({ work: null })
  }
}))

// Buttons on the rest notification (pause, ±15s, skip) change the countdown in the
// service first, then mirror that into the in-app timer. skip ends it. Seconds round up, as the
// notification's clock does, so a pause in the last half second still holds a second here.
bindNativeRest(ev => {
  if (!ev) return
  if (ev.type === 'skip') { useUI.getState().stopRest(); return }
  const left = Math.ceil((ev.leftMs || 0) / 1000)
  if (!(left > 0)) return
  const total = Math.max(left, Math.round((ev.totalMs || 0) / 1000))
  useUI.getState().followNativeRest({ endsAt: ev.endsAt, left, total, paused: !!ev.paused })
})
