// The phone's side of the conversation with the Wear OS app, between WearBridgePlugin.java (which
// owns the Wearable Data Layer) and the pure translations in wear-bridge.js. Everything the app
// itself has to do about the watch is decided here, with its collaborators handed in so a test can
// stand in for the plugin and the workout screen:
//
//   publishAll        the routine list and every routine's snapshot are put in the Data Layer ahead of
//                     time (app opened, a workout saved, a routine edited), so the watch starts a
//                     workout from its own copy and never has to wake this page up to ask
//   routineRequested  the watch wants the list or one snapshot anyway (no copy yet, or its refresh
//                     button) -> publish it
//   sessionFinished   the watch sends a recorded session -> finish it, then ack
//
// Acking is what lets the watch forget a session, so it is the last thing done, and only for a
// session the phone is certain about: saved, already saved, deleted since, or unreadable for good.
// A session the phone cannot judge yet (a newer format, a workout of its own in the way) stays
// un-acked; the Data Layer keeps it and the plugin hands it over again the next time the app opens.
import { classifyWatchSession, routineIndexForWatch, routineToWatchSnapshot, watchSessionEnd, WEAR_SCHEMA } from './wear-bridge.js'

// A request id that starts with this is the watch looking in, not waiting (wear/.../Paths.kt QUIET_PREFIX).
const WATCH_CHECK_IN = 'quiet-'

export function createWearLink({ plugin, getState, finish, askConflict, nameOf, toast, t }) {
  // A session being dealt with, so the same one arriving twice at once (the plugin re-offers
  // everything pending whenever the app comes forward) is dealt with once.
  const busy = new Set()

  const ack = id => plugin.ack({ id }).catch(() => {})

  // What the watch was last given, by item, without its timestamp: an unchanged routine is not put
  // again (every put wakes the watch app's data service and moves bytes over Bluetooth). A failed
  // put is not remembered, so the next pass tries it again.
  const given = new Map()
  const same = body => JSON.stringify({ ...body, ts: 0 })
  let queue = Promise.resolve()

  async function give(key, body, put, force) {
    const fingerprint = same(body)
    if (!force && given.get(key) === fingerprint) return
    try {
      await put()
      given.set(key, fingerprint)
    } catch { /* no Data Layer right now; the next pass tries again */ }
  }

  async function runPublishAll({ force }) {
    const state = getState()
    const routines = (state.routines || []).filter(r => r?.id)
    const live = new Set()
    // Snapshots first and the list last: a routine the list names is already there to start.
    for (const routine of routines) {
      const key = 'snapshot:' + routine.id
      live.add(key)
      let body = null
      try { body = routineToWatchSnapshot(routine, state, { nameOf }) } catch { /* a routine that cannot be built is left to the watch's request */ }
      if (!body) continue
      await give(key, body, () => plugin.publishSnapshot({ routineId: routine.id, json: JSON.stringify(body) }), force)
    }
    for (const key of [...given.keys()]) if (key.startsWith('snapshot:') && !live.has(key)) given.delete(key)
    const index = routineIndexForWatch(state)
    await give('index', index, () => plugin.publishIndex({ json: JSON.stringify(index) }), force)
  }

  /**
   * Puts the routine list and every routine's snapshot where the watch can read them. Only what
   * changed since the last pass goes out, unless [force] (the watch asked). Passes run one at a
   * time, and never reject.
   */
  function publishAll({ force = false } = {}) {
    queue = queue.then(() => runPublishAll({ force })).catch(() => {})
    return queue
  }

  async function onSession(event) {
    const payload = typeof event?.payload === 'string' ? safeParse(event.payload) : event?.payload
    const id = typeof payload?.id === 'string' ? payload.id : event?.id
    if (typeof id !== 'string' || busy.has(id)) return
    busy.add(id)
    try {
      const verdict = classifyWatchSession(payload, getState())
      switch (verdict.action) {
        case 'finish':
          finish(verdict.active, { end: watchSessionEnd(payload) })
          await ack(id)
          break
        case 'duplicate':
        case 'empty':
          await ack(id)
          break
        case 'invalid':
          // A format newer than this app knows is not broken, it is ahead: leave it where it is
          // for the version that can read it. Anything else will never be readable.
          if (verdict.reason === 'unknown version') { toast(t('Update openGym on this phone to read the workout from your watch.')); break }
          await ack(id)
          break
        case 'conflict':
          // The phone's own workout is never overwritten. The user decides; until then the
          // session stays with the watch. Asked once per session, however often it is offered.
          await askConflict({
            name: verdict.active.name,
            save: async () => {
              // The state may have moved while the sheet was open: ask again before acting.
              const now = classifyWatchSession(payload, getState())
              if (now.action === 'finish' || now.action === 'conflict') finish(verdict.active, { end: watchSessionEnd(payload) })
              await ack(id)
            },
            discard: () => ack(id),
          })
          break
      }
    } finally {
      busy.delete(id)
    }
  }

  async function onRoutineRequested(event) {
    const state = getState()
    const routineId = typeof event?.routineId === 'string' && event.routineId ? event.routineId : null
    try {
      if (!routineId) {
        // The list was asked for, so it is answered even if nothing changed; the snapshots go with
        // it, which is what the watch's refresh button means. A watch that is only checking in
        // (it just opened, and holds its copies already) gets what changed since, and no more.
        const checkingIn = typeof event?.requestId === 'string' && event.requestId.startsWith(WATCH_CHECK_IN)
        await publishAll({ force: !checkingIn })
        return
      }
      const routine = (state.routines || []).find(r => r.id === routineId)
      const snapshot = routine && routineToWatchSnapshot(routine, state, { nameOf })
      // A routine deleted since the watch listed it gets an answer too, or the watch would wait.
      const body = snapshot || { v: WEAR_SCHEMA, kind: 'missing', routineId, ts: Date.now() }
      await plugin.publishSnapshot({ routineId, json: JSON.stringify(body) })
    } catch { /* the watch asks again */ }
  }

  return { onSession, onRoutineRequested, publishAll }
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return null }
}
