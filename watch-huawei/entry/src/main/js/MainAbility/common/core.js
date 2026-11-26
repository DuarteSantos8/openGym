// The openGym watch's logic for Huawei lite wearables: the Garmin watch's Core.mc, Actions.mc and
// App.mc (Link) as plain JavaScript, no screens and no Huawei API. Same wire protocol: the phone
// sends the snapshot of lib/huawei-snapshot.js (the Garmin's shape and names; normally the whole workout, every
// exercise with `i` = its index so hasMore is false, else the Garmin's window: both are read the same), the watch
// sends { events: [...] } and keeps each event until a snapshot's `acked` names it. Constants and the event field
// names are the Garmin's (new ones are appended to EV_KEYS: an outbox stored by an older watch still reads).
// Event ids start with "h" (the Garmin's start with "g"): unique per watch.
//
// Language: no polyfill-needing built-ins (test/syntax.test.js holds core.js to a list of ES5 methods
// and a deny-list of newer syntax). const/let, arrow functions and import/export are used as the
// brief allows: the build must turn them into what the engine runs (nothing here checks that).
//
// SHAPE. One object `c` holds everything (the model's way, not a class):
//   c.s     the persisted state (Garmin's field names: w, rd, set, u, rs, sy, sh, fh, p, pos, sk,
//           rest, ob, obn, ra, rh, ck, stk; added: pl = the phone's language, ca = the day the check-in
//           was asked here, ws = [time, version] of the last watchStatus). Plain JSON. `c.s.ob` is the
//           outbox of packed events. `s.sk` (skipped sets) holds set ids 's:<sid>' (or 'exId#si' without one).
//   c.g     what lives only until the app closes: page, lock, last, rated, fix, hold, hcd, hfor,
//           ask, askLeft, snooze, ended, endedAt, awayAt, bpm, pre (the start flow), activityAt, ...
//           c.g.last / c.g.fix are [exId, setIndex, side, setId]: the set is found by its id when it has one.
//   c.hr    heart-rate sums and the workout's buffer (memory only, see "heart rate" below)
//   c.link  the Link: busy, quiet, ask, began, lastTry, gen
//   c.env   the outside world (below)
// Every function takes `c` first when it needs the clock or the radio, `s` (= c.s) when it only
// reads the state. Functions that change something call save(c), then the page redraws.
//
// START:  const c = createCore(env, stored); launch(c)
//   env.radio      { transmit(message, { onComplete, onError }) }   (message = { events: [...] })
//   env.now()      milliseconds, the watch clock (Date.now() is fine)
//   env.random()   0..1 (Math.random)
//   env.save(s)    called after each change with c.s; the page layer stores JSON.stringify(s)
//   env.tick()     optional monotonic milliseconds (locks, holds, link waits); default env.now()
//   env.version    optional string: the app's version, for watchStatus (none: none is sent)
//   env.today()    optional 'YYYY-MM-DD' of the watch's own day (check-in); default from env.now()
//   env.buzz(p)    optional; p = [[intensity %, ms], ...]; never called when the phone's
//                  settings.restHaptics is off
// stored: what env.save last gave (parsed), or null/undefined for a fresh install.
// Page layer: once a second call second(c) (the rest, holds, "Still training?", link retries) and
// hrSample(c, bpm) while a workout runs; on a message from the phone call onPhone(c, data); on
// the radio's own errors nothing (the listeners are inside). After any of them, redraw from c.s/c.g.
//
// WHAT THE PAGE ASKS (reads, no side effects)
//   entries(s) entryAt(s,pos) entryIdx(s,pos) hasMore(s) needsPhone(s) setIndex(s,pos)
//   sideUp(row) next(s,pos,si) -> [pos, restFirst]   current(c) -> {pos,si,e,row,side,fixing}|null
//   place(e,si) -> [n,of]   planSize(entries) -> [exercises, workSets]   partners(s,pos) -> names
//   progress(s) -> [done,all]   waiting(s)   elapsed(c,w)   asks(...)   lastSet(w)
//   restLeft(c) (seconds or null)   restPaused(c)   held(c)   locked(c)   canRate(c)
//   chips(kind) chipLabel(kind,v) countNumber(ms)   stepWeight(w,step,steps) stepReps(r,steps)
//   stepOf(s,e) unitOf(s,e) isTimed(e) isCardio(e) logged(s,pos,si,side) fixList(s)
// WHAT THE LIFTER DOES (each returns nothing unless said)
//   startWorkout(c, session) -> start event      finishWorkout(c, discard) -> summary|null
//   summary(c,w,ended) -> the medal's numbers; it folds the window's records into c.s.rc (not a pure read)
//   pressDone(c, w, r) -> 'none'|'confirmFinish'|'next'|'hold'|'tick'|'fix'   (w, r = boxes; on a set
//                         being fixed it saves the fix and returns 'fix')
//   tickSet(c,pos,si,side,w,r,sec,restSec)       skipSet(c)   nextExercise(c)
//   holdCount(c, sec) holdStart(c) holdStop(c) holdCancel(c)  (3-2-1 first; countTick(c), which
//                         second() runs, buzzes the count and starts it; call it faster for a tight count)
//   restAdd(c, +15|-15)  restSkip(c)             rate(c, v) (effort chip)
//   fixLast(c) fixStep(c, by) fixSave(c, w, r) fixCancel(c)
//   keepGoing(c, tell)                           reset(c)
//   addSet(c, pos) -> event|null     removeSet(c, pos, si, sid?) -> event|null   (canAdd(s,pos), canRemove(s,pos,si,sid?))
//     setId(s,pos,si) -> the row's set id|null: read it when the page offers a removal and pass it back as `sid`;
//     with it removeSet / canRemove refuse (null / false) when that place is not that set any more.
//     findSet(s,sid) -> [pos, si]|null.
//   c.g.up: a number that moves on every addSet / removeSet and every snapshot that changes the set up (its place,
//     id or numbers): a page that cached the boxes or a confirm for an older value drops it.
//   stop(c): switch a replaced core off for good (late callbacks, timers and messages do nothing, it never saves).
//   lockFor(c, ms): the button lock, on the clock locked() reads.
// BEFORE A START (weigh-in and check-in; the flow is in c.g.pre, not saved; section "before a start" below)
//   startFlow(c, session) -> 'checkin'|'weighin'|'count'|null   preState(c)   preCancel(c)
//   checkinDue(c)  checkinAnswer(c, 1..5|null) -> kind   checkinSkip(c) -> kind
//   weighInStep(c, tenths)  weighInSet(c, w)  weighInDone(c, save) -> 'count'
//   then startWorkout(c, preState(c).session, preState(c).bw)
// HEART RATE (section "heart rate" below)
//   hrSample(c, bpm) once a second   hrSamples(c)  hrStats(c, from?, to?)  hrDownsample(c, n)  hrClear(c)
//   sensorShouldRest(c)  (3 hours idle: the page may stop the sensor; ask again after each action)
// WATCH STATUS: launch(c) sends it when env.version is set and it is due; watchStatus(c) does it on demand
// SHOW AND MEASURE (step 2). Pure modules beside this one read c.s / the heart-rate buffer: records.js (the PR rules),
//   medal.js (what the summary's medal shows: medalOf(summary, opts)), metrics.js (numbers, pulse, zones, effort, muscles,
//   metricPages, streak, restStyle, bandOf; headers there). Here: summary(c, w, ended) now also returns `recs`, the records
//   [[name, 'w'|'r'|'h', old, new, unit], ...] in workout order; workoutTotals(w) -> [sets, volume]; reach(c) -> 'near' |
//   'away' | 'unknown' (REACH_MS). Saved state added: rc (records so far), ef (effort ratings given here, set key ->
//   [value, entry place, name, id]), mu (muscles of exercises that left the window). All reset with the workout.
// THE NOTE, THE OVERVIEW: sessionNote(c) -> '' or the phone's note (read-only)  noteOn(c)  supersetStart(s,pos)
// THE PHONE
//   onPhone(c, data) -> summary|null (a workout the phone ended while the watch had it)
// Cardio is logged on the phone: the page offers nextExercise for it, never tickSet.

import { foldRecords, recordList } from './records.js'

export const EV_KEYS = ['id', 'type', 'at', 'wid', 'exId', 'entryIdx', 'setIdx', 'w', 'r', 'sec', 'side', 'hr', 'rir', 'rpe', 'routineIds', 'sid', 'restEnd', 'endsAt', 'off',
  // appended: the layout of the keys above is what an outbox stored by an older watch holds
  'restHr', 'version', 'sleep', 'energy', 'sore', 'bw']
export const PLACES = 9
export const BATCH = 4
// The outbox: `MAX` events when the phone is there (the oldest sent one goes), `HARD` when nothing has been sent (the
// phone away the whole time). A set with a rest is two events (its setDone, then a setHr for the rest), so 160 is
// about 80 such sets, or 160 without heart-rate events. Stored size, worst case: a setDone with a heart rate, id,
// set id, rest end and offset is about 150 characters as JSON, a setHr about 130, so 160 events are about 23 KB
// (8 parts of the store's 3,000 characters), on top of the workout and routines (about 15 to 20 KB): well under
// 50 KB, 17 parts. (The old 60 / 90 held 30 / 45 such sets.)
export const MAX = 100
export const HARD = 160
export const NEED = 10000
export const RETRY_UNSENT_MS = 30000
export const RETRY_UNACKED_MS = 60000
export const GIVE_UP_MS = 45000
export const HEARD_RESEND_MS = 10000
export const QUIET_MAX = 4
export const CLOCK_SAMPLES = 8
export const CLOCK_WINDOW_MS = 300000
export const REST_SLACK_MS = 250
export const FINISHED_KEPT = 5

/* ---------- small helpers (ES5 only) ---------- */
const trunc = x => (x < 0 ? Math.ceil(x) : Math.floor(x))
const isNum = v => typeof v === 'number' && isFinite(v)
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arrOf = v => (Array.isArray(v) ? v : [])
const same = (a, b) => typeof a === 'string' && a === b
const isTrue = v => v === true || v === 1
const isOff = v => v === false || v === 0
const toI = (v, d) => (isNum(v) ? trunc(v) : d)
const toF = v => (isNum(v) ? v : null)
const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
const has = (a, x) => a.indexOf(x) >= 0
const clone = v => JSON.parse(JSON.stringify(v))
const assign = (a, b) => { Object.keys(b).forEach(k => { a[k] = b[k] }); return a }
const ms = c => c.env.now()
// A monotonic clock for durations (locks, holds, link waits): env.tick() when the page has one, so a
// watch clock that is set mid-workout cannot stretch or cut them; else the wall clock.
const mono = c => (c.env.tick ? c.env.tick() : c.env.now())

export const isTimed = e => !!e && same(e.mode, 'time')
export const isCardio = e => !!e && same(e.mode, 'cardio')

/* ---------- state ---------- */
export const emptyState = () => ({
  w: null, rd: null, set: {}, u: 'kg', rs: 90, stk: null, sy: false,
  sh: null, fh: [], p: {}, pos: 0, sk: [], rest: null, ob: [], obn: 0, ra: 0, rh: null, ck: [],
  pl: null, ca: null, ws: null, // the phone's language, the day the check-in was asked, [time, version] of the last watchStatus
  rc: {}, // records so far (records.js), by the exercise's place in the workout
  ef: {}, // effort ratings given here: set key -> [value, entry place, exercise name, exercise id] (metrics.js effort)
  mu: {} // sets done per muscle by exercises that left the window: entry place -> [work sets done, muscles]
})

// What storage gave back, with anything missing filled in.
export function normalize (s) {
  const base = emptyState()
  if (!dictOf(s)) return base
  Object.keys(base).forEach(k => { if (!(k in s) || (s[k] == null && base[k] != null)) s[k] = base[k] })
  if (toI(s.obn, 0) > s.ob.length) s.obn = s.ob.length
  return s
}

export function createCore (env, stored) {
  const c = {
    env: env,
    s: normalize(stored ? clone(stored) : null),
    link: { busy: false, quiet: 0, ask: true, began: -1e12, lastTry: -1e12, gen: 0, fly: [], okAt: -1e12 },
    g: { page: 'set', lock: null, last: null, rated: null, fix: null, hold: null, hcd: null, hfor: null, hsec: null,
      ask: false, askLeft: false, snooze: null, ended: null, endedAt: null, awayAt: null, bpm: null, askN: 0,
      restTotal: null, restNudged: false, restOver: false, restFor: null, n: 0, hcdN: null, activityAt: env.now(), pre: null, up: 0 },
    hr: { setSum: 0, setN: 0, setMax: 0, allSum: 0, allN: 0, allMax: 0, from: 0, buckets: [], span: 5000, after: null },
    ptlist: [],
    rx: false,
    ptick: null
  }
  return c
}

