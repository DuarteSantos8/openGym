// A whole phone and its watches in one process, for the tests of the watch link
// (watch-sync.sim.test.js, watch-sync.sim2.test.js, watch-sync.property.test.js). Never imported by
// the app.
//
//   the page     the real lib/watch-sync.js, started over a fake WatchBridge and a small store, with
//                a rest timer that keeps the rules of store/useUI.js (start, ±15, Skip, pause,
//                resume, run out to its Ready, alignRest, putRest)
//   the native   the phone's queue file as ios/App/App/WatchBridgePlugin.swift keeps it (WatchLink:
//                stored once by id, drained, acknowledged), shared by every watch
//   the link     WatchConnectivity as Apple documents it, one per watch: a message only gets through
//                while the other side is in reach and may fail; a user-info transfer is queued by
//                the system, delivered in order, survives either app being killed; the application
//                context holds only the newest snapshot
//   the watch    a port of what the watch apps do with all that: WatchCore's SessionCore
//                .applySnapshot / tick / start / finish, Outbox.swift, RestMath.phoneRest,
//                SnapshotOrder, and SessionStore's send / deliver / transferAll / flush.
//                `protocol: 1` is the watch as it shipped in 1.4.5's first builds; `protocol: 2`
//                (the default) is what docs/WATCH_SYNC.md asks of the native sides since the
//                watch-sync round: the rest by its stamp (`restAt`), its own +15 / −15 / Skip sent
//                as `rest` events and the end of the rest it started on each tick (`restEnd`), its
//                clock's offset worked out from the snapshots' `now` and sent as `off`, and every
//                set named by its id (`sid`), sets it adds or takes out included (addSet, removeSet).
//
// The port is the point: the Swift, Kotlin and Monkey C cannot run on the machine the tests run on,
// so the rules they follow are written down here a second time and run against the real page under
// every kind of bad link. When a watch changes, this changes with it (docs/WATCH_SYNC.md).
import { bindWatchActions, bindWatchAppActions, startWatchSync, patchSetIn, markDiscarded, ensureWatchSet, watchTickRest, applyRestStep, restAtFor, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'

const clone = v => JSON.parse(JSON.stringify(v))

/* ---------- Outbox.swift ---------- */

export const RESEND_MS = 20_000
export const REDELIVER_MS = 10 * 60_000
export const OUTBOX_LIMIT = 1000

export const OutboxCore = {
  add (o, event) {
    if (typeof event.id !== 'string' || !event.id) return null
    const have = o.items.find(x => x.id === event.id)
    if (have) return [o, have]
    const seq = o.seq + 1
    const item = { id: event.id, seq, json: JSON.stringify({ ...event, seq }), sentAt: 0, delivered: false }
    // Only the newest waiting status is kept (OutboxCore.latestOnly).
    const kept = event.type === 'watchStatus' ? o.items.filter(x => JSON.parse(x.json).type !== 'watchStatus') : o.items
    return [{ seq, items: [...kept, item].slice(-OUTBOX_LIMIT) }, item]
  },
  ack: (o, ids) => (ids && ids.length ? { ...o, items: o.items.filter(x => !ids.includes(x.id)) } : o),
  sent: (o, ids, now) => ({ ...o, items: o.items.map(x => (ids.includes(x.id) ? { ...x, sentAt: now } : x)) }),
  delivered: (o, ids) => ({ ...o, items: o.items.map(x => (ids.includes(x.id) ? { ...x, delivered: true } : x)) }),
  due: (o, now) => o.items.filter(x => x.sentAt === 0 || now < x.sentAt || now - x.sentAt >= (x.delivered ? REDELIVER_MS : RESEND_MS)).sort((a, b) => a.seq - b.seq),
  onReconnect (o, now) {
    const soon = OutboxCore.due(o, now).map(x => x.id)
    return o.items.filter(x => !x.delivered || soon.includes(x.id)).sort((a, b) => a.seq - b.seq)
  },
}

/* ---------- SessionCore.swift ---------- */

// Protocol 1 keys a pending tick by exercise and set (`exId#setIdx`): one exercise twice in a
// workout shares them (#1162 case 3). Protocol 2 by the set's id, else by entry, exercise and set.
const key1 = (exId, si) => `${exId}#${si}`
const posKey = (ei, exId, si) => `e${ei}:${exId}#${si}`
const sidKey = sid => `s:${sid}`
const freshState = () => ({ workout: null, ready: null, unit: 'kg', restSec: 90, startedHere: null, startId: null, finishedHere: [], pending: {}, edits: [], entryIndex: 0 })
const findSid = (w, sid) => {
  if (!sid || !w?.entries) return null
  for (let i = 0; i < w.entries.length; i++) { const j = w.entries[i].sets.findIndex(s => s.sid === sid); if (j >= 0) return [i, j] }
  return null
}

/** A set the watch added or took out, over a snapshot that does not have that yet (protocol 2). */
function replayEdit (w, ed) {
  const hit = findSid(w, ed.sid)
  if (ed.type === 'removeSet') {
    if (!hit) return
    const row = w.entries[hit[0]].sets[hit[1]]
    if (!row.done && w.entries[hit[0]].sets.length > 1) w.entries[hit[0]].sets.splice(hit[1], 1)
    return
  }
  if (hit) return
  const after = findSid(w, ed.after)
  const ei = after ? after[0] : (w.entries[ed.entryIdx]?.id === ed.exId ? ed.entryIdx : w.entries.findIndex(e => e.id === ed.exId))
  if (ei < 0) return
  const sets = w.entries[ei].sets
  sets.splice(after ? after[1] + 1 : sets.length, 0, { w: ed.w ?? null, r: ed.r ?? null, sec: null, done: false, warmup: false, sid: ed.sid })
}

export const SessionCore = {
  applySnapshot (s0, snap, { v2 = false } = {}) {
    const s = clone(s0)
    if (!s.edits) s.edits = []
    s.ready = snap.ready ?? null
    if (snap.unit) s.unit = snap.unit
    if (snap.restSec > 0) s.restSec = snap.restSec
    const acked = snap.acked || []
    if (s.startedHere != null && s.startId && acked.includes(s.startId)) { s.startedHere = null; s.startId = null }
    if (acked.length) for (const k of Object.keys(s.pending)) if (s.pending[k].id && acked.includes(s.pending[k].id)) delete s.pending[k]
    if (acked.length) s.edits = s.edits.filter(ed => !acked.includes(ed.id))
    const wid = s.workout?.id ?? null
    const droppedThere = wid != null && (snap.discarded || []).includes(wid)
    if (droppedThere && wid === s.startedHere) s.startedHere = null
    const unconfirmed = wid != null && wid === s.startedHere
    const next = snap.active ? clone(snap.active) : null
    if (!next || (next.id != null && s.finishedHere.includes(next.id))) {
      if (unconfirmed) return s
      s.workout = null
      s.pending = {}
      s.edits = []
      return s
    }
    const same = next.id != null && next.id === wid
    if (next.id != null && next.id === s.startedHere) { s.startedHere = null; s.startId = null }
    if (!same && unconfirmed) return s
    if (!same) { s.pending = {}; s.edits = []; s.entryIndex = next.cur }
    // Protocol 2: the sets the watch added or took out first (their ticks may be on them), in the
    // watch's order; then its ticks, by the set's id.
    if (v2) for (const ed of s.edits) replayEdit(next, ed)
    next.entries.forEach((e, ei) => e.sets.forEach((row, si) => {
      let k = key1(e.id, si)
      if (v2) k = row.sid && s.pending[sidKey(row.sid)] ? sidKey(row.sid) : posKey(ei, e.id, si)
      const p = s.pending[k]
      if (!p) return
      // The row's time is the phone's clock; the pending tick's the watch's own (off: the gap).
      const off = v2 ? p.off || 0 : 0
      if (row.done && (row.at ?? Infinity) + off >= p.at) delete s.pending[k]
      else Object.assign(next.entries[ei].sets[si], { done: true, w: p.w ?? row.w, r: p.r ?? row.r, at: p.at - off })
    }))
    if (same && s0.workout.cur !== next.cur) s.entryIndex = next.cur
    s.entryIndex = Math.min(Math.max(0, s.entryIndex), next.entries.length)
    s.workout = next
    return s
  },
  tick (s0, ei, si, { w, r, at, id, v2 = false, off = 0, restEnd = null }) {
    const row = s0.workout?.entries?.[ei]?.sets?.[si]
    if (!row) return [s0, null]
    const s = clone(s0)
    const e = s.workout.entries[ei]
    Object.assign(e.sets[si], { done: true, at: at - (v2 ? off : 0), ...(w != null ? { w } : {}), ...(r != null ? { r } : {}) })
    const k = v2 ? (row.sid ? sidKey(row.sid) : posKey(ei, e.id, si)) : key1(e.id, si)
    s.pending[k] = { w, r, at, id, ...(v2 ? { off } : {}) }
    const ev = { id, type: 'setDone', wid: s.workout.id ?? '', exId: e.id, entryIdx: ei, setIdx: si, at, ...(w != null ? { w } : {}), ...(r != null ? { r } : {}) }
    if (v2) Object.assign(ev, { off, restEnd: restEnd ?? 0, ...(row.sid ? { sid: row.sid } : {}) })
    return [s, ev]
  },
  start (s0, session, { wid, at, id }) {
    const s = clone(s0)
    s.workout = { id: wid, name: session.name, unit: s.unit, cur: 0, restSec: s.restSec, rest: null, entries: clone(session.entries), start: at }
    Object.assign(s, { startedHere: wid, startId: id, pending: {}, edits: [], entryIndex: 0 })
    return [s, { id, type: 'start', routineIds: session.routineIds, wid, at }]
  },
  finish (s0, { at, id, discard = false, idle = false }) {
    if (!s0.workout) return [s0, null]
    const s = clone(s0)
    const wid = s0.workout.id
    Object.assign(s, { workout: null, pending: {}, edits: [], startedHere: null, startId: null })
    if (wid) s.finishedHere = [...s.finishedHere, wid].slice(-5)
    return [s, { id, type: discard ? 'discard' : 'finish', wid: wid ?? '', at, ...(idle && !discard ? { idle: true } : {}) }]
  },
}

/** SnapshotOrder.swift: an older stamp than the newest applied is skipped; a long way back is a clock that jumped. */
export const snapshotAccepted = (at, last) => !(at > 0) || last == null || at >= last || last - at > 6 * 3600

/** RestMath.phoneRest (protocol 1, and protocol 2 with a phone that sends no `restAt`). */
export const phoneRest = (end, last, echo) => (end == null ? { last: null, start: false } : end === last ? { last, start: false } : { last: end, start: !echo })

/**
 * Protocol 2's clock offset (watchClock − phoneClock, ms): the smallest of the last few gaps between
 * a snapshot's `now` and the watch's clock when it came in. A late snapshot only makes a gap bigger.
 */
export const OFF_SAMPLES = 8
export function offsetFrom (samples) { return samples.length ? Math.min(...samples) : 0 }

/* ---------- the phone, its watches and the links between them ---------- */

/**
 * `routines`: { rid: { name, entries } } as the phone builds a session from them; the watch can
 * start any of them by itself (its `ready`, as if an earlier snapshot had brought them).
 * `restSec`: the rest the phone starts for a set ticked (0: none, as the first tests had it).
 * `protocol`: the first watch's protocol (1 or 2).
 */
export function makeWorld ({ routines = {}, vi, rand = Math.random, pageInBackground = false, restSec = 0, protocol = 2 } = {}) {
  let n = 0
  const uid = p => `${p}${++n}`
  const W = {
    near: true,
    /** How messages from the watch go: 'ok', 'lost' (never arrives), 'replyLost' (stored, answer lost). */
    messageFate: () => 'ok',
    /** Whether a snapshot's live message to the watch gets through (the application context always does, later). */
    snapshotMessage: () => true,
    /** How long the application context takes to reach the watch (ms). */
    contextDelay: () => 0,
    /** How long a user-info transfer takes once the two are in reach (ms). */
    transferDelay: () => 0,
    log: [],
    routines: clone(routines),
    restSec,
    pageInBackground,
  }

  /* ----- the phone ----- */

  // What is on the phone's disk: the app's copy of S, the native queue file, localStorage (the
  // page's applied list and the rest's stamp live there; happy-dom's is shared and survives a
  // "kill" by itself).
  const phone = W.phone = { app: 'front', S: { unit: 'kg', restSec: 90, workouts: [], routines: [], week: {}, dayPlan: {}, active: null }, queueFile: [], page: null, timer: null }
  const subs = new Set(), uiSubs = new Set()
  const storeState = () => ({ S: phone.S, ready: true, tourSandbox: false, saveNow: async () => {}, update })
  let last = storeState()
  function update (fn) {
    const S = clone(phone.S); fn(S); phone.S = S
    const prev = last; last = storeState()
    for (const f of [...subs]) f(last, prev)
  }
  const useStore = { getState: () => last, subscribe: fn => { subs.add(fn); return () => subs.delete(fn) } }

  // The rest timer, by store/useUI.js's rules (the parts the watch link touches).
  const setTimer = t => { const prev = { timer: phone.timer }; phone.timer = t; for (const f of [...uiSubs]) f({ timer: t }, prev) }
  const leftOf = endsAt => Math.max(1, Math.round((endsAt - Date.now()) / 1000))
  const ui = {
    startRest (sec) { setTimer(sec > 0 ? { left: sec, total: sec, endsAt: Date.now() + sec * 1000 } : null) },
    stopRest () { if (phone.timer) setTimer(null) },
    skipRest () { if (phone.timer) setTimer(null) },
    addRest (sec) {
      const t = phone.timer
      if (!t) return
      if (t.ready) { if (sec > 0) ui.startRest(sec); else ui.stopRest(); return }
      if (t.paused) { const left = t.left + sec; if (left <= 0) ui.stopRest(); else setTimer({ ...t, left, total: Math.max(t.total, left) }); return }
      const endsAt = t.endsAt + sec * 1000
      if (endsAt <= Date.now()) { ui.skipRest(); return }
      setTimer({ ...t, endsAt, left: leftOf(endsAt), total: Math.max(t.total, leftOf(endsAt)) })
    },
    pauseRest () { const t = phone.timer; if (t && !t.ready && !t.paused) setTimer({ ...t, paused: true, left: leftOf(t.endsAt) }) },
    resumeRest () { const t = phone.timer; if (t?.paused) { const { paused, ...rest } = t; setTimer({ ...rest, endsAt: Date.now() + t.left * 1000 }) } },
    alignRest (endsAt) {
      if (!(endsAt > Date.now() + 500)) { ui.stopRest(); return }
      const t = phone.timer && !phone.timer.ready ? phone.timer : null
      const { paused, ...rest } = t || {}
      setTimer({ ...rest, endsAt, left: leftOf(endsAt), total: Math.max(t?.total || 0, leftOf(endsAt)) })
    },
    putRest (tm) { setTimer(tm && !tm.ready ? clone(tm) : null) },
  }
  const useUI = { getState: () => ({ timer: phone.timer, ...ui }), subscribe: fn => { uiSubs.add(fn); return () => uiSubs.delete(fn) } }
  /** The rest runs out by itself: its Ready, as useUI's tick sets it. */
  const restTick = () => { const t = phone.timer; if (t && !t.ready && !t.paused && t.endsAt <= Date.now()) setTimer({ ...t, left: 0, ready: true }) }
  const pageRuns = () => phone.page && (phone.app === 'front' || W.pageInBackground)
  // What the page reads to tell the front from the background (its visibilitychange listener).
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (phone.app === 'front' ? 'visible' : 'hidden') })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => phone.app !== 'front' })
  } catch { /* a document that will not have it: the page then never hears of the background */ }

  const bridge = {
    status: async () => ({ supported: true, activated: true, paired: true, installed: true, reachable: watches.some(w => w.reachable && w.running) }),
    // WatchBridgePlugin.sendSnapshot: the application context (the newest only), and a message
    // while the watch app is there; to every watch.
    sendSnapshot: async ({ json }) => {
      // Stamped in sending order, whatever the clock does (SnapshotOrder.stamp).
      phone.snapshotAt = Math.max(Date.now() / 1000, (phone.snapshotAt || 0) + 0.001)
      const payload = { snapshot: json, at: phone.snapshotAt }
      phone.sent = (phone.sent || 0) + 1
      for (const w of watches) {
        w.link.context = { payload, readyAt: Date.now() + W.contextDelay() }
        if (w.reachable && w.running && W.snapshotMessage()) w.receive(payload, { live: true })
      }
      return { sent: true }
    },
    sendClips: async () => ({}), dropClips: async () => ({}), openOnWatch: async () => ({ ok: true }),
    drain: async () => ({ events: clone(phone.queueFile) }),
    ack: async ({ ids }) => { phone.queueFile = phone.queueFile.filter(e => !ids.includes(e.id)) },
    addListener: async (name, fn) => { bridge.listeners[name] = fn; return { remove: () => { delete bridge.listeners[name] } } },
    listeners: {},
  }
  /** WatchLink.store: on disk before it answers, once by id. A message to an app that is not running launches it (iOS): `coldLaunch`. */
  const store = json => {
    const ev = JSON.parse(json)
    if (typeof ev.id !== 'string') return null
    if (!phone.queueFile.some(e => e.id === ev.id)) phone.queueFile.push(ev)
    return ev.id
  }
  const tellPage = () => {
    if (pageRuns()) bridge.listeners.watchEvent?.()
    // A watch's message wakes a phone app that was not running, in the background (W.coldLaunch).
    else if (!phone.page && W.coldLaunch && !phone.launching) { phone.launching = true; phone.launch({ app: 'back' }).finally(() => { phone.launching = false }) }
  }

  // The workout screen's own actions, as views/Workout.jsx binds them: of two ticks of one set the
  // later wins; the rest is the watch's when it says (watchTickRest); Finish saves the exercises
  // that have a set done.
  const screen = {
    setDone: (ei, si, { w, r, at, restEnd }) => {
      const set = phone.S.active?.entries?.[ei]?.sets?.[si]
      if (!set) return
      if (set.done && at && Number(set.at) > at) return
      const wasDone = set.done
      update(S => {
        const x = S.active.entries[ei].sets[si]
        if (w != null) x.w = w
        if (r != null) x.r = r
        x.done = true
        if (at) x.at = at
      })
      if (wasDone) return
      const before = phone.timer
      // the phone's own rule: a rest for the set just ticked
      if (W.restSec > 0) ui.startRest(W.restSec)
      const wid = phone.S.active.id
      applyRestStep(useUI, watchTickRest({ before, timer: phone.timer, at, restEnd, restAt: restAtFor(wid) }), { wid, at: at || Date.now() })
    },
    finish: ({ end } = {}) => phone.finish({ end }),
    discard: () => phone.discard(),
    idleKept: () => W.log.push('idleKept'),
  }
  const app = {
    start: (ids, { id, start }) => update(S => {
      const built = (ids || []).flatMap(rid => clone(W.routines[rid]?.entries || []))
      S.active = { id, start, d: 'day', name: W.routines[ids?.[0]]?.name || 'Freestyle', cur: 0, routineIds: ids, entries: built }
    }),
    patchSet: (where, fields, opts) => update(S => { patchSetIn(S, where, fields, w => { w.edited = Date.now() }, opts) }),
    // A set of an exercise (or past the rows) the running workout does not have: given its place.
    ensureSet: (where, fields) => { let ok = false; update(S => { ok = ensureWatchSet(S, where, exId => (W.unknown?.includes(exId) ? null : { id: exId, target: null, sets: [] }), fields) }); return ok },
    edit: fn => { let ok = false; update(S => { ok = !!fn(S) }); return ok },
    openWorkout: () => { phone.route = 'workout'; if (pageRuns()) bindScreen() },
    weighIn: () => {}, healthDeleted: () => {}, stillHere: () => {},
  }
  let unbindScreen = null
  const bindScreen = () => { unbindScreen?.(); unbindScreen = bindWatchActions(screen) }

  Object.assign(phone, {
    ui,
    /** The app launched (or the page reloaded): the page starts from what is on disk. `app: 'back'`: launched in the background by a watch's message. */
    async launch ({ route = phone.S.active ? 'workout' : 'home', app: state = 'front' } = {}) {
      if (phone.page) await phone.kill()
      phone.app = state
      phone.route = route
      _resetWatchSync()
      _setWatchPluginForTest(bridge)
      const unbindApp = bindWatchAppActions(app)
      if (route === 'workout') bindScreen()
      const stop = await startWatchSync({ useStore, useUI })
      phone.page = { stop: () => { stop(); unbindApp(); unbindScreen?.(); unbindScreen = null } }
    },
    /** Force-quit, or killed by iOS: the page is gone at once, the disk stays (a rest restored from it). */
    async kill () {
      phone.page?.stop()
      phone.page = null
      phone.app = 'dead'
      bridge.listeners = {}
      _resetWatchSync()
      // useUI's restoreRest on the next launch: a rest whose end is past is not brought back
      if (phone.timer && !phone.timer.paused && (phone.timer.ready || phone.timer.endsAt <= Date.now())) phone.timer = null
    },
    background () {
      if (phone.app !== 'front') return
      phone.app = 'back'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    foreground () {
      if (!phone.page) return phone.launch()
      phone.app = 'front'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    start (rid) {
      const wid = uid('phone-')
      update(S => { S.active = { id: wid, start: Date.now(), d: 'day', name: W.routines[rid].name, cur: 0, routineIds: [rid], entries: clone(W.routines[rid].entries) } })
      phone.route = 'workout'
      bindScreen()
      return wid
    },
    /** A tick on the phone: the set, and its rest (`rest` seconds, the world's by default). */
    tick (ei, si, { w, r, rest = W.restSec } = {}) {
      const at = Date.now()
      update(S => { const set = S.active.entries[ei].sets[si]; Object.assign(set, { done: true, at, ...(w != null ? { w } : {}), ...(r != null ? { r } : {}) }) })
      if (rest) ui.startRest(rest)
      return at
    },
    untick (ei, si) { update(S => { const set = S.active.entries[ei].sets[si]; set.done = false; delete set.at }) },
    edit (fn) { update(S => fn(S.active, S)) },
    stopRest () { ui.stopRest() },
    finish ({ end = null } = {}) {
      update(S => {
        const A = S.active
        if (!A) return
        S.workouts.push({ id: A.id, start: A.start, end: end || Date.now(), name: A.name, entries: A.entries.filter(e => e.sets.some(s => s.done)) })
        S.active = null
      })
      setTimer(null)
      phone.route = 'home'
      unbindScreen?.(); unbindScreen = null
    },
    discard () {
      markDiscarded(phone.S.active?.id)
      update(S => { S.active = null })
      setTimer(null)
      phone.route = 'home'
      unbindScreen?.(); unbindScreen = null
    },
    useStore,
    useUI,
  })

  /* ----- the watches, each with its link (WatchConnectivity) ----- */

  const watches = W.watches = []

  /** One more watch on this phone (`protocol` 1 or 2), with its own link and its own outbox. */
  W.addWatch = ({ protocol: proto = 2, name = `watch${watches.length + 1}` } = {}) => {
    const link = {
      /** The newest application context on its way to the watch, and the one the watch has. */
      context: null, received: null,
      /** transferUserInfo's queue: in order, kept by the system whatever happens to either app. */
      transfers: [],
      pump () {
        if (!watch.reachable) return
        while (link.transfers.length && link.transfers[0].readyAt <= Date.now()) {
          const t = link.transfers.shift()
          store(t.event)
          tellPage()
          // didFinish reaches the watch app only while it runs.
          if (watch.running) watch.didFinishTransfer(t.id)
        }
        if (link.context && link.context.readyAt <= Date.now()) {
          const { payload } = link.context
          link.context = null
          link.received = payload
          if (watch.running) watch.receive(payload)
        }
      },
    }
    const v2 = proto >= 2
    const watch = {
      name,
      protocol: proto,
      link,
      running: false,
      /** This watch alone out of reach (another watch can be in reach meanwhile). */
      away: false,
      /** How far the watch's clock is off the phone's (ms). */
      skew: 0,
      disk: { state: freshState(), box: { items: [], seq: 0 }, restAt: 0 },
      /** The sessions the watch can start by itself, as an earlier snapshot brought them (its copy can be stale). */
      sessions: readyOf(W.routines),
      now: () => Date.now() + watch.skew,
      get reachable () { return W.near && !watch.away },
      get workout () { return watch.state?.workout ?? watch.disk.state.workout },
      get outbox () { return watch.disk.box.items },
      /** Protocol 2: the clock offset it works with now (ms, watch − phone). */
      get off () { return v2 ? offsetFrom(watch.offSamples || []) : 0 },
      /** The rest on the wrist, on the watch's clock, when one runs (one whose end is past is over). */
      get rest () { return watch.restEndsAt && watch.restEndsAt > watch.now() ? watch.restEndsAt : null },

      launch () {
        watch.state = clone(watch.disk.state)
        Object.assign(watch, { running: true, snapshotAt: null, phoneRestEnd: null, echoOf: null, restEndsAt: watch.disk.restEndsAt ?? null, restPausedLeft: null, generation: (watch.generation || 0) + 1 })
        // activationDidComplete: the newest context, what waits in the outbox, the watch's status.
        if (link.received) watch.receive(link.received)
        watch.flush(true)
        watch.send({ id: uid('st-'), type: 'watchStatus', health: 'off', version: 'sim', at: watch.now() })
      },
      kill () { watch.running = false },
      setState (s) { watch.state = s; watch.disk.state = clone(s) },
      setRest (end) { watch.restEndsAt = end; watch.disk.restEndsAt = end; if (end) watch.restPausedLeft = null },
      editBox (fn) { watch.disk.box = fn(watch.disk.box) },
      /** Protocol 2: this watch made or followed a rest change at `atPhone` (phone clock). */
      stampRest (atPhone) { watch.disk.restAt = atPhone },

      /** SessionStore.receive + apply. `live`: came as a message (else the application context). */
      receive (payload) {
        if (!snapshotAccepted(payload.at, watch.snapshotAt)) { W.log.push('older snapshot skipped'); return }
        if (payload.at > 0) watch.snapshotAt = payload.at
        const snap = JSON.parse(payload.snapshot)
        // Protocol 2: the clock's offset, from the phone's `now` (only ever an upper bound).
        if (v2 && typeof snap.now === 'number') watch.offSamples = [...(watch.offSamples || []), watch.now() - snap.now].slice(-OFF_SAMPLES)
        const before = watch.state
        watch.setState(SessionCore.applySnapshot(before, snap, { v2 }))
        const next = watch.state
        if (before.workout && !next.workout) { watch.setRest(null); watch.disk.restAt = 0 }
        if (next.workout && next.workout.id !== before.workout?.id) watch.disk.restAt = 0
        const ours = next.workout && next.workout.id === snap.active?.id
        const A = snap.active
        if (v2 && ours && typeof A.restAt === 'number') {
          // The phone's rest by its stamp: a change newer than this watch's newest is followed (a
          // start, ±15, a pause, a Skip: rest null), an older one or the same never.
          if (A.restAt > watch.disk.restAt) {
            watch.disk.restAt = A.restAt
            const off = watch.off
            if (A.rest?.endsAt) {
              const end = A.rest.endsAt + off
              if (end > watch.now()) { if (Math.abs((watch.restEndsAt || 0) - end) > 250) watch.setRest(end) } else watch.setRest(null)
            } else if (A.restPaused) { watch.setRest(null); watch.restPausedLeft = A.restLeft ?? null } else { watch.setRest(null); watch.restPausedLeft = null }
          }
        } else {
          const echo = watch.echoOf != null && (snap.acked || []).includes(watch.echoOf)
          if (echo) watch.echoOf = null
          const step = phoneRest(ours ? A?.rest?.endsAt ?? null : null, watch.phoneRestEnd, echo)
          watch.phoneRestEnd = step.last
          if (step.start && step.last > watch.now()) watch.setRest(step.last)
        }
        // phoneApplied
        if (snap.acked?.length) watch.editBox(o => OutboxCore.ack(o, snap.acked))
        watch.flush()
      },

      send (event) {
        const added = OutboxCore.add(watch.disk.box, event)
        if (!added) return
        watch.disk.box = added[0]
        if (event.type === 'setDone') watch.echoOf = event.id
        watch.deliver([added[1]])
      },
      deliver (items) {
        if (!items.length || !watch.running) return
        const ids = items.map(x => x.id)
        watch.editBox(o => OutboxCore.sent(o, ids, watch.now()))
        if (!watch.reachable) { watch.transferAll(items); return }
        for (let i = 0; i < items.length; i += 40) {
          const batch = items.slice(i, i + 40)
          const fate = W.messageFate()
          const got = fate === 'lost' ? [] : batch.map(x => store(x.json)).filter(Boolean)
          if (got.length) tellPage()
          const gen = watch.generation
          // The answer (or the error) comes back a moment later, to the app that is still running.
          setTimeout(() => {
            if (!watch.running || watch.generation !== gen) return
            if (fate !== 'ok') { watch.transferAll(batch); return }
            watch.editBox(o => OutboxCore.delivered(o, got))
            watch.transferAll(batch.filter(x => !got.includes(x.id)))
          }, 30)
        }
      },
      transferAll (items) {
        const outstanding = link.transfers.map(t => t.id)
        for (const item of items) if (!outstanding.includes(item.id)) link.transfers.push({ id: item.id, event: item.json, readyAt: Date.now() + W.transferDelay() })
      },
      flush (reconnect = false) {
        if (!watch.running) return
        const o = watch.disk.box
        watch.deliver(reconnect ? OutboxCore.onReconnect(o, watch.now()) : OutboxCore.due(o, watch.now()))
      },
      didFinishTransfer (id) { watch.editBox(o => OutboxCore.delivered(o, [id])) },
      reachabilityChanged () { if (watch.running && watch.reachable) watch.flush(true) },

      /* what the lifter does on the wrist */

      start (rid, { crash = false } = {}) {
        const session = watch.sessions.find(r => r.routineIds[0] === rid)
        const [next, ev] = SessionCore.start(watch.state, session, { wid: uid('watch-'), at: watch.now(), id: uid('ev-') })
        if (v2) ev.off = watch.off
        watch.send(ev)
        if (crash) { watch.kill(); return ev.wid }
        watch.setState(next)
        watch.disk.restAt = 0
        return ev.wid
      },
      /**
       * Done on the set up next of exercise `ei` (or on `si`). `rest`: the seconds of the rest the
       * watch starts for it (the world's by default). `crash`: killed after the send, before the save.
       */
      tick (ei, si, { w, r, rest = W.restSec, crash = false } = {}) {
        const e = watch.state.workout?.entries?.[ei]
        if (si == null) si = e?.sets.findIndex(s => !s.done)
        const row = e?.sets?.[si]
        if (!row) return null
        const off = watch.off
        // SetFix.correct for a set already done: after its own time (phone clock + offset), never before.
        const at = row.done ? Math.max(watch.now(), (row.at || 0) + (v2 ? off : 0) + 1) : watch.now()
        const restEnd = rest ? at + rest * 1000 : 0
        const [next, ev] = SessionCore.tick(watch.state, ei, si, { w: w ?? row.w, r: r ?? row.r, at, id: uid('ev-'), v2, off, restEnd })
        // A correction of a set done before starts no rest (as the phone's re-tick does not).
        if (v2 && row.done) delete ev.restEnd
        watch.send(ev)
        if (crash) { watch.kill(); return ev }
        watch.setState(next)
        if (!row.done) {
          watch.setRest(rest ? restEnd : null)
          if (v2) watch.stampRest(at - off)
        }
        return ev
      },
      /** +15 / −15 on the wrist (protocol 2 tells the phone; protocol 1 kept it to itself). */
      addRest (sec) {
        if (!watch.rest) return null
        const end = watch.restEndsAt + sec * 1000
        return watch.restChange(end > watch.now() ? end : null)
      },
      skipRest () { if (!watch.rest) return null; return watch.restChange(null) },
      restChange (end) {
        watch.setRest(end)
        if (!v2 || !watch.workout) return null
        const at = watch.now(), off = watch.off
        watch.stampRest(at - off)
        const ev = { id: uid('ev-'), type: 'rest', wid: watch.workout.id ?? '', endsAt: end, at, off }
        watch.send(ev)
        return ev
      },
      /** The set menu (#1139, #1185), protocol 2: a set added after `afterSi` of exercise `ei`, or the set `si` taken out. */
      addSet (ei, { afterSi = null, w = null, r = null } = {}) {
        if (!v2 || !watch.workout) return null
        const e = watch.workout.entries[ei]
        const after = afterSi != null ? e.sets[afterSi]?.sid ?? null : null
        const ev = { id: uid('ev-'), type: 'addSet', wid: watch.workout.id ?? '', exId: e.id, entryIdx: ei, sid: uid('w-'), ...(after ? { after } : {}), ...(w != null ? { w } : {}), ...(r != null ? { r } : {}), at: watch.now(), off: watch.off }
        return watch.edit(ev)
      },
      removeSet (ei, si) {
        if (!v2 || !watch.workout) return null
        const row = watch.workout.entries[ei]?.sets?.[si]
        if (!row?.sid || row.done) return null
        return watch.edit({ id: uid('ev-'), type: 'removeSet', wid: watch.workout.id ?? '', exId: watch.workout.entries[ei].id, entryIdx: ei, setIdx: si, sid: row.sid, at: watch.now(), off: watch.off })
      },
      edit (ev) {
        const s = clone(watch.state)
        s.edits = [...(s.edits || []), ev]
        replayEdit(s.workout, ev)
        watch.send(ev)
        watch.setState(s)
        return ev
      },
      finish (opts = {}) {
        const [next, ev] = SessionCore.finish(watch.state, { at: watch.now(), id: uid('ev-'), ...opts })
        if (!ev) return null
        if (v2) ev.off = watch.off
        watch.setRest(null)
        watch.send(ev)
        watch.setState(next)
        return ev
      },
      discard () { return watch.finish({ discard: true }) },
    }
    watch.state = clone(watch.disk.state)
    watches.push(watch)
    return watch
  }

  W.watch = W.addWatch({ protocol })
  W.link = W.watch.link

  Object.assign(W, {
    /** In reach of each other or not (Bluetooth off, the phone in the locker, airplane mode). */
    setNear (v) {
      if (W.near === v) return
      W.near = v
      if (v) for (const w of watches) { w.link.pump(); w.reachabilityChanged() }
    },
    /** One watch alone in or out of reach. */
    setAway (watch, v) {
      if (watch.away === v) return
      watch.away = v
      if (!v) { watch.link.pump(); watch.reachabilityChanged() }
    },
    /** Time passes: timers run, transfers and the context arrive, the phone's rest runs out. */
    async run (ms = 1000) {
      for (let left = ms; left > 0; left -= 100) {
        for (const w of watches) w.link.pump()
        restTick()
        await vi.advanceTimersByTimeAsync(Math.min(100, left))
      }
      for (const w of watches) w.link.pump()
      restTick()
      await vi.advanceTimersByTimeAsync(0)
    },
    /**
     * Everything comes to rest: both apps open, in reach, and long enough for the outbox to send
     * again what the phone stored but had not applied (the watch app coming back to the front is
     * what flushes it).
     */
    async settle () {
      W.messageFate = () => 'ok'; W.snapshotMessage = () => true; W.contextDelay = () => 0; W.transferDelay = () => 0
      W.setNear(true)
      for (const w of watches) W.setAway(w, false)
      if (!phone.page || phone.app !== 'front') await phone.foreground()
      for (const w of watches) if (!w.running) w.launch()
      for (let i = 0; i < 4; i++) {
        await W.run(3000)
        if (watches.every(w => !w.outbox.length && !w.link.transfers.length) && !phone.queueFile.length) break
        await W.run(REDELIVER_MS + 1000)
        for (const w of watches) w.reachabilityChanged()
      }
    },
    /**
     * How far apart the phone's rest and a watch's are, in ms of real time, or null when they agree
     * there is none. Infinity when one has a rest and the other has none.
     */
    restGap (watch = W.watch) {
      const t = phone.timer
      const p = t && !t.ready && !t.paused && t.endsAt > Date.now() ? t.endsAt : null
      const w = watch.rest ? watch.restEndsAt - watch.skew : null
      if (p == null && w == null) return null
      if (p == null || w == null) return Infinity
      return Math.abs(p - w)
    },
  })

  return W
}

/** The phone's routines as sessions the watch can start. */
export function readyOf (routines) {
  return Object.entries(routines).map(([rid, r]) => ({ routineIds: [rid], name: r.name, entries: r.entries.map(watchEntryOf) }))
}
const watchEntryOf = e => ({ id: e.id, name: e.id, mode: 'reps', restSec: null, last: null, sets: e.sets.map(s => ({ w: s.w ?? null, r: s.r ?? null, sec: null, done: false, warmup: false })) })

/** A small seeded generator (mulberry32), for runs that can be repeated. */
export function seeded (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
