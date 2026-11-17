// Deload weeks without a programme (1.4.5, gm-progress). A programme has its own deload weeks
// (lib/programmes.js); this is for everyone who just trains their routines: every N weeks one
// lighter week, or one suggested when the numbers (and, if you log it, how you feel) say so.
//
//   S.deloadCycle = { every: 4..12 | 0, from: weekKey, auto: true, shift: [weekKey], extra: [weekKey], skip: [weekKey], dismissed: weekKey }
//
//   every      a deload every N weeks; 0 or no key: none on a schedule
//   from       the week the count starts at (lib/format.js weekKey, the profile's week start):
//              the deloads are the weeks from + N−1, from + 2N−1, …
//   auto       suggest one when the signals below say so (on unless false)
//   shift      scheduled deload weeks pushed back a week: that week trains as usual, the next one
//              is the deload ("push it back a week", one tap)
//   extra      weeks made a deload by hand or by saying yes to a suggestion
//   skip       weeks taken back out (any kind), from the Home card's "Not this week"
//   dismissed  the week a suggestion was waved off, so it does not come back that week
// One whole setting (lib/sync-merge.js: the last change wins whole). Every list is capped.
//
// WHAT A DELOAD WEEK DOES (lib/session-start.js): every exercise of a routine trains with
// DELOAD_SET_SHARE of its work sets (at least one), the weight held where it was, and the session
// stays out of progression, so the lighter week neither raises nor lowers anything. A running
// programme wins: its own weeks decide, and this schedule waits.
//
// THE AUTOMATIC TRIGGER reads two signals over the last two weeks:
//   performance  the best estimated 1RM per exercise, this fortnight against the one before;
//                "falling" when most of the exercises logged in both went down
//   daily form   check-ins of how you feel, through the hook below (dailyFormScores). Another
//                part of the app records them; this file only reads what the hook hands back.
// With form data: a low fortnight plus numbers that did not climb suggests a deload. Without it,
// falling numbers alone do. Never more often than once in MIN_GAP weeks, and only as a question.
import { weekKey, weekStartOf, todayISO } from './format.js'
import { estimate1RM } from './onerm.js'
import { isWarmupRow, isSideSet } from './workout-model.js'
import { isAssisted } from './exercises.js'

export const EVERY_CHOICES = [0, 4, 5, 6, 8]
export const EVERY_MIN = 3
export const EVERY_MAX = 12
export const DELOAD_SET_SHARE = 0.6   // 40 % fewer sets
export const MIN_GAP = 3              // weeks between a deload and the next suggestion
const LIST_MAX = 24

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isISO = v => typeof v === 'string' && ISO.test(v)
const DAY = 86400000
const ms = iso => Date.parse(iso + 'T12:00:00Z')
const isoAt = t => new Date(t).toISOString().slice(0, 10)
export const plusWeeks = (wk, n) => isoAt(ms(wk) + n * 7 * DAY)
const weeksBetween = (a, b) => Math.round((ms(b) - ms(a)) / (7 * DAY))
const list = v => (Array.isArray(v) ? [...new Set(v.filter(isISO))].sort().slice(-LIST_MAX) : [])

/* ---------- the daily-form hook ---------- */

// The source of daily-form check-ins. Contract, for whoever records them:
//   source(S, fromIso, toIso) → [{ d: 'YYYY-MM-DD', score: 0..1 }]   (1 = feeling great)
// Days without a check-in are simply left out. Register once at start-up with setDailyFormSource;
// the default has none, and the trigger then reads performance alone.
let formSource = null
export function setDailyFormSource (fn) { formSource = typeof fn === 'function' ? fn : null }
/** The check-ins between two days (inclusive), cleaned; [] without a source or on any error. */
export function dailyFormScores (S, from, to) {
  if (!formSource) return []
  try {
    const out = formSource(S, from, to)
    return (Array.isArray(out) ? out : [])
      .filter(x => x && isISO(x.d) && x.d >= from && x.d <= to && Number.isFinite(Number(x.score)))
      .map(x => ({ d: x.d, score: Math.max(0, Math.min(1, Number(x.score))) }))
  } catch { return [] }
}

/* ---------- the setting ---------- */