export function save (c) { if (!c.stopped && c.env.save) c.env.save(c.s) }
// Switch a core off for good (the page started a new one): its late radio callbacks, timers and messages do
// nothing, and above all it never saves over the new core's state.
export function stop (c) { c.stopped = true }
// The phone moves an event onto its own clock by `off`: every event that carries a time says it.
const withOff = (c, ev) => { const o = off(c); if (o !== 0) ev.off = o; return ev }
const newId = c => { c.g.n += 1; return 'h' + ms(c) + '-' + c.g.n + '-' + Math.floor(c.env.random() * 1000000) }

// Every buzz obeys the phone's setting: only an explicit false/0 mutes.
function buzz (c, pattern) {
  const st = dictOf(c.s.set)
  if (c.env.buzz && !(st && isOff(st.restHaptics))) c.env.buzz(pattern)
}

/* ---------- keys ---------- */
const key = (exId, si, side) => (side != null ? exId + '#' + si + '#' + side : exId + '#' + si)
const placeKey = (e, pos, si, side) => {
  const k = 'e' + toI(e.i, pos) + ':' + strOf(e.id) + '#' + si
  return side != null ? k + '#' + side : k
}
// A pending tick by the set's id when it has one, else by its place.
const pkey = (e, pos, si, side) => {
  const row = dictOf(arrOf(e.sets)[si])
  const sid = row ? row.sid : null
  return typeof sid === 'string' ? (side != null ? 's:' + sid + '#' + side : 's:' + sid) : placeKey(e, pos, si, side)
}
const onKey = (e, pos) => '@' + toI(e.i, pos) + ':' + strOf(e.id)
// The tick kept by place moves to the set-id key once the phone gives the set an id.
function pend (p, e, pos, si, side) {
  const k = pkey(e, pos, si, side)
  if (p[k] == null) {
    const kp = placeKey(e, pos, si, side)
    if (kp !== k && p[kp] != null) { p[k] = p[kp]; delete p[kp] }
  }
  return k
}

/* ---------- the outbox: events wait packed (first 9 by place, then -index, value pairs) ---------- */
export function pack (ev) {
  const out = []
  let last = 0
  EV_KEYS.forEach((k, i) => {
    let v = ev[k]
    if (v === undefined) v = null
    if (dictOf(v)) v = [v.avg, v.max]
    if (i === 16 && v != null && v !== 0) v = v - ev.at
    if (i < PLACES) { out.push(v); if (v != null) last = i + 1; return }
    if (v == null) return
    if (last < PLACES) last = PLACES
    out.length = last
    out.push(-i, v)
    last = out.length
  })
  return out.slice(0, last)
}
const byPairs = ev => ev.length > PLACES && typeof ev[PLACES] === 'number' && ev[PLACES] < 0
export function unpack (ev) {
  if (dictOf(ev)) return ev
  const out = {}
  const pairs = byPairs(ev)
  let i = 0
  while (i < ev.length) {
    let k = i
    let v = ev[i]
    if (pairs && i >= PLACES) { k = -ev[i]; v = i + 1 < ev.length ? ev[i + 1] : null; i += 2 } else i += 1
    if (v == null || k >= EV_KEYS.length) continue
    out[EV_KEYS[k]] = k === 11 || k === 19 ? { avg: v[0], max: v[1] } : k === 16 && v !== 0 ? ev[2] + v : v
  }
  return out
}
export function evField (ev, k) {
  if (dictOf(ev)) return ev[EV_KEYS[k]]
  if (!Array.isArray(ev)) return null
  if (k < PLACES || !byPairs(ev)) return ev.length > k ? ev[k] : null
  for (let i = PLACES; i + 1 < ev.length; i += 2) if (ev[i] === -k) return ev[i + 1]
  return null
}

// The phone named these ids: they leave the outbox, `obn` keeps counting the sent ones before.
export function ackOutbox (s, acked) {
  if (!acked.length) return
  const sent = toI(s.obn, 0)
  const kept = []
  let n = 0
  s.ob.forEach((ev, i) => {
    const id = evField(ev, 0)
    if (acked.some(a => same(a, id))) return
    kept.push(ev)
    if (i < sent) n += 1
  })
  s.ob = kept
  s.obn = n
}

// Room for one more. Everything in the outbox is unnamed by the phone, so when it is full something unconfirmed
// must go. Least valuable first (oldest first within a kind); each line goes only when the ones above are gone:
//  1. a setHr (a heart rate, the set itself stays)   2. a watchStatus   3. a rest change   4. a stillHere
//  5. a dailyForm (the check-in)   6. a correction (a fix or effort of a set: the set stays)
//  7. an addSet or removeSet that no setDone in the outbox names (a removal leaves a planned set, nothing logged;
//     the phone makes a row itself for a setDone with an unknown set id)   8. a weighIn
//  9. a logged set that is not on a row the watch added   10. any logged set   11. an addSet or removeSet
//     (only after every set, so none is kept whose row the phone would never hear was added)
// 12. anything else but start, finish, discard   13. a finish or discard   14. a start (without it the phone holds
// back every event of a watch workout: it goes last). Below `max` nothing goes; with none sent it grows to `hard`
// first. A logged set is therefore the last data to go, and what goes before it is, in this order, heart rate,
// status, rest, check-in, corrections, set edits, the weigh-in.
export function room (s, max, hard) {
  const ob = s.ob
  const sent = toI(s.obn, 0)
  if (ob.length < max || (sent === 0 && ob.length < hard)) return
  let k = -1
  const type = i => evField(ob[i], 1)
  const isType = name => i => same(type(i), name)
  const first = test => { for (let i = 0; i < ob.length && k < 0; i++) if (test(i)) k = i }
  const named = {} // set ids that a setDone names, and that an addSet made
  const added = {}
  ob.forEach((e, i) => {
    const id = evField(e, 15)
    if (typeof id !== 'string') return
    if (same(type(i), 'setDone')) named[id] = true
    if (same(type(i), 'addSet')) added[id] = true
  })
  const edit = i => same(type(i), 'addSet') || same(type(i), 'removeSet')
  first(isType('setHr'))
  first(isType('watchStatus'))
  first(isType('rest'))
  first(isType('stillHere'))
  first(isType('dailyForm'))
  first(i => same(type(i), 'setDone') && again(ob, i))
  first(i => edit(i) && !named[evField(ob[i], 15)])
  first(isType('weighIn'))
  first(i => same(type(i), 'setDone') && !added[evField(ob[i], 15)])
  first(isType('setDone'))
  first(edit)
  first(i => !same(type(i), 'start') && !same(type(i), 'finish') && !same(type(i), 'discard'))
  first(i => !same(type(i), 'start'))
  if (k < 0) k = 0
  if (k < sent) s.obn = sent - 1
  s.ob = ob.filter((_, i) => i !== k)
}

// Only the newest rest change, and the newest watchStatus, wait to be sent.
export function supersede (s, ev) {
  const kind = ev.type === 'watchStatus' ? 'watchStatus' : ev.type === 'rest' || ev.restEnd != null ? 'rest' : null
  if (!kind) return
  const sent = toI(s.obn, 0)
  s.ob = s.ob.filter((e, i) => i < sent || !same(evField(e, 1), kind))
}

export const unsent = s => s.ob.length - toI(s.obn, 0)

// A fix or effort of the same set shortly before: it counts once. The set is told by its set id when both events
// have one (a row's number changes when rows are added or taken out), else by exercise and row number.
function again (ob, i) {
  const a = ob[i]
  const sa = evField(a, 15)
  for (let j = i - 1; j >= 0 && j >= i - 8; j--) {
    const b = ob[j]
    if (!same(evField(b, 1), 'setDone')) continue
    const sb = evField(b, 15)
    const sameSet = typeof sa === 'string' && typeof sb === 'string' ? sa === sb : same(evField(b, 4), evField(a, 4)) && evField(b, 6) === evField(a, 6)
    if (sameSet && same(evField(b, 3), evField(a, 3)) && (evField(b, 10) == null ? evField(a, 10) == null : same(evField(b, 10), evField(a, 10)))) return true
  }
  return false
}
// Sets logged here the phone has not stored yet.
export function waiting (s) {
  let n = 0
  s.ob.forEach((ev, i) => { if (same(evField(ev, 1), 'setDone') && !again(s.ob, i)) n += 1 })
  return n
}

/* ---------- the clocks: the watch's minus the phone's, from the snapshots' `now` ---------- */
function noteClock (c, phoneNow) {
  if (!isNum(phoneNow) || phoneNow <= 0) return
  const now = ms(c)
  c.s.ck = arrOf(c.s.ck).concat([[now, now - phoneNow]]).slice(-CLOCK_SAMPLES)
}
export function off (c) {
  const ck = arrOf(c.s.ck)
  if (!ck.length) return 0
  const now = ms(c)
  let best = null
  ck.forEach(x => { if (now - x[0] <= CLOCK_WINDOW_MS && (best == null || x[1] < best)) best = x[1] })
  return best != null ? best : ck[ck.length - 1][1]
}

/* ---------- reading the workout ---------- */
export function entries (s) { const w = dictOf(s.w); return w ? arrOf(w.entries) : [] }
export function entryAt (s, pos) { const es = entries(s); return pos >= 0 && pos < es.length ? dictOf(es[pos]) : null }
export function entryIdx (s, pos) { const e = entryAt(s, pos); return e ? toI(e.i, pos) : pos }
const posIn = (es, id) => {
  for (let i = 0; i < es.length; i++) if (dictOf(es[i]) && same(es[i].id, id)) return i
  return null
}
export const posOf = (s, exId) => posIn(entries(s), exId)
// The exercise that was on screen, in another list of exercises: the one in the same place of the workout
// (`i`) when the list says so, else by its id.
function findOn (es, on) {
  if (!on) return null
  const oi = toI(on.i, null)
  if (oi != null) for (let k = 0; k < es.length; k++) if (dictOf(es[k]) && same(es[k].id, on.id) && toI(es[k].i, k) === oi) return k
  return posIn(es, on.id)
}
// Where the exercise up now is: `k` (the phone's), or the first after it, round the list, with a set to do
// (one done on the phone moves the watch on); else `k`. Cardio counts: the watch says to log it on the phone.
function openFrom (s, es, k) {
  for (let j = 0; j < es.length; j++) {
    const p = (k + j) % es.length
    if (setIndex(s, p) != null) return p
  }
  return k
}

// The workout has exercises after the window.
export function hasMore (s) {
  const w = dictOf(s.w)
  if (!w) return false
  const es = entries(s)
  if (!es.length) return toI(w.count, 0) > 0
  const last = dictOf(es[es.length - 1])
  return toI(w.count, es.length) > (last ? toI(last.i, es.length - 1) : es.length - 1) + 1
}
// Waiting for the phone: the window is done and more is to come, or a workout started by name.
export function needsPhone (s) {
  if (!dictOf(s.w)) return false
  const n = entries(s).length
  return n === 0 || (toI(s.pos, 0) >= n && hasMore(s))
}

export const unitOf = (s, e) => (e && typeof e.unit === 'string' ? e.unit : dictOf(s.w) && typeof s.w.unit === 'string' ? s.w.unit : s.u)
export function stepOf (s, e) {
  const st = e ? toF(e.step) : null
  return st != null && st > 0 ? st : same(unitOf(s, e), 'lb') ? 5 : 2.5
}
// A weight moved by `steps` on the exercise's grid (an off-grid weight lands on it first), never below 0.
export function stepWeight (w, step, steps) {
  const base = w == null ? 0 : +w
  if (steps === 0 || step <= 0) return base
  const k = base / step
  const fl = trunc(k + 0.001)
  const dn = k - 0.001
  let ce = dn <= 0 ? 0 : trunc(dn)
  if (dn > ce) ce += 1
  const out = (steps > 0 ? fl + steps : ce + steps) * step
  return out < 0 ? 0 : Math.round(out * 100) / 100
}
export function stepReps (r, steps) {
  const v = (r == null ? 0 : +r) + steps
  return v < 0 ? 0 : v > 999 ? 999 : v
}

