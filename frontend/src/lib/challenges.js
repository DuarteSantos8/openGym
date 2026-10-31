// Monthly challenges (v1.4.4): three small goals each calendar month, sized to how you train.
//
// Pure and framework-free. Everything is worked out on the device from the profile's own
// workouts and weigh-ins: a phone kept local and a synced one do exactly the same, and nothing
// new is sent anywhere. The card lives in components/Challenges.jsx.
//
// THE MONTH is the local calendar month. A workout belongs to the month of its local day (`d`,
// lib/history.js workoutDay), never the UTC one, so a session on the 31st at 23:30 counts for that
// month wherever the server sits.
//
// THE PICK. Each month offers PICKS challenges out of CHALLENGES, one per kind where it can
// (a habit, an effort, something new), and only ones that fit: the pull-ups one only for someone
// who does pull-ups, cardio only for someone who does cardio. Which one of a kind turns with the
// month (rotation, not chance), so the same profile on two devices picks the same three, and
// next month brings different ones. Targets come from the LOOKBACK months before (the user's
// level): a bit more than usual (stretch), so it is a stretch you can make, not a wall.
//
// WHAT IS STORED: once the month's three are picked they are kept, so a workout imported into
// an earlier month halfway through does not swap the goals under you, and what was completed
// stays completed (the badge). The progress itself is never stored, it is read back from the
// workouts every time:
//
//   S.challenges = { '2026-11': { picked: [{ id: 'workouts', n: 14 }, { id: 'volume', n: 50000, u: 'kg' }, …],
//                                 done: ['workouts'], at: 1793836800000 } }
//
// At most MONTHS_KEPT months are kept, every list is capped, and two copies merge by the union of
// what was done (mergeChallenges, used by lib/sync-merge.js and api/sync-stamps.js).
//
// No shaming, ever: a challenge not made just ends with its month.
import { workoutDay, sessionVolume, completedRepsOf, doneUnits } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { EXIDX, isCardio, canonicalExId } from './exercises.js'
import { musclesOf } from './muscles.js'
import { isoOf, weekKey, weekStartOf } from './format.js'
import { LB_KG } from './units.js'

export const PICKS = 3
export const LOOKBACK = 3
export const MONTHS_KEPT = 24
// A week counts for the "every week" challenge when at least this many of its days are in the month.
export const WEEK_DAYS_IN = 4
// Weeks in a month, on average: 365.25 / 12 / 7.
const WEEKS_PER_MONTH = 4.348

