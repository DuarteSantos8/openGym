// Rotation — the in-app half of the queue (lib/queue.js).
//
//   S.rotation = null | { id: string, sequence: string[], label: string, at?: number }
//
// REST DAYS AND REPEATS (#536) — the sequence may hold a routine more than once (A→B→C→B→D) and
// 'rest' entries (a day off between two sessions). A pass (S.queue) is still a SET of sessions,
// done by routine id (queue.js, and api/queue.js for the reminders, which this never touches), so
// such a loop runs as SEGMENTS: from `at`, the sessions up to the next rest or the next routine
// already in the segment. A, B, C, rest, B, D runs as the pass [A, B, C], then one day off, then
// [B, D]. `at` is where the running segment starts in the sequence. A rest day is a pass that
// starts later: the next segment's startsOn is pushed back one day per 'rest' after the one that
// just finished, and until then the loop shows nothing for the day (queueView's `waiting`).
// A sequence with neither (every loop made before #536) is SIMPLE and runs exactly as it always
// did: one pass of all its routines, rotated after the session that closed it.
//
// `S.rotation` is a DEFINITION, never a live queue: what the calendar, the reminders and the MCP
// resolve is always `S.queue`. `scheduleModeOf` is Home/Plan's own display choice: a live queue
// always wins regardless of `S.scheduleMode` (an external writer never has to know the flag
// exists), and the flag itself exists only to hold Rotation selected — weekday grid hidden, both
// screens showing the rotation editor — from the moment it is chosen through to the first
// routine being added, since there is no queue yet at that point to derive anything from.
//
// OWNERSHIP — `S.queue.rotationId === S.rotation.id` marks a pass this app manages: only such a
// pass refills itself when it completes. A planner's queue omits `rotationId`, so it completes
// and waits for its writer; saving it from Plan's editor adopts it (stamps the id) and opts it
// into refill from that point on. The token also stops a stale saved rotation from reclaiming
// somebody else's queue that happens to hold the same routine ids.
//
// THE ONE-DAY BOUNDARY — a new pass created by a completion starts the day AFTER the workout
// that closed the old one. The done rule (queue.js) credits a workout dated on or after
// `startsOn` whose name matches the routine even when its `start` predates `since` — the
// fallback for an early or unreliable clock. Without the boundary the session that finished the
// old pass would immediately tick an item of the new one.

import { isoOf, todayISO, uid } from './format.js'
import { queueOf, queueView } from './queue.js'

const routineIdsOf = w => (Array.isArray(w?.routineIds) ? w.routineIds : (w?.routineId ? [w.routineId] : []))
const dayAfter = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 1); return isoOf(d) }

/** 'rotation' while a usable live queue exists, or once chosen with nothing built yet (S.scheduleMode). */
export const scheduleModeOf = S => (queueOf(S) || S?.scheduleMode === 'rotation') ? 'rotation' : 'week'

/** A queue payload arrived but is unusable (malformed, duplicate-only, all-deleted): Week + a fix-up in Plan. */
export const queueRecovery = S => S?.queue != null && !queueOf(S)

/** The saved sequence's routines that still exist, first occurrence of each — the ids a new pass gets. */
export const rotationIds = S => {
  const seq = Array.isArray(S?.rotation?.sequence) ? S.rotation.sequence : []
  const routines = Array.isArray(S?.routines) ? S.routines : []
  return seq.filter((id, i) => seq.indexOf(id) === i && routines.some(r => r.id === id))
}

const newPass = (ids, label, rotationId, startsOn, since) => ({ ids, since, startsOn, label, rotationId })

export const REST = 'rest'
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }

/**
 * The saved sequence as the loop runs it (#536): routines that still exist, repeats kept, and
 * 'rest' entries. Rests are never first in a run of the loop that has no session at all.
 */
export const sequenceOf = S => {
  const seq = Array.isArray(S?.rotation?.sequence) ? S.rotation.sequence : []
  const routines = Array.isArray(S?.routines) ? S.routines : []
  const out = seq.filter(id => id === REST || routines.some(r => r.id === id))
  return out.some(id => id !== REST) ? out : []
}

/** A loop with no rest day and no routine twice: one pass of all of it, as before #536. */
export const isSimpleSequence = seq => !seq.includes(REST) && seq.every((id, i) => seq.indexOf(id) === i)

/**
 * The segment of `seq` that starts at `at` (skipping rests there): `{ start, ids, rest, next }`.
 * `ids` runs to the next rest, the next routine already in it, or the end of the sequence; `rest`
 * is how many rest days follow it (round the end of the sequence too); `next` is where the next
 * segment starts. Null for a sequence without a session.
 */