/** S.deloadCycle cleaned, with every default filled in. */
export function deloadCycleOf (S) {
  const c = S?.deloadCycle && typeof S.deloadCycle === 'object' ? S.deloadCycle : {}
  const every = Number.isInteger(c.every) && c.every >= EVERY_MIN && c.every <= EVERY_MAX ? c.every : 0
  return {
    every,
    from: every && isISO(c.from) ? c.from : null,
    auto: c.auto !== false,
    shift: list(c.shift), extra: list(c.extra), skip: list(c.skip),
    dismissed: isISO(c.dismissed) ? c.dismissed : null,
  }
}

const write = (s, c) => {
  const out = {}
  if (c.every) { out.every = c.every; out.from = c.from }
  if (c.auto === false) out.auto = false
  for (const k of ['shift', 'extra', 'skip']) if (c[k]?.length) out[k] = list(c[k])
  if (c.dismissed) out.dismissed = c.dismissed
  if (Object.keys(out).length) s.deloadCycle = out
  else delete s.deloadCycle
}

const wkOf = (S, iso) => weekKey(iso, weekStartOf(S))

/** Every N weeks from this week on (0 turns the schedule off). The first deload is N−1 weeks out. */
export function setDeloadEvery (s, every, today = todayISO()) {
  const c = deloadCycleOf(s)
  const n = Math.round(Number(every)) || 0
  c.every = n >= EVERY_MIN && n <= EVERY_MAX ? n : 0
  c.from = c.every ? wkOf(s, today) : null
  c.shift = []
  write(s, c)
}

export function setDeloadAuto (s, on) { const c = deloadCycleOf(s); c.auto = !!on; write(s, c) }

/* ---------- which weeks ---------- */

const scheduled = (c, wk) => {
  if (!c.every || !c.from || wk < c.from) return false
  return (weeksBetween(c.from, wk) + 1) % c.every === 0
}

/** Whether the week `wk` (a week key) is a deload week, and why: 'cycle' | 'extra' | null. */
export function deloadWhy (S, wk) {
  const c = deloadCycleOf(S)
  if (c.skip.includes(wk)) return null
  if (c.extra.includes(wk)) return 'extra'
  if (scheduled(c, wk) && !c.shift.includes(wk)) return 'cycle'
  const prev = plusWeeks(wk, -1)
  if (scheduled(c, prev) && c.shift.includes(prev)) return 'cycle'
  return null
}

/** Whether `iso` falls in a deload week. A running programme's own weeks win. */
export function isDeloadDay (S, iso = todayISO(), programmeOn = false) {
  if (programmeOn || !isISO(iso)) return false
  return !!deloadWhy(S, wkOf(S, iso))
}

/** The next deload week from this one on (this one included), within a year, or null. */
export function nextDeloadWeek (S, today = todayISO()) {
  const cur = wkOf(S, today)
  for (let i = 0; i <= 53; i++) { const wk = plusWeeks(cur, i); if (deloadWhy(S, wk)) return wk }
  return null
}

/** The last deload week before this one, within half a year, or null. */
export function lastDeloadWeek (S, today = todayISO()) {
  const cur = wkOf(S, today)
  for (let i = 1; i <= 26; i++) { const wk = plusWeeks(cur, -i); if (deloadWhy(S, wk)) return wk }
  return null
}

/** Push the deload week `wk` back by one (a scheduled one moves, a hand-made one too). */
export function pushBack (s, wk) {
  const c = deloadCycleOf(s)
  const why = deloadWhy(s, wk)
  if (!why) return false
  if (c.extra.includes(wk)) { c.extra = c.extra.filter(x => x !== wk); c.extra.push(plusWeeks(wk, 1)) }
  else if (scheduled(c, wk)) c.shift.push(wk)
  else {
    // The week after a pushed one: push that one again by making the next week an extra.
    c.skip.push(wk); c.extra.push(plusWeeks(wk, 1))
  }
  write(s, c)
  return true
}

/** Take the week `wk` out: it trains as usual, the schedule after it stays. */
export function skipDeload (s, wk) { const c = deloadCycleOf(s); c.skip.push(wk); c.extra = c.extra.filter(x => x !== wk); write(s, c) }