/* ---------- sets, sides, next ---------- */
// A skipped set is known by its set id (a row keeps it when rows are added or taken out before it, and two
// copies of one exercise skip apart); without an id by exercise and place, as an older store holds it.
const skipKey = (e, si) => { const row = dictOf(arrOf(e.sets)[si]); return row && typeof row.sid === 'string' ? 's:' + row.sid : key(e.id, si, null) }
const isSkipped = (s, e, si) => has(s.sk, skipKey(e, si)) || has(s.sk, key(e.id, si, null))
// The set to do next in an exercise: the first not done and not skipped.
export function setIndex (s, pos) {
  const e = entryAt(s, pos)
  if (!e) return null
  const sets = arrOf(e.sets)
  for (let si = 0; si < sets.length; si++) {
    const row = dictOf(sets[si])
    if (row && !isTrue(row.done) && !isSkipped(s, e, si)) return si
  }
  return null
}
// The side up next on a per-side set, or null.
export function sideUp (row) {
  const sd = row ? dictOf(row.sides) : null
  if (!sd) return null
  const l = dictOf(sd.L)
  const r = dictOf(sd.R)
  if (!l || !isTrue(l.done)) return 'L'
  if (!r || !isTrue(r.done)) return 'R'
  return null
}
// One side of a per-side set done; the row follows both sides (reps add, weight = the heavier).
function markSide (row, side, w, r, at) {
  const sd = dictOf(row.sides)
  if (!sd) return
  let one = dictOf(sd[side])
  if (!one) { one = {}; sd[side] = one }
  one.done = true
  if (w != null) one.w = w
  if (r != null) one.r = r
  const l = dictOf(sd.L)
  const rr = dictOf(sd.R)
  row.done = !!l && isTrue(l.done) && !!rr && isTrue(rr.done)
  const lr = l ? toF(l.r) : null
  const rrr = rr ? toF(rr.r) : null
  row.r = (lr == null ? 0 : lr) + (rrr == null ? 0 : rrr)
  const lw = l ? toF(l.w) : null
  const rw = rr ? toF(rr.w) : null
  row.w = Math.max(lw == null ? 0 : lw, rw == null ? 0 : rw)
  const was = toF(row.at)
  row.at = was != null && was > at ? was : at
}
// A set passed over (both sides of a per-side set: the key has no side).
function skip (s, pos, si) {
  const e = entryAt(s, pos)
  if (!e) return
  const k = skipKey(e, si)
  if (!has(s.sk, k)) s.sk.push(k)
}
// Where to go after set `si` of the exercise at `pos`, and whether a rest comes first: [pos, rest].
export function next (s, pos, si) {
  const es = entries(s)
  const count = es.length
  const e = entryAt(s, pos)
  if (!e) return [s.pos, false]
  const sets = arrOf(e.sets)
  if (si >= 0 && si < sets.length && sideUp(dictOf(sets[si])) != null) return [pos, false]
  const g = e.group
  if (g != null) {
    let lo = pos
    let hi = pos
    while (lo > 0 && same(dictOf(es[lo - 1]) ? es[lo - 1].group : null, g)) lo--
    while (hi + 1 < count && same(dictOf(es[hi + 1]) ? es[hi + 1].group : null, g)) hi++
    if (hi > lo) {
      // a superset: the members after this one first, a rest only after a full round
      for (let k = pos + 1; k <= hi; k++) if (setIndex(s, k) != null) return [k, false]
      for (let k = lo; k <= pos; k++) if (setIndex(s, k) != null) return [k, true]
      for (let k = hi + 1; k < count; k++) if (setIndex(s, k) != null) return [k, true]
      for (let k = 0; k < lo; k++) if (setIndex(s, k) != null) return [k, true]
      return [count, true]
    }
  }
  if (setIndex(s, pos) != null) return [pos, true]
  for (let k = pos + 1; k < count; k++) if (setIndex(s, k) != null) return [k, true]
  for (let k = 0; k < pos; k++) if (setIndex(s, k) != null) return [k, true]
  return [count, true]
}

// "Set 2 of 4": a work set among the work sets, a warm-up among the warm-ups.
export function place (e, si) {
  const sets = arrOf(e.sets)
  if (si < 0 || si >= sets.length) return [0, 0]
  const warm = isTrue(dictOf(sets[si]).warmup)
  let n = 0
  let total = 0
  for (let i = 0; i < sets.length; i++) {
    const row = dictOf(sets[i])
    if (row && isTrue(row.warmup) === warm) { total += 1; if (i <= si) n = total }
  }
  return [n, total]
}
export function planSize (es) {
  let ex = 0
  let sets = 0
  arrOf(es).forEach(e => {
    const rows = arrOf(dictOf(e) ? e.sets : null)
    if (!rows.length) return
    ex += 1
    rows.forEach(r => { if (!isTrue(dictOf(r) ? r.warmup : null)) sets += 1 })
  })
  return [ex, sets]
}
export function partners (s, pos) {
  const es = entries(s)
  const e = entryAt(s, pos)
  const out = []
  const g = e ? e.group : null
  if (g == null) return out
  es.forEach((o, i) => { if (i !== pos && dictOf(o) && same(o.group, g)) out.push(strOf(o.name)) })
  return out
}

// Work sets done and in all over the whole workout: the phone's count plus the ticks it has not
// confirmed (a fix has 5 values, not counted); a workout started here counts its own.
export function progress (s) {
  const w = dictOf(s.w)
  if (!w) return [0, 0]
  let done = 0
  let all = 0
  entries(s).forEach(e => {
    arrOf(dictOf(e) ? e.sets : null).forEach(row => {
      if (!dictOf(row) || isTrue(row.warmup)) return
      all += 1
      if (isTrue(row.done)) done += 1
    })
  })
  const pr = arrOf(w.progress)
  if (pr.length === 2) {
    let ticks = 0
    Object.keys(s.p).forEach(k => { if (s.p[k].length === 4) ticks += 1 })
    return [toI(pr[0], 0) + ticks, toI(pr[1], all)]
  }
  return [done, all]
}

// The workout as the summary shows it: name, seconds, sets, volume, unit. There is no PR here.
// Work sets done and the volume (in the workout's unit) over the window, or the phone's totals when they are larger
// (the window is only part of the workout): [sets, volume]. Warm-ups, timed and cardio sets add no volume.
export function workoutTotals (w) {
  let sets = 0
  let volume = 0
  const unit = strOf(w.unit)
  arrOf(w.entries).forEach(e => {
    if (!dictOf(e)) return
    let f = 1
    if (typeof e.unit === 'string' && e.unit !== unit) f = e.unit === 'lb' ? 0.45359237 : 1 / 0.45359237
    arrOf(e.sets).forEach(row => {
      if (!dictOf(row) || isTrue(row.warmup) || !isTrue(row.done)) return
      sets += 1
      if (!isTimed(e) && !isCardio(e)) {
        const ww = toF(row.w)
        const rr = toF(row.r)
        volume += (ww == null ? 0 : ww) * (rr == null ? 0 : rr) * f
      }
    })
  })
  // the window is only part of the workout: the phone's totals count the rest
  const pr = arrOf(w.progress)
  if (pr.length === 2 && toI(pr[0], 0) > sets) sets = toI(pr[0], 0)
  const vol = toF(w.volume)
  if (vol != null && vol > volume) volume = vol
  return [sets, volume]
}
// Seconds into the workout, null without a start: it stands at `pausedAt` while the phone has it paused. A
// workout started here has its start on this watch's clock; the phone's start and pausedAt are on the phone's,
// which is the watch's less its offset.
export function elapsed (c, w) {
  const start = toF(w.start)
  if (start == null) return null
  const pausedAt = toF(w.pausedAt)
  const now = ms(c) - (same(w.id, c.s.sh) ? 0 : off(c))
  return Math.max(0, Math.floor(((pausedAt != null && pausedAt > 0 ? pausedAt : now) - start) / 1000))
}
export function summary (c, w, endedOnPhone) {
  foldRecords(c.s.rc, w) // the window now, with the sets ticked here: what left it was folded before
  const tot = workoutTotals(w)
  const sets = tot[0]
  const volume = tot[1]
  const unit = strOf(w.unit)
  return { name: strOf(w.name), unit: unit, dur: elapsed(c, w), sets: sets, vol: volume, ended: endedOnPhone, recs: recordList(c.s.rc) }
}

/* ---------- heart rate ----------
 * One reading a second from the page: hrSample(c, bpm). Readings outside 25..250 are no reading (the phone drops
 * a set's heart rate outside that: lib/heart-rate.js sanitizeHr). Two uses:
 *  - the sums a watch-ticked set carries (`hr` of its setDone): since the last tick, rest end or hold start;
 *  - the workout's buffer, for a set ticked on the phone (setHr) and for the rest's heart rate, and for the
 *    Pulse and Zones pages. The buffer keeps 5 s buckets [start, sum, count, max, min], at most HR_BUCKETS of
 *    them: past that neighbours merge and the bucket gets twice as long, so a long workout thins out but every
 *    average and maximum stays exact. It is in memory only (Wear's is too), one workout's, and empties when
 *    the workout ends or another starts.
 * Read it with hrSamples(c) -> [[time, bpm], ...] (a bucket's start and mean), hrStats(c, from?, to?) ->
 * {avg, max, min, n} or null (readings with a bucket start in from..to, ms on the watch's clock),
 * hrDownsample(c, n) -> at most n [time, bpm] points for a chart. */
