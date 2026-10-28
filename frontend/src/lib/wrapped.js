// "Your year in openGym" (v1.4.5): a look back at one calendar year, story by story.
//
// This file is the engine and the calendar, nothing more: what the year holds (yearStats), which
// years can be looked back on (wrappedYears), when the season is on (Dec 1 to Jan 31), whether
// Home shows its card, and whether the phone should plan its one notification. It reads the
// profile and stores nothing; the cards (lib/wrapped-cards.js) turn the numbers into words, and
// components/Wrapped.jsx shows them. Everything stays on the device: nothing here is sent anywhere.
//
// THE YEAR is the user's own calendar year: a workout belongs to the year of its local day (`d`,
// the date the phone showed when it was logged, workoutDay), never the UTC one. A Dec 31 workout
// at 23:30 in Lisbon is 2026 even though it is already 2027 in UTC. Time of day reads `start`
// on this device's clock.
//
// UNITS: every weight in a profile is in its unit (S.unit). Totals are reported in it; the fun
// comparisons work in kg underneath, so a lb profile gets the same blue whales.
import { workoutDay, workoutDuration, sessionVolume, doneUnits } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { isAssisted, isCardio } from './exercises.js'
import { MUSCLES, loadOfWorkouts } from './muscles.js'
import { isoOf, weekKey, weekStartOf, weekOrder } from './format.js'
import { LB_KG } from './units.js'

export const SEASON_FROM = [12, 1]   // Dec 1, local
export const SEASON_TO = [1, 31]     // to the end of Jan 31: the year just gone stays up a while
// Sessions logged without a clock (imports) have no duration; shorter than this is not a real one.
const MIN_SESSION_MS = 60000

const ISO = /^\d{4}-\d{2}-\d{2}$/
const plusWeek = (iso, n = 1) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); return isoOf(d) }

/** The workouts of one local calendar year, oldest first. */
export function workoutsOfYear(S, year) {
  const y = String(year)
  return (Array.isArray(S?.workouts) ? S.workouts : [])
    .filter(w => w && workoutDay(w)?.slice(0, 4) === y)
    .sort((a, b) => (workoutDay(a) < workoutDay(b) ? -1 : workoutDay(a) > workoutDay(b) ? 1 : (Number(a.start) || 0) - (Number(b.start) || 0)))
}

/** Every year with at least one workout, newest first. */
export function wrappedYears(S) {
  const years = new Set()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    const day = w && workoutDay(w)
    if (day) years.add(Number(day.slice(0, 4)))
  }
  return [...years].filter(y => y >= 1970 && y <= 9999).sort((a, b) => b - a)
}

/* ---------- the dev switch ----------
   localStorage og_wrapped_now = '2026-12-01' (or any YYYY-MM-DD) makes the app believe it is that
   day for the season, the Home card and the notification, so December can be previewed in
   October. Nothing else in the app reads it. */
export const NOW_KEY = 'og_wrapped_now'
export function wrappedNow(real = new Date()) {
  try {
    const v = localStorage.getItem(NOW_KEY)
    if (v && ISO.test(v)) {
      const d = new Date(v + 'T12:00:00')
      if (!Number.isNaN(d.getTime())) { d.setHours(real.getHours(), real.getMinutes(), real.getSeconds()); return d }
    }
  } catch (e) { /* no storage: the real clock */ }
  return real
}

/** The year the season is about on `now` (local): Dec 2026 and Jan 2027 are both 2026. null out of season. */
export function seasonYear(now = new Date()) {
  const m = now.getMonth() + 1
  if (m === SEASON_FROM[0] && now.getDate() >= SEASON_FROM[1]) return now.getFullYear()
  if (m === SEASON_TO[0] && now.getDate() <= SEASON_TO[1]) return now.getFullYear() - 1
  return null
}

