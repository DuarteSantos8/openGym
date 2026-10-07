import { propertyList, watchProfile, validWatchSession } from './watch-protocol.js'
import { MOBILE } from './mobile.js'
import { exerciseNameText } from './i18n-core.js'
import { exOr } from './exercises.js'
import { bestWeightForEntry } from './history.js'
import { isSideSet, syncSideAggregate } from './workout-model.js'
import { buildCombinedEntries } from './session-merge.js'
import { nav } from './nav.js'
import { useUI } from '../store/useUI.js'
import { watchDisplayOf } from './watch-display.js'
import { watchThumbnailFor, syncWatchThumbnails } from './watch-thumbnails.js'

let bridgeInstance
let publishing
let draining = false
let drainAgain = false
let launchedSessionId = ''
let preparedNotifications = false
let openedWatchSessionId = ''
let thumbnailsSyncing = false
let thumbnailsAgain = false

async function bridge() {
  if (!MOBILE) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  return (bridgeInstance ||= { native: registerPlugin('WatchBridge') })
}

export function snapshot(store) {
  const { S, ready } = store.getState()
  if (!ready) return { profile: watchProfile(store), session: {}, routines: [], rest: {} }
  const active = S.active
  const timer = useUI.getState().timer
  // WCSession accepts property-list values, but not JavaScript null/undefined.
  const safe = propertyList
  return {
    profile: watchProfile(store),
    sessionId: String(active?.id || ''),
    title: active?.name || 'openGym',
    unit: S.unit || 'kg',
    watchDisplay: watchDisplayOf(S),
    session: active ? safe({ ...active, profile: watchProfile(store), entries: (active.entries || []).map(entry => ({
      ...entry, name: exerciseNameText(exOr(entry.id)),
      thumbnailKey: watchThumbnailFor(exOr(entry.id))?.key,
      restSec: entry.target?.restSec ?? S.restSec,
    })) }) : {},
    routines: (S.routines || []).filter(r => r.ex?.length).map(r => ({
      id: String(r.id), name: r.name,
      entries: safe(buildCombinedEntries(S, [r.id]).entries.map((entry, index) => ({
        ...entry, name: exerciseNameText(exOr(entry.id)),
        thumbnailKey: watchThumbnailFor(exOr(entry.id))?.key,
        restSec: r.ex[index]?.restSec ?? S.restSec,
      }))),
    })),
    completedIds: (S.workouts || []).slice(-20).map(w => String(w.id)),
    discardedIds: S._watchDiscardedIds || [],
    entries: (active?.entries || []).map((entry, index) => ({
      index,
      name: exerciseNameText(exOr(entry.id)),
      sets: (entry.sets || []).map((set, number) => ({ number, done: !!set.done,
        label: [set.w != null ? `${set.w} ${S.unit}` : '', set.r != null ? `× ${set.r}` : ''].join(' ').trim() })),
    })),
    rest: timer ? { endsAt: timer.endsAt || 0, left: timer.left || 0, paused: !!timer.paused, ready: !!timer.ready } : {},
  }
}