export const HR_MIN = 25
export const HR_MAX = 250
export const HR_BUCKETS = 1500
const HR_BUCKET_MS = 5000
export function hrSample (c, bpm) {
  const h = c.hr
  c.g.bpm = bpm
  if (!(bpm >= HR_MIN && bpm <= HR_MAX) || !dictOf(c.s.w)) return
  h.setSum += bpm; h.setN += 1; if (bpm > h.setMax) h.setMax = bpm
  h.allSum += bpm; h.allN += 1; if (bpm > h.allMax) h.allMax = bpm
  const t = ms(c)
  const b = h.buckets
  const last = b.length ? b[b.length - 1] : null
  if (last && t - last[0] < h.span) {
    last[1] += bpm; last[2] += 1
    if (bpm > last[3]) last[3] = bpm
    if (bpm < last[4]) last[4] = bpm
    return
  }
  b.push([t, bpm, 1, bpm, bpm])
  if (b.length > HR_BUCKETS) {
    const merged = []
    for (let i = 0; i < b.length; i += 2) {
      const x = b[i]
      const y = b[i + 1]
      merged.push(y ? [x[0], x[1] + y[1], x[2] + y[2], Math.max(x[3], y[3]), Math.min(x[4], y[4])] : x)
    }
    h.buckets = merged
    h.span *= 2
  }
}
export function hrClear (c) { c.hr.buckets = []; c.hr.span = HR_BUCKET_MS; c.hr.after = null }
export function hrSamples (c) { return c.hr.buckets.map(x => [x[0], Math.round(x[1] / x[2])]) }
export function hrStats (c, from, to) {
  const lo = from == null ? -Infinity : from
  const hi = to == null ? Infinity : to
  let sum = 0
  let n = 0
  let max = 0
  let min = 1e9
  c.hr.buckets.forEach(x => {
    if (x[0] < lo || x[0] > hi) return
    sum += x[1]; n += x[2]
    if (x[3] > max) max = x[3]
    if (x[4] < min) min = x[4]
  })
  return n ? { avg: Math.round(sum / n), max: Math.round(max), min: Math.round(min), n: n } : null
}
export function hrDownsample (c, n) {
  const b = c.hr.buckets
  if (!(n > 0)) return []
  if (b.length <= n) return hrSamples(c)
  const out = []
  for (let i = 0; i < n; i++) {
    let t = 0
    let sum = 0
    let cnt = 0
    const from = Math.floor(i * b.length / n)
    const to = Math.floor((i + 1) * b.length / n)
    for (let j = from; j < to; j++) { t += b[j][0]; sum += b[j][1]; cnt += b[j][2] }
    out.push([Math.round(t / (to - from)), Math.round(sum / cnt)])
  }
  return out
}
export function newSet (c) { c.hr.setSum = 0; c.hr.setN = 0; c.hr.setMax = 0; c.hr.from = ms(c) }
export function hrForSet (c) {
  const h = c.hr
  const out = h.setN > 0 ? [trunc(h.setSum / h.setN), h.setMax] : null
  newSet(c)
  return out
}
export function hrTotals (c) {
  const h = c.hr
  const out = h.allN > 0 ? [trunc(h.allSum / h.allN), h.allMax] : null
  h.allSum = 0; h.allN = 0; h.allMax = 0
  newSet(c)
  return out
}
// phone: watch-sync.js applyEach 'setHr' -> patchSet(by wid, exId, entryIdx, setIdx, sid) with `hr` and `restHr`,
// each only when sanitizeHr holds (avg and max whole, 25..250, max >= avg: hrStats rounds, so it does). No `side`:
// the phone puts it on the row. `at` lets the phone hold it back for a watch workout whose start is still on its
// way (the phone waits for `watch-` workouts' events, a heart rate with an `at` for up to 2 days).
function setHrEvent (c, wid, t, key, hr) {
  const ev = { id: newId(c), type: 'setHr', wid: wid, exId: t.exId, entryIdx: t.entryIdx, setIdx: t.setIdx, at: ms(c) }
  if (typeof t.sid === 'string' && t.sid) ev.sid = t.sid
  ev[key] = { avg: hr.avg, max: hr.max }
  return withOff(c, ev)
}
// The rest after a set is over: its heart rate goes to that set (restHr), and the next set counts from here.
function closeRest (c, end) {
  const h = c.hr
  const r = h.after
  if (!r) return
  h.after = null
  h.from = end
  const hr = hrStats(c, r.from, end)
  if (hr) send(c, setHrEvent(c, r.wid, r, 'restHr', hr))
}
// Sets ticked on the phone since the last snapshot (c.ptlist, oldest first): measured here like a tick on the
// wrist, from when the set started up to the phone's tick, and sent as a setHr. As Wear's phoneTicked: not for a
// tick from before this set's window (made while the watch was away) or one more than a minute in the watch's
// future; a rest the phone started after it is that set's rest.
function phoneTicksHr (c) {
  const w = dictOf(c.s.w)
  const list = c.ptlist
  c.ptlist = []
  if (!w || !list.length) return
  const resting = !!dictOf(w.rest)
  const o = off(c)
  const h = c.hr
  list.sort((a, b) => a.at - b.at)
  list.forEach(t => {
    const at = t.at + o // the phone's time on this clock
    if (at <= h.from || at > ms(c) + 60000) return
    const from = h.from // before closeRest moves it: this set's window starts where the last one ended (Wear's phoneTicked)
    closeRest(c, at)
    const hr = hrStats(c, from, at)
    if (hr) send(c, setHrEvent(c, strOf(w.id), t, 'hr', hr))
    newSet(c)
    h.from = at
    if (resting) h.after = { wid: strOf(w.id), exId: t.exId, entryIdx: t.entryIdx, setIdx: t.setIdx, sid: t.sid, from: at }
  })
}
// Whether the heart-rate sensor may rest: three hours with nothing happening in the workout (a set done on
// either side, a rest's end, a start, an action here), no rest or hold running. The next action wakes it: ask
// again after each. (Wear's SensorPlan; the page stops and starts its heart-rate subscription by this.)
export const SENSOR_IDLE_MS = 3 * 3600000
export function sensorShouldRest (c) {
  const s = c.s
  const w = dictOf(s.w)
  if (!w || s.rest != null || s.rh != null || c.g.hold || c.g.hcd != null) return false
  let last = c.g.activityAt
  const o = off(c)
  const seen = x => { const v = toF(x); if (v != null && v + o > last) last = v + o }
  seen(w.start)
  seen(dictOf(w.rest) ? w.rest.endsAt : null)
  arrOf(w.entries).forEach(e => arrOf(dictOf(e) ? e.sets : null).forEach(r => { if (dictOf(r)) seen(r.at) }))
  return ms(c) - last >= SENSOR_IDLE_MS
}
const touch = c => { c.g.activityAt = ms(c) }

/* ---------- a set done ---------- */
// The set done at time `at` (watch clock): row and pending tick updated, the event returned.
// `hr` = [avg, max] or null; `eff` = ['rir'|'rpe', value] or null.
function tickAt (c, pos, si, side, w, r, sec, hr, at, eff) {
  const s = c.s
  const wk = dictOf(s.w)
  const e = entryAt(s, pos)
  if (!wk || !e) return null
  const sets = arrOf(e.sets)
  if (si < 0 || si >= sets.length) return null
  const row = dictOf(sets[si])
  if (!row) return null
  w = toF(w) // a string or NaN from the page never reaches the phone
  r = toF(r)
  sec = toF(sec)
  const oneSide = side != null && dictOf(row.sides) ? side : null
  const o = off(c)
  const pat = at - o // the row keeps the phone's clock, as the phone will
  if (oneSide) markSide(row, oneSide, w, r, pat)
  else {
    row.done = true
    if (w != null) row.w = w
    if (r != null) row.r = r
    if (sec != null) row.sec = sec
    row.at = pat
  }
  s.p[pkey(e, pos, si, oneSide)] = [w, r, pat, sec]
  const ev = { id: newId(c), type: 'setDone', wid: strOf(wk.id), exId: strOf(e.id), entryIdx: entryIdx(s, pos), setIdx: si, at: at }
  if (typeof row.sid === 'string') ev.sid = row.sid
  if (o !== 0) ev.off = o
  if (w != null) ev.w = w
  if (r != null) ev.r = r
  if (sec != null) ev.sec = sec
  if (oneSide) ev.side = oneSide
  if (hr) ev.hr = { avg: hr[0], max: hr[1] }
  if (eff) ev[eff[0]] = eff[1]
  return ev
}
// The rest a tick starts (`sec` from the tick; none: 0); the tick's time is the rest's stamp.
function tickRest (c, ev, sec) {
  const s = c.s
  const end = sec != null && sec > 0 ? ev.at + trunc(sec * 1000) : 0
  ev.restEnd = end
  s.ra = ev.at - (ev.off == null ? 0 : ev.off)
  s.rh = null
  s.rest = end > 0 ? end : null
  return s.rest
}

// What the lifter did: set `si` of the exercise at `pos` done (Actions.tick). Moves on, starts the
// rest (exercise's, else workout's, else the phone's default) only when next() says so.
export function tickSet (c, pos, si, side, w, r, sec, restSec) {
  restSec = toF(restSec)
  const s = c.s
  const g = c.g
  const e = entryAt(s, pos)
  if (!e) return
  closeRest(c, ms(c)) // the last set's rest ends here
  const ev = tickAt(c, pos, si, side, w, r, sec, hrForSet(c), ms(c), null)
  if (!ev) return
  touch(c)
  g.last = [e.id, si, side, ev.sid]
  g.rated = null
  g.ask = false
  lockFor(c, 1000)
  const nx = next(s, pos, si)
  s.pos = nx[0]
  const atEnd = nx[0] >= entries(s).length
  let rs = null
  if (nx[1] && (!atEnd || hasMore(s))) {
    rs = restSec
    if (!(rs > 0)) rs = toF(dictOf(s.w) ? s.w.restSec : null)
    if (!(rs > 0)) rs = toF(s.rs)
  }
  restBegin(c, tickRest(c, ev, rs), rs)
  if (s.rest != null) c.hr.after = { wid: ev.wid, exId: ev.exId, entryIdx: ev.entryIdx, setIdx: ev.setIdx, sid: ev.sid, from: ev.at }
  send(c, ev)
  buzz(c, [[40, 60]])
  if (atEnd && !hasMore(s)) g.page = 'over'
  save(c)
}

export function skipSet (c) {
  const s = c.s
  const pos = s.pos
  const si = setIndex(s, pos)
  if (si == null) { nextExercise(c); return }
  c.g.hold = null; c.g.hcd = null
  skip(s, pos, si)
  s.pos = next(s, pos, si)[0]
  if (s.pos >= entries(s).length && !hasMore(s)) c.g.page = 'over'
  save(c)
}
// On to the next exercise with a set to do; mid-rest that is a Skip.
export function nextExercise (c) {
  const s = c.s
  const count = entries(s).length
  let to = count
  for (let k = s.pos + 1; k < count; k++) if (setIndex(s, k) != null) { to = k; break }
  s.pos = to
  c.g.hold = null; c.g.hcd = null
  restSkip(c)
  save(c)
}

// What the set page shows now: {pos, si, e, row, side, fixing}, or null on the end page. si null:
// nothing left in this exercise.
export function current (c) {
  const s = c.s
  const f = c.g.fix
  let pos = s.pos
  let si = null
  let fixing = false
  if (f) {
    const r = refSet(s, f)
    if (r && logged(s, r[0], r[1], f[2])) { pos = r[0]; si = r[1]; fixing = true } else c.g.fix = null // gone, or unticked on the phone
  }
  const e = entryAt(s, pos)
  if (!e) return null
  if (!fixing) si = setIndex(s, pos)
  const row = si == null ? null : dictOf(arrOf(e.sets)[si])
  const side = fixing ? f[2] : sideUp(row)
  return { pos: pos, si: si, e: e, row: row, side: side, fixing: fixing }
}
// Done on the set page (Ed.done); w, r are the boxes (r is seconds for a hold).
export function pressDone (c, w, r) {
  if (!entries(c.s).length) return 'none'
  const cur = current(c)
  if (!cur) return 'confirmFinish'
  if (cur.fixing) { fixSave(c, w, r); return 'fix' } // Done on a set being fixed saves the fix
  if (cur.si == null || isCardio(cur.e)) { nextExercise(c); return 'next' }
  if (isTimed(cur.e)) { holdCount(c, r); return 'hold' }
  tickSet(c, cur.pos, cur.si, cur.side, w, r, null, toF(cur.e.restSec))
  return 'tick'
}

