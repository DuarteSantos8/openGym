// The advent calendar (v1.4.4), part of the Christmas theme (lib/seasonal.js): 24 doors from
// 1 December, one more each local day. Pure and framework-free; the calendar itself (its art,
// its sheet and what is behind each door) lives in the theme's lazy chunk (seasonal/).
//
// What is opened is kept in the synced profile, so a door opened on the phone is open on the
// laptop too:  S.advent = { year: 2026, opened: [1, 2, 5], done: [2] }
//   opened  the doors opened this year
//   done    the doors whose little challenge was ticked off
// A calendar of another year reads as a fresh one. Both lists only ever hold the numbers 1 to 24,
// once each, so the field stays tiny whatever a device sends (cleanAdvent). Two copies of the same
// year merge by union (mergeAdvent, used by lib/sync-merge.js): opening a door is never undone.

export const DOORS = 24

const isDec = now => now.getMonth() === 11

/** Whether `now` (local) is inside the calendar's days: 1 to 24 December. */
export const inAdvent = (now = new Date()) => isDec(now) && now.getDate() <= DOORS

/** Whether the calendar can still be opened at all: all of December, for whoever is late. */
export const adventOpenable = (now = new Date()) => isDec(now)

const days = v => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= DOORS))].sort((a, b) => a - b)

/** The stored value made safe: { year, opened, done }, or null for anything unusable. */
export function cleanAdvent(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const year = Number(v.year)
  if (!Number.isInteger(year) || year < 2000 || year > 3000) return null
  const opened = days(v.opened)
  // A challenge is only ever ticked behind a door that is open.
  const done = days(v.done).filter(d => opened.includes(d))
  return { year, opened, done }
}

/** This year's calendar as { year, opened, done }: empty for a stored one of another year. */
export function adventOf(S, now = new Date()) {
  const a = cleanAdvent(S?.advent)
  const year = now.getFullYear()
  return a && a.year === year ? a : { year, opened: [], done: [] }
}

/**
 * One door on `now`:
 *   'locked'  a day still to come (or not December at all): no peeking
 *   'today'   today's door, not opened yet
 *   'ready'   an earlier day's door nobody opened: still there for the taking
 *   'open'    opened
 */
export function doorState(S, day, now = new Date()) {
  if (!isDec(now) || !Number.isInteger(day) || day < 1 || day > DOORS || day > now.getDate()) return 'locked'
  if (adventOf(S, now).opened.includes(day)) return 'open'
  return day === now.getDate() ? 'today' : 'ready'
}

/** Opens a door into `s` (inside a store update). False, and nothing changed, for a locked one. */
export function openDoor(s, day, now = new Date()) {
  if (doorState(s, day, now) === 'locked') return false
  const a = adventOf(s, now)
  s.advent = { year: a.year, opened: days([...a.opened, day]), done: a.done }
  return true
}

/** Ticks off the challenge behind an open door. False for a door that is not open. */
export function markDone(s, day, now = new Date()) {
  if (doorState(s, day, now) !== 'open') return false
  const a = adventOf(s, now)
  s.advent = { year: a.year, opened: a.opened, done: days([...a.done, day]) }
  return true
}

/** The day whose door wants opening most: today's, else the earliest one left. null when none. */
export function nextDoor(S, now = new Date()) {
  if (!isDec(now)) return null
  const today = Math.min(now.getDate(), DOORS)
  if (doorState(S, today, now) === 'today') return today
  for (let d = 1; d <= today; d++) if (doorState(S, d, now) === 'ready') return d
  return null
}

/**
 * Two copies' calendars, one: the later year wins; of the same year, every door either opened
 * and every challenge either ticked. Undefined when neither has a usable one.
 */
export function mergeAdvent(a, b) {
  const x = cleanAdvent(a), y = cleanAdvent(b)
  if (!x || !y) return x || y || undefined
  if (x.year !== y.year) return x.year > y.year ? x : y
  return cleanAdvent({ year: x.year, opened: [...x.opened, ...y.opened], done: [...x.done, ...y.done] })
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