export function segmentAt(seq, at = 0) {
  const n = seq.length
  if (!n || !seq.some(id => id !== REST)) return null
  let start = Number.isInteger(at) && at >= 0 && at < n ? at : 0
  while (seq[start] === REST) start = (start + 1) % n
  const ids = []
  let i = start
  while (i < n && seq[i] !== REST && !ids.includes(seq[i])) ids.push(seq[i++])
  let rest = 0, k = i % n
  for (let c = 0; c < n && seq[k] === REST; c++) { rest++; k = (k + 1) % n }
  return { start, ids, rest, next: k }
}

/** Workouts that could have credited `q`'s pass: dated on/after its startsOn, matching one of its ids. */
const creditWindow = (s, q) => (s.workouts || [])
  .filter(w => String(w.d || '') >= q.startsOn && routineIdsOf(w).some(id => q.ids.includes(id)))

/**
 * `now`, or later still when a workout already in the credit window would otherwise re-credit
 * the new pass — a backdated or future-clock finish, or one just written by the caller. The done
 * rule's first clause is `w.start >= since` with no date bound of its own, so `since` is the only
 * thing keeping an old pass's own workouts from also ticking the new one.
 */
const sinceAfter = (s, q, now) => Math.max(now, ...creditWindow(s, q).map(w => (w.start ?? 0) + 1))

/**
 * Clears dayPlan pins dated `today` or later that name one of `ids` — a pass no longer owns
 * them (dropped, replaced by a refill, or ended outright), so a leftover pin never resurfaces as
 * an "open" pin on a session that isn't this pass's any more (pinState, queue.js) or, once no
 * queue is left at all, as a plain routine override history.js was never meant to read it as.
 */
const sweepPins = (s, ids, today) => {
  if (!ids.length) return
  Object.keys(s.dayPlan || {}).forEach(iso => {
    if (iso >= today && ids.includes(s.dayPlan[iso])) delete s.dayPlan[iso]
  })
}

/** Settings → Rotation with a saved rotation and no queue. False when nothing valid is left to start. */
export function startPass(s, today = todayISO(), now = Date.now()) {
  const seq = sequenceOf(s)
  if (seq.length && !isSimpleSequence(seq)) {
    const seg = segmentAt(seq, s.rotation.at)
    s.rotation = { ...s.rotation, at: seg.start }
    s.queue = newPass(seg.ids, s.rotation.label || '', s.rotation.id, today, now)
    return true
  }
  const ids = rotationIds(s)
  if (!ids.length) return false
  s.queue = newPass(ids, s.rotation.label || '', s.rotation.id, today, now)
  return true
}

/**
 * Plan's editor save: create the rotation on the first save, adopt an externally written queue,
 * or apply an ordinary edit. An edit keeps the running pass's `since`/`startsOn`, and the done
 * rule is by routine id since `since`, so progress already logged survives a reorder — and an id
 * added back after it was already trained today reads as done straight away.
 */
export function saveRotation(s, ids, label, today = todayISO(), now = Date.now()) {
  if (!ids.length) return
  if (!isSimpleSequence(ids)) { saveLoop(s, ids, label, today, now); return }
  const prev = queueOf(s)
  s.rotation = { id: s.rotation?.id ?? uid(), sequence: ids, label }
  s.queue = {
    ids,
    since: prev?.since ?? now,
    startsOn: prev?.startsOn ?? today,
    label,
    rotationId: s.rotation.id,
    ...(prev?.strict === true ? { strict: true } : {}),
  }
  // A session dropped from the rotation leaves its future pin behind otherwise — dayPlan then
  // still resolves that date to a session the queue no longer has (pinState/queue.js).
  sweepPins(s, (prev?.ids || []).filter(id => !ids.includes(id)), today)
  // An edit (e.g. removing the last session still to do) can leave the pass complete on the
  // spot — without this it would sit idle until a workout happened to reach refillAfter. Only an
  // edit that removed or reordered sessions of a pass that already existed: a pass this save just
  // created or grew is complete only because its sessions were trained already, and those
  // workouts are exactly what it should be showing as done (building the loop one routine at a
  // time after training the first one today). The new pass follows refill semantics: it starts
  // the day after the last workout that credited this one, so nothing already logged re-ticks it.
  if (prev && ids.every(id => prev.ids.includes(id)) && queueView(s, today)?.complete) {
    const q = queueOf(s)
    const last = lastCreditDay(s)
    sweepPins(s, q.ids, today)
    s.queue = newPass(rotationIds(s), label, s.rotation.id, last ? dayAfter(last) : today, sinceAfter(s, q, now))
  }
}