/* ---------- fixing a logged set, effort ---------- */
// What was logged on a done set (one side's numbers on a per-side set) as [w, r, sec], or null.
export function logged (s, pos, si, side) {
  const e = entryAt(s, pos)
  const sets = e ? arrOf(e.sets) : []
  if (si < 0 || si >= sets.length || isCardio(e)) return null
  const row = dictOf(sets[si])
  if (!row) return null
  const sd = dictOf(row.sides)
  if (side != null && sd) {
    const one = dictOf(sd[side])
    return one && isTrue(one.done) ? [toF(one.w), toF(one.r), null] : null
  }
  return isTrue(row.done) ? [toF(row.w), toF(row.r), toF(row.sec)] : null
}
// A done set with new numbers (or an effort): a later setDone without hr and without restEnd, so
// the phone's later-tick-wins rule takes it and the rest is untouched.
function fix (c, pos, si, side, w, r, sec, eff) {
  const s = c.s
  const e = entryAt(s, pos)
  const was = logged(s, pos, si, side)
  if (!was) return null
  const row = dictOf(arrOf(e.sets)[si])
  const oneSide = dictOf(row.sides) ? side : null
  const rowAt = toF(row.at)
  const o = off(c)
  let at = ms(c)
  if (rowAt != null && rowAt + o + 1 > at) at = rowAt + o + 1
  if (isTimed(e)) {
    r = null
    if (was[0] == null || was[0] <= 0) w = null
  } else sec = null
  const k = pkey(e, pos, si, oneSide)
  const had = s.p[k]
  const newTick = !!had && had.length === 4
  const ev = tickAt(c, pos, si, oneSide, w, r, sec, null, at, eff)
  if (!newTick) s.p[k].push(true) // a fix of a confirmed set is not counted twice in progress()
  return ev
}
// Every done non-cardio set in the window as [pos, si, side].
export function fixList (s) {
  const out = []
  entries(s).forEach((e, pos) => {
    if (!dictOf(e) || isCardio(e)) return
    arrOf(e.sets).forEach((row, si) => {
      if (dictOf(row) && dictOf(row.sides)) {
        if (logged(s, pos, si, 'L')) out.push([pos, si, 'L'])
        if (logged(s, pos, si, 'R')) out.push([pos, si, 'R'])
      } else if (dictOf(row) && isTrue(row.done)) out.push([pos, si, null])
    })
  })
  return out
}
function fixFrom (s, from, by) {
  const all = fixList(s)
  if (!all.length) return null
  if (!from) return by < 0 ? all[all.length - 1] : null
  for (let i = 0; i < all.length; i++) {
    const a = all[i]
    if (a[0] === from[0] && a[1] === from[1] && (a[2] == null ? from[2] == null : same(a[2], from[2]))) {
      const j = i + by
      return j >= 0 && j < all.length ? all[j] : null
    }
  }
  return null
}
// < and >: the done set before/after the one on screen; past the newest, back to the set up now.
export function fixStep (c, by) {
  const s = c.s
  const f = c.g.fix
  let from = null
  if (f) { const r = refSet(s, f); from = r ? [r[0], r[1], f[2]] : null }
  const to = fixFrom(s, from, by)
  if (!to && !from && by < 0) return
  c.g.fix = to ? [entryAt(s, to[0]).id, to[1], to[2], rowSidOf(entryAt(s, to[0]), to[1])] : null
}
// "Previous set" on the rest: the set just done, else the last done one.
export function fixLast (c) {
  const l = c.g.last
  if (l && refSet(c.s, l)) c.g.fix = l
  else fixStep(c, -1)
}
export function fixCancel (c) { c.g.fix = null }
export function fixSave (c, w, r) {
  const s = c.s
  const f = c.g.fix
  const ref = f ? refSet(s, f) : null
  c.g.fix = null
  if (ref) {
    const pos = ref[0]
    const timed = isTimed(entryAt(s, pos))
    const ev = fix(c, pos, ref[1], f[2], w, timed ? null : r, timed ? r : null, null)
    send(c, ev)
    if (ev) buzz(c, [[40, 60]])
  }
  save(c)
}
// A set the last tick or the fix names: [exercise, set index, side, set id]. By its id when it has one, so rows
// added or taken out before it do not move what it points at; else by its index. [pos, si], or null when gone.
function rowSidOf (e, si) { const row = e ? dictOf(arrOf(e.sets)[si]) : null; return row && typeof row.sid === 'string' ? row.sid : null }
export function refSet (s, ref) {
  const w = dictOf(s.w)
  if (w && typeof ref[3] === 'string') {
    const at = rowAt(w, ref[3]) // wherever the row is now, also in the second copy of an exercise
    return at && same(dictOf(entryAt(s, at[0])).id, ref[0]) ? at : null
  }
  const pos = posOf(s, ref[0])
  if (pos == null) return null
  return ref[1] < arrOf(entryAt(s, pos).sets).length ? [pos, ref[1]] : null
}
export const chips = kind => (same(kind, 'rpe') ? [10, 9, 8, 7] : [0, 1, 2, 3])
export function chipLabel (kind, v) {
  if (same(kind, 'rpe') && v <= 7) return '<8'
  if (!same(kind, 'rpe') && v >= 3) return '3+'
  return String(v)
}
export function canRate (c) {
  const s = c.s
  const st = dictOf(s.set)
  const ref = c.g.last ? refSet(s, c.g.last) : null
  if (!st || typeof st.effort !== 'string' || !ref) return false
  const e = entryAt(s, ref[0])
  const row = ref[1] < arrOf(e.sets).length ? dictOf(e.sets[ref[1]]) : null
  return !isCardio(e) && !!row && !isTrue(row.warmup)
}
export const locked = c => c.g.lock != null && mono(c) < c.g.lock
// The button lock for `ms` milliseconds, on the clock locked() reads (the page must not write c.g.lock itself).
export function lockFor (c, span) { c.g.lock = mono(c) + span }
// An effort chip: the set just done gets rir/rpe `v` (its setDone again, as logged).
export function rate (c, v) {
  const s = c.s
  const st = dictOf(s.set)
  const kind = st ? st.effort : null
  const l = c.g.last
  const ref = l ? refSet(s, l) : null
  if (!same(kind, 'rir') && !same(kind, 'rpe')) return
  if (!ref || locked(c)) return
  const n = logged(s, ref[0], ref[1], l[2])
  if (!n) return
  const ev = fix(c, ref[0], ref[1], l[2], n[0], n[1], n[2], [kind, v])
  send(c, ev)
  if (ev) { // for the Effort page; a rating from before the set had an id (kept by place) is replaced, not added
    const e = entryAt(s, ref[0])
    delete s.ef[placeKey(e, ref[0], ref[1], null)]
    s.ef[pkey(e, ref[0], ref[1], null)] = [v, toI(e.i, ref[0]), strOf(e.name), strOf(e.id)]
  }
  c.g.rated = v
  buzz(c, [[40, 60]])
  save(c)
}

/* ---------- the set menu: add a set, take one out ----------
 * Both change the lifter's own workout at once and go to the phone as an event; until the phone names the event
 * in `acked` it stays in the outbox, and every snapshot is shown with those events laid over it (replayEdits), so
 * an older snapshot does not undo them. After the ack the snapshot is the truth: a removal the phone refused (the
 * set was ticked there meanwhile) is simply back. No undo: a removable set is not done, so nothing logged is lost.
 * phone: watch-sync.js addWatchSet / removeWatchSet (applyEach 'addSet' / 'removeSet', only for the running workout
 * `ours`). A refused or repeated event is still acked, and the ack makes the phone send a fresh snapshot.
 *   addSet    needs `sid` matching /^[A-Za-z0-9_-]{1,40}$/ (sidOk) and not on any row of the workout yet; the exercise
 *             is A.entries[entryIdx] when its id is exId, else the first with that exId; at most 100 rows; the new row
 *             is a copy of the last (rowLike: w, r, sec, and both sides of a per-side row, never done, never a
 *             warm-up) with `w` (converted by storedWeight), `r`, `sec` of the event over it; it goes at the end
 *             (`after` is not sent).
 *   removeSet finds the row by `sid` only (exId, entryIdx and setIdx are sent for old phones, ignored); refused for a
 *             set done on either side or the exercise's only row.
 * The watch is more careful than the phone where the phone would break a pair: no add or remove on cardio or on a
 * timed per-side exercise (its two rows read as one set), and a remove only when every row of the exercise has a
 * set id (a pending tick kept by place would otherwise shift). */
const newSid = c => { c.g.n += 1; return 'h' + ms(c).toString(36) + c.g.n.toString(36) + Math.floor(c.env.random() * 46656).toString(36) }
const sideDone = (row, k) => { const sd = dictOf(row.sides); const o = sd ? dictOf(sd[k]) : null; return !!o && isTrue(o.done) }
const anyDone = row => isTrue(row.done) || sideDone(row, 'L') || sideDone(row, 'R')
const paired = e => isTimed(e) && (isTrue(e.perSide) || arrOf(e.sets).some(r => dictOf(r) && (r.side === 'L' || r.side === 'R')))
export function canAdd (s, pos) {
  const e = entryAt(s, pos)
  return !!e && !!dictOf(s.w) && typeof s.w.id === 'string' && !isCardio(e) && !paired(e) && Array.isArray(e.sets) && e.sets.length < 100
}
export function canRemove (s, pos, si, sid) {
  const e = entryAt(s, pos)
  if (!e || !dictOf(s.w) || isCardio(e) || paired(e)) return false
  const sets = arrOf(e.sets)
  const row = dictOf(sets[si])
  if (sid != null && !(row && same(row.sid, sid))) return false // not the set the page offered
  return !!row && sets.length > 1 && !anyDone(row) && sets.every(r => dictOf(r) && typeof r.sid === 'string')
}
// [entry index, set index] of the row with this id in workout `w`, or null
function rowAt (w, sid) {
  const es = arrOf(w.entries)
  for (let i = 0; i < es.length; i++) {
    const sets = dictOf(es[i]) ? arrOf(es[i].sets) : []
    for (let j = 0; j < sets.length; j++) if (dictOf(sets[j]) && same(sets[j].sid, sid)) return [i, j]
  }
  return null
}
// One addSet or removeSet over workout `w` (the watch's own, or the phone's snapshot): the phone's rules. Returns
// whether it changed anything. The total of work sets (`w.progress[1]`) moves with it until the phone's own comes.
function applyEdit (w, ev) {
  const es = arrOf(w.entries)
  let k = -1
  es.forEach((e, i) => { if (k < 0 && dictOf(e) && toI(e.i, i) === ev.entryIdx && same(e.id, ev.exId)) k = i }) // where it was made,
  es.forEach((e, i) => { if (k < 0 && dictOf(e) && same(e.id, ev.exId)) k = i }) // else the exercise (the phone: entryIndexOf)
  const pr = arrOf(w.progress)
  if (ev.type === 'addSet') {
    if (k < 0 || !same(ev.sid, ev.sid) || rowAt(w, ev.sid) || !Array.isArray(es[k].sets) || es[k].sets.length >= 100) return false
    const sets = es[k].sets
    const last = sets.length ? dictOf(sets[sets.length - 1]) : null
    const row = { sid: ev.sid }
    if (toF(ev.w) != null) row.w = ev.w
    if (toF(ev.r) != null) row.r = ev.r
    if (toF(ev.sec) != null) row.sec = ev.sec
    const sd = last ? dictOf(last.sides) : null
    if (sd) {
      const half = o => ({ w: dictOf(o) ? o.w : null, r: dictOf(o) ? o.r : null })
      row.sides = { L: half(sd.L), R: half(sd.R) }
      if (toF(ev.w) == null && last.w != null) row.w = last.w
      if (toF(ev.r) == null && last.r != null) row.r = last.r
    }
    sets.push(row)
    if (pr.length === 2) pr[1] = toI(pr[1], 0) + 1
    return true
  }
  if (ev.type !== 'removeSet') return false
  const at = rowAt(w, ev.sid)
  if (!at) return false
  const sets = es[at[0]].sets
  const row = dictOf(sets[at[1]])
  if (anyDone(row) || sets.length <= 1) return false
  sets.splice(at[1], 1)
  if (pr.length === 2 && !isTrue(row.warmup)) pr[1] = Math.max(0, toI(pr[1], 0) - 1)
  return true
}
// What the watch added or took out that the phone has not named yet (those events are still in the outbox: the
// snapshot's `acked` was taken out first), over the phone's snapshot, in the order made.
function replayEdits (s, nx) {
  s.ob.forEach(ev => {
    const type = evField(ev, 1)
    if ((same(type, 'addSet') || same(type, 'removeSet')) && same(evField(ev, 3), nx.id)) applyEdit(nx, unpack(ev))
  })
}
// Add a set (a copy of the exercise's last, at its end). Returns the event, or null when it is not allowed.
// A per-side row is sent without numbers: the phone copies both sides itself.
export function addSet (c, pos) {
  const s = c.s
  if (!canAdd(s, pos)) return null
  const e = entryAt(s, pos)
  const sets = arrOf(e.sets)
  const last = sets.length ? dictOf(sets[sets.length - 1]) : null
  const ev = { id: newId(c), type: 'addSet', wid: strOf(s.w.id), exId: strOf(e.id), entryIdx: entryIdx(s, pos), sid: newSid(c), at: ms(c) }
  if (last && !dictOf(last.sides)) {
    if (toF(last.w) != null) ev.w = last.w
    if (toF(last.r) != null) ev.r = last.r
    if (toF(last.sec) != null) ev.sec = last.sec
  }
  withOff(c, ev)
  applyEdit(s.w, ev)
  touch(c)
  c.g.up += 1
  send(c, ev)
  return ev
}
// Take a set out (not done, not the only one). Returns the event, or null.
// The set id of a row, to read when the page offers a removal and to pass back to removeSet / canRemove.
export function setId (s, pos, si) { return rowSidOf(entryAt(s, pos), si) }
// [pos, set index] of the row with this set id in the window now, or null.
export function findSet (s, sid) { const w = dictOf(s.w); const at = w ? rowAt(w, sid) : null; return at }
// `sid`: the set id the page read when it offered the removal (setId). With it, the removal is refused (null) when
// that place is not the same set any more: it was ticked, or another set sits there now. Without it, as before.
export function removeSet (c, pos, si, sid) {
  const s = c.s
  if (!canRemove(s, pos, si, sid)) return null
  const e = entryAt(s, pos)
  const gone = e.sets[si].sid
  const ev = withOff(c, { id: newId(c), type: 'removeSet', wid: strOf(s.w.id), exId: strOf(e.id), entryIdx: entryIdx(s, pos), setIdx: si, sid: gone, at: ms(c) })
  applyEdit(s.w, ev)
  s.sk = s.sk.filter(k => k !== 's:' + gone) // a skip goes with its set (skips, the last tick and a fix are known by set id)
  touch(c)
  c.g.up += 1
  send(c, ev)
  return ev
}

/* ---------- the note, the overview ---------- */
// The phone's session note (read-only: the watch cannot type, so it sends no workoutNote). '' for none; the phone
// carries at most 280 characters. noteOn: the phone's settings.workoutNote (it understands the note at all).
export function sessionNote (c) { const w = dictOf(c.s.w); return w && typeof w.note === 'string' ? w.note : '' }
export function noteOn (c) { const st = dictOf(c.s.set); return !!st && st.workoutNote === true }
// The first exercise of a superset of two or more (the Overview's "Superset" heading goes above it).
export function supersetStart (s, pos) {
  const es = entries(s)
  const e = dictOf(es[pos])
  if (!e || e.group == null) return false
  const before = pos > 0 && dictOf(es[pos - 1]) && same(es[pos - 1].group, e.group)
  const after = pos + 1 < es.length && dictOf(es[pos + 1]) && same(es[pos + 1].group, e.group)
  return !before && !!after
}

