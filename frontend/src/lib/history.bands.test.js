import { describe, expect, it } from 'vitest'
import { setLabel, seedBands } from './history.js'
import { migratedFixture } from './test-fixtures.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { setKnownBands } from './bands.js'

// Reddit: "15 reps with red", and the next session starts where the bands left off.
const BANDS = [
  { id: 'y', name: 'Yellow', color: '#f2c94c', kg: 5 },
  { id: 'r', name: 'Red', color: '#eb5757', kg: 10 },
  { id: 'g', name: 'Green', color: '#27ae60', kg: 15 },
]
const BAND_EX = '0005' // band alternate biceps curl
const LIFT = '0025'
const cfg = (extra = {}) => ({ id: BAND_EX, sets: 2, reps: 12, weight: 0, mode: 'reps', ...extra })
const after = sets => ({ bands: BANDS, workouts: [{ id: 'w1', d: '2026-11-01', start: 1, end: 2, routineIds: ['r'], entries: [{ id: BAND_EX, rid: 'r', sets }] }] })
// v2: the work rows Start opens for the slot, after the state's workouts.
const buildSets = (state, slot) => {
  const S = migratedFixture({ unit: 'kg', ...state, routines: [{ id: 'r', name: 'R', ex: [slot] }] })
  const draft = { ...S, prescriptions: { ...S.prescriptions } }
  const xs = buildSessionExposures(draft, S.routines[0], { now: Date.parse('2026-11-03T12:00:00Z'), newId: x => x })
  return entriesForExposures(xs, draft.prescriptions)[0].sets.filter(r => r.phase !== 'warmup')
}

describe('the set line', () => {
  it('reads "15 × Red + Yellow", "20×15 + Red" with a weight too', () => {
    setKnownBands(BANDS)
    expect(setLabel(BAND_EX, { w: 0, r: 15, bands: ['r', 'y'], done: true }, cfg())).toBe('15 × Red + Yellow')
    expect(setLabel(LIFT, { w: 20, r: 15, bands: ['r'], done: true }, { id: LIFT, mode: 'reps' })).toBe('20×15 + Red')
    expect(setLabel(LIFT, { w: 20, r: 15, done: true }, { id: LIFT, mode: 'reps' })).toBe('20×15')
  })
})

describe('the bands a new session starts with', () => {
  it("is the plan's the first time, last time's set by set after", () => {
    expect(buildSets({ bands: BANDS, workouts: [] }, cfg({ bands: ['r'] })).map(s => s.bands)).toEqual([['r'], ['r']])
    const S = after([{ w: 0, r: 10, bands: ['g'], done: true }, { w: 0, r: 9, bands: ['r'], done: true }])
    expect(buildSets(S, cfg({ bands: ['y'] })).map(s => s.bands)).toEqual([['g'], ['r']])
  })

  it('steps up a band once every set reached the top of the reps, and starts the reps again', () => {
    const S = after([{ w: 0, r: 12, bands: ['y'], done: true }, { w: 0, r: 13, bands: ['y'], done: true }])
    const rows = buildSets(S, cfg({ prog: 'double', repsMin: 8, repsMax: 12 }))
    expect(rows.map(s => s.bands)).toEqual([['r'], ['r']])
    expect(rows.map(s => s.r)).toEqual([8, 8])
  })

  it('stays on the same bands when a set fell short, progression is off, or the lift has weight', () => {
    const S = after([{ w: 0, r: 12, bands: ['y'], done: true }, { w: 0, r: 10, bands: ['y'], done: true }])
    expect(buildSets(S, cfg()).map(s => s.bands)).toEqual([['y'], ['y']])
    const all = after([{ w: 0, r: 12, bands: ['y'], done: true }, { w: 0, r: 12, bands: ['y'], done: true }])
    expect(buildSets(all, cfg({ prog: 'off' })).map(s => s.bands)).toEqual([['y'], ['y']])
    expect(buildSets(all, cfg({ weight: 5 })).map(s => s.bands)).toEqual([['y'], ['y']])
  })

  it('leaves an exercise without bands exactly as it was', () => {
    const rows = [{ w: 50, r: 8, done: false }]
    expect(seedBands({ bands: BANDS, workouts: [] }, { id: LIFT, sets: 1, reps: 8, mode: 'reps' }, rows)).toBe(rows)
  })
})
