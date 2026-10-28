// Several weigh-ins a day, each with its time (#859).
//
// S.bodyweight stays what it always was to everything that reads it: one entry per day,
// `{ d, w, t, src? }`, sorted by day, `w` that day's weight and `t` when the day was last edited.
// What is new rides inside the day, where an older app keeps it without knowing it:
//
//   { d: '2026-10-28', w: 80.1, t: 1761630000000,
//     ins: [ { id: 'k3x9a', at: '07:12', w: 80.1, t: 1761630000000 },
//            { id: 'p0q2c', at: '21:40', w: 81.0, t: 1761675000000, src: 'health', sid: '…' } ],
//     gone: { r8a1d: 1761650000000 } }
//
//   - `ins`, the readings of the day: a stable id (unique within the day), `at` the local time
//     of day ('HH:MM', null when it is not known), the weight in the profile's unit, `t` when the
//     reading was last edited, `src` when it was read from the health hub or a file (the same
//     mark the day used to carry), `sid` the hub's own id of the sample.
//   - `gone`, the readings removed from a day that still has others: id → when. A reading edited
//     after its removal comes back, as everywhere else in the sync (lib/sync-merge.js).
//   - `w` is a mirror: the day's one value as the profile's "Daily value" setting
//     (S.bwDaily: 'first', the default, since a morning weight is the one worth comparing,
//     'avg' or 'last') picks it from the readings. Every chart, the trend, the goal line, the
//     widgets, Wrapped, the Coach and the MCP server read `w` and so all agree.
//   - `t` is the latest stamp of the day: of its readings and of its removals.
//
// A day with no `ins` is a weigh-in from before: one reading, no time, id '0' (readingsOf).
//
// Older apps (1.4.3 and before) merge whole days, the later `t` winning, and edit a day in place
// (`ex.w = n; ex.t = now`). So a day they did not touch travels through them whole, `ins` and all.
// A day they edited has a `t` its readings do not explain and a `w` that is not the daily value:
// that edit is taken as a correction of the reading the daily value came from (absorbLegacyEdit),
// the way that app's user saw it. Deleting a day there deletes the whole day, as it did.

export const DAILY_MODES = ['first', 'avg', 'last']
export const DEFAULT_TIME = '08:00'
const LEGACY_ID = '0'

const list = v => (Array.isArray(v) ? v : [])
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const num = v => Number(v) || 0
const round1 = n => Math.round(Number(n) * 10) / 10
const round2 = n => Math.round(Number(n) * 100) / 100
const p2 = n => String(n).padStart(2, '0')

/** The profile's choice of daily value; anything unknown reads as 'first'. */
export const dailyModeOf = S => (DAILY_MODES.includes(S?.bwDaily) ? S.bwDaily : 'first')