const pad = n => String(n).padStart(2, '0')
const ID = /^[a-z][a-z0-9-]{0,31}$/
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/
export const isMonthKey = k => typeof k === 'string' && MONTH.test(k)
/** 'YYYY-MM' of a local date. */
export const monthKeyOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const monthIndex = key => { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1) }
/** The month `n` months after `key` (before, for a negative n). */
export const shiftMonth = (key, n) => { const i = monthIndex(key) + n; return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}` }
const daysIn = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate() }

/* ---------- muscle groups ---------- */

// "Every muscle group at least once": six groups a person would name, from the map's muscles.
export const GROUPS = {
  chest: ['chest', 'serratus'],
  back: ['upper-back', 'trapezius', 'lower-back'],
  shoulders: ['deltoids'],
  arms: ['biceps', 'triceps', 'forearm'],
  legs: ['gluteal', 'quadriceps', 'hamstring', 'adductors', 'calves', 'hip-flexors', 'tibialis'],
  core: ['abs', 'obliques'],
}
export const GROUP_IDS = Object.keys(GROUPS)
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, ms]) => ms.map(m => [m, g])))
// A group counts as trained from one done work set whose main muscle is in it (lib/muscles.js:
// weight 1, a helper weighs less): squats train legs, not core, however many sets of them.
const mainGroupsOf = e => {
  const historical = e?.exercise || e?.ex
  const source = historical?.muscleWeights ? historical : (EXIDX[e?.id] || historical || e)
  let m = {}
  try { m = musclesOf(source) || {} } catch { m = {} }
  return Object.entries(m).filter(([, w]) => w >= 1).map(([k]) => GROUP_OF[k]).filter(Boolean)
}

/* ---------- reading a month back ---------- */

const nameOf = e => {
  const ex = EXIDX[e?.id]
  return String(ex?.n || e?.exercise?.n || e?.ex?.n || e?.name || '').toLowerCase()
}
const PULLUP = /\b(pull|chin)[\s-]?ups?\b/
const PUSHUP = /\bpush[\s-]?ups?\b/
const workRows = e => (Array.isArray(e?.sets) ? e.sets : []).filter(s => s && !isWarmupRow(s))
const repsOf = e => workRows(e).reduce((n, s) => n + completedRepsOf(s), 0)
// Cardio minutes of one entry: a cardio row's `min`, or a timed row's `sec` on a cardio exercise.
function cardioMinOf(e) {
  const cardio = isCardio(e?.id)
  let m = 0
  for (const s of workRows(e)) {
    if (!doneUnits(s)) continue
    if (Number(s.min) > 0) m += Number(s.min)
    else if (cardio && Number(s.sec) > 0) m += Number(s.sec) / 60
  }
  return m
}
const exKey = id => (typeof id === 'string' ? canonicalExId(id) : null)

// The weeks that count for a month: the profile's weeks with at least WEEK_DAYS_IN days inside it.
export function weeksOfMonth(key, ws = 1) {
  const [y, m] = key.split('-').map(Number)
  const per = new Map()
  for (let d = 1; d <= daysIn(key); d++) {
    const k = weekKey(isoOf(new Date(y, m - 1, d, 12)), ws)
    per.set(k, (per.get(k) || 0) + 1)
  }
  return [...per].filter(([, n]) => n >= WEEK_DAYS_IN).map(([k]) => k)
}

/**
 * What one month holds, for every kind of challenge at once. `firstSeen` (exercise id → its first
 * day ever with a done set) is shared across months, see factsFor.
 */
function monthFacts(S, key, ws, months, firstSeen) {
  const list = months.get(key) || []
  const lb = S?.unit === 'lb'
  const weeks = weeksOfMonth(key, ws)
  const trainedWeeks = new Set()
  const exDone = new Set()
  const groups = new Set()
  let volume = 0, prs = 0, pullups = 0, pushups = 0, cardio = 0
  for (const w of list) {
    const day = workoutDay(w)
    trainedWeeks.add(weekKey(day, ws))
    let v = 0
    try { v = sessionVolume(w, S) } catch { v = 0 }
    volume += v
    prs += new Set(Array.isArray(w.prs) ? w.prs.filter(id => typeof id === 'string') : []).size
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      if (!e) continue
      const name = nameOf(e)
      if (PULLUP.test(name)) pullups += repsOf(e)
      else if (PUSHUP.test(name)) pushups += repsOf(e)
      cardio += cardioMinOf(e)
      const k = exKey(e.id)
      if (!workRows(e).some(s => doneUnits(s) > 0)) continue
      if (k) exDone.add(k)
      for (const g of mainGroupsOf(e)) groups.add(g)
    }
  }
  const from = key + '-01', to = key + '-' + pad(daysIn(key))
  let newEx = 0
  for (const k of exDone) { const f = firstSeen.get(k); if (f && f >= from && f <= to) newEx++ }
  const weighDays = new Set((Array.isArray(S?.bodyweight) ? S.bodyweight : [])
    .filter(b => b && typeof b.d === 'string' && b.d.startsWith(key + '-') && Number(b.w) > 0).map(b => b.d)).size
  return {
    workouts: list.length,
    weeks: weeks.length,
    weeksTrained: weeks.filter(k => trainedWeeks.has(k)).length,
    volumeKg: lb ? volume * LB_KG : volume,
    prs,
    pullups,
    pushups,
    cardioMin: cardio,
    weighDays,
    newEx,
    groups: groups.size,
  }
}

/** The facts of several months in one pass over the workouts: { [key]: facts }. */
export function factsFor(S, keys) {
  const ws = weekStartOf(S)
  const want = new Set(keys)
  const months = new Map()
  const firstSeen = new Map()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    if (!w) continue
    const day = workoutDay(w)
    if (!day) continue
    const key = day.slice(0, 7)
    if (want.has(key)) { if (!months.has(key)) months.set(key, []); months.get(key).push(w) }
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      const k = exKey(e?.id)
      if (!k || !workRows(e).some(s => doneUnits(s) > 0)) continue
      const f = firstSeen.get(k)
      if (!f || day < f) firstSeen.set(k, day)
    }
  }
  const out = {}
  for (const k of keys) out[k] = monthFacts(S, k, ws, months, firstSeen)
  return out
}

/* ---------- the user's level ---------- */

/**
 * How `key`'s user usually trains: the average month of the LOOKBACK months before it, counted
 * from the first month with a workout (someone who started last month is not averaged over three).
 * `fresh` with no workout before `key` at all.
 */
export function levelOf(S, key) {
  let first = null
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    const day = w && workoutDay(w)
    if (day && (!first || day < first)) first = day
  }
  const firstMonth = first ? first.slice(0, 7) : null
  const keys = []
  for (let i = 1; i <= LOOKBACK; i++) {
    const k = shiftMonth(key, -i)
    if (firstMonth && k >= firstMonth) keys.push(k)
  }
  const base = { fresh: !keys.length, months: keys.length, workouts: 0, perWeek: 0, weekRate: 0, volumeKg: 0, prs: 0, pullups: 0, pushups: 0, cardioMin: 0, weighDays: 0, groups: 0 }
  if (!keys.length) return base
  const facts = factsFor(S, keys)
  const avg = f => keys.reduce((n, k) => n + f(facts[k]), 0) / keys.length
  const workouts = avg(f => f.workouts)
  return {
    ...base,
    workouts,
    perWeek: workouts / WEEKS_PER_MONTH,
    weekRate: avg(f => (f.weeks ? f.weeksTrained / f.weeks : 0)),
    volumeKg: avg(f => f.volumeKg),
    prs: avg(f => f.prs),
    pullups: avg(f => f.pullups),
    pushups: avg(f => f.pushups),
    cardioMin: avg(f => f.cardioMin),
    weighDays: avg(f => f.weighDays),
    groups: avg(f => f.groups),
  }
}

/**
 * The target for something done `usual` times a month: FACTOR more, at least `bump` more, rounded
 * up to `step`, kept between `min` and `max`. With nothing usual yet it is `min`.
 */
export const FACTOR = 1.15
export function stretch(usual, { min, max, step = 1, bump = step, factor = FACTOR }) {
  const u = Number(usual) > 0 ? Number(usual) : 0
  const raw = u > 0 ? Math.max(u * factor, u + bump) : min
  const n = Math.ceil(raw / step - 1e-9) * step
  return Math.min(max, Math.max(min, n))
}

// Tonnes for a kg profile, a round number of pounds for a lb one. The target is kept in the unit
// it was picked in (`u`), so 110,000 lb stays exactly that.
function volumeTarget(L, unit) {
  if (unit === 'lb') {
    const usual = L.volumeKg / LB_KG
    const step = usual < 20000 ? 1000 : usual < 100000 ? 5000 : 10000
    return { n: stretch(usual, { min: 2000, max: 5000000, step, factor: 1.1 }), u: 'lb' }
  }
  const step = L.volumeKg < 10000 ? 500 : L.volumeKg < 50000 ? 1000 : 5000
  return { n: stretch(L.volumeKg, { min: 1000, max: 2000000, step, factor: 1.1 }), u: 'kg' }
}

/* ---------- the list ---------- */

/**
 * Every challenge there is. `kind` is what the pick takes one of; `fits(L)` whether it suits this
 * user at all; `target(L, ctx)` its goal ({ n } and, for volume, the unit `u`); `have(F)` how far
 * the month's facts are. Add one here and it takes part in the rotation.
 */
export const CHALLENGES = [
  { id: 'workouts', kind: 'habit', icon: 'dumbbell', fits: () => true,
    target: L => ({ n: stretch(L.workouts, { min: 4, max: 28 }) }), have: F => F.workouts },
  // Someone who already trains every single week gets nothing out of this one.
  { id: 'weeks', kind: 'habit', icon: 'calendar', fits: L => L.fresh || L.weekRate < 0.99,
    target: (L, c) => ({ n: c.weeks }), have: F => F.weeksTrained },
  { id: 'volume', kind: 'effort', icon: 'plate', fits: L => L.volumeKg > 0,
    target: (L, c) => volumeTarget(L, c.unit), have: (F, p) => (p.u === 'lb' ? F.volumeKg / LB_KG : F.volumeKg) },
  { id: 'prs', kind: 'effort', icon: 'trophy', fits: L => L.prs > 0,
    target: L => ({ n: stretch(L.prs, { min: 2, max: 12 }) }), have: F => F.prs },
  { id: 'pullups', kind: 'effort', icon: 'pullup', fits: L => L.pullups > 0,
    target: L => ({ n: stretch(L.pullups, { min: 20, max: 3000, step: 10 }) }), have: F => F.pullups },
  { id: 'pushups', kind: 'effort', icon: 'arm', fits: L => L.pushups > 0,
    target: L => ({ n: stretch(L.pushups, { min: 30, max: 5000, step: 10 }) }), have: F => F.pushups },
  { id: 'cardio', kind: 'effort', icon: 'figureRun', fits: L => L.cardioMin > 0,
    target: L => ({ n: stretch(L.cardioMin, { min: 30, max: 3000, step: 15 }) }), have: F => Math.floor(F.cardioMin) },
  { id: 'newex', kind: 'explore', icon: 'sparkles', fits: () => true,
    target: L => ({ n: L.fresh ? 3 : L.perWeek < 2 ? 2 : L.perWeek < 4 ? 3 : 4 }), have: F => F.newEx },
  { id: 'muscles', kind: 'explore', icon: 'figureStrength', fits: L => L.fresh || L.groups < GROUP_IDS.length - 0.01,
    target: () => ({ n: GROUP_IDS.length }), have: F => F.groups },
  // Daily weighers have nothing to stretch here.
  { id: 'weighins', kind: 'explore', icon: 'scale', fits: L => L.weighDays > 0 && L.weighDays < 24,
    target: L => ({ n: stretch(L.weighDays, { min: 4, max: 25, bump: 2 }) }), have: F => F.weighDays },
]
export const CHALLENGE_IDS = CHALLENGES.map(c => c.id)
const BY_ID = Object.fromEntries(CHALLENGES.map(c => [c.id, c]))
export const challengeOf = id => BY_ID[id] || null
export const KINDS = ['habit', 'effort', 'explore']

/**
 * The month's three, fresh: one per kind in KINDS order, the one at the month's place in the
 * rotation among those that fit; a kind with none that fits is made up from the others. Same
 * profile, same month, same three: on every device.
 */
export function pickChallenges(S, key, L = levelOf(S, key)) {
  const ctx = { unit: S?.unit === 'lb' ? 'lb' : 'kg', weeks: weeksOfMonth(key, weekStartOf(S)).length }
  const at = monthIndex(key)
  const fitting = CHALLENGES.filter(c => { try { return c.fits(L) } catch { return false } })
  const picked = []
  KINDS.forEach((kind, i) => {
    const pool = fitting.filter(c => c.kind === kind)
    if (pool.length) picked.push(pool[(at + i) % pool.length])
  })
  const rest = fitting.filter(c => !picked.includes(c))
  for (let i = 0; picked.length < PICKS && rest.length; i++) picked.push(rest.splice((at + i) % rest.length, 1)[0])
  return picked.slice(0, PICKS).map(c => ({ id: c.id, ...c.target(L, ctx) }))
}

/* ---------- what is stored ---------- */

const cleanPick = p => {
  if (!p || typeof p !== 'object' || !ID.test(p.id)) return null
  const n = Number(p.n)
  if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null
  return p.u === 'kg' || p.u === 'lb' ? { id: p.id, n, u: p.u } : { id: p.id, n }
}
const cleanMonth = v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const picked = []
  for (const p of Array.isArray(v.picked) ? v.picked : []) {
    const c = cleanPick(p)
    if (c && !picked.some(x => x.id === c.id)) picked.push(c)
    if (picked.length >= PICKS) break
  }
  const ids = picked.map(p => p.id)
  const done = [...new Set((Array.isArray(v.done) ? v.done : []).filter(id => typeof id === 'string' && ID.test(id)))]
    .filter(id => !ids.length || ids.includes(id)).slice(0, PICKS).sort()
  const at = Number(v.at)
  if (!picked.length && !done.length) return null
  return { picked, done, at: Number.isFinite(at) && at > 0 ? at : 0 }
}

/** The stored value made safe: only real months, the last MONTHS_KEPT of them, capped lists. null when empty. */
export function cleanChallenges(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  for (const k of Object.keys(v).filter(isMonthKey).sort().slice(-MONTHS_KEPT)) {
    const m = cleanMonth(v[k])
    if (m) out[k] = m
  }
  return Object.keys(out).length ? out : null
}

/**
 * Two copies, one. Of a month both have, the picks that were made first (the earlier `at`; the
 * same picks either way when both devices saw the same history) and every challenge either copy
 * completed of them. Undefined when neither has any.
 */
export function mergeChallenges(a, b) {
  const x = cleanChallenges(a), y = cleanChallenges(b)
  if (!x || !y) return x || y || undefined
  const out = {}
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[k], q = y[k]
    if (!p || !q) { out[k] = p || q; continue }
    const first = !q.picked.length ? p : !p.picked.length ? q
      : (p.at || Infinity) < (q.at || Infinity) ? p : (q.at || Infinity) < (p.at || Infinity) ? q
        : JSON.stringify(p.picked) <= JSON.stringify(q.picked) ? p : q
    out[k] = { picked: first.picked, done: [...p.done, ...q.done], at: first.at }
  }
  return cleanChallenges(out) || undefined
}

/** One month as stored, cleaned, or null. */
export const storedMonth = (S, key) => cleanChallenges(S?.challenges)?.[key] || null

/**
 * The month's challenges: the stored picks, or fresh ones (`stored` false: not saved yet).
 */
export function monthChallenges(S, key) {
  const m = storedMonth(S, key)
  if (m && m.picked.length) return { key, picked: m.picked, done: m.done, stored: true }
  return { key, picked: pickChallenges(S, key), done: m ? m.done : [], stored: false }
}

/** Into `s` (inside a store update): the month's picks, if none are stored yet. True when it wrote. */
export function savePicks(s, key, picked, now = Date.now()) {
  const all = cleanChallenges(s.challenges) || {}
  if (all[key]?.picked.length) return false
  all[key] = { picked: picked.map(cleanPick).filter(Boolean), done: all[key]?.done || [], at: now }
  s.challenges = cleanChallenges(all)
  return true
}

/** Into `s`: `ids` of `key` marked done, with the picks if they were not stored yet. */
export function markDone(s, key, ids, picked, now = Date.now()) {
  savePicks(s, key, picked, now)
  const all = cleanChallenges(s.challenges) || {}
  const m = all[key]
  if (!m) return false
  const before = m.done.length
  m.done = [...new Set([...m.done, ...ids])]
  s.challenges = cleanChallenges(all)
  return (s.challenges?.[key]?.done.length || 0) > before
}

/* ---------- progress ---------- */

/**
 * Where each of the month's challenges stands: [{ id, icon, n, u, have, pct, done }]. `done` once
 * the goal is reached or it was ever completed (a deleted workout does not take a badge back).
 * `facts` can be handed in when the caller has them already.
 */
export function progressOf(S, month, facts = factsFor(S, [month.key])[month.key]) {
  return month.picked.map(p => {
    const c = challengeOf(p.id)
    const have = c ? Math.max(0, Number(c.have(facts, p)) || 0) : 0
    const reached = have >= p.n
    const done = reached || month.done.includes(p.id)
    return { id: p.id, icon: c?.icon || 'star', n: p.n, u: p.u, have, pct: done ? 1 : Math.min(1, have / p.n), done, known: !!c }
  })
}

/** The ids reached now but not yet stored as done. */
export const newlyDone = (month, progress) => progress.filter(p => p.known && p.have >= p.n && !month.done.includes(p.id)).map(p => p.id)

/** Whether every challenge of the month is done: a gold month. */
export const isGold = m => !!m && m.picked.length > 0 && m.picked.every(p => m.done.includes(p.id))

/** The trophy shelf: every month with a badge, newest first: [{ key, done, total, gold }]. */
export function shelfOf(S) {
  const all = cleanChallenges(S?.challenges) || {}
  return Object.keys(all).sort().reverse()
    .map(k => ({ key: k, done: all[k].done.length, total: all[k].picked.length || PICKS, gold: isGold(all[k]) }))
    .filter(m => m.done > 0)
}

/* ---------- settings ---------- */

/** Off in Settings → Look & Home → Monthly challenges. */
export const challengesOn = S => S?.monthlyChallenges !== false
/** Whether the card is put away for `key` (its ×: until next month). */
export const hiddenFor = (S, key) => S?.challengesHidden === key
