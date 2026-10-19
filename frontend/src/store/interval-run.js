import { create } from 'zustand'
import { useStore } from './useStore.js'
import { useUI } from './useUI.js'
import { intervalGroupReady, nextIntervalSet } from '../lib/interval-group.js'
import { supersetMeta } from '../lib/superset-meta.js'
import { bestWeightForEntry } from '../lib/history.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { uid } from '../lib/format.js'

// The sequence belongs to the session, not to the mounted workout screen.
// shortcut: browser suspension delays progression; guaranteed background timing needs a native scheduler.
export const useIntervalRun = create(() => ({ run: null }))
let current = null
let changing = false
let completion = null
const signature = a => JSON.stringify(a?.entries)
const valid = run => current === run && useStore.getState().S.active?.id === run.id
  && signature(useStore.getState().S.active) === run.signature

export function bindIntervalCompletion(id, complete) {
  const binding = { id, complete }
  completion = binding
  return () => { if (completion === binding) completion = null }
}

export function stopIntervals() {
  const run = current
  current = null
  if (!run) return
  run.unsubscribeUI?.(); run.unsubscribeStore?.()
  useIntervalRun.setState({ run: null })
  const ui = useUI.getState()
  if (ui.work?.owner?.interval === run.token) ui.stopWork()
  if (ui.timer?.interval === run.token) ui.stopRest()
}

function completeSet(run, idx, i, seconds, chimed) {
  if (completion?.id === run.id) {
    completion.complete(idx, i, seconds, chimed)
    return
  }
  // Offscreen completion uses the same fields as a timed set, without opening sheets.
  useStore.getState().update(s => {
    const entry = s.active.entries[idx], set = entry.sets[i]
    set.sec = seconds; set.done = true; set.at = Date.now()
    delete set.planSec
    if (entry.sets.every(s => s.done)) entry.topW = bestWeightForEntry(entry) || null
  }, true)
}

function nextWork(run) {
  if (!valid(run)) { stopIntervals(); return }
  const active = useStore.getState().S.active
  if (!run.next || !intervalGroupReady(active.entries, run.unit)) { stopIntervals(); return }
  const { idx, i } = run.next, entry = active.entries[idx]
  const seconds = supersetMeta(active.entries, run.unit, { onTarget: true }).work ?? Number(entry.sets[i].planSec ?? entry.sets[i].sec)
  changing = true
  try {
    run.phase = 'work'
    useStore.getState().update(s => { s.active.cur = idx })
    useUI.getState().startWork(seconds, exerciseNameFor(exOr(entry.id)), (elapsed, flags = {}) => {
      if (!valid(run) || flags.abandoned) { if (current === run) stopIntervals(); return }
      changing = true
      try {
        completeSet(run, idx, i, Math.min(seconds, elapsed), flags.chimed)
        const fresh = useStore.getState().S.active
        if (fresh?.id !== run.id) { stopIntervals(); return }
        run.signature = signature(fresh)
        run.next = nextIntervalSet(fresh.entries, run.unit, idx)
        if (!run.next) { stopIntervals(); return }
        const meta = supersetMeta(fresh.entries, run.unit, { onTarget: true })
        const rest = run.next.roundEnd ? (meta.roundRest ?? (meta.rest > 0 ? meta.rest : meta.intervalRest)) : meta.intervalRest
        run.phase = 'rest'
        useUI.getState().startRest(rest, idx, { forSet: i, interval: run.token })
        if (!rest) nextWork(run)
      } finally { changing = false }
    }, { idx, i, id: entry.id, interval: run.token })
  } finally { changing = false }
}

export function startIntervals(unit) {
  const active = useStore.getState().S.active
  if (!active) return
  const next = nextIntervalSet(active.entries, unit)
  if (!next || document.hidden) return
  stopIntervals()
  const run = { id: active.id, token: uid(), unit: [...unit], next, signature: signature(active), phase: 'prep' }
  current = run
  useIntervalRun.setState({ run: { id: run.id, unit: run.unit } })
  const check = () => {
    if (changing || current !== run) return
    if (!valid(run)) { stopIntervals(); return }
    const ui = useUI.getState()
    if (run.phase === 'rest') {
      if (ui.work || (ui.timer && ui.timer.interval !== run.token)) { stopIntervals(); return }
      if (ui.timer?.ready) nextWork(run)
      else if (!ui.timer) {
        // A replacement rest clears the previous one before installing itself.
        Promise.resolve().then(() => {
          if (current === run && run.phase === 'rest' && !useUI.getState().timer && !useUI.getState().work) nextWork(run)
        })
      }
    } else if (ui.work?.owner?.interval !== run.token) {
      // stopWork clears the bar before invoking its completion callback in the same task.
      Promise.resolve().then(() => {
        if (current === run && run.phase !== 'rest' && useUI.getState().work?.owner?.interval !== run.token) stopIntervals()
      })
    }
  }
  run.unsubscribeUI = useUI.subscribe(check)
  run.unsubscribeStore = useStore.subscribe(check)
  const prep = supersetMeta(active.entries, unit, { onTarget: true }).prep ?? 0
  if (prep > 0) {
    changing = true
    try {
      useUI.getState().startWork(prep, t('Preparation before starting'), (_elapsed, flags = {}) => {
        if (valid(run) && !flags.abandoned) nextWork(run)
        else if (current === run) stopIntervals()
      }, { interval: run.token, prep: true })
    } finally { changing = false }
  } else nextWork(run)
}
