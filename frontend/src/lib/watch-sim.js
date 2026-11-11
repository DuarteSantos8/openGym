// A whole phone and watch in one process, for the tests of the watch link (watch-sync.sim.test.js,
// watch-sync.property.test.js). Never imported by the app.
//
//   the page     the real lib/watch-sync.js, started over a fake WatchBridge and a small store
//   the native   the phone's queue file as ios/App/App/WatchBridgePlugin.swift keeps it (WatchLink:
//                stored once by id, drained, acknowledged)
//   the link     WatchConnectivity as Apple documents it: a message only gets through while the
//                other side is in reach and may fail; a user-info transfer is queued by the
//                system, delivered in order, survives either app being killed; the application
//                context holds only the newest snapshot
//   the watch    a line-by-line port of what the watch app does with all that: WatchCore's
//                SessionCore.applySnapshot / tick / start / finish, Outbox.swift, RestMath.phoneRest,
//                SnapshotOrder, and SessionStore's send / deliver / transferAll / flush
//
// The port is the point: the Swift cannot run on the machine the tests run on, so the rules it
// follows are written down here a second time and run against the real page under every kind of
// bad link. When the Swift changes, this changes with it (docs/WATCH_SYNC.md).
import { bindWatchActions, bindWatchAppActions, startWatchSync, patchSetIn, markDiscarded, ensureWatchSet, _setWatchPluginForTest, _resetWatchSync } from './watch-sync.js'

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

const key = (exId, si) => `${exId}#${si}`
const freshState = () => ({ workout: null, ready: null, unit: 'kg', restSec: 90, startedHere: null, startId: null, finishedHere: [], pending: {}, entryIndex: 0 })

export const SessionCore = {
  applySnapshot (s0, snap) {
    const s = clone(s0)
    s.ready = snap.ready ?? null
    if (snap.unit) s.unit = snap.unit
    if (snap.restSec > 0) s.restSec = snap.restSec
    const acked = snap.acked || []
    if (s.startedHere != null && s.startId && acked.includes(s.startId)) { s.startedHere = null; s.startId = null }
    if (acked.length) for (const k of Object.keys(s.pending)) if (s.pending[k].id && acked.includes(s.pending[k].id)) delete s.pending[k]
    const wid = s.workout?.id ?? null
    const droppedThere = wid != null && (snap.discarded || []).includes(wid)
    if (droppedThere && wid === s.startedHere) s.startedHere = null
    const unconfirmed = wid != null && wid === s.startedHere
    const next = snap.active ? clone(snap.active) : null
    if (!next || (next.id != null && s.finishedHere.includes(next.id))) {
      if (unconfirmed) return s
      s.workout = null
      s.pending = {}
      return s
    }
    const same = next.id != null && next.id === wid
    if (next.id != null && next.id === s.startedHere) { s.startedHere = null; s.startId = null }
    if (!same && unconfirmed) return s
    if (!same) { s.pending = {}; s.entryIndex = next.cur }
    next.entries.forEach((e, ei) => e.sets.forEach((row, si) => {
      const k = key(e.id, si)
      const p = s.pending[k]
      if (!p) return
      if (row.done && (row.at ?? Infinity) >= p.at) delete s.pending[k]
      else Object.assign(next.entries[ei].sets[si], { done: true, w: p.w ?? row.w, r: p.r ?? row.r, at: p.at })
    }))
    if (same && s0.workout.cur !== next.cur) s.entryIndex = next.cur
    s.entryIndex = Math.min(Math.max(0, s.entryIndex), next.entries.length)
    s.workout = next
    return s
  },
  tick (s0, ei, si, { w, r, at, id }) {
    const row = s0.workout?.entries?.[ei]?.sets?.[si]
    if (!row) return [s0, null]
    const s = clone(s0)
    const e = s.workout.entries[ei]
    Object.assign(e.sets[si], { done: true, at, ...(w != null ? { w } : {}), ...(r != null ? { r } : {}) })
    s.pending[key(e.id, si)] = { w, r, at, id }
    return [s, { id, type: 'setDone', wid: s.workout.id ?? '', exId: e.id, entryIdx: ei, setIdx: si, at, ...(w != null ? { w } : {}), ...(r != null ? { r } : {}) }]
  },
  start (s0, session, { wid, at, id }) {
    const s = clone(s0)
    s.workout = { id: wid, name: session.name, unit: s.unit, cur: 0, restSec: s.restSec, rest: null, entries: clone(session.entries), start: at }
    Object.assign(s, { startedHere: wid, startId: id, pending: {}, entryIndex: 0 })
    return [s, { id, type: 'start', routineIds: session.routineIds, wid, at }]
  },
  finish (s0, { at, id, discard = false, idle = false }) {
    if (!s0.workout) return [s0, null]
    const s = clone(s0)
    const wid = s0.workout.id
    Object.assign(s, { workout: null, pending: {}, startedHere: null, startId: null })
    if (wid) s.finishedHere = [...s.finishedHere, wid].slice(-5)
    return [s, { id, type: discard ? 'discard' : 'finish', wid: wid ?? '', at, ...(idle && !discard ? { idle: true } : {}) }]
  },
}

