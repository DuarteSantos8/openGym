// The openGym watch's logic for Huawei lite wearables: the Garmin watch's Core.mc, Actions.mc and
// App.mc (Link) as plain JavaScript, no screens and no Huawei API. Same wire protocol: the phone
// sends the Garmin snapshot (lib/garmin-snapshot.js: a window of the workout,
// each exercise with `i` = its index; the whole-workout case is still read), the watch
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
//           rest, ob, obn, ra, rh, ck; added: ws = [time, version] of the last watchStatus). Plain JSON. `c.s.ob` is the
//           outbox of packed events. `s.sk` (skipped sets) holds set ids 's:<sid>' (or 'exId#si' without one).
//   c.g     what lives only until the app closes: page, lock, last, rated, fix, hold, hcd, hfor,
//           ask, askLeft, snooze, ended, endedAt, awayAt, bpm, activityAt, ...
//           c.g.last / c.g.fix are [exId, setIndex, side, setId]: the set is found by its id when it has one.
//   c.hr    heart-rate sums (memory only, see "heart rate" below)
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
//   summary(c,w,ended) -> the summary's numbers {name, unit, dur, sets, vol, ended}
//   pressDone(c, w, r) -> 'none'|'confirmFinish'|'next'|'hold'|'tick'|'fix'   (w, r = boxes; on a set
//                         being fixed it saves the fix and returns 'fix')
//   tickSet(c,pos,si,side,w,r,sec,restSec)       skipSet(c)   nextExercise(c)
//   holdCount(c, sec) holdStart(c) holdStop(c) holdCancel(c)  (3-2-1 first; countTick(c), which
//                         second() runs, buzzes the count and starts it; call it faster for a tight count)
//   restAdd(c, +15|-15)  restSkip(c)             rate(c, v) (effort chip)
//   fixLast(c) fixStep(c, by) fixSave(c, w, r) fixCancel(c)
//   keepGoing(c, tell)                           reset(c)
//   c.g.up: a number that moves on every snapshot that changes the set up (its place, id or numbers): a page that
//     cached the boxes for an older value loads them again.
//   stop(c): switch a replaced core off for good (late callbacks, timers and messages do nothing, it never saves).
//   lockFor(c, ms): the button lock, on the clock locked() reads.
// HEART RATE (section "heart rate" below)
//   hrSample(c, bpm) once a second   hrSoFar(c) -> [avg, max]|null   (sums only, no buffer)
//   sensorShouldRest(c)  (3 hours idle: the page may stop the sensor; ask again after each action)
// WATCH STATUS: launch(c) sends it when env.version is set and it is due; watchStatus(c) does it on demand
// SUMMARY AND METRICS: metrics.js has the one Metrics page's numbers; workoutTotals(w) -> [sets, volume].
// OVERVIEW: supersetStart(s,pos)
// THE PHONE
//   onPhone(c, data) -> summary|null (a workout the phone ended while the watch had it)
// Cardio is logged on the phone: the page offers nextExercise for it, never tickSet.

export const EV_KEYS = ['id', 'type', 'at', 'wid', 'exId', 'entryIdx', 'setIdx', 'w', 'r', 'sec', 'side', 'hr', 'rir', 'rpe', 'routineIds', 'sid', 'restEnd', 'endsAt', 'off',
  // appended: the layout of the keys above is what an outbox stored by an older watch holds
  'restHr', 'version']
export const PLACES = 9
export const BATCH = 4
// The outbox: `MAX` events when the phone is there (the oldest sent one goes), `HARD` when nothing has been sent (the
// phone away the whole time): the Garmin's 60 / 90, so the heap stays small and the phone's 16 acked ids keep up.
export const MAX = 60
export const HARD = 90
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
const ms = c => c.env.now()
// A monotonic clock for durations (locks, holds, link waits): env.tick() when the page has one, so a
// watch clock that is set mid-workout cannot stretch or cut them; else the wall clock.
const mono = c => (c.env.tick ? c.env.tick() : c.env.now())

export const isTimed = e => !!e && same(e.mode, 'time')
export const isCardio = e => !!e && same(e.mode, 'cardio')

