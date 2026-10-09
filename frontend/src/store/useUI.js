import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { chime, countdown, holdSession, hush, vibrate, alertBuzz } from '../lib/sound.js'
import { restSoundOf, restSoundFor, REST_KINDS } from '../lib/rest-sounds.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { deviceId } from '../lib/push.js'
import { MOBILE } from '../lib/mobile.js'
import { armRestAlert, bindNativeRest, disarmRestAlert, holdRestAlert } from '../lib/rest-alert.js'
import { useStore } from './useStore.js'
import { REST_MAX } from '../lib/duration.js'
import { accentValue } from '../lib/accent.js'

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline. The device id keeps the
// timer this browser's own: a desktop tab finishing its rest on screen used to cancel the
// alert the phone in the gym was waiting for, because the server held one timer per account.
const pushRestTimer = sec => { if (useStore.getState().user) api('/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ seconds: sec, deviceId: deviceId() }) }).catch(() => {}) }
const cancelPushRestTimer = () => { if (useStore.getState().user) api('/api/push/rest-timer/cancel', { method: 'POST', body: JSON.stringify({ deviceId: deviceId() }) }).catch(() => {}) }

// Books the end of a rest with whatever can announce it while the app is not looking: in the
// Android app a native alarm and the countdown notification, everywhere else (and wherever that
// alarm could not be set) the server's push. The web build books the push at once, as before.
// A switch-sides pause (Workout.jsx SWITCH_SIDES_SEC) books no server push, whose words are "rest over":
// it is ten seconds between the two sides of a hold, and the app is in your hand.
// The alarm plays the sound this kind of rest ends with (restSoundFor), the same one the page
// plays when the app is on screen; RestTone.java renders every REST_SOUNDS id by name.
const bookRestEnd = (endsAt, totalSec, kind) => {
  const switching = kind === 'switch'
  if (!MOBILE) { if (!switching) pushRestTimer(Math.max(1, Math.round((endsAt - Date.now()) / 1000))); return }
  const { S } = useStore.getState()
  const tone = restSoundFor(S, kind)
  armRestAlert(endsAt, { title: switching ? t('Switch sides') : t('Rest’s over. Next set!'), countdownTitle: switching ? t('Switch sides') : t('Rest'), totalSec, accent: accentValue(S), sound: !!S.sound, classic: tone === 'classic', tone, vibrate: S.vibrate !== false, alarmBuzz: S.vibrate !== false && !!S.vibrateOnSilent })
    .then(ok => {
      // Only for the rest that asked: one skipped or moved since then has booked its own end.
      const tm = useUI.getState().timer
      if (!ok && !switching && tm && !tm.paused && !tm.ready && tm.endsAt === endsAt) pushRestTimer(Math.max(1, Math.round((endsAt - Date.now()) / 1000)))
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
    // Android Chrome forbids the Notification constructor (Illegal constructor) - the
    // service-worker registration path is the one that actually pops there.
    // Same tag as the server's rest-timer push (api/push-messages.js): whichever lands second
    // replaces the first instead of stacking a second banner, and one already in the tray is
    // closed by hand first, the way sw.js does. No body — it only repeated the title.
    const tag = 'rest-timer'
    const opts = { tag, icon: 'icon-512.png', renotify: true }
    if (reg?.showNotification) {
      try { for (const n of await reg.getNotifications?.({ tag }) || []) n.close() } catch { /* */ }
      reg.showNotification(t('Rest’s over. Next set!'), opts)
      return
    }
    new Notification(t('Rest’s over. Next set!'), opts)
  } catch {
    // Intentionally ignore: notification APIs vary by browser and policy in edge cases.
  }
}

let toastTm = null
const TOAST_MS = 2200
const TOAST_ACTION_MS = 5000
let toastLeft = 0
let toastT0 = 0
let toastPaused = false
let toastSeq = 0
const runToast = set => {
  toastPaused = false
  toastT0 = Date.now()
  clearTimeout(toastTm)
  toastTm = setTimeout(() => set({ toastMsg: '', toastAction: null }), toastLeft)
}
let timerInt = null
let timerTick = null
// Whether the running rest has already had its end on a hidden page (see runRest): the audio
// session let go and, for a guest, the "rest over". Reset by startRest, and by the notification's
// own buttons bringing a rest back to life (followNativeRest); a flag rather than a key on endsAt,
// which ±15 s moves.
let hiddenOver = false
// The kinds a rest can carry: the switch-sides pause, and what a rest after a set leads into.
const knownKind = kind => kind === 'switch' || REST_KINDS.includes(kind)
const knownPhase = phase => phase === 'warmup' || phase === 'work'
let workInt = null
let workTick = null
// The same for the running hold (see runWork): its audio session already let go on a hidden page.
// Reset by runWork, which every start and restore of a hold goes through.
let workHiddenOver = false
let workDone = null
// The audio session is held for the length of a timer (lib/sound.js holdSession) only while Sounds
// is on: with nothing to play, holding it would still keep the phone's music paused under "Play
// even on silent", and the volume buttons on a channel that stays quiet.
const holdAudio = () => { if (useStore.getState().S.sound) holdSession(true) }
const MAX_WORK_OVERTIME_SEC = 15 * 60
// The seconds really left until `endsAt`, fractions included: what a count-in queued now is timed
// against (lib/sound.js countdown). A timer's `left` is the last whole second the tick shows.
const secsTo = (endsAt, now = Date.now()) => Math.max(0, (endsAt - now) / 1000)

// The hold's countdown tick, from a start or from a restore after a reload.
const runWork = (set, get) => {
  stopWorkTicking()
  workHiddenOver = false
  workTick = () => {
    const wk = get().work
    if (!wk) return
    const left = Math.max(wk.overtime ? -MAX_WORK_OVERTIME_SEC : 0, Math.round((wk.endsAt - Date.now()) / 1000))
    // A hidden page changes nothing on screen (see runRest). A hold has no push to fall back on
    // and nothing to alert: it finishes, and logs its full length, on the tick that runs when the
    // page is back. Its audio session goes when it runs out, as a rest's does: nothing is left to
    // count, its end only sounds on screen, and held on it kept the phone's music paused (under
    // 'playback') for as long as the phone stayed in the pocket. Once.
    if (document.hidden) {
      if (left <= 0 && !workHiddenOver) {
        workHiddenOver = true
        hush()
        holdSession(false)
      }
      return
    }
    const seenLive = pageHiddenAt === null
    pageHiddenAt = null
    // Back on screen after a lock or an app switch. The count-in queued at the start froze with
    // the audio clock while the page was away, so it would now tick late: queue it again against
    // the time that is really left. Once, on the first tick back.
    if (!seenLive && left > 0) countdown(useStore.getState().S.sound, secsTo(wk.endsAt))
    if (left === wk.left) return
    const { S: st } = useStore.getState()
    const snd = st.sound, endSound = restSoundOf(st)
    if (left <= 0) {
      if (seenLive && !wk.alerted) {
        chime(snd, endSound)
        alertBuzz([200, 100, 200]); get().flashTimer()
      }
      if (wk.overtime && left > -MAX_WORK_OVERTIME_SEC) {
        // Counting on past the target: its end has sounded and nothing more will, so the audio
        // session goes now, as it does for a hold that ends here (and as the hidden page does).
        if (!wk.alerted) { hush(); holdSession(false) }
        set({ work: { ...wk, left, alerted: true } })
        return
      }
      const done = workDone || ownerDone(wk)
      get().stopWork()
      // `chimed` tells the set's own tick that this end has already sounded and buzzed — not
      // so when overtime ran out, whose end chime played when the target was reached.
      // `endedAt`, only for an end nobody saw: when it really was, so the rest it earned can have
      // been counting since (startRest's `since`) rather than start in full now the page is back.
      if (done) done(wk.total - left, { chimed: seenLive && !wk.alerted, ...(seenLive ? {} : { endedAt: wk.endsAt - left * 1000 }) })
      return
    }
    set({ work: { ...wk, left } })
  }
  workInt = setInterval(workTick, 1000)
  document.addEventListener('visibilitychange', workTick)
}
const stopWorkTicking = () => {
  if (workInt) clearInterval(workInt); workInt = null
  if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
}
// The set a hold belongs to, while it still is that one: the same exercise at that place in the
// running workout, not ticked off yet.
const ownerSet = o => {
  const e = useStore.getState().S?.active?.entries?.[o?.idx]
  const st = e && e.id === o.id ? e.sets?.[o.i] : null
  return st && !st.done ? st : null
}
// A restored hold that ends before the workout screen is back to bind its handler: the time still
// goes to its set, and a hold that ran out (or got its Done) ticks the set off. No rest follows:
// that is the workout screen's to start, and the hold mostly ended while the app was away.
const ownerDone = wk => !wk?.owner ? null : (elapsed, { abandoned = false } = {}) => {
  if (!ownerSet(wk.owner)) return
  const { idx, i } = wk.owner
  useStore.getState().update(s => {
    const st = s.active.entries[idx].sets[i]
    st.sec = elapsed
    if (abandoned) { if (st.planSec == null) st.planSec = wk.total; return }
    delete st.planSec
    if (st.sides) return   // a per-side row is ticked side by side, on the workout screen
    st.done = true
    st.at = Date.now()
  }, true)
}
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
    // A hidden page changes nothing on screen. With the audio session held for the whole rest
    // (holdSession) the page keeps running while the phone is locked or the app is switched away,
    // where it used to be frozen, and this tick started arriving there: a re-render every second,
    // and at zero the toast and a local notification, all done to a screen nobody is looking at.
    // That doubled the "rest over" alert (this one plus the server push), and iOS was left with a
    // page laid out while it was not showing it: on return the tab bar and the timer bar sat where
    // the page had been, scrolling with it. So a hidden tick leaves everything to the tick that
    // visibilitychange fires when the page is back, exactly what a frozen page did. The one thing a
    // hidden page owes is the alert, and a signed-in device already gets it from the push
    // pushRestTimer booked. For a guest the local notification stands in, once per rest since the
    // interval keeps calling, and only where this browser still holds a push subscription
    // (restAlertsOn). The Android app has its own alarm for this (bookRestEnd).
    // The audio session is not on screen either, and it goes at the end: held on, it kept the
    // volume buttons on a timer with nothing left to count and, under 'playback', the phone's music
    // paused for as long as the phone stayed in the pocket. Once, like the alert.
    if (document.hidden) {
      if (left <= 0 && !hiddenOver) {
        hiddenOver = true
        hush()
        holdSession(false)
        if (!MOBILE && !useStore.getState().user) maybeRestNotification()
      }
      return
    }
    const seenLive = pageHiddenAt === null
    pageHiddenAt = null
    // Back on screen: queue the count-in again against the time really left, as runWork does.
    if (!seenLive && left > 0) countdown(useStore.getState().S.sound, secsTo(tm.endsAt))
    if (left === tm.left) return
    const { S: st } = useStore.getState()
    const snd = st.sound, endSound = restSoundOf(st)
    if (left <= 0 && tm.kind === 'switch') {
      // Over like a hold is: the chime and its buzz, then the bar goes. No "Ready", no toast:
      // the other side is the next thing, one tap away.
      if (seenLive) { chime(snd, endSound); alertBuzz([200, 100, 200]); get().flashTimer() }
      stopRestTicking()
      hush()
      holdSession(false)
      set({ timer: null })
      return
    }
    if (left <= 0) {
      if (seenLive) {
        // The Android alarm for this end stays quiet while the app is on screen, so this chime is
        // the only one. Locked, this branch never runs and the alarm's tone does. The sound is the
        // one this kind of rest ends with (timer.kind), the profile's own unless Settings → Sound
        // gives that kind one of its own.
        chime(snd, restSoundFor(st, tm.kind))
        alertBuzz([200, 100, 200]); get().flashTimer()
      }
      // The toast stays even when the rest ran out while the app was hidden: a guest, or anyone
      // without push permission, gets no notification, and a countdown that silently vanishes
      // on reopen reads like a bug. Only the loud parts (beep, vibration, flash) are gated.
      // The native alarm is left armed: this tick can come a little early, and with the screen
      // locked it never runs at all.
      get().toast(t('Rest’s over. Next set!'))
      cancelPushRestTimer()
      stopRestTicking()
      hush()
      holdSession(false)     // nothing left to count, so the volume buttons can go back to the ringer
      set({ timer: { ...tm, left: 0, ready: true } })
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
  toastAction: null,   // { label, run, id } while the toast offers an action (Undo)
  swipeHint: null,     // { idx, i, id }: the set row showing the one-time swipe hint (Workout.jsx)
  setFlash: null,      // { idx, i, id }: the set row a copy or an undo just brought, flashed once
  timer: null,         // rest countdown between sets — { left, total, endsAt, forIdx, ready?, paused?, kind? }
                       // kind: 'switch' for the short pause between the two sides of a timed set;
                       //   otherwise what the rest leads into, 'set' | 'round' | 'block'
                       //   (supersetFlow.restKind), which picks the sound it ends with
                       // phase: 'warmup' when the set a rest leads into is a warm-up (ramp) set, else
                       //   'work', on an exercise that has warm-up rows (supersetFlow.restSetPhase);
                       //   the bar then says "Warm-up" instead of "Set"
                       // forIdx: index of the active entry whose set started the rest (undefined when unknown)
                       // forSet: index of that set in the entry's rows, so removing the set stops its rest
                       // paused: held at `left`; `endsAt` means nothing until resumeRest sets it again
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label, overtime? }
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

  // A toast is 2.2 s of text. With an action (`{ action: 'Undo', onAction }`) it stays 5 s, shows
  // the action as a button at its end and holds still while a finger rests on it (pauseToast). A
  // new toast replaces the one showing, action and all: the old Undo is gone, what it would have
  // undone stays done. The action runs once at most, and the toast goes with it.
  toast(msg, { action, onAction, ms } = {}) {
    const withAction = !!(action && typeof onAction === 'function')
    clearTimeout(toastTm)
    toastLeft = ms || (withAction ? TOAST_ACTION_MS : TOAST_MS)
    toastSeq += 1
    set({ toastMsg: msg, toastAction: withAction ? { label: action, run: onAction, id: toastSeq } : null })
    runToast(set)
  },
  runToastAction() {
    const act = get().toastAction
    if (!act) return
    clearTimeout(toastTm)
    set({ toastMsg: '', toastAction: null })
    act.run()
  },
  pauseToast() {
    if (!get().toastAction || toastPaused) return
    toastPaused = true
    clearTimeout(toastTm)
    toastLeft = Math.max(400, toastLeft - (Date.now() - toastT0))
  },
  resumeToast() {
    if (!toastPaused) return
    toastPaused = false
    if (get().toastMsg) runToast(set)
  },

  startRest(sec, forIdx, { kind, forSet, phase, since } = {}) {
    get().stopRest()
    // Rest timer set to Off. Stopping and returning rather than starting a zero-length timer
    // keeps every caller honest: the four places that start a rest do not each need to know.
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
    hiddenOver = false
    // `since`: when the rest really began, if that was while the page was away: the end of a hold
    // that ran out hidden, which is only finished on the first tick back (runWork's `endedAt`).
    // That rest has been counting all along (owner's call). So it is started as one that began
    // then, on a page that was away, and this is its first tick back: what is left is counted in
    // and booked as for any rest, and one that is over too ends here the way a rest that ran out
    // unseen does (Ready and its toast; a switch-sides pause just goes), with nothing counted in or
    // booked for an end that has passed.
    const late = since != null && since < Date.now()
    if (late) pageHiddenAt = since
    const endsAt = (late ? since : Date.now()) + sec * 1000
    set({ timer: { left: sec, total: sec, endsAt, forIdx, ...(forSet != null ? { forSet } : {}), ...(knownKind(kind) ? { kind } : {}), ...(knownPhase(phase) ? { phase } : {}) } })
    if (late) {
      if (Math.round((endsAt - Date.now()) / 1000) > 0) { holdAudio(); bookRestEnd(endsAt, sec, kind) }
      runRest(set, get)
      timerTick()
      return
    }
    // The last seconds are queued now, inside the tap that finished the set, rather than beeped by
    // the ticks below: those stop running once the phone goes in a pocket (lib/sound.js countdown).
    // Every exit from this timer goes through stopRest, which calls them off; a pause does too, and
    // a resume queues them again. The switch-sides pause counts you in like any rest.
    countdown(useStore.getState().S.sound, sec)
    holdAudio()            // so the phone's volume buttons reach the timer, not the ringer
    bookRestEnd(endsAt, sec, kind)
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
    // The count-in queued for the old end would tick on through the pause, and a held rest has
    // nothing to reach with the volume buttons, so the audio session goes back too.
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
    hiddenOver = false
    countdown(useStore.getState().S.sound, tm.left)
    holdAudio()
    bookRestEnd(endsAt, tm.total, tm.kind)
    runRest(set, get)
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm) return
    // A fresh rest from Ready keeps what the old one led into: the sound it ends with, and the bar's word.
    if (tm.ready) { if (sec > 0) get().startRest(Math.min(sec, REST_MAX), tm.forIdx, { forSet: tm.forSet, kind: tm.kind, phase: tm.phase }); else get().stopRest(); return }
    // +15 s stops where the wheel does (15:00), so the two never disagree about a rest's length.
    if (sec > 0) sec = Math.min(sec, Math.max(0, REST_MAX - tm.left))
    if (!sec) return
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    const total = Math.max(tm.total || left, left)
    // Paused, there is no end to move and nothing booked on the server: the time is simply held,
    // and the notification holds the new figure.
    if (tm.paused) { set({ timer: { ...tm, left, total } }); holdRestAlert(left, total); return }
    const endsAt = tm.endsAt + sec * 1000
    set({ timer: { ...tm, left, total, endsAt } })
    hiddenOver = false
    bookRestEnd(endsAt, total, tm.kind)
    countdown(useStore.getState().S.sound, secsTo(endsAt))   // the end moved, and the last five seconds with it
  },
  // The active list changed shape (an exercise removed or inserted at `at`): keep the rest
  // pointing at the same exercise. Returns nothing; the caller decides whether to stop instead.
  // A running hold's owner moves the same way: an exercise added above it in the List layout (it
  // goes in after the current unit, and the hold can be further down) moved its row, and its
  // saved owner is what a reload brings it back to. The workout screen moves its own copy
  // (Workout.jsx holdAt) with it.
  shiftRestOwner(at, delta) {
    const tm = get().timer
    if (tm && tm.forIdx >= at) set({ timer: { ...tm, forIdx: tm.forIdx + delta } })
    const wk = get().work
    if (wk?.owner && wk.owner.idx >= at) set({ work: { ...wk, owner: { ...wk.owner, idx: wk.owner.idx + delta } } })
  },
  // Android: the rest notification's own Pause, −15 s and +15 s (#296) change the countdown there
  // first, and this brings the bar in the app to the same place — a pause stops the ticking here
  // too, a resume starts it again from the notification's end, and +15 s on a rest the app had
  // already called Ready opens it again. Nothing is sent back: the notification already shows it.
  followNativeRest({ endsAt, left, total, paused }) {
    const tm = get().timer
    const forIdx = tm?.forIdx
    const kind = { ...(knownKind(tm?.kind) ? { kind: tm.kind } : {}), ...(knownPhase(tm?.phase) ? { phase: tm.phase } : {}), ...(tm?.forSet != null ? { forSet: tm.forSet } : {}) }
    if (paused) {
      stopRestTicking()
      hush()
      holdSession(false)
      set({ timer: { left, total, endsAt, forIdx, ...kind, paused: true } })
      return
    }
    const ticking = !!timerInt && !!tm && !tm.paused && !tm.ready
    set({ timer: { left, total, endsAt, forIdx, ...kind } })
    countdown(useStore.getState().S.sound, secsTo(endsAt))   // against the notification's end, as addRest does
    holdAudio()
    hiddenOver = false   // its end is ahead again: +15 s on one that ran out in the pocket
    if (ticking) return
    // As in resumeRest: a hide from while it was held or over is no catch-up of this countdown.
    pageHiddenAt = document.hidden ? Date.now() : null
    runRest(set, get)
  },
  // Sounds switched on or off (Settings, or the workout's settings sheet) while a timer runs: its
  // count-in was queued when it started, so queue it again, or call it off, and take or let go of
  // the audio session with it. A paused rest has none queued and gets none: it would tick a frozen
  // clock down to nothing. Resuming queues it.
  restartCountdown() {
    const tm = get().timer
    const wk = tm ? null : get().work
    if (tm ? tm.paused || tm.ready : !wk) return
    const { sound } = useStore.getState().S
    const left = secsTo((tm || wk).endsAt)
    if (left > 0) countdown(sound, left)           // with Sounds off, this calls it off
    holdSession(!!sound && left > 0)               // and nothing is left to hold it for past the end
  },
  stopRest() {
    // The count-in and the audio session are shared with the hold, so they are called off only when
    // there is a rest to call them off for: the closing set of one exercise stops the rest while a
    // hold may be running on another, and that hold's count-in is not this one's to end.
    if (get().timer) { hush(); holdSession(false) }
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
     `onDone(elapsedSec, { chimed, abandoned, endedAt })` is called both when the countdown reaches
     zero and on an early finish; the elapsed time is what actually gets logged, so stopping at 0:38
     of a 0:45 hold records 0:38 rather than crediting the full target. `chimed` is true when the
     countdown ran out in front of you and the end chime and buzz have just played; `abandoned`
     when a rest displaced the hold (abandonWork); `endedAt` when it ran out while the page was
     hidden and is only finished now the page is back: the moment it really ended.
     `owner` ({ idx, i, id }: the active entry and set being held) lets a hold outlive a reload or
     the app being killed (restoreWork below). onDone is a closure and cannot be kept, so the owner
     says where the time goes, and the workout screen binds its handler again (bindWork). */
  startWork(sec, label, onDone, owner = null) {
    get().abandonWork()   // a hold this one replaces keeps what it held, same as a rest replacing one
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    pageHiddenAt = document.hidden ? Date.now() : null   // see startRest: a stale hide is not a catch-up
    set({ work: { left: total, total, endsAt, label, overtime: useStore.getState().S.timedSetOvertime === true, ...(owner ? { owner } : {}) } })
    countdown(useStore.getState().S.sound, total)
    holdAudio()
    runWork(set, get)
  },
  // The workout screen, back on a hold restored after a reload: `make(work)` gives it the handler
  // its own start would have. Nothing to do for a hold that has one, or whose set is gone.
  bindWork(make) {
    const wk = get().work
    if (!wk?.owner || workDone || !ownerSet(wk.owner)) return
    workDone = make(wk)
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const startedAt = wk.endsAt - wk.total * 1000
    const elapsed = Math.max(1, Math.min(wk.total + (wk.overtime ? MAX_WORK_OVERTIME_SEC : 0), Math.round((Date.now() - startedAt) / 1000)))
    const done = workDone || ownerDone(wk)
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed)
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
    const done = workDone || ownerDone(wk)
    get().stopWork()
    // Under two seconds there is nothing to keep: that is a play button tapped by accident, or
    // tapped and thought better of, and rounding it up to one second the way an early finish does
    // would write a one-second plank over a real plan. (finishWorkEarly's Math.max(1, …) is right
    // for what it is: you pressed Done, so you held it, however briefly.)
    if (done && elapsed >= 2) done(elapsed, { abandoned: true })
  },
  // Abandon without logging anything.
  stopWork() {
    // Only a hold's own count-in and audio session, as in stopRest: moving an exercise up or down
    // stops "the hold" in the middle of a rest to drop its callback, and used to silence the
    // rest's last seconds and hand the volume buttons back to the ringer.
    if (get().work) { hush(); holdSession(false) }
    stopWorkTicking()
    workDone = null
    set({ work: null })
  }
}))