/**
 * saveRotation for a loop with rest days or repeats (#536): the sequence is saved whole, and the
 * running pass becomes the segment at `at` (kept while it still starts a segment of the edited
 * loop, else the loop's first). The pass keeps its since/startsOn, so progress already logged
 * counts, and a segment the edit left complete rolls on to the next one, as a refill would.
 */
function saveLoop(s, seq, label, today, now) {
  const prev = queueOf(s)
  const ownPrev = !!prev && !!s.rotation && prev.rotationId === s.rotation.id
  const at = Number.isInteger(s.rotation?.at) && s.rotation.at < seq.length && seq[s.rotation.at] !== REST ? s.rotation.at : 0
  s.rotation = { id: s.rotation?.id ?? uid(), sequence: seq, label, at }
  const seg = segmentAt(seq, at)
  s.rotation.at = seg.start
  s.queue = {
    ids: seg.ids,
    since: prev?.since ?? now,
    startsOn: prev?.startsOn ?? today,
    label,
    rotationId: s.rotation.id,
    ...(prev?.strict === true ? { strict: true } : {}),
  }
  sweepPins(s, (prev?.ids || []).filter(id => !seg.ids.includes(id)), today)
  if (prev && ownPrev && queueView(s, today)?.complete) {
    const q = queueOf(s)
    const last = lastCreditDay(s)
    advanceLoop(s, q, last, today, now)
  }
}

/** The next segment of a loop with rest days or repeats, after `q`; `bound` is the day it closed. */
function advanceLoop(s, q, bound, today, now) {
  const seq = sequenceOf(s)
  const seg = segmentAt(seq, s.rotation.at)
  const next = segmentAt(seq, seg.next)
  sweepPins(s, q.ids, today)
  s.rotation = { ...s.rotation, at: next.start }
  const startsOn = addDays(bound ? dayAfter(bound) : today, seg.rest)
  s.queue = newPass(next.ids, s.rotation.label || '', s.rotation.id, startsOn, sinceAfter(s, q, now))
}

/**
 * Ends the current pass without touching the saved sequence — "Use Fixed Week", or the editor
 * emptied down to nothing. Sweeps the same future pins saveRotation does, so a dropped pass never
 * resurfaces as a plain routine override (history.js) once the weekday plan is back in charge.
 */
export function stopPass(s, today = todayISO()) {
  const q = queueOf(s)
  if (q) sweepPins(s, q.ids, today)
  s.queue = null
}

/**
 * "How you train: Rotation", the one switch Plan and Settings share. Holds Rotation selected
 * (S.scheduleMode) and starts a pass from the saved sequence when there is one to start. A
 * malformed queue is not a live pass: Plan's recovery is the honest answer there, not a new pass
 * written over data another client may still fix. Returns true when a pass started.
 */
export function chooseRotation(s, today = todayISO(), now = Date.now()) {
  s.scheduleMode = 'rotation'
  if (queueRecovery(s) || !rotationIds(s).length) return false
  return startPass(s, today, now)
}

/**
 * "How you train: Fixed week". Stops this app's own pass and keeps the saved sequence for a
 * later start; the weekday plan was never touched. A planner's queue (no matching rotationId)
 * is never this app's to drop, so only the mode flag moves for it.
 */
export function chooseFixedWeek(s, today = todayISO()) {
  const q = queueOf(s)
  const external = !!q && (!s.rotation || q.rotationId !== s.rotation.id)
  if (!external) stopPass(s, today)
  s.scheduleMode = 'week'
}

/** The latest day a workout could have credited the current pass, or null. */
const lastCreditDay = s => {
  const q = queueOf(s)
  if (!q) return null
  const days = creditWindow(s, q).map(w => w.d)
  return days.length ? days.sort().at(-1) : null
}

/**
 * Plan's "Start new pass": throw the current pass away and begin the saved sequence again, right
 * now. Today is its first day, so Home, Start and the day sheet all name its first session as
 * today's, and nothing logged before this moment counts for it (`strict`, queue.js): a session
 * done earlier today was the old pass's, even under the same routine name.
 */