/** Local calendar day of a time in ms, 'YYYY-MM-DD'. */
export const dayOf = ms => { const x = new Date(ms); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}` }
/** Local time of day of a time in ms, 'HH:MM'. */
export const timeOf = ms => { const x = new Date(ms); return `${p2(x.getHours())}:${p2(x.getMinutes())}` }
/** A clean 'HH:MM', or null. */
export function cleanTime(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '').trim())
  if (!m || +m[1] > 23 || +m[2] > 59) return null
  return `${p2(+m[1])}:${m[2]}`
}
/** The moment a reading was taken, in local time: its day at its time (noon without one). */
export function readingAt(d, at) {
  const [y, mo, da] = String(d).split('-').map(Number)
  const tm = cleanTime(at)
  const [h, mi] = tm ? tm.split(':').map(Number) : [12, 0]
  return new Date(y, (mo || 1) - 1, da || 1, h, mi, 0, 0).getTime()
}

/** A short id made from a string: the same on every device (an imported weigh-in's, lib/import-csv.js). */
export function hashId(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < String(str).length; i++) h = Math.imul(h ^ String(str).charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** A new reading id: short, random, unique enough within a day. */
export const newReadingId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)

// Readings by time of day; one without a time first (an old weigh-in was nearly always the
// morning's), then by when it was entered.
const byTime = (a, b) => {
  const x = a.at || '', y = b.at || ''
  return x < y ? -1 : x > y ? 1 : num(a.t) - num(b.t)
}

function cleanReading(r) {
  if (!isMap(r) || r.id == null || !(Number(r.w) > 0)) return null
  const out = { ...r, id: String(r.id), at: cleanTime(r.at), w: Number(r.w) }
  if (out.t != null) out.t = num(out.t)
  return out
}

/**
 * The readings of one day, sorted by time. A day from before (`ins` absent) is one reading with
 * id '0', its time the moment it was typed when that was on its own day.
 */
export function readingsOf(e) {
  if (!isMap(e)) return []
  if (Array.isArray(e.ins)) return e.ins.map(cleanReading).filter(Boolean).sort(byTime)
  if (!(Number(e.w) > 0)) return []
  const t = num(e.t)
  const r = { id: LEGACY_ID, at: t > 0 && dayOf(t) === e.d ? timeOf(t) : null, w: Number(e.w), t }
  if (e.src) r.src = e.src
  return [r]
}

/** How many readings a day holds. */
export const readingCount = e => readingsOf(e).length

/** The one value of a day from its readings: the first, the average or the last. */
export function dailyValue(readings, mode = 'first') {
  const rs = list(readings).filter(r => Number(r?.w) > 0)
  if (!rs.length) return null
  if (mode === 'last') return Number(rs[rs.length - 1].w)
  if (mode === 'avg') return round2(rs.reduce((s, r) => s + Number(r.w), 0) / rs.length)
  return Number(rs[0].w)
}

/** The latest stamp a day's readings and removals explain. */
export function stampOf(e) {
  let m = 0
  for (const r of list(e?.ins)) m = Math.max(m, num(r?.t))
  if (isMap(e?.gone)) for (const v of Object.values(e.gone)) m = Math.max(m, num(v))
  return m
}

/**
 * An older app's edit of a day that has readings (see the header): its `t` moved past what the
 * readings explain and its `w` is not the daily value. The new weight goes to the reading the
 * daily value is read from (the first, or the last for 'last'), as an edit made then. Mutates `e`.
 */
export function absorbLegacyEdit(e, mode = 'first') {
  if (!isMap(e) || !Array.isArray(e.ins) || !e.ins.length) return e
  const st = stampOf(e), t = num(e.t)
  if (t === st || !(Number(e.w) > 0)) return e
  const rs = readingsOf(e)
  if (!rs.length || Number(e.w) === dailyValue(rs, mode)) return e
  const pick = mode === 'last' ? rs[rs.length - 1] : rs[0]
  const r = e.ins.find(x => String(x?.id) === pick.id)
  if (!r) return e
  r.w = round1(e.w)
  r.t = Math.max(t, st + 1)
  if (e.src) r.src = e.src; else delete r.src
  e.t = r.t
  return e
}

/**
 * Brings a day's mirror up to date with its readings: `w` the daily value, `t` the latest stamp,
 * `src` only when every reading was read in. Readings removed after their last edit are dropped.
 * A day with readings stays in the readings form. Returns the day, or null when nothing is left.
 * Mutates `e`.
 */
export function settleDay(e, mode = 'first', { absorb = true } = {}) {
  if (!isMap(e)) return null
  if (!Array.isArray(e.ins)) return Number(e.w) > 0 ? e : null
  if (absorb) absorbLegacyEdit(e, mode)
  const gone = isMap(e.gone) ? e.gone : {}
  const rs = e.ins.map(cleanReading).filter(r => r && !(num(gone[r.id]) > 0 && num(gone[r.id]) >= num(r.t))).sort(byTime)
  // One id once: the later edit of it.
  const seen = new Map()
  for (const r of rs) { const cur = seen.get(r.id); if (!cur || num(r.t) > num(cur.t)) seen.set(r.id, r) }
  e.ins = [...seen.values()].sort(byTime)
  if (!e.ins.length) return null
  if (isMap(e.gone)) {
    for (const k of Object.keys(e.gone)) if (!(num(e.gone[k]) > 0)) delete e.gone[k]
    if (!Object.keys(e.gone).length) delete e.gone
  }
  e.w = dailyValue(e.ins, mode)
  e.t = Math.max(stampOf(e), e.ins.some(r => r.t == null) ? num(e.t) : 0)
  if (e.ins.every(r => r.src)) e.src = e.ins[0].src; else delete e.src
  return e
}

/** settleDay on every day of S.bodyweight (S mutated), for a change of S.bwDaily and after merges. */
export function settleAll(S, mode = dailyModeOf(S)) {
  if (!Array.isArray(S?.bodyweight)) return S
  S.bodyweight = S.bodyweight.map(e => (isMap(e) && Array.isArray(e.ins) ? settleDay(e, mode) : e)).filter(e => e != null)
  return S
}

/**
 * A day turned into the readings form, keeping what it had as reading '0'; a day an older app
 * edited takes that edit in first (absorbLegacyEdit). The writers below change a day only after
 * this, and settle it without looking for such an edit again: their own change is not one.
 * Mutates `e`.
 */
function toReadings(e, mode) {
  absorbLegacyEdit(e, mode)
  if (!Array.isArray(e.ins)) {
    e.ins = readingsOf(e)
    delete e.src
  }
  return e
}

const OWN = { absorb: false }
const sortDays = S => S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))

/**
 * Adds a reading to S.bodyweight (mutated): on day `d` at time `at` ('HH:MM'). A reading at the
 * same time on that day is corrected instead (a second save of the same weigh-in), unless one of
 * them was read in from elsewhere. `t` is when it was entered; `id`, `src` and `sid` as in the
 * header. Returns the reading, or null when the weight is no weight.
 */
export function addWeighIn(S, { d, at = null, w, t = Date.now(), id = null, src = null, sid = null } = {}, mode = dailyModeOf(S)) {
  const n = round1(w)
  if (!(n > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return null
  if (!Array.isArray(S.bodyweight)) S.bodyweight = []
  const tm = cleanTime(at)
  const r = { id: String(id || newReadingId()), at: tm, w: n, t: num(t) }
  if (src) r.src = src
  if (sid) r.sid = String(sid)
  let day = S.bodyweight.find(b => b && b.d === d)
  let kept = r.id
  if (!day) {
    day = { d, w: n, t: r.t, ins: [r] }
    S.bodyweight.push(day)
  } else {
    toReadings(day, mode)
    const same = day.ins.find(x => x && (String(x.id) === r.id || (!src && !x.src && tm && cleanTime(x.at) === tm)))
    if (same) { kept = String(same.id); Object.assign(same, r, { id: same.id }); if (!src) { delete same.src; delete same.sid } }
    else day.ins.push(r)
    if (isMap(day.gone)) delete day.gone[r.id]
    day.t = Math.max(num(day.t), r.t)
  }
  settleDay(day, mode, OWN)
  sortDays(S)
  return day.ins.find(x => x.id === kept) || r
}

/**
 * Removes one reading (S mutated). The last reading of a day takes the whole day with it, which
 * the store records as a removed day (stampDeletions). Returns what Undo needs to put it back:
 * { d, reading, day } (`day` the whole day when it went), or null.
 */
export function removeWeighIn(S, d, id, now = Date.now(), mode = dailyModeOf(S)) {
  const i = list(S?.bodyweight).findIndex(b => b && b.d === d)
  if (i < 0) return null
  const day = S.bodyweight[i]
  const rs = readingsOf(day)
  const reading = rs.find(r => r.id === String(id))
  if (!reading) return null
  if (rs.length <= 1) {
    S.bodyweight.splice(i, 1)
    return { d, reading, day: JSON.parse(JSON.stringify(day)) }
  }
  toReadings(day, mode)
  const at = Math.max(num(now), stampOf(day) + 1, num(day.t) + 1)
  day.ins = day.ins.filter(r => String(r.id) !== reading.id)
  day.gone = { ...(isMap(day.gone) ? day.gone : {}), [reading.id]: at }
  settleDay(day, mode, OWN)
  day.t = at
  return { d, reading, day: null }
}

/**
 * Undo of removeWeighIn: the reading back on its day, stamped as edited now so a device that
 * synced the removal keeps it too. A whole day comes back as it was (the store marks it as added
 * back). Mutates S.
 */
export function restoreWeighIn(S, undo, now = Date.now(), mode = dailyModeOf(S)) {
  if (!undo?.reading) return false
  if (!Array.isArray(S.bodyweight)) S.bodyweight = []
  const day = S.bodyweight.find(b => b && b.d === undo.d)
  if (!day) {
    if (undo.day) { S.bodyweight.push(JSON.parse(JSON.stringify(undo.day))); sortDays(S); return true }
    addWeighIn(S, { ...undo.reading, d: undo.d, t: Math.max(num(now), num(undo.reading.t) + 1) }, mode)
    return true
  }
  if (readingsOf(day).some(r => r.id === undo.reading.id)) return false
  toReadings(day, mode)
  const t = Math.max(num(now), stampOf(day) + 1, num(day.t) + 1)
  day.ins.push({ ...undo.reading, t })
  if (isMap(day.gone)) delete day.gone[undo.reading.id]
  settleDay(day, mode, OWN)
  sortDays(S)
  return true
}

/**
 * Changes one reading: its weight, its time, its day. Moving it to another day takes it off the
 * first (as removeWeighIn) and adds it there under the same id. Returns the reading's day and id,
 * or null. Mutates S.
 */
export function editWeighIn(S, d, id, { d: to = d, at, w } = {}, now = Date.now(), mode = dailyModeOf(S)) {
  const day = list(S?.bodyweight).find(b => b && b.d === d)
  const old = day && readingsOf(day).find(r => r.id === String(id))
  if (!old) return null
  const next = { w: w != null ? w : old.w, at: at !== undefined ? at : old.at }
  if (to !== d) {
    removeWeighIn(S, d, id, now, mode)
    const r = addWeighIn(S, { ...old, ...next, d: to, t: now, src: null, id: old.id }, mode)
    return r ? { d: to, id: r.id } : null
  }
  toReadings(day, mode)
  const r = day.ins.find(x => String(x.id) === old.id)
  r.w = round1(next.w)
  r.at = cleanTime(next.at)
  r.t = Math.max(num(now), stampOf(day) + 1)
  delete r.src
  delete r.sid
  settleDay(day, mode, OWN)
  return { d, id: r.id }
}

/**
 * Two copies of one day, merged (lib/sync-merge.js mergeBodyweight). Two days from before
 * (no readings) keep the old rule: the one edited later, a typed one over one read in. Otherwise
 * the readings of both, by id, each as edited last; the removals of both; nothing removed after
 * its last edit. Returns the merged day, or null when no reading is left.
 */
export function mergeDay(a, b, mode = 'first') {
  if (!Array.isArray(a?.ins) && !Array.isArray(b?.ins)) {
    return !!a.src !== !!b.src ? (a.src ? b : a) : num(b.t) > num(a.t) ? b : a
  }
  const A = absorbLegacyEdit(JSON.parse(JSON.stringify(a)), mode)
  const B = absorbLegacyEdit(JSON.parse(JSON.stringify(b)), mode)
  const gone = {}
  for (const g of [A.gone, B.gone]) if (isMap(g)) for (const [k, v] of Object.entries(g)) if (num(v) > num(gone[k])) gone[k] = num(v)
  const by = new Map()
  for (const r of [...readingsOf(A), ...readingsOf(B)]) {
    const cur = by.get(r.id)
    if (!cur || num(r.t) > num(cur.t)) by.set(r.id, r)
  }
  const base = num(B.t) > num(A.t) ? B : A
  const out = { ...base, ins: [...by.values()], t: Math.max(num(A.t), num(B.t)) }
  delete out.gone
  if (Object.keys(gone).length) out.gone = gone
  return settleDay(out, mode)
}

/** The date and time to show for a reading: "07:12", or '' without a time. */
export const readingTime = r => cleanTime(r?.at) || ''

/** Every reading of S.bodyweight as one flat list, oldest first: [{ d, id, at, w, t, src }]. */
export function allReadings(bodyweight) {
  const out = []
  for (const e of list(bodyweight)) {
    if (!e?.d) continue
    for (const r of readingsOf(e)) out.push({ ...r, d: e.d })
  }
  return out.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : byTime(x, y)))
}

/**
 * The time the weigh-in sheet starts on: now for today; for an earlier day the time of that
 * day's first reading, or 08:00.
 */
export function defaultTimeFor(S, d, today, now = Date.now()) {
  if (d === today) return timeOf(now)
  const day = list(S?.bodyweight).find(b => b && b.d === d)
  const first = day ? readingsOf(day)[0] : null
  return first?.at || DEFAULT_TIME
}