/* ---------- state ---------- */
export const emptyState = () => ({
  w: null, rd: null, set: {}, u: 'kg', rs: 90, sy: false,
  sh: null, fh: [], p: {}, pos: 0, sk: [], rest: null, ob: [], obn: 0, ra: 0, rh: null, ck: [],
  ws: null // [time, version] of the last watchStatus
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
    link: { busy: false, quiet: 0, ask: true, began: -1e12, lastTry: -1e12, gen: 0, fly: [] },
    g: { page: 'set', lock: null, last: null, rated: null, fix: null, hold: null, hcd: null, hfor: null, hsec: null,
      ask: false, askLeft: false, snooze: null, ended: null, endedAt: null, awayAt: null, bpm: null, askN: 0,
      restTotal: null, restNudged: false, restOver: false, restFor: null, n: 0, hcdN: null, activityAt: env.now(), up: 0 },
    hr: { setSum: 0, setN: 0, setMax: 0, allSum: 0, allN: 0, allMax: 0 },
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
//  1. a watchStatus   2. a rest change   3. a stillHere   4. a correction (a fix or effort of a set: the set stays)
//  5. a logged set   6. anything else but start, finish, discard   7. a finish or discard   8. a start (without it the
// phone holds back every event of a watch workout: it goes last). Below `max` nothing goes; with none sent it grows to
// `hard` first. A logged set is therefore the last data to go.
export function room (s, max, hard) {
  const ob = s.ob
  const sent = toI(s.obn, 0)
  if (ob.length < max || (sent === 0 && ob.length < hard)) return
  let k = -1
  const type = i => evField(ob[i], 1)
  const isType = name => i => same(type(i), name)
  const first = test => { for (let i = 0; i < ob.length && k < 0; i++) if (test(i)) k = i }
  first(isType('watchStatus'))
  first(isType('rest'))
  first(isType('stillHere'))
  first(i => same(type(i), 'setDone') && again(ob, i))
  first(isType('setDone'))
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

// The workout as the summary shows it: name, seconds, sets, volume, unit.
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
  const tot = workoutTotals(w)
  const sets = tot[0]
  const volume = tot[1]
  const unit = strOf(w.unit)
  return { name: strOf(w.name), unit: unit, dur: elapsed(c, w), sets: sets, vol: volume, ended: endedOnPhone }
}

/* ---------- heart rate ----------
 * One reading a second from the page: hrSample(c, bpm). Readings outside 25..250 are no reading (the phone drops
 * a set's heart rate outside that: lib/heart-rate.js sanitizeHr). The sums a watch-ticked set carries (`hr` of its
 * setDone, since the last tick, rest end or hold start) and the workout's own, for the Metrics page and the summary.
 * No buffer: a set ticked on the phone gets no heart rate from here (the Garmin's level). */
export const HR_MIN = 25
export const HR_MAX = 250
export function hrSample (c, bpm) {
  const h = c.hr
  c.g.bpm = bpm
  if (!(bpm >= HR_MIN && bpm <= HR_MAX) || !dictOf(c.s.w)) return
  h.setSum += bpm; h.setN += 1; if (bpm > h.setMax) h.setMax = bpm
  h.allSum += bpm; h.allN += 1; if (bpm > h.allMax) h.allMax = bpm
}
export function newSet (c) { c.hr.setSum = 0; c.hr.setN = 0; c.hr.setMax = 0 }
export function hrForSet (c) {
  const h = c.hr
  const out = h.setN > 0 ? [trunc(h.setSum / h.setN), h.setMax] : null
  newSet(c)
  return out
}
// [average, max] of the workout so far, or null.
export function hrSoFar (c) { const h = c.hr; return h.allN > 0 ? [trunc(h.allSum / h.allN), h.allMax] : null }
export function hrTotals (c) {
  const h = c.hr
  const out = hrSoFar(c)
  h.allSum = 0; h.allN = 0; h.allMax = 0
  newSet(c)
  return out
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
  c.g.rated = v
  buzz(c, [[40, 60]])
  save(c)
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

/* ---------- the overview ---------- */
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
  // the watch's rest ended here (the phone's end is past, or it skipped it): the next set's heart rate counts from now
  if (was && s.rest == null && s.rh == null) newSet(c)
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

/* ---------- start, finish, the phone's snapshot ---------- */
export function reset (c) {
  const g = c.g
  g.page = 'set'; g.fix = null; g.hold = null; g.hcd = null; g.hfor = null; g.hsec = null; g.last = null; g.rated = null
  g.ask = false; g.askLeft = false; g.snooze = null
}
// A ready session (today's or another routine); by name only (entries []) the watch waits for the phone.
export function startWorkout (c, session) {
  const s = c.s
  const at = ms(c)
  const wid = 'watch-' + at
  const es = arrOf(session.entries)
  s.w = { id: wid, name: strOf(session.name), unit: s.u, cur: 0, restSec: s.rs, entries: es, start: at, count: toI(session.count, es.length) }
  s.sh = wid
  const rd = dictOf(s.rd)
  if (rd && rd.today === session) rd.today = { name: strOf(session.name), routineIds: arrOf(session.routineIds), entries: [] }
  s.p = {}; s.sk = []; s.pos = 0; s.rest = null; s.rh = null; s.ra = 0
  hrTotals(c) // the last workout's heart-rate sums must not reach this one
  touch(c)
  reset(c)
  c.g.ended = null
  const ev = { id: newId(c), type: 'start', routineIds: arrOf(session.routineIds), wid: wid, at: at }
  withOff(c, ev)
  send(c, ev)
  save(c)
  return ev
}
const FINISH_BUZZ = [[40, 60]]
// Finished here, or discarded (the phone drops it unsaved: no summary). A running hold is logged first.
export function finishWorkout (c, discard) {
  const s = c.s
  const w = dictOf(s.w)
  if (!w) return null
  if (!discard && c.g.hold) holdStop(c)
  const sm = discard ? null : summary(c, w, false)
  const at = ms(c)
  const wid = strOf(w.id)
  s.w = null; s.p = {}; s.sk = []; s.sh = null; s.rest = null; s.rh = null; s.ra = 0; s.pos = 0
  s.fh.push(wid)
  if (s.fh.length > FINISHED_KEPT) s.fh = s.fh.slice(s.fh.length - FINISHED_KEPT)
  send(c, withOff(c, { id: newId(c), type: discard ? 'discard' : 'finish', wid: wid, at: at }))
  const hr = hrTotals(c)
  if (sm) { sm.hr = hr; buzz(c, FINISH_BUZZ) }
  reset(c)
  c.g.ended = sm
  c.g.endedAt = ms(c)
  save(c)
  return sm
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
  ackOutbox(s, arrOf(snap.acked))
  noteClock(c, toF(snap.now))
  s.rd = dictOf(snap.ready)
  s.sy = true
  if (typeof snap.unit === 'string') s.u = snap.unit
  const rs = toF(snap.restSec)
  if (rs != null && rs > 0) s.rs = rs
  if (dictOf(snap.settings)) s.set = snap.settings

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
    s.w = null; s.p = {}; s.sk = []; s.rest = null; s.rh = null; s.ra = 0
    return ended
  }
  const sameOne = nid != null && same(nid, wid)
  if (nid != null && same(nid, s.sh)) s.sh = null
  if (!sameOne && unconfirmed) return null // the phone runs another workout: the watch keeps its own

  const onScreen = entryAt(s, s.pos)
  const onId = onScreen ? onScreen.id : null
  const atEnd = !!cur && entries(s).length > 0 && s.pos >= entries(s).length
  if (!sameOne) { hrTotals(c); touch(c); s.p = {}; s.sk = []; s.rest = null; s.rh = null; s.ra = 0 }

  let es = arrOf(nx.entries)
  // the phone behind a drain: until it has every set logged here, its window without the exercise
  // on screen is the phone behind, not moved on
  const held2 = sameOne && onId != null && waiting(s) > 0 && findOn(es, onScreen) == null
  if (held2) { es = entries(s); nx.entries = es }
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
    })
  })
  s.w = nx
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
// through a snapshot; a page that loaded its boxes for an older value loads them again.
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
    buzz(c, FINISH_BUZZ)
    reset(c)
    c.g.ended = ended
    c.g.endedAt = ms(c)
  } else if (s.w == null) {
    hrTotals(c)
    reset(c)
  } else {
    restFollowed(c, r0)
    followTick(c)
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

/* ---------- what the app does with the outside (app.js: sensor, screen, motor) ---------- */
// The heart-rate sensor only while a workout runs, and not after three idle hours (sensorShouldRest).
export const wantHr = c => !!c.s.w && !sensorShouldRest(c)
// The screen stays on only during a rest or a hold.
export const wantAwake = c => !!c.s.w && (c.s.rest != null || !!c.g.hold || c.g.hcd != null)

// core.js buzzes with [[intensity %, ms], ...]; the watch has 'long' and 'short' only. Each pair with
// an intensity is one buzz, long when the pair lasts 200 ms or more and it is the only one; a pair with 0 is a pause. Returns
// [[delay ms, mode], ...], each buzz starting when the pairs before it have run their time.
// A pattern with more than one buzz (the double at the end of a rest) uses short buzzes only: how long
// 'long' lasts is not documented, and a second long buzz could start inside the first and merge with it.
export function buzzPlan (pattern) {
  const out = []
  const pairs = arrOf(pattern)
  const several = pairs.filter(p => p[0] > 0).length > 1
  let at = 0
  pairs.forEach(p => {
    if (p[0] > 0) out.push([at, !several && p[1] >= 200 ? 'long' : 'short'])
    at += p[1]
  })
  return out
}

// The heart rate the core is fed once a second: the sensor reports every 5 s, so the last reading
// counts for up to 15 s (3 reports), then it is stale and counts as none.
export const HR_STALE_MS = 15000
export const bpmNow = (bpm, at, now) => (bpm > 0 && now - at <= HR_STALE_MS ? bpm : 0)
