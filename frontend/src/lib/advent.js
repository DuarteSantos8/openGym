// The advent calendar (v1.4.4, reworked in v1.4.5), part of the Christmas theme (lib/seasonal.js):
// 24 doors from 1 December, one more each local day, each one something to do in the gym or the
// living room. Pure and framework-free; the calendar itself (its art, its sheet and what is behind
// each door) lives in the theme's lazy chunk (seasonal/).
//
// What is opened is kept in the synced profile, so a door opened on the phone is open on the
// laptop too:  S.advent = { year: 2026, opened: [1, 2, 5], done: [2], reps: { 5: 30 } }
//   opened  the doors opened this year
//   done    the doors whose thing was done (the challenge, the finisher, the 50 squats...)
//   reps    v1.4.5: how far a counting door got (door 5: 30 of its 50 squats), only below its goal
// A calendar of another year reads as a fresh one. The lists only ever hold the numbers 1 to 24,
// once each, and reps only open doors with a count below 1000, so the field stays tiny whatever a
// device sends (cleanAdvent). Two copies of the same year merge by union, the higher count of a
// door winning (mergeAdvent, used by lib/sync-merge.js): opening a door is never undone.
//
// Backwards compatible both ways: a 1.4.4 copy has no reps and reads as zero counted; a 1.4.4
// device keeps `opened` and `done` from a newer one and drops `reps`, so at worst a half-done
// count on it starts again, while the door it finished stays done.
//
// Every door that is open hangs a bauble on the tree; it lights up when its thing is done or
// when you trained that day (adventLit). Catch-up is always fine: a missed day's door opens any
// time in December, and nothing is ever taken away.
import { available } from './seasonal.js'
import { seasonNow } from './season-clock.js'

export const DOORS = 24
export const REPS_MAX = 999

const isDec = now => now.getMonth() === 11 && available('christmas', now)

/** Whether `now` (local) is inside the calendar's days: 1 to 24 December. */
export const inAdvent = (now = seasonNow()) => isDec(now) && now.getDate() <= DOORS

/** Whether the calendar can still be opened at all: all of December, for whoever is late. */
export const adventOpenable = (now = seasonNow()) => isDec(now)

const isDay = n => Number.isInteger(n) && n >= 1 && n <= DOORS
const days = v => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(isDay))].sort((a, b) => a - b)
function repsOf(v, opened) {
  const out = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, n] of Object.entries(v)) {
    const d = Number(k), c = Math.floor(Number(n))
    if (isDay(d) && opened.includes(d) && c > 0) out[d] = Math.min(c, REPS_MAX)
  }
  return out
}

/** The stored value made safe: { year, opened, done[, reps] }, or null for anything unusable. */
export function cleanAdvent(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const year = Number(v.year)
  if (!Number.isInteger(year) || year < 2000 || year > 3000) return null
  const opened = days(v.opened)
  // A door's thing is only ever done behind a door that is open, and a done door counts no more.
  const done = days(v.done).filter(d => opened.includes(d))
  const reps = repsOf(v.reps, opened)
  for (const d of done) delete reps[d]
  return Object.keys(reps).length ? { year, opened, done, reps } : { year, opened, done }
}

/** This year's calendar as { year, opened, done, reps }: empty for a stored one of another year. */
export function adventOf(S, now = seasonNow()) {
  const a = cleanAdvent(S?.advent)
  const year = now.getFullYear()
  return a && a.year === year ? { reps: {}, ...a } : { year, opened: [], done: [], reps: {} }
}

const store = (s, a) => { s.advent = cleanAdvent(a) }

/**
 * One door on `now`:
 *   'locked'  a day still to come (or not December at all): no peeking
 *   'today'   today's door, not opened yet
 *   'ready'   an earlier day's door nobody opened: still there for the taking
 *   'open'    opened
 */
export function doorState(S, day, now = seasonNow()) {
  if (!isDec(now) || !isDay(day) || day > now.getDate()) return 'locked'
  if (adventOf(S, now).opened.includes(day)) return 'open'
  return day === now.getDate() ? 'today' : 'ready'
}

/** Opens a door into `s` (inside a store update). False, and nothing changed, for a locked one. */
export function openDoor(s, day, now = seasonNow()) {
  if (doorState(s, day, now) === 'locked') return false
  const a = adventOf(s, now)
  store(s, { ...a, opened: [...a.opened, day] })
  return true
}

/** Marks the thing behind an open door as done. False for a door that is not open. */
export function markDone(s, day, now = seasonNow()) {
  if (doorState(s, day, now) !== 'open') return false
  const a = adventOf(s, now)
  store(s, { ...a, done: [...a.done, day] })
  return true
}

/**
 * Counts `by` more reps on a counting door (`goal` its target): 'counted', 'done' when that
 * reached the goal (the door is then done), or false for a door that is not open or already done.
 * A negative `by` takes some back, never below zero.
 */