/** SnapshotOrder.swift: an older stamp than the newest applied is skipped; a long way back is a clock that jumped. */
export const snapshotAccepted = (at, last) => !(at > 0) || last == null || at >= last || last - at > 6 * 3600

/** RestMath.phoneRest. */
export const phoneRest = (end, last, echo) => (end == null ? { last: null, start: false } : end === last ? { last, start: false } : { last: end, start: !echo })

/* ---------- the two devices and the link between them ---------- */

/**
 * `routines`: { rid: { name, entries } } as the phone builds a session from them; the watch can
 * start any of them by itself (its `ready`, as if an earlier snapshot had brought them).
 */
export function makeWorld ({ routines = {}, vi, rand = Math.random, pageInBackground = false } = {}) {
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
  }

  /* ----- the phone ----- */

  // What is on the phone's disk: the app's copy of S, the native queue file, localStorage (the
  // page's applied list lives there; happy-dom's is shared and survives a "kill" by itself).
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
  const setTimer = t => { const prev = { timer: phone.timer }; phone.timer = t; for (const f of [...uiSubs]) f({ timer: t }, prev) }
  const useUI = { getState: () => ({ timer: phone.timer }), subscribe: fn => { uiSubs.add(fn); return () => uiSubs.delete(fn) } }
  const pageRuns = () => phone.page && (phone.app === 'front' || pageInBackground)

  const bridge = {
    status: async () => ({ supported: true, activated: true, paired: true, installed: true, reachable: W.near && watch.running }),
    // WatchBridgePlugin.sendSnapshot: the application context (the newest only), and a message
    // while the watch app is there.
    sendSnapshot: async ({ json }) => {
      // Stamped in sending order, whatever the clock does (SnapshotOrder.stamp).
      phone.snapshotAt = Math.max(Date.now() / 1000, (phone.snapshotAt || 0) + 0.001)
      const payload = { snapshot: json, at: phone.snapshotAt }
      link.context = { payload, readyAt: Date.now() + W.contextDelay() }
      if (W.near && watch.running && W.snapshotMessage()) watch.receive(payload)
      return { sent: true }
    },
    sendClips: async () => ({}), dropClips: async () => ({}), openOnWatch: async () => ({ ok: true }),
    drain: async () => ({ events: clone(phone.queueFile) }),
    ack: async ({ ids }) => { phone.queueFile = phone.queueFile.filter(e => !ids.includes(e.id)) },
    addListener: async (name, fn) => { bridge.listeners[name] = fn; return { remove: () => { delete bridge.listeners[name] } } },
    listeners: {},
  }
  /** WatchLink.store: on disk before it answers, once by id. */
  const store = json => {
    const ev = JSON.parse(json)
    if (typeof ev.id !== 'string') return null
    if (!phone.queueFile.some(e => e.id === ev.id)) phone.queueFile.push(ev)
    return ev.id
  }
  const tellPage = () => { if (pageRuns()) bridge.listeners.watchEvent?.() }

  // The workout screen's own actions, as views/Workout.jsx binds them: of two ticks of one set the
  // later wins; Finish saves the exercises that have a set done.
  const screen = {
    setDone: (ei, si, { w, r, at }) => update(S => {
      const set = S.active?.entries?.[ei]?.sets?.[si]
      if (!set) return
      if (set.done && at && Number(set.at) > at) return
      if (w != null) set.w = w
      if (r != null) set.r = r
      set.done = true
      if (at) set.at = at
    }),
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
    openWorkout: () => { phone.route = 'workout'; if (pageRuns()) bindScreen() },
    weighIn: () => {}, healthDeleted: () => {}, stillHere: () => {},
  }
  let unbindScreen = null
  const bindScreen = () => { unbindScreen?.(); unbindScreen = bindWatchActions(screen) }

  Object.assign(phone, {
    /** The app launched (or the page reloaded): the page starts from what is on disk. */
    async launch ({ route = phone.S.active ? 'workout' : 'home' } = {}) {
      if (phone.page) await phone.kill()
      phone.app = 'front'
      phone.route = route
      _resetWatchSync()
      _setWatchPluginForTest(bridge)
      const unbindApp = bindWatchAppActions(app)
      if (route === 'workout') bindScreen()
      const stop = await startWatchSync({ useStore, useUI })
      phone.page = { stop: () => { stop(); unbindApp(); unbindScreen?.(); unbindScreen = null } }
    },
    /** Force-quit, or killed by iOS: the page is gone at once, the disk stays. */
    async kill () {
      phone.page?.stop()
      phone.page = null
      phone.app = 'dead'
      bridge.listeners = {}
      _resetWatchSync()
    },
    background () { if (phone.app === 'front') phone.app = 'back' },
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
    tick (ei, si, { w, r, rest = 0 } = {}) {
      const at = Date.now()
      update(S => { const set = S.active.entries[ei].sets[si]; Object.assign(set, { done: true, at, ...(w != null ? { w } : {}), ...(r != null ? { r } : {}) }) })
      if (rest) setTimer({ endsAt: at + rest * 1000 })
      return at
    },
    untick (ei, si) { update(S => { const set = S.active.entries[ei].sets[si]; set.done = false; delete set.at }) },
    edit (fn) { update(S => fn(S.active, S)) },
    stopRest () { setTimer(null) },
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
  })

  /* ----- the link (WatchConnectivity) ----- */

  const link = W.link = {
    /** The newest application context on its way to the watch, and the one the watch has. */
    context: null, received: null,
    /** transferUserInfo's queue: in order, kept by the system whatever happens to either app. */
    transfers: [],
    pump () {
      if (!W.near) return
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

  /* ----- the watch ----- */

  const watch = W.watch = {
    running: false,
    /** How far the watch's clock is off the phone's (ms). */
    skew: 0,
    disk: { state: freshState(), box: { items: [], seq: 0 } },
    /** The sessions the watch can start by itself, as an earlier snapshot brought them (its copy can be stale). */
    sessions: readyOf(W.routines),
    now: () => Date.now() + watch.skew,
    get reachable () { return W.near },
    get workout () { return watch.state.workout },
    get outbox () { return watch.disk.box.items },

    launch () {
      watch.state = clone(watch.disk.state)
      Object.assign(watch, { running: true, snapshotAt: null, phoneRestEnd: null, echoOf: null, restEndsAt: null, generation: (watch.generation || 0) + 1 })
      // activationDidComplete: the newest context, what waits in the outbox, the watch's status.
      if (link.received) watch.receive(link.received)
      watch.flush(true)
      watch.send({ id: uid('st-'), type: 'watchStatus', health: 'off', version: 'sim', at: watch.now() })
    },
    kill () { watch.running = false },
    setState (s) { watch.state = s; watch.disk.state = clone(s) },
    editBox (fn) { watch.disk.box = fn(watch.disk.box) },

    /** SessionStore.receive + apply. */
    receive (payload) {
      if (!snapshotAccepted(payload.at, watch.snapshotAt)) { W.log.push('older snapshot skipped'); return }
      if (payload.at > 0) watch.snapshotAt = payload.at
      const snap = JSON.parse(payload.snapshot)
      const before = watch.state
      watch.setState(SessionCore.applySnapshot(before, snap))
      const next = watch.state
      if (before.workout && !next.workout) watch.restEndsAt = null
      const echo = watch.echoOf != null && (snap.acked || []).includes(watch.echoOf)
      if (echo) watch.echoOf = null
      const ours = next.workout?.id === snap.active?.id
      const step = phoneRest(ours ? snap.active?.rest?.endsAt ?? null : null, watch.phoneRestEnd, echo)
      watch.phoneRestEnd = step.last
      if (step.start && step.last > watch.now()) watch.restEndsAt = step.last
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
      watch.send(ev)
      if (crash) { watch.kill(); return ev.wid }
      watch.setState(next)
      return ev.wid
    },
    /** Done on the set up next of exercise `ei` (or on `si`). `crash`: killed after the send, before the save. */
    tick (ei, si, { w, r, rest = 0, crash = false } = {}) {
      const e = watch.state.workout?.entries?.[ei]
      if (si == null) si = e?.sets.findIndex(s => !s.done)
      const row = e?.sets?.[si]
      if (!row) return null
      // SetFix.correct for a set already done: after its own time, never before.
      const at = row.done ? Math.max(watch.now(), (row.at || 0) + 1) : watch.now()
      const [next, ev] = SessionCore.tick(watch.state, ei, si, { w: w ?? row.w, r: r ?? row.r, at, id: uid('ev-') })
      watch.send(ev)
      if (crash) { watch.kill(); return ev }
      watch.setState(next)
      if (rest) watch.restEndsAt = at + rest * 1000
      return ev
    },
    finish (opts = {}) {
      const [next, ev] = SessionCore.finish(watch.state, { at: watch.now(), id: uid('ev-'), ...opts })
      if (!ev) return null
      watch.restEndsAt = null
      watch.send(ev)
      watch.setState(next)
      return ev
    },
    discard () { return watch.finish({ discard: true }) },
  }

  Object.assign(W, {
    /** In reach of each other or not (Bluetooth off, the phone in the locker, airplane mode). */
    setNear (v) {
      if (W.near === v) return
      W.near = v
      if (v) { link.pump(); watch.reachabilityChanged() }
    },
    /** Time passes: timers run, transfers and the context arrive. */
    async run (ms = 1000) {
      for (let left = ms; left > 0; left -= 100) {
        link.pump()
        await vi.advanceTimersByTimeAsync(Math.min(100, left))
      }
      link.pump()
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
      if (!phone.page || phone.app !== 'front') await phone.foreground()
      if (!watch.running) watch.launch()
      for (let i = 0; i < 4; i++) {
        await W.run(3000)
        if (!watch.outbox.length && !phone.queueFile.length && !link.transfers.length) break
        await W.run(REDELIVER_MS + 1000)
        watch.reachabilityChanged()
      }
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