/* ---------- the rest ---------- */
function restBegin (c, end, sec) {
  const g = c.g
  g.restFor = end
  g.restNudged = false
  g.restOver = false
  g.restTotal = end == null || sec == null ? null : trunc(sec)
}
// Seconds left (rounded up), the held seconds while paused on the phone, or null.
export function restLeft (c) {
  const s = c.s
  if (s.rest == null) return s.rh == null ? null : toI(s.rh, 0)
  const left = s.rest - ms(c)
  return left <= 0 ? 0 : trunc((left + 999) / 1000)
}
export const restPaused = c => c.s.rest == null && c.s.rh != null
// The rest ended (ran out, Skip, ended on the phone): nothing is sent from here.
function restStop (c) {
  closeRest(c, ms(c))
  c.s.rest = null
  c.s.rh = null
  c.g.restTotal = null
  save(c)
  newSet(c)
}
// After a rest, "Timed holds start by themselves" brings up the hold's 3-2-1.
function restAfter (c) {
  const g = c.g
  const s = c.s
  const st = dictOf(s.set)
  if (!g.fix && !g.hold && g.hcd == null && st && isTrue(st.autoHolds) && isTimed(entryAt(s, s.pos)) && setIndex(s, s.pos) != null) holdCount(c, null)
}
// The +15 / -15 of the rest. -15 with a second or less left is a Skip.
export function restAdd (c, sec) {
  const s = c.s
  if (s.rest == null) return
  const to = sec > 0 ? s.rest + sec * 1000 : (s.rest + sec * 1000 - ms(c) >= 1000 ? s.rest + sec * 1000 : null)
  if (to == null) { restSkip(c); return }
  s.rest = to
  c.g.restFor = to
  if (c.g.restTotal != null && sec > 0) c.g.restTotal += sec
  c.g.restNudged = false
  send(c, restEvent(c, to))
  save(c)
}
export function restSkip (c) {
  const had = c.s.rest != null || c.s.rh != null
  restStop(c)
  if (had) {
    send(c, restEvent(c, null))
    lockFor(c, 1000)
    restAfter(c)
  }
}
// +15 / -15 / Skip pressed here: the `rest` event, stamped after the change it follows.
function restEvent (c, endsAt) {
  const s = c.s
  const w = dictOf(s.w)
  if (!w) return null
  const o = off(c)
  let at = ms(c)
  const ra = toF(s.ra)
  if (ra != null && ra + o + 1 > at) at = ra + o + 1
  s.ra = at - o
  const ev = { id: newId(c), type: 'rest', wid: strOf(w.id), at: at, endsAt: endsAt }
  if (o !== 0) ev.off = o
  return ev
}
function restTick (c) {
  const s = c.s
  const g = c.g
  if (s.rest == null) return
  if (s.rest !== g.restFor) { g.restFor = s.rest; g.restNudged = false; g.restOver = false }
  const l = restLeft(c)
  if (l <= 10 && l > 0 && !g.restNudged) { g.restNudged = true; buzz(c, [[50, 150]]) }
  if (l === 0 && !g.restOver) {
    g.restOver = true
    buzz(c, [[100, 400], [0, 200], [100, 400]])
    restStop(c)
    restAfter(c)
  }
}
// After a snapshot: a rest the phone ended runs what a Skip runs; a new end starts the ring over.
function restFollowed (c, was) {
  const s = c.s
  if (c.rx) { c.rx = false; c.g.restTotal = null; newSet(c); restAfter(c); return }
  const r = s.rest
  if (r != null && (was == null || r !== was)) {
    const t = toF(dictOf(dictOf(s.w) ? s.w.rest : null) ? s.w.rest.total : null)
    c.g.restTotal = t != null && t > 0 ? trunc(t) : null
  }
}
// The phone's rest by its stamp `restAt` (only a change newer than ours counts).
function followRest (c, nx) {
  const s = c.s
  const rest = dictOf(nx.rest)
  const endsAt = rest ? toF(rest.endsAt) : null
  const rAt = toF(nx.restAt)
  if (rAt == null) return
  if (rAt <= toI(s.ra, 0)) return
  s.ra = rAt
  const now = ms(c)
  const mine = toF(s.rest)
  const was = (mine != null && mine > now) || s.rh != null
  s.rh = null
  if (endsAt != null) {
    const end = endsAt + off(c)
    const d = mine == null ? 1000 : end - mine
    if (end <= now) s.rest = null
    else if (d > REST_SLACK_MS || d < -REST_SLACK_MS) s.rest = end
  } else if (isTrue(nx.restPaused)) {
    const lf = toF(nx.restLeft)
    s.rest = null
    s.rh = lf == null || lf < 0 ? 0 : trunc(lf)
  } else {
    s.rest = null
    c.rx = was
  }
  // the watch's rest ended here (the phone's end is past, or it skipped it): its heart rate ends now, and the
  // next set's counts from now (Wear's endRestFromPhone)
  if (was && s.rest == null && s.rh == null) { closeRest(c, now); newSet(c) }
}

/* ---------- holds (timed sets) ---------- */
// The set a hold is for: [pkey, side]; its end logs that set, not whichever is up by then.
function holdFor (s, pos, si, side) {
  const e = entryAt(s, pos)
  return !e || si == null ? null : [pkey(e, pos, si, side), side]
}
// Where that set is now as [pos, si], or null when it is done (the phone logged it) or gone.
function holdAt (s, h) {
  if (!h) return null
  const es = entries(s)
  for (let pos = 0; pos < es.length; pos++) {
    const e = dictOf(es[pos])
    if (!e) continue
    const sets = arrOf(e.sets)
    for (let si = 0; si < sets.length; si++) {
      if (h[0] !== pkey(e, pos, si, h[1]) && h[0] !== placeKey(e, pos, si, h[1])) continue
      const row = dictOf(sets[si])
      const sd = !row || h[1] == null ? null : dictOf(row.sides)
      const one = sd ? dictOf(sd[h[1]]) : null
      const done = !row || (one ? isTrue(one.done) : isTrue(row.done))
      return done ? null : [pos, si]
    }
  }
  return null
}
function holdUp (c) {
  const s = c.s
  const e = entryAt(s, s.pos)
  const si = setIndex(s, s.pos)
  return !e || si == null ? null : holdFor(s, s.pos, si, sideUp(dictOf(arrOf(e.sets)[si])))
}
// START on a timed set: the 3-2-1 first (second() starts the hold 3.7 s later). `sec`: the target
// the lifter set (null: the set's own).
export function holdCount (c, sec) {
  c.g.hcd = mono(c)
  c.g.hcdN = null
  c.g.hold = null
  c.g.hsec = toF(sec)
  c.g.hfor = holdUp(c)
}
export function holdStart (c) {
  const g = c.g
  g.hcd = null
  if (!g.hfor) g.hfor = holdUp(c)
  let sec = g.hsec
  g.hsec = null
  if (sec == null) {
    const at = holdAt(c.s, g.hfor)
    const row = at ? dictOf(entryAt(c.s, at[0]).sets[at[1]]) : null
    sec = row ? toF(row.sec) : null
  }
  g.hold = [mono(c), sec == null || sec < 1 ? 30 : sec]
  closeRest(c, ms(c))
  newSet(c)
}
export function holdCancel (c) { c.g.hcd = null; c.g.hold = null; c.g.hfor = null; c.g.hsec = null }
export const held = c => (c.g.hold ? trunc((mono(c) - c.g.hold[0]) / 1000) : 0)
// Stop (or Finish mid-hold): the set logged with the seconds held, 1 up to the target.
export function holdStop (c) {
  const h = c.g.hold
  if (!h) return
  const sec = held(c)
  c.g.hold = null
  logHold(c, sec < 1 ? 1 : sec > h[1] ? h[1] : sec)
}
// Nothing is logged when the phone logged that set first: one hold, one set.
function logHold (c, sec) {
  const s = c.s
  const h = c.g.hfor
  const at = holdAt(s, h)
  c.g.hfor = null
  if (!at) return
  const e = entryAt(s, at[0])
  const row = dictOf(arrOf(e.sets)[at[1]])
  const w = toF(row.w)
  tickSet(c, at[0], at[1], h[1], w != null && w > 0 ? w : null, null, sec, toF(e.restSec))
}
function holdTick (c) {
  const h = c.g.hold
  if (!h) return
  const left = h[1] - held(c)
  if (left <= 0) {
    c.g.hold = null
    buzz(c, [[100, 400], [0, 200], [100, 400]])
    logHold(c, h[1])
  } else if (left <= 3) buzz(c, [[30, 40]])
}
// The 3-2-1 before a hold: buzzes on each number and starts the hold at 3.7 s. second() calls it; a
// page may call it more often (every 100 to 250 ms) while c.g.hcd != null for a tighter count.
export function countTick (c) {
  const g = c.g
  if (g.hcd == null) return
  const el = mono(c) - g.hcd
  const n = countNumber(el)
  if (n !== g.hcdN) { g.hcdN = n; buzz(c, n === 0 ? [[100, 250]] : [[30, 40]]) }
  if (el >= 3700) holdStart(c) // "Go!" shown 0.7 s, then it runs
}
export const countNumber = t => { const n = 3 - (t < 0 ? 0 : trunc(t / 1000)); return n < 0 ? 0 : n }

/* ---------- "Still training?" ---------- */
export function lastSet (w) {
  let best = toF(w.activeAt)
  arrOf(w.entries).forEach(e => {
    arrOf(dictOf(e) ? e.sets : null).forEach(row => {
      const at = dictOf(row) ? toF(row.at) : null
      if (at != null && (best == null || at > best)) best = at
    })
  })
  return best != null ? best : toF(w.start)
}
export function asks (last, snooze, now, askMin) {
  const after = (askMin == null ? 20 : askMin) * 60000
  let since = last
  if (snooze != null && (since == null || snooze > since)) since = snooze
  return after > 0 && since != null && now - since >= after
}
// Every 10th second.
function askTick (c) {
  const g = c.g
  const w = dictOf(c.s.w)
  g.askN += 1
  if (!w || g.askN % 10 !== 0 || g.hold) return
  const paused = toF(w.pausedAt)
  if (paused != null && paused > 0) { g.ask = false; g.askLeft = false; return } // never while paused on the phone
  const left = toF(w.leftGymAt)
  g.askLeft = left != null && (g.snooze == null || g.snooze < left)
  const st = dictOf(c.s.set)
  const yes = g.askLeft || asks(lastSet(w), g.snooze, ms(c), st ? toF(st.askMin) : null)
  if (yes && !g.ask) { g.ask = true; g.page = 'set'; buzz(c, [[60, 300]]) } else if (!yes && g.ask) g.ask = false
}
// "Keep going" (tell: a stillHere event) or Finish there (no event).
export function keepGoing (c, tell) {
  const w = dictOf(c.s.w)
  if (tell && c.g.ask && w) send(c, withOff(c, { id: newId(c), type: 'stillHere', wid: strOf(w.id), at: ms(c) }))
  c.g.ask = false
  c.g.askLeft = false
  c.g.snooze = ms(c)
}

/* ---------- before a start: the check-in, the weigh-in ----------
 * A routine started here goes through up to two questions first, as on Wear and the phone: startFlow(c, session)
 * says which comes first ('checkin', 'weighin' or 'count' = straight to the 3-2-1) and keeps the session in
 * c.g.pre; preState(c) says what to draw; the answers move it on; at 'count' the page runs its 3-2-1 and calls
 * startWorkout(c, pre.session, pre.bw). The flow is not saved (a restart in the middle starts over); only the day
 * the check-in was asked is (s.ca). preCancel(c) drops it: nothing starts, the check-in is asked again next time.
 * preState(c) -> null | { kind: 'checkin', step, steps, key } | { kind: 'weighin', w, whole, tenth, unit, min, max }
 *                    | { kind: 'count', session, bw } */