/* ---------- what the profile remembers ----------
   S.wrapped = { opened: [2026], dismissed: [2026], phone: 2026 } — a setting like any other, so it
   syncs and a sync merge keeps the copy changed last. `opened` and `dismissed` are the years whose
   Home card is done with; `phone` is the year a phone planned its local notification for, which
   tells the server not to send its own. S.wrappedNotify === false switches the notification off
   (Settings → Notifications); S.wrappedBody === false leaves the body-weight card out. */
const yearList = v => (Array.isArray(v) ? v.filter(y => Number.isInteger(y)) : [])
export const wrappedOf = S => {
  const w = S?.wrapped && typeof S.wrapped === 'object' ? S.wrapped : {}
  return { opened: yearList(w.opened), dismissed: yearList(w.dismissed), phone: Number.isInteger(w.phone) ? w.phone : null }
}
/** S.wrapped with `year` added to one of its lists (opened / dismissed), at most the last 5 years. */
export function withYear(S, list, year) {
  const w = wrappedOf(S)
  const next = [...new Set([...w[list], year])].sort((a, b) => a - b).slice(-5)
  return { ...w, [list]: next }
}
export const notifyOn = S => S?.wrappedNotify !== false

/** The year Home's card is about now, or null: in season, with workouts that year, not yet opened or dismissed. */
export function homeCardYear(S, now = new Date()) {
  const y = seasonYear(now)
  if (y == null) return null
  const w = wrappedOf(S)
  if (w.opened.includes(y) || w.dismissed.includes(y)) return null
  return workoutsOfYear(S, y).length ? y : null
}

// The one notification of the season goes out at 18:00 on Dec 1, local.
export const NOTIFY_HOUR = 18
export const NOTIFY_ID = 7120  // the local notification's fixed id: planning it again replaces it

/**
 * What the phone should do about its one December notification when the app opens:
 *   { action: 'schedule', year, at }  plan it (at: a Date, Dec 1 18:00 local)
 *   { action: 'cancel' }              switched off: take a planned one back
 *   { action: 'none' }                nothing to do
 * `granted` is whether notifications are allowed already: the app never asks for this one, it
 * is not worth a permission prompt. A year with no workouts yet still gets one planned (December
 * is weeks away and the year is not over), and planning it again is harmless (same id). Once
 * Dec 1 18:00 has passed there is nothing to plan: the Home card says it.
 */
export function notificationPlan(S, now = new Date(), { granted = false } = {}) {
  if (!notifyOn(S)) return { action: 'cancel' }
  if (!granted) return { action: 'none' }
  const year = now.getFullYear()
  const at = new Date(year, 11, 1, NOTIFY_HOUR, 0, 0, 0)
  if (now >= at) return { action: 'none' }
  // From November on: earlier than that, the plan would only sit in the system for months.
  if (now.getMonth() < 10) return { action: 'none' }
  const hasAny = workoutsOfYear(S, year).length > 0
  if (!hasAny) return { action: 'none' }
  return { action: 'schedule', year, at }
}

/* ---------- the year in numbers ---------- */

// A set's weight as logged (the heavier side of a per-side set, as its row shows it).
const setWeight = s => Number(s?.w) || 0
const workSets = e => (Array.isArray(e?.sets) ? e.sets : []).filter(s => !isWarmupRow(s) && doneUnits(s) > 0)
const entryName = e => (typeof e?.exercise?.n === 'string' ? e.exercise.n : typeof e?.ex?.n === 'string' ? e.ex.n : null)