// A reload in the middle of a rest (pull to refresh, a WebView restart, an update) used to drop
// the countdown while its alarm still rang later. The rest lives on in localStorage and comes
// back at boot while its end is still ahead, held if it was paused. Not sessionStorage: that
// dies with the process, and Android killing the app mid-rest (or iOS dropping the home-screen
// app) took the bar with it. On the web its end was booked when it started (the server's push,
// per device, which survives the reload), so it is not booked again: the alert fires once, and
// the bar's own tick at zero calls the push off as it always does. In the app the countdown
// notification lives in the app's process and may be gone with it, so the end is booked again
// there: the alarm has a fixed id and the new booking replaces the old one, it never adds a second.
// A rest that ended meanwhile, or one left with no session running, is dropped.
export const REST_KEY = 'gym_rest'
const restStore = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const saveRest = tm => {
  const ss = restStore()
  if (!ss) return
  try {
    if (!tm || tm.ready) ss.removeItem(REST_KEY)
    else ss.setItem(REST_KEY, JSON.stringify({ endsAt: tm.endsAt, total: tm.total, forIdx: tm.forIdx ?? null, forSet: tm.forSet ?? null, kind: tm.kind || null, phase: tm.phase || null, paused: !!tm.paused, left: tm.left }))
  } catch { /* the rest just does not outlive a reload */ }
}
export function restoreRest(now = Date.now()) {
  const ss = restStore()
  let saved = null
  try { saved = JSON.parse(ss?.getItem(REST_KEY) || 'null') } catch { saved = null }
  if (!saved || useUI.getState().timer) return false
  const total = Math.round(Number(saved.total))
  const ok = useStore.getState().S?.active && total > 0 && (saved.paused ? saved.left > 0 : saved.endsAt > now)
  if (!ok) { try { ss.removeItem(REST_KEY) } catch { /* nothing to drop */ } return false }
  const base = { total, forIdx: saved.forIdx ?? undefined, ...(saved.forSet != null ? { forSet: saved.forSet } : {}), ...(knownKind(saved.kind) ? { kind: saved.kind } : {}), ...(knownPhase(saved.phase) ? { phase: saved.phase } : {}) }
  if (saved.paused) {
    useUI.setState({ timer: { ...base, left: Math.round(saved.left), endsAt: saved.endsAt, paused: true } })
    if (MOBILE) holdRestAlert(Math.round(saved.left), total)
    return true
  }
  pageHiddenAt = typeof document !== 'undefined' && document.hidden ? now : null
  const left = Math.max(1, Math.round((saved.endsAt - now) / 1000))
  useUI.setState({ timer: { ...base, left, endsAt: saved.endsAt } })
  // The count-in queued at the start went with the page: queue it again for what is left.
  countdown(useStore.getState().S.sound, secsTo(saved.endsAt, now))
  holdAudio()
  if (MOBILE) bookRestEnd(saved.endsAt, total, base.kind)
  runRest(useUI.setState, useUI.getState)
  return true
}
useUI.subscribe((s, prev) => { if (s.timer !== prev.timer) saveRest(s.timer) })
restoreRest()

