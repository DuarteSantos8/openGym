// Discord, ayeeebroham (Android, 1.4.4): "5 sessions of 3 × 8 squats missed, the weight stays at
// 185 lb". His plan: linear progression, a routine slot with no weight of its own (0, typed in at
// the gym), a scheduled rotation of Lower A / Lower B, "Planned sessions start from" Your plan and
// Last workout both tried, extra sets added on top. Every one of those, started and logged the way
// the app does it (session-start → finish-session, v2), deloads on the third miss in a row and keeps
// backing off while the misses go on. Kept as a guard so none of those settings ever stops it.
import { describe, it, expect } from 'vitest'
import { buildCombinedExposures } from './session-merge.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildCompletedSession } from './finish-session.js'
import { isWarmupRow } from './workout-model.js'
import { migratedFixture } from './test-fixtures.js'

const SQUAT = '0043'
const work = e => e.sets.filter(s => !isWarmupRow(s))

function run (profile, { extra = 0, slot = {} } = {}) {
  let st = migratedFixture({
    unit: 'lb', exWeights: {}, workouts: [], week: {}, dayPlan: {}, ...profile,
    routines: [
      { id: 'A', name: 'Lower A', ex: [{ id: SQUAT, sets: 3, reps: 8, weight: 0, ...slot }] },
      { id: 'B', name: 'Lower B', ex: [{ id: '0032', sets: 3, reps: 10, weight: 0 }] },
    ],
  })
  // Start: the routine's exposures (their prescriptions stored) and the workout screen's rows.
  const open = (rid, d) => {
    const draft = { ...st, prescriptions: { ...st.prescriptions } }
    const { exposures } = buildCombinedExposures(draft, [rid], { now: Date.parse(d + 'T10:00:00Z'), newId: v => v + d })
    st = draft
    return { exposures, entries: entriesForExposures(exposures, draft.prescriptions, draft).map((e, i) => ({ ...e, plan: exposures[i].plan })) }
  }
  const opened = []
  let day = 1
  const train = rid => {
    const d = `2026-10-${String(day).padStart(2, '0')}`
    const started = open(rid, d)
    const entries = started.entries.map(e => {
      if (rid === 'A') opened.push({ w: work(e)[0].w, kind: e.plan?.kind ?? 'off' })
      // 185 typed in, six of the eight reps each set; the extra sets go past the plan.
      const sets = e.sets.map(s => (isWarmupRow(s) ? { ...s, done: true } : { ...s, w: e.id === SQUAT ? 185 : 95, r: 6, done: true }))
      for (let k = 0; k < extra; k++) sets.push({ w: 185, r: 8, done: true })
      return { ...e, sets }
    })
    const active = { id: 'w' + day, d, start: Date.parse(d + 'T10:00:00Z'), routineIds: [rid], name: rid, exposures: started.exposures, entries }
    day++
    // A new state per change, the way the store hands them out (ex-unit and others cache by it).
    const done = buildCompletedSession(active, st, { end: active.start + 1, newId: v => v, unit: st.unit })
    st = { ...st, workouts: [...st.workouts, done.session], progression: { ...st.progression, ...done.progression } }
  }
  // The rotation: A, B, A, B ... five Lower A days, then the one the deload should open.
  for (let k = 0; k < 5; k++) { train('A'); train('B') }
  const last = open('A', '2026-10-30').entries[0]
  opened.push({ w: work(last)[0].w, kind: last.plan?.kind ?? 'off' })
  return opened
}

describe('linear progression with no weight in the plan', () => {
  for (const [name, profile] of [['your plan', { startFrom: 'plan' }], ['your last session', { startFrom: 'last' }], ['last time means any workout', { startFrom: 'last', lastFrom: 'any' }], ['default rule picked in Settings', { progDefault: 'linear' }]]) {
    it(`deloads on the third miss in a row (${name})`, () => {
      const opened = run(profile)
      expect(opened[0].kind).toBe('first')
      expect(opened.slice(1, 3).map(o => [o.w, o.kind])).toEqual([[185, 'hold'], [185, 'hold']])
      expect(opened[3].kind).toBe('deload')
      expect(opened[3].w).toBeLessThan(185)
    })
  }

  it('extra sets on top of the plan do not hide the misses', () => {
    const opened = run({}, { extra: 2 })
    expect(opened[3].kind).toBe('deload')
    expect(opened[3].w).toBeLessThan(185)
  })

  it('with progression switched off for the slot it holds, which is what an "Off" rule means', () => {
    const opened = run({ startFrom: 'last' }, { slot: { prog: 'off' } })
    expect(opened.slice(1).every(o => o.kind === 'off' && o.w === 185)).toBe(true)
  })
})
