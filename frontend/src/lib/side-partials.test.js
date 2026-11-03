import { describe, it, expect } from 'vitest'
import { makeSideSet, setSideField, setSidePartials, sidePartialsOf, partialsTotalOf, completedVolumeOf, partialSetsOf, partialLoadOf, addDrop } from './workout-model.js'
import { setLabel } from './history.js'
import { workoutRows } from './export-csv.js'
import { todayForCoach } from './coach-context.js'

// A unilateral row taken to failure, both sides done at 10 reps each.
const failed = () => {
  let row = makeSideSet({ w: 20, r: 20, done: false, failure: true })
  row = setSideField(row, 'L', 'done', true)
  row = setSideField(row, 'R', 'done', true)
  return row
}

describe('per-side partials', () => {
  it('counts each side at its own load and partial count', () => {
    let row = failed()
    row = setSideField(row, 'R', 'w', 10)
    row = setSidePartials(row, 'L', 2)
    row = setSidePartials(row, 'R', 5)
    expect(sidePartialsOf(row, 'L')).toBe(2)
    expect(sidePartialsOf(row, 'R')).toBe(5)
    expect(partialsTotalOf(row)).toBe(7)
    // 20 x 10 + 10 x 10 = 300 full reps; partials 20 x 2 x 0.2 + 10 x 5 x 0.2 = 18
    expect(completedVolumeOf(row, { partials: true })).toBeCloseTo(318)
    expect(completedVolumeOf(row)).toBeCloseTo(300)
  })

  it('adds the side partials to the recovery extra sets, capped at one', () => {
    const row = failed()
    const withLp = setSidePartials(setSidePartials(row, 'L', 4), 'R', 4)
    expect(partialSetsOf(withLp)).toBeCloseTo(Math.min(1, (8 * 0.2) / 20))
  })

  it('gives up a side\'s partials when that side is rated short of failure', () => {
    let row = setSidePartials(failed(), 'L', 3)
    row = setSideField(row, 'L', 'rir', 2)
    expect(sidePartialsOf(row, 'L')).toBe(0)
    expect(partialsTotalOf(row)).toBe(0)
  })

  it('keeps the partials of a side not allowed them out of the count', () => {
    const row = setSidePartials(makeSideSet({ w: 20, r: 10, done: false }), 'L', 3)
    expect(sidePartialsOf(row, 'L')).toBe(0)
  })

  it('counts a straight set\'s partials at the last drop\'s weight', () => {
    const row = addDrop({ w: 40, r: 8, done: true, failure: true, lp: 4 }, { w: 30, r: 6 })
    expect(partialLoadOf(row)).toBe(30)
    expect(completedVolumeOf(row, { partials: true })).toBeCloseTo(40 * 8 + 30 * 6 + 30 * 4 * 0.2)
  })

  it('shows a side\'s partials in the history label, on that side', () => {
    let row = setSidePartials(failed(), 'L', 2)
    row = setSideField(row, 'L', 'rir', 0)
    row = setSideField(row, 'R', 'rir', 0)
    const label = setLabel('x', row, { mode: 'reps' })
    expect(label).toMatch(/^L .*F\+2/)
    expect(label).not.toMatch(/R .*F\+/)
  })

  it('writes each side\'s partials on its own CSV row', () => {
    let row = setSidePartials(failed(), 'L', 2)
    row = setSideField(row, 'L', 'rir', 0)
    row = setSideField(row, 'R', 'rir', 0)
    const S = { workouts: [{ d: '2026-10-29', start: 0, entries: [{ id: 'x', sets: [row] }] }] }
    const rows = workoutRows(S)
    const lpCol = 20 // 'partials' is the 21st column (index 20) in WORKOUT_COLUMNS
    const left = rows.find(r => r.includes('L'))
    expect(left[lpCol]).toBe('2')
    expect(rows.find(r => r.includes('R'))[lpCol]).toBe('')
  })

  it('hands the Coach each side\'s partials in the running session', () => {
    let row = setSidePartials(failed(), 'L', 2)
    row = setSideField(row, 'L', 'rir', 0)
    const out = todayForCoach({ active: { entries: [{ id: 'x', sets: [row] }] } })
    expect(out.entries[0].sets[0].sides.L.lp).toBe(2)
    expect(out.entries[0].sets[0].sides.R.lp).toBeUndefined()
  })
})