// The hold (a timed set) the same way: a reload or the app being killed mid-plank used to drop
// the bar and the seconds with it. Kept beside the rest, with the set it belongs to (`owner`);
// at boot it carries on while its end is ahead, and one that ended meanwhile is written to its set
// as held to the end. The workout screen binds its own handler again (bindWork), and until it
// does the time still lands on the set (ownerDone). Only the start, total and owner are kept:
// the tick reads `endsAt`, so what it shows after the reload is what the clock says.
export const WORK_KEY = 'gym_work'
const saveWork = wk => {
  const ls = restStore()
  if (!ls) return
  try {
    if (!wk?.owner) ls.removeItem(WORK_KEY)
    else ls.setItem(WORK_KEY, JSON.stringify({ endsAt: wk.endsAt, total: wk.total, label: wk.label || '', overtime: !!wk.overtime, alerted: !!wk.alerted, owner: wk.owner }))
  } catch { /* the hold just does not outlive a reload */ }
}
export function restoreWork(now = Date.now()) {
  const ls = restStore()
  let saved = null
  try { saved = JSON.parse(ls?.getItem(WORK_KEY) || 'null') } catch { saved = null }
  if (!saved || useUI.getState().work) return false
  const total = Math.round(Number(saved.total))
  const drop = () => { try { ls.removeItem(WORK_KEY) } catch { /* nothing to drop */ } return false }
  if (!(total > 0) || !(saved.endsAt > 0) || !ownerSet(saved.owner)) return drop()
  const wk = { left: total, total, endsAt: saved.endsAt, label: saved.label || '', overtime: !!saved.overtime, ...(saved.alerted ? { alerted: true } : {}), owner: saved.owner }
  const left = Math.round((saved.endsAt - now) / 1000)
  // Over while the app was away: held to the end (overtime past the target is not known, and
  // the target is what was planned), with no chime for an end nobody was there for.
  if (left <= 0 && !(wk.overtime && left > -MAX_WORK_OVERTIME_SEC)) {
    drop()
    ownerDone(wk)(total)
    return true
  }
  pageHiddenAt = typeof document !== 'undefined' && document.hidden ? now : null
  useUI.setState({ work: { ...wk, left, ...(left <= 0 ? { alerted: true } : {}) } })
  // As for a restored rest: the count-in went with the page, so it is queued again.
  if (left > 0) {
    countdown(useStore.getState().S.sound, secsTo(saved.endsAt, now))
    holdAudio()                     // not for one counting on past its target: nothing more sounds
  }
  runWork(useUI.setState, useUI.getState)
  return true
}
useUI.subscribe((s, prev) => { if (s.work !== prev.work && (!s.work || !prev.work || s.work.owner !== prev.work.owner || s.work.endsAt !== prev.work.endsAt || s.work.alerted !== prev.work.alerted)) saveWork(s.work) })
restoreWork()

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