export async function applyWatchSession(store, command) {
  const incoming = command.session
  if (!validWatchSession(incoming)) return true
  if (incoming.profile !== watchProfile(store)) return false
  const { S } = store.getState()
  if ((S._watchDiscardedIds || []).includes(incoming.id)) return true
  if (incoming.discarded === true) {
    const discardingActive = String(S.active?.id) === incoming.id
    store.getState().update(s => {
      s._watchDiscardedIds = [...(s._watchDiscardedIds || []), incoming.id].slice(-200)
      if (String(s.active?.id) === incoming.id) s.active = null
    })
    if (discardingActive) {
      useUI.getState().stopRest()
      useUI.getState().abandonWork()
      if (!document.hidden) nav('/')
    }
    return true
  }
  if (!Array.isArray(incoming.entries) || !Array.isArray(incoming.routineIds)) return true
  if ((S.workouts || []).some(w => String(w.id) === incoming.id)) return true
  if (S.active && String(S.active.id) !== incoming.id) return false
  const seq = Number(incoming.seq) || 0
  let completedIndex = -1
  let restSeconds = S.restSec
  const restActions = []
  if (!S.active) {
    store.getState().update(s => {
      s.active = {
        id: incoming.id, d: incoming.d, start: incoming.start,
        routineIds: incoming.routineIds, name: incoming.name,
        bw: null, cur: 0, entries: incoming.entries.map(({ name, restSec, thumbnailKey, ...entry }) => entry),
        workoutView: s.workoutView || 'cards', _watchSeq: seq,
      }
    })
    if (!document.hidden) {
      openedWatchSessionId = incoming.id
      setTimeout(() => nav('/workout'), 250)
    }
  } else if (seq > (S.active._watchSeq || 0)) {
    const previousSeq = S.active._watchSeq || 0
    store.getState().update(s => {
      const active = s.active
      if (!active || String(active.id) !== incoming.id) return
      for (const change of (incoming.changes || []).filter(c => c.seq > previousSeq).sort((a, b) => a.seq - b.seq)) {
        if (change.field === 'rest') {
          if (Date.now() - Number(change.at) < 30000) restActions.push(change.value)
          continue
        }
        if (!['done', 'w', 'r', 'sec'].includes(change.field)) continue
        const entry = active.entries?.[change.entry]
        const row = entry?.sets?.[change.set]
        if (!row || String(entry.id) !== String(incoming.entries?.[change.entry]?.id)) continue
        if (change.field === 'done') {
          const done = change.value === true
          entry.sets[change.set] = isSideSet(row)
            ? syncSideAggregate({ ...row, sides: { L: { ...row.sides.L, done }, R: { ...row.sides.R, done } } })
            : { ...row, done }
          if (done) {
            completedIndex = change.entry
            restSeconds = incoming.entries[change.entry].restSec ?? s.restSec
          } else restActions.push('skipRest')
        } else if (Number.isFinite(Number(change.value)) && Number(change.value) >= 0) {
          const value = change.field === 'w' ? Number(change.value) : Math.round(Number(change.value))
          entry.sets[change.set] = isSideSet(row) && ['L', 'R'].includes(change.side)
            ? syncSideAggregate({ ...row, sides: { ...row.sides, [change.side]: { ...row.sides[change.side], [change.field]: value } } })
            : { ...row, [change.field]: value }
        }
        entry.topW = bestWeightForEntry(entry) || null
      }
      active._watchSeq = seq
    })
  }
  if (completedIndex >= 0 && !incoming.finished && Date.now() - Number(incoming.lastSetAt) < 5000 &&
      store.getState().S.active?.entries.some(entry => entry.sets?.some(row => !row.done))) {
    useUI.getState().startRest(restSeconds, completedIndex)
  } else if (completedIndex >= 0 && !store.getState().S.active?.entries.some(entry => entry.sets?.some(row => !row.done))) {
    useUI.getState().stopRest()
  }
  for (const action of restActions) {
    if (action === 'skipRest') useUI.getState().stopRest()
    else if (action === 'addRest') useUI.getState().addRest(15)
    else if (action === 'pauseRest') useUI.getState().pauseRest()
    else if (action === 'resumeRest') useUI.getState().resumeRest()
  }
  if (incoming.finished && store.getState().S.active?.id === incoming.id) {
    const { finishWorkoutFromWatch } = await import('../sheets.jsx')
    finishWorkoutFromWatch(incoming.id, incoming.end)
  }
  return true
}

async function drain(store) {
  if (draining) { drainAgain = true; return }
  if (!store.getState().ready) return
  draining = true
  try {
    const native = (await bridge())?.native
    if (!native) return
    const commands = (await native.drain()).commands || []
    const acknowledged = []
    for (const command of commands) {
      if (command.action === 'syncSession') {
        if (await applyWatchSession(store, command)) acknowledged.push(command.id)
        continue
      }
      const active = store.getState().S.active
      if (!active || String(active.id) !== command.sessionId) { acknowledged.push(command.id); continue }
      if (command.action === 'completeSet') {
        const entry = active.entries[command.entry]
        if (!entry?.sets?.[command.set] || entry.sets[command.set].done) { acknowledged.push(command.id); continue }
        store.getState().update(s => {
          const currentEntry = s.active?.entries?.[command.entry]
          const row = currentEntry?.sets?.[command.set]
          if (row) currentEntry.sets[command.set] = isSideSet(row)
            ? syncSideAggregate({ ...row, sides: { L: { ...row.sides.L, done: true }, R: { ...row.sides.R, done: true } } })
            : { ...row, done: true }
          if (currentEntry?.sets?.every(set => set.done)) currentEntry.topW = bestWeightForEntry(currentEntry) || null
          if (s.active) s.active.cur = command.entry
        })
        if (store.getState().S.active.entries.some(current => current.sets?.some(set => !set.done))) {
          useUI.getState().startRest(entry.restSec ?? store.getState().S.restSec, command.entry)
        } else useUI.getState().stopRest()
      } else if (command.action === 'skipRest') useUI.getState().stopRest()
      else if (command.action === 'addRest') useUI.getState().addRest(15)
      else if (command.action === 'pauseRest') useUI.getState().pauseRest()
      else if (command.action === 'resumeRest') useUI.getState().resumeRest()
      acknowledged.push(command.id)
    }
    if (acknowledged.length) await native.ack({ ids: acknowledged })
    if (acknowledged.length) publish(store)
  } catch { /* The phone can be used normally without a paired watch. */ }
  finally {
    draining = false
    if (drainAgain) {
      drainAgain = false
      queueMicrotask(() => drain(store))
    }
  }
}

