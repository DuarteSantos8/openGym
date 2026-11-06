// Recovery sessions (#313): a sauna, an ice bath, a massage, a stretch or a walk, logged in two
// taps with how long it took. They are not workouts: no sets, no volume, no PRs, and they stay out
// of everything that reads S.workouts. They show in History and the month calendar beside the
// workouts, in the journal when they carry a note, and they count for the week streak only when
// the profile asks for it (`S.recoveryStreak`, Settings → Look & Home; the walk is
// api/coach/core/streak.js, shared with the server so a trainer sees the same number).
//
// Stored one entry per session, keyed by its id, the way day photos are (lib/day-photos.js):
//
//   S.recoverySessions = { '<id>': { d: '2026-11-06', kind: 'sauna', min: 20, note: '…', _ts }, … }
//
// Two devices that each logged one keep both, an edit keeps its later version (lib/sync-merge.js
// mergeStampedMap, STAMPED_MAPS), and a removal is a stamped empty entry (`{ _ts }`), never a
// deleted key, which the other device's copy would bring straight back.
import { NOTE_MAX } from './history.js'

export const RECOVERY_KINDS = ['sauna', 'cold', 'massage', 'stretch', 'walk', 'other']
export const RECOVERY_LABEL = { sauna: 'Sauna', cold: 'Ice bath', massage: 'Massage', stretch: 'Mobility', walk: 'Easy walk', other: 'Other recovery' }
export const RECOVERY_ICON = { sauna: 'flame', cold: 'snowflake', massage: 'heart', stretch: 'stretch', walk: 'steps', other: 'sparkles' }
// The durations the sheet offers in one tap, in minutes, per kind (a typed one is fine too).
export const RECOVERY_PRESETS = { sauna: [10, 15, 20], cold: [2, 3, 5], massage: [30, 45, 60], stretch: [10, 20, 30], walk: [20, 30, 45], other: [10, 20, 30] }
export const RECOVERY_MIN_MAX = 600

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** One stored entry read back: { d, kind, min, note } or null for a cleared or broken one. */
export function readRecovery(entry) {
  if (!isMap(entry) || !ISO.test(String(entry.d || ''))) return null
  const kind = RECOVERY_KINDS.includes(entry.kind) ? entry.kind : 'other'
  const min = Math.round(Number(entry.min))
  if (!Number.isFinite(min) || min < 1) return null
  const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, NOTE_MAX) : ''
  return { d: entry.d, kind, min: Math.min(RECOVERY_MIN_MAX, min), ...(note ? { note } : {}) }
}

/** Every recovery session, newest day first, as { id, d, kind, min, note? }. */
export function recoverySessionsOf(S) {
  const map = isMap(S?.recoverySessions) ? S.recoverySessions : {}
  const out = []
  for (const [id, e] of Object.entries(map)) {
    const r = readRecovery(e)
    if (r) out.push({ id, ...r, _ts: Number(e._ts) || 0 })
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b._ts - a._ts))
}

/** The sessions on `iso`. */
export const recoveryOn = (S, iso) => recoverySessionsOf(S).filter(r => r.d === iso)

/** The days that hold one, as a Set of ISO dates. */
export const recoveryDays = S => new Set(recoverySessionsOf(S).map(r => r.d))

/** Whether the week streak counts these days too (off unless asked for). */
export const recoveryCountsStreak = S => S?.recoveryStreak === true

/**
 * S.recoverySessions with `id` set to `session`, stamped `now`. Null (or an unusable session) clears
 * it with a stamped empty entry, so the removal syncs.
 */
export function withRecovery(map, id, session, now = Date.now()) {
  const clean = session ? readRecovery(session) : null
  return { ...(isMap(map) ? map : {}), [id]: clean ? { ...clean, _ts: now } : { _ts: now } }
}

/** "Sauna · 20 min" (no note). */
export function recoveryLine(r, tr = s => s) {
  if (!r) return ''
  return `${tr(RECOVERY_LABEL[r.kind] || RECOVERY_LABEL.other)} · ${tr('{0} min', r.min)}`
}

/** Minutes per kind in the days [from, to], for a week or a month line. */
export function recoveryTotals(S, from, to) {
  const out = {}
  for (const r of recoverySessionsOf(S)) if (r.d >= from && r.d <= to) out[r.kind] = (out[r.kind] || 0) + r.min
  return out
}
