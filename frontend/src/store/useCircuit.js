// The circuit player's clock (lib/circuit.js decides, this runs it): one run at a time, for one
// group of the workout in progress. Kept in its own store, beside useUI's rest and hold timers,
// which it stops while it runs (they must never run together). The run is plain data and lives
// on in localStorage, so a reload or the app being killed comes back to where the clock is.
//
// Every finished station is written into the session at once (lib/circuit.js logStation), so
// the history, the stats, the watch, the Lock Screen and a sync see the real sets as they happen.
// The phone asleep: each step books the next boundaries with the native alarm (rest-alert cues),
// the same path a rest or a hold that runs itself uses, so a locked phone still beeps "Go".
import { create } from 'zustand'
import { useStore } from './useStore.js'
import { useUI } from './useUI.js'
import {
  startRun, tickRun, doneStep, skipStep, pauseRun, resumeRun, stopRun, runStep, stepEndsAt, leftOf,
  logStation, trimUnlogged, runResult, circuitOf, stationsOf, lockCues, programAdvance, stationNow,
} from '../lib/circuit.js'
import { cueWords } from '../lib/circuit-copy.js'
import { supersetMeta } from '../lib/superset-meta.js'
import { modeOf, supersetUnits } from '../lib/history.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import { beep, chime, vibrate, unlock } from '../lib/sound.js'
import { speak, voiceOpts } from '../lib/speech.js'
import { MOBILE } from '../lib/mobile.js'
import { armRestAlert, disarmRestAlert } from '../lib/rest-alert.js'
import { accentValue } from '../lib/accent.js'
import { t } from '../lib/i18n.js'
import { bindCircuitSource, circuitChanged } from '../lib/watch-sync.js'

const KEY = 'gym_circuit_v1'
const TICK_MS = 200
// A step that began longer ago than this is caught up quietly (the phone was asleep): no beep
// for a "Go" that happened two minutes ago.
const FRESH_MS = 1500

const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const save = run => { try { if (run) store()?.setItem(KEY, JSON.stringify(run)); else store()?.removeItem(KEY) } catch { /* the run just does not survive a reload */ } }
const load = () => { try { const v = JSON.parse(store()?.getItem(KEY) || 'null'); return v && v.v === 1 ? v : null } catch { return null } }

const nameOf = id => { const ex = EXIDX[id]; return ex ? exerciseNameText(ex) : String(id ?? '') }
const S = () => useStore.getState().S
const sound = () => !!S()?.sound
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

let timer = null
let lastBeep = null

/** The group around entry `idx` of the running workout: { unit, sg, cfg, roundRest }, or null. */
export function circuitUnitAt(active, idx) {
  if (!active?.entries?.length) return null
  const unit = supersetUnits(active.entries).find(u => u.includes(idx))
  if (!unit) return null
  const cfg = circuitOf(active.entries, unit, { onTarget: true })
  if (!cfg) return null
  return { unit, sg: active.entries[unit[0]]?.sg || null, cfg, roundRest: supersetMeta(active.entries, unit, { onTarget: true }).rest }
}

function say(text, opts) {
  const st = S()
  if (!text || st?.spokenCues !== true) return
  speak(text, { ...voiceOpts(st), ...(opts || {}) })
}

// The session, written as the stations finish.
function writeEvents(run, events) {
  const work = events.filter(e => e.type === 'work')
  const step = events.filter(e => e.type === 'step').at(-1)
  if (!work.length && !step) return
  useStore.getState().update(s => {
    const A = s.active
    if (!A || (run.wid != null && A.id !== run.wid)) return
    for (const e of work) {
      const st = run.stations[e.m]
      if (!st) continue
      logStation(A.entries, st, e.r, { reps: e.reps, w: e.w ?? st.w, sec: e.sec, at: e.to })
    }
    // The station on now is the current exercise, so the watch and the Lock Screen show it.
    const now = runStep(run)
    if (now && now.k !== 'prep') { const idx = run.stations[now.m]?.idx; if (Number.isInteger(idx) && idx < A.entries.length) A.cur = idx }
  })
}

// Sound, buzz and voice for what just happened, only when it happened now and in front of you.
function feedback(run, events, now) {
  if (!visible()) return
  const snd = sound()
  for (const e of events) {
    if (now - (e.at ?? e.to ?? now) > FRESH_MS) continue
    if (e.type === 'step') {
      const nm = nameOf(run.stations[e.step.m]?.id)
      if (e.step.k === 'work') { beep(snd, 1320, 0.32); vibrate([60, 40, 60]); say(cueWords.work(nm, e.step), { queue: false }) }
      else if (e.step.k === 'rest') { beep(snd, 660, 0.25); vibrate(40); say(cueWords.rest(nm, e.step), { queue: false }) }
    } else if (e.type === 'end') {
      chime(snd, 'chime'); vibrate([120, 60, 120, 60, 200]); say(cueWords.end(), { queue: false })
    } else if (e.type === 'split') {
      vibrate(25)
    }
  }
}