const OKBW = w => typeof w === 'number' && isFinite(w) && w > 0 && w < 700 // phone: okBw (watch-sync.js)
const okBw = OKBW
export const CHECKIN_KEYS = ['sleep', 'energy', 'sore'] // Wear's; the phone's FORM_KEYS also has `stress`, never asked here
export const WEIGH_MIN = 20
const weighTop = c => (c.s.u === 'lb' ? 699.9 : 320.9)
// The watch's own day, YYYY-MM-DD, as the phone writes `checkinDay` (its local date). env.today() when the page has one.
export function today (c) {
  if (c.env.today) return c.env.today()
  const d = new Date(ms(c))
  const two = n => (n < 10 ? '0' : '') + n
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
}
// phone: settings.checkin is true only when the check-in is on there; `checkinDay` is the newest day it has answers
// for (lib/daily-form.js lastFormDay). Asked when on, not answered today on the phone, and not asked here today.
export function checkinDue (c) {
  const st = dictOf(c.s.set)
  const day = today(c)
  return !!st && st.checkin === true && st.checkinDay !== day && c.s.ca !== day
}
function afterCheckin (c) {
  const st = dictOf(c.s.set)
  const pre = c.g.pre
  if (st && st.weighIn === false) { pre.kind = 'count'; return 'count' } // missing = asked, as Wear
  const lb = toF(st ? st.lastBw : null)
  const top = weighTop(c)
  pre.w = Math.min(top, Math.max(WEIGH_MIN, Math.round((lb != null ? lb : c.s.u === 'lb' ? 160 : 70) * 10) / 10))
  pre.kind = 'weighin'
  return 'weighin'
}
export function startFlow (c, session) {
  if (dictOf(c.s.w)) return null
  c.g.pre = { session: session, kind: 'checkin', i: 0, answers: {}, w: null, bw: undefined }
  if (checkinDue(c)) return 'checkin'
  return afterCheckin(c)
}
export function preState (c) {
  const p = c.g.pre
  if (!p) return null
  if (p.kind === 'checkin') return { kind: 'checkin', step: p.i, steps: CHECKIN_KEYS.length, key: CHECKIN_KEYS[p.i] }
  if (p.kind === 'weighin') {
    const tenths = Math.round(p.w * 10)
    return { kind: 'weighin', w: p.w, whole: trunc(tenths / 10), tenth: tenths % 10, unit: c.s.u === 'lb' ? 'lb' : 'kg', min: WEIGH_MIN, max: weighTop(c) }
  }
  return { kind: 'count', session: p.session, bw: p.bw }
}
export function preCancel (c) { c.g.pre = null }
function finishCheckin (c, skip) {
  const p = c.g.pre
  c.s.ca = today(c)
  const ev = { id: newId(c), type: 'dailyForm', at: ms(c) }
  let any = false
  CHECKIN_KEYS.forEach(k => { if (p.answers[k] != null) { ev[k] = p.answers[k]; any = true } })
  // phone: formFromWatch keeps each of sleep / energy / sore / stress that is a whole number 1 to 5, drops the rest;
  // with none left nothing is stored, so none is sent
  if (!skip && any) send(c, withOff(c, ev))
  save(c)
  return afterCheckin(c)
}
// One question answered (1 to 5; anything else passes it over); after the last, the weigh-in or the 3-2-1.
export function checkinAnswer (c, value) {
  const p = c.g.pre
  if (!p || p.kind !== 'checkin') return p ? p.kind : null
  if (typeof value === 'number' && value >= 1 && value <= 5 && Math.floor(value) === value) p.answers[CHECKIN_KEYS[p.i]] = value
  if (p.i + 1 < CHECKIN_KEYS.length) { p.i += 1; return 'checkin' }
  return finishCheckin(c, false)
}
// "Skip for today": nothing sent (answers already given go too), not asked again today.
export function checkinSkip (c) {
  const p = c.g.pre
  if (!p || p.kind !== 'checkin') return p ? p.kind : null
  return finishCheckin(c, true)
}
// The weight on the tenth's grid, inside 20 .. 320.9 kg / 699.9 lb (under the phone's 700).
export function weighInSet (c, w) {
  const p = c.g.pre
  if (!p || p.kind !== 'weighin' || !isNum(w)) return
  p.w = Math.min(weighTop(c), Math.max(WEIGH_MIN, Math.round(w * 10) / 10))
}
export function weighInStep (c, tenths) {
  const p = c.g.pre
  if (!p || p.kind !== 'weighin' || !isNum(tenths)) return
  weighInSet(c, (Math.round(p.w * 10) + trunc(tenths)) / 10)
}
// phone: applyEach 'weighIn' needs okBw(ev.w) (a number, 0 < w < 700), then logWeighIn on the event's day (a day's
// second weigh-in replaces the first). Saved: the event goes and the weight rides on the start as `bw`.
export function weighInDone (c, saveIt) {
  const p = c.g.pre
  if (!p || p.kind !== 'weighin') return p ? p.kind : null
  const w = Math.round(p.w * 10) / 10
  if (saveIt && okBw(w)) {
    send(c, withOff(c, { id: newId(c), type: 'weighIn', w: w, at: ms(c) }))
    p.bw = w
  }
  p.kind = 'count'
  return 'count'
}

/* ---------- start, finish, the phone's snapshot ---------- */
export function reset (c) {
  const g = c.g
  g.page = 'set'; g.fix = null; g.hold = null; g.hcd = null; g.hfor = null; g.hsec = null; g.last = null; g.rated = null
  g.ask = false; g.askLeft = false; g.snooze = null
}
// A ready session (today's or another routine); by name only (entries []) the watch waits for the phone.
export function startWorkout (c, session, bw) {
  const s = c.s
  const at = ms(c)
  const wid = 'watch-' + at
  const es = arrOf(session.entries)
  s.w = { id: wid, name: strOf(session.name), unit: s.u, cur: 0, restSec: s.rs, entries: es, start: at, count: toI(session.count, es.length) }
  s.sh = wid
  const rd = dictOf(s.rd)
  if (rd && rd.today === session) rd.today = { name: strOf(session.name), routineIds: arrOf(session.routineIds), entries: [] }
  s.p = {}; s.sk = []; s.pos = 0; s.rest = null; s.rh = null; s.ra = 0; s.rc = {}; s.ef = {}; s.mu = {}
  closeRest(c, at)
  hrClear(c)
  newSet(c)
  touch(c)
  reset(c)
  c.g.ended = null
  c.g.pre = null
  const ev = { id: newId(c), type: 'start', routineIds: arrOf(session.routineIds), wid: wid, at: at }
  // phone: watch-sync.js applyEach 'start' reads `bw` only when 0 < bw < 700 (okBw): the weight the lifter just gave
  if (okBw(bw)) ev.bw = Math.round(bw * 10) / 10
  withOff(c, ev)
  send(c, ev)
  save(c)
  return ev
}
// The buzz of a finished workout: long on a records day, short otherwise.
const finishBuzz = sm => (sm.recs.length ? [[60, 250]] : [[40, 60]])
// Finished here, or discarded (the phone drops it unsaved: no summary). A running hold is logged first.
export function finishWorkout (c, discard) {
  const s = c.s
  const w = dictOf(s.w)
  if (!w) return null
  if (!discard && c.g.hold) holdStop(c)
  closeRest(c, ms(c))
  const sm = discard ? null : summary(c, w, false)
  const at = ms(c)
  const wid = strOf(w.id)
  s.w = null; s.p = {}; s.sk = []; s.sh = null; s.rest = null; s.rh = null; s.ra = 0; s.pos = 0; s.rc = {}; s.ef = {}; s.mu = {}
  s.fh.push(wid)
  if (s.fh.length > FINISHED_KEPT) s.fh = s.fh.slice(s.fh.length - FINISHED_KEPT)
  send(c, withOff(c, { id: newId(c), type: discard ? 'discard' : 'finish', wid: wid, at: at }))
  const hr = hrTotals(c)
  hrClear(c)
  if (sm) { sm.hr = hr; buzz(c, finishBuzz(sm)) }
  reset(c)
  c.g.ended = sm
  c.g.endedAt = ms(c)
  save(c)
  return sm
}

// The working sets done per exercise that left the window are kept (their muscles with them), so the Muscles page
// counts the whole workout when the phone sends only part of it; one that is back in the window is read from there.
function foldMuscles (s, cur, next) {
  const key = (e, i) => toI(e.i, i) + ':' + strOf(e.id)
  const places = {}
  const ids = {}
  next.forEach((e, i) => { if (dictOf(e)) { places[toI(e.i, i)] = true; ids[strOf(e.id)] = true } })
  // what the window shows now is read from there: a line at one of its places, or of an exercise in it (the phone moved it)
  Object.keys(s.mu).forEach(k => { if (places[parseInt(k, 10)] || ids[k.slice(k.indexOf(':') + 1)]) delete s.mu[k] })
  arrOf(cur.entries).forEach((e, i) => {
    if (!dictOf(e)) return
    if (places[toI(e.i, i)] || ids[strOf(e.id)] || !dictOf(e.muscles)) return
    let n = 0
    arrOf(e.sets).forEach(r => { if (dictOf(r) && isTrue(r.done) && !isTrue(r.warmup)) n += 1 })
    if (n > 0) s.mu[key(e, i)] = [n, e.muscles]
  })
}

// A phone-ticked set the watch has not seen: [pos, si, at] of the newest, in c.ptick.
function phoneTick (c, old, e, ei, si, row, k) {
  if (isTrue(row.done) && old[onKey(e, ei)] && !old[k]) {
    const at = toF(row.at) == null ? 0 : row.at
    if (!c.ptick || at >= c.ptick[2]) c.ptick = [ei, si, at]
  }
}
function doneKeys (s) {
  const out = {}
  entries(s).forEach((e, ei) => {
    if (!dictOf(e)) return
    out[onKey(e, ei)] = true
    arrOf(e.sets).forEach((row, si) => {
      if (!dictOf(row)) return
      if (isTrue(row.done)) out[pkey(e, ei, si, null)] = true
      ;['L', 'R'].forEach(side => { const sd = dictOf(row.sides); const one = sd ? dictOf(sd[side]) : null; if (one && isTrue(one.done)) out[pkey(e, ei, si, side)] = true })
    })
  })
  return out
}