function publish(store) {
  clearTimeout(publishing)
  publishing = setTimeout(async () => {
    try {
      const native = (await bridge())?.native
      await native?.publish({ state: snapshot(store) })
      if (native && store.getState().ready) publishThumbnails(native, store)
    } catch { /* Watch may be unavailable. */ }
  }, 250)
}

async function publishThumbnails(native, store) {
  if (thumbnailsSyncing) { thumbnailsAgain = true; return }
  thumbnailsSyncing = true
  try {
    const { S } = store.getState()
    const ids = [...(S.active?.entries || []).map(e => e.id), ...(S.routines || []).flatMap(r => (r.ex || []).map(e => e.id))]
    const descriptors = new Map(ids.map(id => watchThumbnailFor(exOr(id))).filter(Boolean).map(d => [d.key, d]))
    await syncWatchThumbnails(native, store, [...descriptors.values()])
  } catch { /* File transfers can wait until the Watch reconnects. */ }
  finally {
    thumbnailsSyncing = false
    if (thumbnailsAgain) { thumbnailsAgain = false; publishThumbnails(native, store) }
  }
}

function launchWatchForPhoneSession(store) {
  const active = store.getState().S.active
  if (!store.getState().ready || !active || active._watchSeq || launchedSessionId === String(active.id)) return
  launchedSessionId = String(active.id)
  setTimeout(async () => {
    try {
      const result = await (await bridge())?.native.launchWorkout()
      if (!result?.launched) launchedSessionId = ''
    }
    catch { launchedSessionId = '' }
  }, 400)
}

async function prepareWatchNotifications(store) {
  if (preparedNotifications || !store.getState().ready) return
  preparedNotifications = true
  try {
    const result = await (await bridge())?.native.prepareNotifications()
    if (!result?.available) preparedNotifications = false
  } catch { preparedNotifications = false }
}

export async function startAppleWatch(store) {
  if (!MOBILE) return
  const native = (await bridge())?.native
  if (!native) return
  native.addListener('watchCommand', () => drain(store))
  store.subscribe((next, prev) => {
    if (next.S.active !== prev.S.active || next.S.routines !== prev.S.routines ||
        next.S.watchDisplay !== prev.S.watchDisplay || next.S.customEx !== prev.S.customEx || next.ready !== prev.ready || watchProfile({ getState: () => next }) !== watchProfile({ getState: () => prev })) publish(store)
    if (next.S.active !== prev.S.active) drain(store)
    if (next.S.active?.id !== prev.S.active?.id || (!prev.ready && next.ready)) launchWatchForPhoneSession(store)
    if (!prev.ready && next.ready) prepareWatchNotifications(store)
    if (!prev.ready && next.ready) drain(store)
  })
  useUI.subscribe((next, prev) => { if (next.timer !== prev.timer) publish(store) })
  document.addEventListener('opengym:language', () => publish(store))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { drain(store); publish(store); launchWatchForPhoneSession(store) } })
  import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      drain(store); publish(store); prepareWatchNotifications(store)
      const active = store.getState().S.active
      if (active?._watchSeq && openedWatchSessionId !== String(active.id)) {
        openedWatchSessionId = String(active.id)
        setTimeout(() => nav('/workout'), 100)
      }
    }
  })).catch(() => {})
  drain(store)
  publish(store)
  launchWatchForPhoneSession(store)
  prepareWatchNotifications(store)
}
