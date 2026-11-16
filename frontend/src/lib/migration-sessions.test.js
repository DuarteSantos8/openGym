// v1 parity over many sessions after the upgrade. migration-sessions.json was recorded from v1's
// own code (git ce30c730: session-start.js, progression.js, finish-workout.js), independent of
// the engine under test: the history v1 wrote before the upgrade, and the rows v1 would open at
// every session after it. Each case migrates that history (or a workout still running), then
// trains on in v2 with the same sets logged, and every session must open where v1's would have.
// Rows: "r@w", "a+b@w" (per side), "30s" / "30sL" / "30s@5" (holds); "~" is a row left unchecked.
import { describe, expect, it } from 'vitest'
import { migrateProfileV1ToV2, validateCanonicalProfile } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { buildSessionExposures } from './session-start.js'
import { buildCompletedSession } from './finish-session.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { isWarmupRow, syncSideAggregate } from './workout-model.js'
import CASES from './migration-sessions.json'

const DAY = 86400000
const T0 = Date.parse('2026-01-05T10:00:00Z')

// What was logged on a row, as the recording did it.
const less = (r, d) => (r.sec != null ? { ...r, sec: Math.max(1, r.sec - 5 * d) } : r.r != null ? { ...r, r: Math.max(0, r.r - d) } : r)
const more = (r, d) => (r.sec != null ? { ...r, sec: r.sec + 5 * d } : r.r != null ? { ...r, r: r.r + d } : r)
const loaded = r => r.sec == null && r.w > 0
const PATTERNS = {
  hit: r => r,
  missLast: (r, k, n) => (k === n - 1 ? less(r, 2) : r),
  missAll: r => less(r, 1),
  missBig: r => less(r, 4),
  beat: r => more(r, 3),
  beat1: r => more(r, 1),
  skipLast: (r, k, n) => (k === n - 1 ? { ...r, done: false } : r),
  firstOnly: (r, k) => (k === 0 ? r : { ...r, done: false }),
  plusLoad: r => (r.sec == null ? { ...r, w: (r.w || 0) + 10 } : r),
  noLoad: r => ({ ...r, w: 0 }),
  ramp: (r, k) => (loaded(r) ? { ...r, w: r.w + 2.5 * k } : r),
  rampMiss: (r, k, n) => (loaded(r) ? less({ ...r, w: r.w + 2.5 * k }, k === n - 1 ? 2 : 0) : r),
  lighterMiss: (r, k, n) => (loaded(r) ? less({ ...r, w: r.w - 2.5 * k }, k === n - 1 ? 1 : 0) : r)
}
function perform(entry, pattern, from = 0) {
  const fn = PATTERNS[pattern]
  const work = entry.sets.map((row, i) => [row, i]).filter(([row]) => !isWarmupRow(row))
  work.forEach(([row, i], k) => {
    if (k < from) return
    if (!row.sides) { entry.sets[i] = fn({ ...row, done: true }, k, work.length); return }
    const side = s => fn({ ...s, done: true }, k, work.length)
    const L = side(row.sides.L), R = side(row.sides.R)
    entry.sets[i] = syncSideAggregate({ ...row, done: L.done && R.done, sides: { L, R } })
  })
  entry.sets.forEach((row, i) => { if (isWarmupRow(row)) entry.sets[i] = { ...row, done: true } })
}

const rowOf = s => {
  const done = !s.startsWith('~'), v = s.replace('~', '')
  const hold = v.match(/^(\d+(?:\.\d+)?)s([LR]?)(?:@(.+))?$/)
  if (hold) return { sec: +hold[1], w: hold[3] ? +hold[3] : 0, done, ...(hold[2] ? { side: hold[2] } : {}) }
  const [reps, w] = v.split('@')
  if (reps.includes('+')) {
    const [l, r] = reps.split('+').map(Number)
    return { r: l + r, w: +w, done, sides: { L: { r: l, w: +w, done }, R: { r, w: +w, done } } }
  }
  return { r: +reps, w: +w, done }
}
const shown = rows => rows.filter(r => !isWarmupRow(r)).map(r => (r.sides ? `${r.sides.L.r}+${r.sides.R.r}@${r.sides.L.w ?? 0}`
  : r.sec != null ? `${r.sec}s${r.side || ''}${r.w ? '@' + r.w : ''}` : `${r.r}@${r.w ?? 0}`)).join(' ')

// The routine as v1 had it before session k: the recorded edits applied in order.
const cfgAt = (c, k) => Object.entries(c.edits || {}).filter(([at]) => +at <= k).reduce((cfg, [, edit]) => ({ ...cfg, ...edit }), structuredClone(c.cfg))
const at = k => ({ d: new Date(T0 + k * DAY).toISOString().slice(0, 10), start: T0 + k * DAY, routineIds: ['r1'], name: 'R' })
// Main #445 replaced the hidden flat pyramid weight with the same set's last load after
// the first session. Keep the older independent recording intact; only this case changed.
const mainPyramidRows = ['10@50 8@50 6@50', '10@60 8@60 6@60', '10@60 8@60 6@60']
const entryOf = (cfg, s) => ({ id: cfg.id, rid: 'r1', target: { ...cfg, ...s.target }, planned: s.planned, sets: s.rows.split(' ').map(rowOf) })
function v1Profile(c) {
  const m = c.history.length
  return {
    unit: 'kg', restSec: 90, ...c.profile, routines: [{ id: 'r1', name: 'R', ex: [cfgAt(c, m)] }],
    workouts: c.history.map((s, k) => ({ id: 'w' + k, ...at(k), end: T0 + k * DAY + 3600000, routineId: 'r1', entries: [entryOf(cfgAt(c, k), s)] })),
    ...(c.active ? { active: { id: 'w' + m, ...at(m), cur: 0, entries: [entryOf(cfgAt(c, m), c.active)] } } : {})
  }
}
function finish(profile, active, k) {
  const { session, oneRepMaxes, progression } = buildCompletedSession(active, profile, { end: T0 + k * DAY + 3600000, newId: s => s, unit: profile.unit })
  profile.workouts.push(session)
  for (const r of oneRepMaxes) profile.oneRepMaxes[r.id] = r
  profile.progression = { ...profile.progression, ...progression }
}

describe('after the upgrade, every session opens where v1\'s would have', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const { profile: migrated, activeSession } = migrateProfileV1ToV2(v1Profile(c), LIB_BY_ID)
      const profile = structuredClone(migrated)
      const m = c.history.length
      let k = m
      if (activeSession) {
        // A workout running at the upgrade: its first set was logged in v1, the rest on v2.
        activeSession.entries.forEach(e => perform(e, c.pats[0], 1))
        finish(profile, activeSession, k++)
      }
      for (; k < m + c.pats.length; k++) {
        const exposures = buildSessionExposures(profile, profile.routines[0], { now: T0 + k * DAY, newId: s => `${s}`, unit: profile.unit })
        const entries = entriesForExposures(exposures, profile.prescriptions)
        const expected = name === "pyramid sets: the routine's weight | at 0" ? mainPyramidRows : c.v1
        expect(shown(entries[0].sets), `session ${k + 1}`).toBe(expected[k - m])
        entries.forEach(e => perform(e, c.pats[k - m]))
        finish(profile, { id: 'w' + k, ...at(k), exposures, entries }, k)
      }
      expect(validateCanonicalProfile(profile).errors).toEqual([])
    })
  }
})