/** Morning 5–11, midday 11–14, afternoon 14–17, evening 17–21, night 21–5. */
export const DAYPARTS = ['morning', 'midday', 'afternoon', 'evening', 'night']
export function daypartOf(hour) {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 14) return 'midday'
  if (hour >= 14 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

const LEGS = ['quadriceps', 'hamstring', 'gluteal', 'calves', 'adductors']
const UPPER = ['chest', 'deltoids', 'biceps', 'triceps', 'trapezius', 'upper-back', 'forearm']

/**
 * Everything the cards say about `year`, or null when it has no workout. Weights in the profile's
 * unit (`unit`), times in ms. Ties are settled the same way every time:
 *   top exercise   more sets, then more volume, then the id
 *   top muscle     more load, then the map's own order
 *   favourite day  more workouts, then earlier in the profile's week
 *   time of day    more workouts, then morning before night
 *   best month     more workouts, then more volume, then the earlier month
 */
export function yearStats(S, year) {
  const ws = workoutsOfYear(S, year)
  if (!ws.length) return null
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const wkStart = weekStartOf(S)

  let ms = 0, timed = 0, volume = 0, sets = 0, prs = 0
  const days = new Set()
  const perEx = new Map()            // id -> { sets, vol, name }
  const byWeekday = Array(7).fill(0)
  const byPart = Object.fromEntries(DAYPARTS.map(p => [p, 0]))
  const months = Array.from({ length: 12 }, () => ({ n: 0, vol: 0 }))
  let cardioSets = 0, early = 0, late = 0, weekend = 0

  for (const w of ws) {
    const day = workoutDay(w)
    days.add(day)
    const d = new Date(day + 'T12:00:00')
    byWeekday[d.getDay()]++
    if (d.getDay() === 0 || d.getDay() === 6) weekend++
    const vol = sessionVolume(w, S)
    volume += vol
    months[d.getMonth()].n++
    months[d.getMonth()].vol += vol
    const dur = workoutDuration(w)
    if (dur >= MIN_SESSION_MS && Number.isFinite(Number(w.start))) {
      ms += dur
      timed++
      const h = new Date(Number(w.start)).getHours()
      byPart[daypartOf(h)]++
      if (h >= 4 && h < 9) early++
      if (h >= 20 || h < 4) late++
    }
    prs += new Set(Array.isArray(w.prs) ? w.prs.filter(id => typeof id === 'string') : []).size
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      if (!e || typeof e.id !== 'string') continue
      const done = workSets(e)
      const n = done.reduce((m, s) => m + doneUnits(s), 0)
      if (!n) continue
      sets += n
      if (isCardio(e.id)) cardioSets += n
      const cur = perEx.get(e.id) || { sets: 0, vol: 0, name: null }
      cur.sets += n
      cur.vol += done.reduce((v, s) => v + setWeight(s) * (Number(s.r) || 0), 0)
      cur.name = cur.name || entryName(e)
      perEx.set(e.id, cur)
    }
  }

  // Top exercise by sets.
  let topEx = null
  for (const [id, v] of perEx) {
    if (!topEx || v.sets > topEx.sets || (v.sets === topEx.sets && (v.vol > topEx.vol || (v.vol === topEx.vol && id < topEx.id)))) topEx = { id, ...v }
  }
  // Top muscle by load (effective sets, lib/muscles.js).
  const load = loadOfWorkouts(ws)
  let topMuscle = null
  let total = 0
  for (const m of MUSCLES) {
    const v = load[m] || 0
    total += v
    if (v > 0 && (!topMuscle || v > load[topMuscle])) topMuscle = m
  }
  const share = list => (total > 0 ? list.reduce((n, m) => n + (load[m] || 0), 0) / total : 0)

  // Favourite weekday, in the profile's week order on a tie.
  let favDay = null
  for (const d of weekOrder(wkStart)) if (byWeekday[d] > 0 && (favDay == null || byWeekday[d] > byWeekday[favDay])) favDay = d
  let daypart = null
  for (const p of DAYPARTS) if (byPart[p] > 0 && (!daypart || byPart[p] > byPart[daypart])) daypart = p
  let bestMonth = null
  months.forEach((m, i) => {
    if (!m.n) return
    const b = bestMonth == null ? null : months[bestMonth]
    if (!b || m.n > b.n || (m.n === b.n && m.vol > b.vol)) bestMonth = i
  })

  return {
    year: Number(year), unit,
    workouts: ws.length,
    days: days.size,
    perWeek: ws.length / weeksIn(year, ws),
    ms, timed, avgMs: timed ? ms / timed : 0,
    volume, volumeKg: unit === 'lb' ? volume * LB_KG : volume,
    sets,
    streak: longestStreak(ws, wkStart),
    topExercise: topEx ? { id: topEx.id, sets: topEx.sets, name: topEx.name } : null,
    topMuscle: topMuscle ? { id: topMuscle, share: load[topMuscle] / total } : null,
    load,
    distinctExercises: perEx.size,
    prs,
    biggestPr: biggestPr(S, year, ws),
    favDay: favDay == null ? null : { day: favDay, n: byWeekday[favDay] },
    daypart: daypart ? { part: daypart, n: byPart[daypart] } : null,
    bestMonth: bestMonth == null ? null : { month: bestMonth, n: months[bestMonth].n, vol: months[bestMonth].vol },
    months: months.map(m => m.n),
    body: bodyChange(S, year),
    shares: { legs: share(LEGS), upper: share(UPPER), cardio: sets ? cardioSets / sets : 0, early: timed ? early / timed : 0, late: timed ? late / timed : 0, weekend: weekend / ws.length },
    first: workoutDay(ws[0]),
  }
}