// The boundaries ahead, for a phone that is about to sleep (the native alarm rings them).
function bookLock(run) {
  if (!MOBILE || useStore.getState().tourSandbox) return
  const plan = lockCues(run, cueWords, nameOf)
  if (!plan) { disarmRestAlert(); return }
  const st = S() || {}
  armRestAlert(plan.at, { title: plan.title, cues: plan.cues, countdown: false, totalSec: Math.max(1, Math.round((plan.at - Date.now()) / 1000)),
    accent: accentValue(st), sound: !!st.sound, vibrate: st.vibrate !== false, alarmBuzz: st.vibrate !== false && !!st.vibrateOnSilent })
}

export const useCircuit = create((set, get) => ({
  run: null,          // lib/circuit.js run, or null
  open: false,        // the full-screen player is up
  ask: null,          // { m } the station the cap caught you in: how many reps did you get?
  result: null,       // the saved result of the run that just ended, for the player's last screen

  /** Opens the player on the circuit around entry `idx`: its running clock, or a new one ready to start. */
  openAt(idx) {
    const A = S()?.active
    const g = circuitUnitAt(A, idx)
    if (!g) return false
    const cur = get().run
    if (cur && !cur.ended && cur.wid === (A.id ?? null) && cur.sg === g.sg) { set({ open: true }); return true }
    set({ run: null, open: true, ask: null, result: null, pending: { idx } })
    return true
  },
  close() { set({ open: false }) },

  /** Get ready… The rest and hold timers stop: one clock at a time. */
  start() {
    const A = S()?.active
    const idx = get().pending?.idx ?? get().run?.unit?.[0]
    const g = circuitUnitAt(A, idx)
    if (!g) return
    unlock(sound())
    useUI.getState().stopRest?.()
    useUI.getState().stopWork?.()
    useUI.getState().stopCountIn?.()
    const stations = stationsOf(A.entries, g.unit, cfg => modeOf(cfg))
    const run = startRun({ wid: A.id ?? null, sg: g.sg, unit: g.unit, cfg: g.cfg, stations, roundRest: g.roundRest }, Date.now())
    set({ run, open: true, ask: null, result: null, pending: null })
    save(run)
    bookLock(run)
    get().loop()
    say(t('Get ready'))
  },

  apply({ run, events }, now = Date.now()) {
    if (!run) return
    set({ run })
    save(run)
    if (events.length) {
      writeEvents(run, events)
      feedback(run, events, now)
      if (events.some(e => e.type === 'step')) bookLock(run)
      const end = events.find(e => e.type === 'end')
      if (end) {
        if (MOBILE) disarmRestAlert()
        // The station the clock caught you in: its reps are asked for before the result is kept.
        const p = run.partial
        if (p && run.stations[p.m]?.mode === 'reps' && (run.cfg.mode === 'amrap' || end.reason === 'stopped')) set({ ask: { m: p.m } })
        else get().finish()
      }
    }
  },

  tick(now = Date.now()) {
    const run = get().run
    if (!run || run.ended || run.paused != null) return
    // 3, 2, 1 before a fixed step ends: short beeps (and the numbers, with the voice on).
    const left = leftOf(run, now)
    const end = stepEndsAt(run) ?? run.capEndsAt
    if (end != null && left != null && left <= 3 && left >= 1 && visible() && lastBeep !== `${end}:${left}`) {
      lastBeep = `${end}:${left}`
      beep(sound(), 880, 0.12)
      if (runStep(run)?.sec >= 10 || run.capEndsAt) say(String(left), { queue: false })
    }
    const r = tickRun(run, now)
    if (r.events.length) get().apply(r, now)
  },

  loop() {
    clearInterval(timer)
    timer = setInterval(() => {
      const run = get().run
      if (!run || run.ended) { clearInterval(timer); timer = null; return }
      get().tick()
    }, TICK_MS)
  },

  done() { const run = get().run; if (run) { unlock(sound()); get().apply(doneStep(run, Date.now())) } },
  skip() { const run = get().run; if (run) get().apply(skipStep(run, Date.now())) },
  pause() {
    const run = get().run
    if (!run || run.paused != null || run.ended) return
    const next = pauseRun(run, Date.now())
    set({ run: next }); save(next)
    if (MOBILE) disarmRestAlert()
  },
  resume() {
    const run = get().run
    if (!run || run.paused == null) return
    const next = resumeRun(run, Date.now())
    set({ run: next }); save(next)
    bookLock(next)
    get().loop()
  },
  stop() { const run = get().run; if (run && !run.ended) get().apply(stopRun(run, Date.now())) },

  /** Reps or weight changed on the player, for this station's rounds from now on. */
  adjust(m, patch) {
    const run = get().run
    if (!run) return
    const cur = stationNow(run, m) || {}
    const next = { ...run, adj: { ...run.adj, [m]: { ...(run.adj?.[m] || {}), ...patch } } }
    if (patch.reps != null) next.adj[m].reps = Math.max(0, Math.min(999, Math.round(patch.reps)))
    if (patch.w != null) next.adj[m].w = Math.max(0, Math.round(patch.w * 100) / 100)
    if (cur.reps === next.adj[m].reps && cur.w === next.adj[m].w && patch.reps == null && patch.w == null) return
    set({ run: next }); save(next)
  },

  /** The run is over: the partial station (when asked), the result onto the session, rows owed trimmed. */
  finish(partialReps = 0) {
    const run = get().run
    if (!run || !run.ended) return
    const ask = get().ask
    const A0 = S()?.active
    const name = A0 ? supersetMeta(A0.entries, run.unit, { onTarget: true }).name : ''
    const result = runResult(run, { partialReps: ask ? partialReps : 0, name })
    useStore.getState().update(s => {
      const A = s.active
      if (!A || (run.wid != null && A.id !== run.wid)) return
      if (ask && partialReps > 0) {
        const st = run.stations[ask.m]
        if (st) logStation(A.entries, st, run.partial.r, { reps: partialReps, w: stationNow(run, ask.m)?.w ?? st.w, sec: 0, at: run.endedAt })
      }
      trimUnlogged(A.entries, run.unit)
      // The run/walk ladder moves up after its finished sessions, in the routine it came from,
      // but only once the workout is saved (sheets.jsx doFinishWorkout, applyProgramAdvances):
      // here the step is only noted, so a workout discarded after the run does not count it.
      const rid = run.cfg.program === 'runwalk' ? A.entries[run.unit[0]]?.rid || A.routineId || (A.routineIds || [])[0] : null
      const r = rid != null ? (s.routines || []).find(x => x.id === rid) : null
      const advance = r ? programAdvance(run.cfg, result, rid) : null
      A.circuits = [...(Array.isArray(A.circuits) ? A.circuits : []), { ...result, at: run.endedAt, ...(advance ? { advance } : {}) }]
    })
    set({ ask: null, result })
    save(null)
  },

  /** The workout is being finished with the clock still going: it stops, and what was done is kept. */
  wrapUp() {
    const run = get().run
    if (run && !run.ended) get().apply(stopRun(run, Date.now()))
    if (get().ask) get().finish(0)
    set({ open: false })
  },

  /** Throws the clock away (the workout ended or was discarded under it). */
  reset() { clearInterval(timer); timer = null; if (MOBILE && get().run && !get().run.ended) disarmRestAlert(); set({ run: null, open: false, ask: null, result: null, pending: null }); save(null) },
}))