/** Make `wk` a deload week (a yes to the suggestion, or by hand). */
export function addDeload (s, wk) { const c = deloadCycleOf(s); c.extra.push(wk); c.skip = c.skip.filter(x => x !== wk); c.dismissed = null; write(s, c) }

/** Wave this week's suggestion off. */
export function dismissSuggestion (s, today = todayISO()) { const c = deloadCycleOf(s); c.dismissed = wkOf(s, today); write(s, c) }

/** How many work sets a deload week keeps of `sets`. */
export const deloadSets = sets => Math.max(1, Math.round((Math.max(1, Number(sets) || 1)) * DELOAD_SET_SHARE))

/* ---------- the automatic trigger ---------- */

const e1rmOf = (entry) => {
  if (isAssisted(entry?.id) || entry?.target?.assisted === true) return 0
  let best = 0
  for (const s of entry?.sets || []) {
    if (!s || isWarmupRow(s)) continue
    const rows = isSideSet(s) ? [s.sides.L, s.sides.R] : [s]
    for (const r of rows) {
      if (!r || r.done !== true || !(r.w > 0) || !(r.r > 0)) continue
      const est = estimate1RM(r.w, r.r) || 0
      if (est > best) best = est
    }
  }
  return best
}

/**
 * Performance over the last two weeks against the two before: { trend: 'falling' | 'flat' |
 * 'rising' | null, down, up, compared }. null when fewer than MIN_COMPARE exercises were logged in
 * both windows (nothing to say yet).
 */
export const MIN_COMPARE = 2
export function performanceTrend (S, today = todayISO()) {
  const t0 = ms(today)
  const recent = new Map(), before = new Map()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    if (!w || !isISO(w.d) || w.noProg === true) continue
    const age = (t0 - ms(w.d)) / DAY
    if (age < 0 || age >= 28) continue
    const into = age < 14 ? recent : before
    for (const e of w.entries || []) {
      if (!e?.id || e.noProg === true) continue
      const v = e1rmOf(e)
      if (v > (into.get(e.id) || 0)) into.set(e.id, v)
    }
  }
  let down = 0, up = 0, compared = 0
  for (const [id, now] of recent) {
    const then = before.get(id)
    if (!then) continue
    compared++
    const d = (now - then) / then
    if (d <= -0.02) down++
    else if (d >= 0.02) up++
  }
  if (compared < MIN_COMPARE) return { trend: null, down, up, compared }
  const trend = down / compared >= 0.6 ? 'falling' : up / compared >= 0.5 ? 'rising' : 'flat'
  return { trend, down, up, compared }
}

/** How the last two weeks felt, from the daily-form hook: { low, mean, n } or null without data. */
export const FORM_MIN = 4
export const FORM_LOW = 0.4
export function formTrend (S, today = todayISO()) {
  const from = isoAt(ms(today) - 13 * DAY)
  const scores = dailyFormScores(S, from, today)
  if (scores.length < FORM_MIN) return null
  const mean = scores.reduce((a, x) => a + x.score, 0) / scores.length
  return { low: mean < FORM_LOW, mean, n: scores.length }
}

/**
 * Whether to suggest making next week a deload, and why: null, or { week, reason: 'both' |
 * 'performance' | 'form', perf, form }. Only with `auto` on, never with a programme running,
 * never when one is already coming within two weeks or was within MIN_GAP, never twice a week.
 */
export function deloadSuggestion (S, today = todayISO(), { programmeOn = false } = {}) {
  const c = deloadCycleOf(S)
  if (!c.auto || programmeOn) return null
  const cur = wkOf(S, today)
  if (c.dismissed === cur) return null
  const next = nextDeloadWeek(S, today)
  if (next && weeksBetween(cur, next) <= 1) return null
  const last = lastDeloadWeek(S, today)
  if (last && weeksBetween(last, cur) < MIN_GAP) return null
  const perf = performanceTrend(S, today)
  const form = formTrend(S, today)
  let reason = null
  if (form) {
    if (form.low && perf.trend && perf.trend !== 'rising') reason = perf.trend === 'falling' ? 'both' : 'form'
  } else if (perf.trend === 'falling') reason = 'performance'
  return reason ? { week: plusWeeks(cur, 1), reason, perf, form } : null
}