export function startNewPass(s, today = todayISO(), now = Date.now()) {
  if (!s.rotation) return
  // A loop with rest days or repeats starts over from its first segment (#536).
  const seq = sequenceOf(s)
  const loop = seq.length && !isSimpleSequence(seq) ? segmentAt(seq, 0) : null
  if (loop) s.rotation = { ...s.rotation, at: loop.start }
  const ids = loop ? loop.ids : rotationIds(s)
  if (!ids.length) return
  const q = queueOf(s)
  if (q) sweepPins(s, q.ids, today)
  // A live workout on one of the loop's routines, already running when the loop is started over,
  // belongs to the new pass: otherwise `strict` + since=now means it never counts once finished.
  // Still never earlier than the old pass's own workouts (sinceAfter's floor).
  const a = s.active
  const running = a && !a.backfill && Number.isFinite(a.start) && a.start <= now && routineIdsOf(a).some(id => ids.includes(id))
  const since = running ? (q ? sinceAfter(s, q, a.start) : a.start) : (q ? sinceAfter(s, q, now) : now)
  s.queue = { ...newPass(ids, s.rotation.label || '', s.rotation.id, today, since), strict: true }
}

/** Is `ids` some circular ordering of `seq`? (Both already normalized, so ids are unique.) */
const isCircular = (ids, seq) => {
  if (!ids.length || ids.length !== seq.length) return false
  const i = seq.indexOf(ids[0])
  return i >= 0 && ids.every((id, n) => seq[(i + n) % seq.length] === id)
}

/** `seq` rotated to begin just after `afterId`; unchanged when the id is not in it. */
const rotate = (seq, afterId) => {
  const i = seq.indexOf(afterId)
  return i < 0 ? seq : [...seq.slice(i + 1), ...seq.slice(0, i + 1)]
}

/**
 * Called with the state a finished workout has just been written into. Replaces a COMPLETE pass
 * this app manages with the next one and returns true; returns false — leaving `S.queue`
 * untouched — for an incomplete pass, a queue with no matching `rotationId`, or a managed pass
 * that no longer matches its rotation (the editor will resync it on the next save).
 *
 * The next pass is the rotation, rotated so it begins after the final queue id this workout
 * credited: `[A,B,C]` closed by C repeats as `[A,B,C]`, closed by B becomes `[C,A,B]`.
 */
export function refillAfter(s, w, today = todayISO(), now = Date.now()) {
  const q = queueOf(s)
  if (!q?.rotationId || !s.rotation?.id || q.rotationId !== s.rotation.id) return false
  if (!queueView(s, today)?.complete) return false
  const full = sequenceOf(s)
  if (full.length && !isSimpleSequence(full)) {
    // A loop with rest days or repeats (#536): the pass must be the segment at `at`, or the
    // editor resyncs it on its next save, as for a simple loop that no longer matches.
    const seg = segmentAt(full, s.rotation.at)
    if (!seg || seg.ids.length !== q.ids.length || seg.ids.some((id, i) => id !== q.ids[i])) return false
    advanceLoop(s, q, [w.d, lastCreditDay(s)].filter(Boolean).sort().at(-1), today, now)
    return true
  }
  const seq = rotationIds(s)
  if (!isCircular(q.ids, seq)) return false
  const credited = routineIdsOf(w)
  const last = q.ids.filter(id => credited.includes(id)).at(-1) ?? null
  const bound = [w.d, lastCreditDay(s)].filter(Boolean).sort().at(-1)
  sweepPins(s, q.ids, today)
  // The rotation's own label only — never the closing pass's (q.label): once adopted from a
  // planner, that would otherwise repeat its original week name ("US W1") on every pass this app
  // generates on its own from then on.
  s.queue = newPass(rotate(seq, last), s.rotation.label || '', s.rotation.id, dayAfter(bound), sinceAfter(s, q, now))
  return true
}

/**
 * A complete pass this app manages, refilled as the finish that completed it would have
 * (refillAfter), taking the latest workout that credited it as that finish. For a copy that
 * reached this state without a finish on this device: a sync merge that took both devices'
 * sessions of the pass, or kept the other copy's queue over this one's refill. Returns true when
 * it refilled; anything else (no managed pass, an incomplete one) is left alone.
 */
export function refillIfComplete(s, today = todayISO(), now = Date.now()) {
  const q = queueOf(s)
  if (!q?.rotationId || !s.rotation?.id || q.rotationId !== s.rotation.id) return false
  if (!queueView(s, today)?.complete) return false
  const last = creditWindow(s, q)
    .sort((x, y) => (x.d === y.d ? (x.start || 0) - (y.start || 0) : x.d < y.d ? -1 : 1)).at(-1)
  return last ? refillAfter(s, last, today, now) : false
}