// Back after a reload: the run of this workout picks up where the clock is.
export function restoreCircuit() {
  const run = load()
  const A = S()?.active
  if (!run || !A || (run.wid != null && A.id !== run.wid)) { if (run) save(null); return false }
  useCircuit.setState({ run })
  // It ended while the page was gone (the reps of the last station were never asked): keep what was done.
  if (run.ended) { useCircuit.getState().finish(0); return true }
  useCircuit.getState().loop()
  useCircuit.getState().tick()
  return true
}

// The workout gone (finished, discarded, another one started): its clock goes too.
let wired = false
export function wireCircuit() {
  if (wired) return
  wired = true
  // The watches count a circuit's rests too (lib/watch-sync.js), told when a step changes.
  bindCircuitSource(() => useCircuit.getState().run)
  const stepOf = r => (r ? `${r.i}|${r.at}|${r.paused}|${r.ended}|${r.split}` : '')
  useCircuit.subscribe((s, prev) => { if (stepOf(s.run) !== stepOf(prev.run)) circuitChanged() })
  useStore.subscribe((s, prev) => {
    const run = useCircuit.getState().run
    if (!run) return
    const A = s.S?.active
    if (!A || (run.wid != null && A.id !== run.wid)) useCircuit.getState().reset()
  })
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (visible()) useCircuit.getState().tick() })
}