// The weeks the year has had so far: all 52-and-a-bit of a year gone by, up to the last
// workout's week for the year in progress (a profile that started in October is not averaged
// over January to September either: from its first workout's week).
function weeksIn(year, ws) {
  const first = new Date(workoutDay(ws[0]) + 'T12:00:00')
  const lastDay = new Date(Math.min(new Date(Number(year), 11, 31, 12).getTime(), Math.max(Date.now(), new Date(workoutDay(ws.at(-1)) + 'T12:00:00').getTime())))
  return Math.max(1, Math.round((lastDay - first) / (7 * 86400000)) + 1)
}

/** The longest run of weeks in a row with a workout, inside the year: { weeks, from, to } (week keys). */
export function longestStreak(ws, wkStart) {
  const keys = [...new Set(ws.map(w => weekKey(workoutDay(w), wkStart)))].sort()
  let best = { weeks: 0, from: null, to: null }
  let run = 0, from = null, prev = null
  for (const k of keys) {
    if (prev && plusWeek(prev) === k) run++
    else { run = 1; from = k }
    if (run > best.weeks) best = { weeks: run, from, to: k }
    prev = k
  }
  return best
}

/**
 * The biggest new best of the year. For a lift that had a best before the year, the one that grew
 * the most past it (weight gained, in the profile's unit); for a profile whose history starts this
 * year, the heaviest lift that set a record. Assisted lifts (less help is better) are counted as
 * records but never picked: "+10 kg" on an assisted pull-up would read the wrong way round.
 * null when the year set no record.
 */
export function biggestPr(S, year, ws = workoutsOfYear(S, year)) {
  const recorded = new Map() // id -> { w, d }
  for (const w of ws) {
    for (const id of Array.isArray(w.prs) ? w.prs : []) {
      if (typeof id !== 'string' || isAssisted(id)) continue
      const top = Math.max(0, ...(w.entries || []).filter(e => e?.id === id).flatMap(e => workSets(e).map(setWeight)))
      if (top > 0 && top >= (recorded.get(id)?.w || 0)) recorded.set(id, { w: top, d: workoutDay(w) })
    }
  }
  if (!recorded.size) return null
  const start = String(year) + '-01-01'
  const before = new Map()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    const day = w && workoutDay(w)
    if (!day || day >= start) continue
    for (const e of w.entries || []) {
      if (!recorded.has(e?.id)) continue
      const top = Math.max(0, ...workSets(e).map(setWeight))
      if (top > (before.get(e.id) || 0)) before.set(e.id, top)
    }
  }
  let pick = null
  for (const [id, r] of recorded) {
    const prev = before.get(id) || 0
    const gain = prev > 0 ? r.w - prev : null
    const c = { id, w: r.w, d: r.d, gain, prev: prev || null }
    if (!pick) { pick = c; continue }
    // A grown record beats a first one; among grown ones the most gained; else the heaviest.
    const a = c.gain != null && c.gain > 0, b = pick.gain != null && pick.gain > 0
    if (a !== b) { if (a) pick = c; continue }
    const ka = a ? c.gain : c.w, kb = b ? pick.gain : pick.w
    if (ka > kb || (ka === kb && (c.w > pick.w || (c.w === pick.w && id < pick.id)))) pick = c
  }
  return pick
}