export function countReps(s, day, by, goal, now = seasonNow()) {
  if (doorState(s, day, now) !== 'open') return false
  const a = adventOf(s, now)
  if (a.done.includes(day)) return false
  const n = Math.max(0, Math.min(REPS_MAX, (a.reps[day] || 0) + Math.round(Number(by) || 0)))
  if (n >= goal) { store(s, { ...a, done: [...a.done, day] }); return 'done' }
  store(s, { ...a, reps: { ...a.reps, [day]: n } })
  return 'counted'
}

/** How far a counting door got: its goal once done, else the reps counted so far. */
export function repsDone(S, day, goal, now = seasonNow()) {
  const a = adventOf(S, now)
  return a.done.includes(day) ? goal : Math.min(goal, a.reps[day] || 0)
}

const pad = n => String(n).padStart(2, '0')
/** Whether a workout was logged on December `day` of `year` (a local date, like every workout's `d`). */
export function trainedOn(S, year, day) {
  const iso = `${year}-12-${pad(day)}`
  return (Array.isArray(S?.workouts) ? S.workouts : []).some(w => w && w.d === iso)
}

/** Whether an open door's bauble is lit: its thing done, or a workout logged that day. */
export function adventLit(S, day, now = seasonNow()) {
  const a = adventOf(S, now)
  if (!a.opened.includes(day)) return false
  return a.done.includes(day) || trainedOn(S, a.year, day)
}

/** The tree in numbers: { hung, lit } baubles, one per open door, lit as adventLit says. */
export function treeOf(S, now = seasonNow()) {
  const a = adventOf(S, now)
  return { hung: a.opened.length, lit: a.opened.filter(d => adventLit(S, d, now)).length }
}

/** The day whose door wants opening most: today's, else the earliest one left. null when none. */
export function nextDoor(S, now = seasonNow()) {
  if (!isDec(now)) return null
  const today = Math.min(now.getDate(), DOORS)
  if (doorState(S, today, now) === 'today') return today
  for (let d = 1; d <= today; d++) if (doorState(S, d, now) === 'ready') return d
  return null
}

/**
 * Two copies' calendars, one: the later year wins; of the same year, every door either opened,
 * every thing either did, and the higher count of a door. Undefined when neither has a usable one.
 */
export function mergeAdvent(a, b) {
  const x = cleanAdvent(a), y = cleanAdvent(b)
  if (!x || !y) return x || y || undefined
  if (x.year !== y.year) return x.year > y.year ? x : y
  const reps = { ...(x.reps || {}) }
  for (const [d, n] of Object.entries(y.reps || {})) reps[d] = Math.max(reps[d] || 0, n)
  return cleanAdvent({ year: x.year, opened: [...x.opened, ...y.opened], done: [...x.done, ...y.done], reps })
}

/* The order the doors hang in: scrambled, the way a real calendar is, the same every year. Six
   columns of four; no two neighbours a day apart, so finding today is a small treasure hunt that
   the glow then gives away. */
export const LAYOUT = [
  7, 15, 2, 21, 11, 18,
  13, 4, 24, 9, 1, 16,
  20, 10, 17, 5, 22, 3,
  12, 23, 6, 14, 19, 8,
]

/* ------------------------------------------------ the door you swing open -- */

/* The big door is dragged open by its edge (the Christmas chunk). Its angle follows the finger
   1:1 (with a little give past shut and past wide open), and on release it springs to open or
   shut. The choice is made from where the swing is going, not where it was let go (Apple's
   momentum projection), so a flick opens it from a few degrees and a slow drag needs half way. */
export const OPEN_DEG = 112

const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * over)

/** The door's angle for a drag of `dx` px on a door `width` px wide (RTL: the hinge is on the right). */
export function dragAngle(dx, width, rtl = false) {
  const x = rtl ? -dx : dx
  const raw = (-x / Math.max(1, width)) * 140 + 0   // + 0: no -0 for a door at rest
  if (raw < 0) return -rubber(-raw, 30)
  if (raw > OPEN_DEG) return OPEN_DEG + rubber(raw - OPEN_DEG, 30)
  return raw
}

/** Where a swing ends up, from `angle` (deg) and its release velocity (deg/s). */
export const projectAngle = (angle, velocity, rate = 0.995) => angle + (velocity / 1000) * rate / (1 - rate)

/** On release: true to spring open, false to spring back shut. */
export const releaseOpens = (angle, velocity) => projectAngle(angle, velocity) >= OPEN_DEG / 2

/**
 * One step of a spring toward `target`, Apple-style: `response` seconds and a `damping` ratio
 * (1 settles without a bounce, under 1 overshoots a touch). { x, v } in, { x, v } out, `dt` in s.
 */
export function springStep({ x, v }, target, dt, { response = 0.42, damping = 0.78 } = {}) {
  const k = (2 * Math.PI / response) ** 2, c = 4 * Math.PI * damping / response
  // Small fixed substeps keep it stable on a slow frame.
  let n = Math.max(1, Math.ceil(dt * 240))
  const h = dt / n
  while (n--) { const acc = -k * (x - target) - c * v; v += acc * h; x += v * h }
  return { x, v }
}

/** Whether a spring is close enough to rest to stop animating. */
export const springSettled = ({ x, v }, target) => Math.abs(x - target) < 0.3 && Math.abs(v) < 4
