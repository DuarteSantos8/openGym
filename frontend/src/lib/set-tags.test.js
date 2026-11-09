import { describe, expect, it } from 'vitest'
import { SET_TAGS, setTagOf, withSetTag, setTagCell } from './set-tags.js'
import { workoutRows, WORKOUT_COLUMNS } from './export-csv.js'

// TestFlight 11-08: "be able to colour code each exercise set".
describe('a colour tag on a set', () => {
  it('every tag has a shape too, never colour alone, each one different', () => {
    expect(new Set(SET_TAGS.map(x => x.shape)).size).toBe(SET_TAGS.length)
  })
  it('sets and clears without touching the rest of the set, and ignores what is not a tag', () => {
    const row = { w: 60, r: 8, done: true }
    const tagged = withSetTag(row, 'blue')
    expect(tagged).toEqual({ w: 60, r: 8, done: true, tag: 'blue' })
    expect(row.tag).toBeUndefined()
    expect(withSetTag(tagged, null)).toEqual(row)
    expect(withSetTag(row, 'chartreuse')).toEqual(row)
    expect(setTagOf({ tag: 'nope' })).toBeNull()
    expect(setTagCell(tagged)).toBe('blue')
  })
  it('goes into the CSV as set_color, and a per-side set keeps its bands there', () => {
    const S = { unit: 'kg', bands: [{ id: 'b-red', name: 'Red', color: '#eb5757' }], workouts: [{ id: 'w', d: '2026-10-01', start: 0, end: 0, name: 'Legs', entries: [
      { id: '0025', target: { mode: 'reps' }, sets: [{ w: 80, r: 8, done: true, tag: 'green' }, { w: 80, r: 7, done: true }] },
      { id: '0043', target: { mode: 'reps' }, sets: [{ bands: ['b-red'], side: true, sides: { L: { w: 0, r: 10, done: true }, R: { w: 0, r: 10, done: true } } }] },
    ] }] }
    const rows = workoutRows(S)
    const col = name => WORKOUT_COLUMNS.indexOf(name)
    expect(rows.slice(0, 2).map(r => r[col('set_color')])).toEqual(['green', ''])
    expect(rows.slice(2).map(r => r[col('bands')])).toEqual(['Red', 'Red'])
  })
})