/** First and last weigh-in of the year: { from, to, delta, n }, or null with fewer than two or the card switched off. */
export function bodyChange(S, year) {
  if (S?.wrappedBody === false) return null
  const y = String(year)
  const list = (Array.isArray(S?.bodyweight) ? S.bodyweight : [])
    .filter(b => b && typeof b.d === 'string' && ISO.test(b.d) && b.d.slice(0, 4) === y && Number(b.w) > 0)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (Number(a.t) || 0) - (Number(b.t) || 0)))
  if (list.length < 2) return null
  const from = Number(list[0].w), to = Number(list.at(-1).w)
  return { from, to, delta: to - from, n: list.length, fromDay: list[0].d, toDay: list.at(-1).d }
}

/* ---------- fun with numbers ---------- */

// What a year of lifting weighs, in things. Masses in kg, rounded the way a pub quiz would.
export const THINGS = [
  { key: 'eiffel', kg: 7300000 },   // the Eiffel Tower's iron
  { key: 'iss', kg: 420000 },       // the International Space Station
  { key: 'whale', kg: 150000 },     // a blue whale
  { key: 'trex', kg: 8000 },        // a Tyrannosaurus rex
  { key: 'elephant', kg: 6000 },    // an African elephant
  { key: 'car', kg: 1500 },         // a family car
  { key: 'piano', kg: 480 },        // a concert grand piano
  { key: 'panda', kg: 100 },        // a giant panda
  { key: 'cat', kg: 4.5 },          // a house cat
]

/**
 * The comparison for `kg` lifted: the biggest thing it comes to at least two of ("3.2 blue
 * whales" reads better than "1.1 space stations"), else the biggest it comes to one of, else
 * cats. { key, count } with count rounded to one decimal under 10 and to whole ones above; null
 * for nothing lifted.
 */
export function comparisonFor(kg) {
  if (!(kg > 0)) return null
  const pick = THINGS.find(x => kg / x.kg >= 2) || THINGS.find(x => kg / x.kg >= 1) || THINGS.at(-1)
  const raw = kg / pick.kg
  const count = raw < 10 ? Math.round(raw * 10) / 10 : Math.round(raw)
  return { key: pick.key, count }
}

/**
 * A personality from the year's patterns, the first rule that fits (so the order is the
 * priority). Every label is a compliment: a light year is "Steady and sure", never a lazy one.
 */
export const PERSONALITIES = ['early', 'night', 'legs', 'streak', 'records', 'weekend', 'cardio', 'marathon', 'quick', 'explorer', 'upper', 'steady']
export function personalityOf(st) {
  if (!st) return 'steady'
  const enough = st.timed >= 5
  if (enough && st.shares.early >= 0.4) return 'early'
  if (enough && st.shares.late >= 0.4) return 'night'
  if (st.shares.legs >= 0.35 && LEGS.includes(st.topMuscle?.id)) return 'legs'
  if (st.streak.weeks >= 12) return 'streak'
  if (st.prs >= 20) return 'records'
  if (st.workouts >= 5 && st.shares.weekend >= 0.5) return 'weekend'
  if (st.shares.cardio >= 0.4) return 'cardio'
  if (enough && st.avgMs >= 75 * 60000) return 'marathon'
  if (enough && st.avgMs > 0 && st.avgMs <= 35 * 60000) return 'quick'
  if (st.distinctExercises >= 40) return 'explorer'
  if (st.shares.upper >= 0.6) return 'upper'
  return 'steady'
}