// The phone's snapshot over what the watch has. Returns the summary of a workout the phone ended.
export function applySnapshot (c, snap) {
  const s = c.s
  c.rx = false
  c.ptick = null
  c.ptlist = []
  ackOutbox(s, arrOf(snap.acked))
  noteClock(c, toF(snap.now))
  s.rd = dictOf(snap.ready)
  s.sy = true
  if (dictOf(snap.settings) && typeof snap.settings.lang === 'string') s.pl = snap.settings.lang // kept until the phone gives another
  if (typeof snap.unit === 'string') s.u = snap.unit
  const rs = toF(snap.restSec)
  if (rs != null && rs > 0) s.rs = rs
  if (dictOf(snap.settings)) {
    // the ratings follow the phone's scale: RIR = 10 - RPE (lib/effort.js); any other change drops them (Wear's applySnapshot)
    const was = dictOf(s.set) ? s.set.effort : undefined
    s.set = snap.settings
    if (was !== s.set.effort) {
      const ef = {}
      if ((was === 'rpe' && s.set.effort === 'rir') || (was === 'rir' && s.set.effort === 'rpe')) Object.keys(s.ef).forEach(k => { ef[k] = [10 - s.ef[k][0], s.ef[k][1], s.ef[k][2], s.ef[k][3]] })
      s.ef = ef
    }
  }
  if (dictOf(snap.streak)) s.stk = snap.streak

  const cur = dictOf(s.w)
  const wid = cur ? cur.id : null
  const droppedThere = wid != null && has(arrOf(snap.discarded), wid)
  if (droppedThere && same(wid, s.sh)) s.sh = null
  const unconfirmed = wid != null && same(wid, s.sh)
  const nx = dictOf(snap.active)
  const nid = nx ? nx.id : null

  if (!nx || (nid != null && has(s.fh, nid))) {
    // no workout on the phone, or one the watch has finished already
    if (unconfirmed || !cur) return null
    const ended = droppedThere ? null : summary(c, cur, true)
    closeRest(c, ms(c))
    hrClear(c)
    s.w = null; s.p = {}; s.sk = []; s.rest = null; s.rh = null; s.ra = 0; s.rc = {}; s.ef = {}; s.mu = {}
    return ended
  }
  const sameOne = nid != null && same(nid, wid)
  if (nid != null && same(nid, s.sh)) s.sh = null
  if (!sameOne && unconfirmed) return null // the phone runs another workout: the watch keeps its own

  const onScreen = entryAt(s, s.pos)
  const onId = onScreen ? onScreen.id : null
  const atEnd = !!cur && entries(s).length > 0 && s.pos >= entries(s).length
  if (!sameOne) { closeRest(c, ms(c)); hrClear(c); newSet(c); touch(c); s.p = {}; s.sk = []; s.rest = null; s.rh = null; s.ra = 0; s.rc = {}; s.ef = {}; s.mu = {} }

  let es = arrOf(nx.entries)
  // the phone behind a drain: until it has every set logged here, its window without the exercise
  // on screen is the phone behind, not moved on
  const held2 = sameOne && onId != null && waiting(s) > 0 && findOn(es, onScreen) == null
  if (held2) { es = entries(s); nx.entries = es }
  if (!held2) replayEdits(s, nx)
  const old = sameOne && !held2 ? doneKeys(s) : null

  const p = s.p
  const seen = {}
  es.forEach((e, ei) => {
    if (!dictOf(e)) return
    arrOf(e.sets).forEach((row, si) => {
      if (!dictOf(row)) return
      const k = pend(p, e, ei, si, null)
      const t = p[k]
      if (t != null) {
        seen[k] = true
        const rowAt = toF(row.at)
        // (both on the phone's clock) held: the rows are the watch's own
        if (!held2 && isTrue(row.done) && (rowAt == null || rowAt >= t[2])) delete p[k]
        else {
          row.done = true
          if (t[0] != null) row.w = t[0]
          if (t[1] != null) row.r = t[1]
          if (t[3] != null) row.sec = t[3]
          row.at = t[2]
        }
      } else if (old) phoneTick(c, old, e, ei, si, row, k)
      ;['L', 'R'].forEach(side => {
        const ks = pend(p, e, ei, si, side)
        const ts = p[ks]
        if (ts == null) return
        seen[ks] = true
        const sd = dictOf(row.sides)
        const one = sd ? dictOf(sd[side]) : null
        const rowAt2 = toF(row.at)
        if (!held2 && one && isTrue(one.done) && (rowAt2 == null || rowAt2 >= ts[2])) delete p[ks]
        else if (sd) markSide(row, side, ts[0], ts[1], ts[2])
        else delete p[ks]
      })
      // a set (or a side of it) done on the phone since the last snapshot: its heart rate is the watch's (setHr)
      if (old && old[onKey(e, ei)] && toF(row.at) != null) {
        const sd = dictOf(row.sides)
        let fresh = isTrue(row.done) && !old[k]
        ;['L', 'R'].forEach(side => { const one = sd ? dictOf(sd[side]) : null; if (one && isTrue(one.done) && !old[pkey(e, ei, si, side)]) fresh = true })
        if (fresh) c.ptlist.push({ exId: strOf(e.id), entryIdx: toI(e.i, ei), setIdx: si, sid: row.sid, at: row.at })
      }
    })
  })
  if (sameOne && cur) foldRecords(s.rc, cur) // the window that is about to go, with its local ticks
  if (sameOne && cur) foldMuscles(s, cur, es)
  s.w = nx
  // a set unticked on the phone loses its rating, so a later unrated tick does not bring it back
  es.forEach((e, ei) => {
    if (!dictOf(e)) return
    arrOf(e.sets).forEach((row, si) => {
      if (!dictOf(row)) return
      const k = pkey(e, ei, si, null)
      if (s.ef[k] && !isTrue(row.done) && !sideDone(row, 'L') && !sideDone(row, 'R')) delete s.ef[k]
    })
  })
  // ticks of sets this snapshot no longer has: the phone has them (it moved the window on). Not while their
  // setDone is still in the outbox: the phone may only be behind, and an older whole-workout snapshot would
  // show the set open again.
  const live = {}
  s.ob.forEach(ev => {
    if (!same(evField(ev, 1), 'setDone')) return
    const id = evField(ev, 15)
    const sd = evField(ev, 10)
    const k = typeof id === 'string' ? 's:' + id : 'e' + evField(ev, 5) + ':' + strOf(evField(ev, 4)) + '#' + evField(ev, 6)
    live[sd != null ? k + '#' + sd : k] = true
  })
  Object.keys(p).forEach(k => { if (!seen[k] && !live[k]) delete p[k] })

  let pos = 0
  const curIdx = toI(nx.cur, 0)
  const moved = sameOne && !held2 && toI(cur.cur, curIdx) !== curIdx && waiting(s) === 0
  let at2 = null
  if (!sameOne || moved) {
    for (let k2 = 0; k2 < es.length; k2++) if (dictOf(es[k2]) && toI(es[k2].i, k2) === curIdx) { at2 = k2; break }
  }
  if (at2 != null) pos = openFrom(s, es, at2)
  else if (sameOne && atEnd && es.length > 0 && !hasMore(s)) pos = es.length
  else if (sameOne && onId != null) { const k3 = findOn(es, onScreen); if (k3 != null) pos = k3 }
  s.pos = pos
  followRest(c, nx)
  return null
}

// The phone ticked a set: the watch moves on as its own Done would, unless fixing or holding.
function followTick (c) {
  const s = c.s
  const g = c.g
  const t = c.ptick
  c.ptick = null
  // a hold for a set the phone logged since: its own hold ended first, this one ends unlogged
  if ((g.hold || g.hcd != null) && g.hfor && holdAt(s, g.hfor) == null) holdCancel(c)
  const e = t ? entryAt(s, t[0]) : null
  if (!e) return
  g.last = [e.id, t[1], null, rowSidOf(e, t[1])]
  g.rated = null
  if (g.fix || g.hold || g.hcd != null) return
  const to = next(s, t[0], t[1])[0]
  if ((to >= entries(s).length && hasMore(s)) || to === s.pos) return
  s.pos = to
  if (to >= entries(s).length) g.page = 'over'
}

// What the page may cache about the set up: its place, its id and its numbers. c.g.up moves on when it changes
// through an edit (addSet, removeSet) or a snapshot; a page that loaded its boxes for an older value loads them again.
function upKey (c) {
  const s = c.s
  const e = entryAt(s, s.pos)
  const si = e ? setIndex(s, s.pos) : null
  const row = si == null ? null : dictOf(arrOf(e.sets)[si])
  return (dictOf(s.w) ? strOf(s.w.id) : '') + '|' + s.pos + '|' + (e ? strOf(e.id) : '') + '|' + (si == null ? '' : si) + '|' +
    (row ? strOf(row.sid) + '|' + strOf(row.w) + '|' + strOf(row.r) + '|' + strOf(row.sec) : '')
}
// A message from the phone (the snapshot). Returns the summary when the phone ended the workout the
// watch had running (the page shows it; c.g.ended holds it too), else null. After it, if s.w went
// from null to a workout, the phone started it: the page starts its heart-rate sensor.
export function onPhone (c, data) {
  if (!dictOf(data)) return null
  const s = c.s
  c.g.awayAt = null
  if (c.stopped) return null
  const r0 = s.rest
  const up0 = upKey(c)
  const ended = applySnapshot(c, data)
  if (ended) {
    ended.hr = hrTotals(c)
    buzz(c, finishBuzz(ended))
    reset(c)
    c.g.ended = ended
    c.g.endedAt = ms(c)
  } else if (s.w == null) {
    hrTotals(c)
    reset(c)
  } else {
    restFollowed(c, r0)
    followTick(c)
    phoneTicksHr(c)
    c.g.pre = null // a workout runs: no start to prepare
  }
  if (upKey(c) !== up0) c.g.up += 1
  save(c)
  heard(c)
  return ended
}

/* ---------- the Link: send, hello, retries ---------- */
export function send (c, ev) {
  if (!ev || c.stopped) return
  supersede(c.s, ev)
  room(c.s, MAX, HARD)
  c.s.ob.push(pack(ev))
  save(c)
  flush(c)
}
function listener (c, ids) {
  const gen = c.link.gen
  return { onComplete: () => { if (!c.stopped) sent(c, ids, gen) }, onError: () => { if (!c.stopped) failed(c, gen) } }
}
// A radio that throws is a failed send, not a busy link for 45 s.
function transmit (c, msg, ids) {
  const l = c.link
  try { c.env.radio.transmit(msg, listener(c, ids)) } catch (e) { failed(c, l.gen) }
}
// "Send me the latest": the phone's bridge answers with a snapshot. Never queued.
export function hello (c) {
  const l = c.link
  if (l.busy || c.stopped) return false
  l.began = mono(c)
  l.gen += 1
  l.busy = true
  transmit(c, { events: [{ id: newId(c), type: 'hello', at: ms(c) }] }, [])
  return true
}
export function launch (c) { hello(c); watchStatus(c) }

// What the watch tells the phone about itself (Settings on the phone: "last heard", the version).
// phone: writeWatchStatus (watch-settings.js): health is 'on'|'off'|'denied' else null, version a string cut to
// 20 characters, at a number, routinesHash / routinesCount only when strings / numbers. This watch has no
// health access and no routines file yet, so it sends the version and the time only; the phone then shows its
// routines pill as unknown. Not more often than every 6 hours, and again after an update (as Wear's CheckIn).
// Needs env.version (a string); without it nothing is sent.
export const STATUS_EVERY_MS = 6 * 3600000
export function watchStatus (c) {
  const v = c.env.version
  if (typeof v !== 'string' || !v) return null
  const now = ms(c)
  const last = arrOf(c.s.ws)
  if (last.length === 2 && last[1] === v && now >= last[0] && now - last[0] < STATUS_EVERY_MS) return null
  c.s.ws = [now, v]
  const ev = withOff(c, { id: newId(c), type: 'watchStatus', version: v, at: now })
  send(c, ev)
  return ev
}
export function flush (c) {
  if (c.stopped) return
  const l = c.link
  const ob = c.s.ob
  const from = toI(c.s.obn, 0)
  if (l.busy || from >= ob.length) return
  l.busy = true
  l.lastTry = mono(c)
  l.began = l.lastTry
  l.gen += 1
  const batch = ob.slice(from, from + BATCH)
  transmit(c, { events: batch.map(unpack) }, batch.map(e => evField(e, 0)))
}
// `ids`: the events that were in the message. While it was out, the outbox may have changed (an ack,
// a superseded rest, a dropped event): only the sent mark moves over events that are still there.
function sent (c, ids, gen) {
  if (gen !== c.link.gen) return
  c.link.busy = false
  c.link.okAt = ms(c) // a message got through: the phone is in reach
  c.g.awayAt = null
  if (ids.length) {
    const s = c.s
    let n = toI(s.obn, 0)
    while (n < s.ob.length && has(ids, evField(s.ob[n], 0))) n += 1
    s.obn = n
    save(c)
  }
  flush(c)
}
function failed (c, gen) {
  if (gen !== c.link.gen) return
  c.link.busy = false
  c.g.awayAt = ms(c) // "Phone out of reach"
}
// Whether the phone is in reach, from what the link already knows: 'near' when a message got through or the phone
// spoke less than REACH_MS ago and nothing failed since, 'away' when the last send failed (and nothing since got
// through), else 'unknown' (nothing sent lately: the watch cannot tell).
export const REACH_MS = 10 * 60000
export function reach (c) {
  const ok = c.link.okAt
  const bad = c.g.awayAt
  if (bad != null && bad >= ok) return 'away'
  return ms(c) - ok < REACH_MS ? 'near' : 'unknown'
}
// What was not sent goes after 30 s, what the phone has not confirmed after a minute; a transmit
// that never called back is given up after 45 s. All doubling while the phone stays silent.
function retry (c) {
  const l = c.link
  const s = c.s
  const now = mono(c)
  if (l.busy && (now - l.began > GIVE_UP_MS || now < l.began)) { l.busy = false; l.gen += 1 }
  if (l.busy) return
  const need = needsPhone(s)
  const wait = (need ? NEED : RETRY_UNACKED_MS) << Math.min(QUIET_MAX, l.quiet)
  if ((l.ask || (need && !s.ob.length)) && now - l.began > wait && hello(c)) { l.quiet += 1; return }
  if (!s.ob.length) return
  const since = now - l.lastTry
  if (unsent(s) > 0 && since > (need ? wait : RETRY_UNSENT_MS)) { if (need) l.quiet += 1; flush(c) } else if (unsent(s) === 0 && since > wait) { s.obn = 0; l.quiet += 1; flush(c) }
}
// The phone just spoke: what it did not name and was sent a while ago goes again now.
export function heard (c) {
  const l = c.link
  const s = c.s
  l.ask = false
  l.quiet = 0
  l.okAt = ms(c)
  if (!l.busy && s.ob.length > 0 && unsent(s) === 0 && mono(c) - l.lastTry > HEARD_RESEND_MS) s.obn = 0
  flush(c)
}

// Once a second.
export function second (c) {
  if (c.stopped) return
  restTick(c)
  holdTick(c)
  countTick(c)
  askTick(c)
  retry(c)
}
