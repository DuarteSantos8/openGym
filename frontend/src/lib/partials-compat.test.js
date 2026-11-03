// Lengthened partials must not change anything for data that has none: exports from before the
// `partials` column, imports without it, histories without `lp`, and rows that carry `lp` going
// through code that doesn't know the field (JSON, merges).
import { describe, expect, it } from 'vitest'
import { csvField, workoutsCSV, WORKOUT_COLUMNS } from './export-csv.js'
import { parseCSV, parseWorkoutCSV, parseImport, mergeImport } from './import-csv.js'
import { sessionVolume, workoutVolume } from './history.js'
import { partialsOf, partialSetsOf, partialVolumeOf, completedVolumeOf } from './workout-model.js'

const at = (d, h) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime()

const plainState = () => ({
  unit: 'kg',
  customEx: [],
  workouts: [{
    id: 'w1', d: '2026-03-02', start: at('2026-03-02', 18), end: at('2026-03-02', 19), name: 'Push', prs: [],
    entries: [{ id: '0025', sets: [
      { w: 40, r: 10, done: true, phase: 'warmup' },
      { w: 62.5, r: 8, done: true, rpe: 8.5 },
      { w: 62.5, r: 6, done: true, failure: true, rir: 0 },
    ] }],
  }],
})
const fresh = () => ({ unit: 'kg', workouts: [], customEx: [], exWeights: {} })
const csvOf = rows => rows.map(r => r.map(csvField).join(',')).join('\n') + '\n'
const sets = parsed => parsed.workouts[0].entries[0].sets

// What an export from before the column looked like: the same file with `partials` taken out.
function withoutPartialsColumn(text) {
  const rows = parseCSV(text)
  const at = rows[0].indexOf('partials')
  expect(at).toBeGreaterThan(-1)
  return csvOf(rows.map(r => r.filter((_, i) => i !== at)))
}

describe('exports without partials', () => {
  it('only add one empty column, every other cell is what it was', () => {
    const rows = parseCSV(workoutsCSV(plainState()))
    const col = rows[0].indexOf('partials')
    expect(rows.slice(1).every(r => r[col] === '')).toBe(true)
    expect(rows[0].filter(c => c === 'partials').length).toBe(1)
    // the column sits before `note`, after `incline`: nothing else moved
    expect(rows[0].slice(col - 1, col + 2)).toEqual(['incline', 'partials', 'note'])
  })
})

describe('imports without the partials column', () => {
  const old = withoutPartialsColumn(workoutsCSV(plainState()))

  it('an export from before the column is still ours and imports whole', () => {
    expect(parseCSV(old)[0]).not.toContain('partials')
    const parsed = parseWorkoutCSV(old, { unit: 'kg' })
    expect(parsed.source).toBe('openGym')
    expect(parsed.skipped).toBe(0)
    expect(sets(parsed).length).toBe(3)
    expect(sets(parsed).some(s => 'lp' in s)).toBe(false)
  })

  it('reads the same sets as the same file with the empty column', () => {
    const a = parseWorkoutCSV(old, { unit: 'kg' })
    const b = parseWorkoutCSV(workoutsCSV(plainState()), { unit: 'kg' })
    expect(sets(a)).toEqual(sets(b))
    const into = fresh(); mergeImport(into, a)
    const into2 = fresh(); mergeImport(into2, b)
    expect(into.workouts.map(w => w.vol)).toEqual(into2.workouts.map(w => w.vol))
  })

  it('goes through the generic entry point too', () => {
    const r = parseImport(old, { unit: 'kg' })
    expect(r.error).toBeUndefined()
  })

  it('a file from another app, with no such column, gets no partials', () => {
    const other = 'Date,Exercise,Weight,Reps,Set Type\n2026-08-08,Bench Press,80,5,Working\n2026-08-08,Bench Press,85,3,Working'
    expect(sets(parseWorkoutCSV(other, { unit: 'kg' })).some(s => 'lp' in s)).toBe(false)
  })
})

describe('what the partials cell may hold', () => {
  const row = lp => `2026-03-02,2026-03-02 18:00,,X,,Barbell Bench Press,0025,chest,,1,failure,,60,kg,5,,,,,,${lp},`
  const read = cells => sets(parseWorkoutCSV(WORKOUT_COLUMNS.join(',') + '\n' + cells.map(row).join('\n'), { unit: 'kg' }))

  it('empty, zero, negative, text and absurd values add nothing; a fraction is floored', () => {
    const out = read(['', '0', '-3', 'abc', '100', '2.7', '12'])
    expect(out.map(s => s.lp)).toEqual([undefined, undefined, undefined, undefined, undefined, 2, 12])
  })
})

describe('histories without lp', () => {
  const w = plainState().workouts[0]

  it('count the same volume with the partials switch on or off', () => {
    expect(sessionVolume(w, {})).toBe(sessionVolume(w, { effort: 'rir', partials: 'fold' }))
    expect(workoutVolume(w)).toBe(workoutVolume(w, { partials: true }))
  })

  it('have no partials for any helper', () => {
    for (const s of w.entries[0].sets) {
      expect(partialsOf(s)).toBe(0)
      expect(partialSetsOf(s)).toBe(0)
      expect(partialVolumeOf(s)).toBe(0)
      expect(completedVolumeOf(s, { partials: true })).toBe(completedVolumeOf(s))
    }
  })

  it('survive an export and an import with no lp appearing', () => {
    const parsed = parseWorkoutCSV(workoutsCSV(plainState()), { unit: 'kg' })
    expect(sets(parsed).some(s => 'lp' in s)).toBe(false)
  })
})

describe('rows with lp, in code that does not know the field', () => {
  const withLp = () => {
    const S = plainState()
    S.workouts[0].entries[0].sets[2].lp = 4
    return S
  }

  it('lp is plain JSON on the row, so a sync or backup in between keeps it', () => {
    const S = withLp()
    const copy = JSON.parse(JSON.stringify(S))
    expect(copy.workouts[0].entries[0].sets[2].lp).toBe(4)
    expect(copy).toEqual(S)
  })

  it('only w and r drive volume: the saved vol and the default screens ignore lp', () => {
    const S = withLp()
    expect(sessionVolume(S.workouts[0], {})).toBe(sessionVolume(plainState().workouts[0], {}))
  })

  it('importing the same workout over itself does not drop or duplicate the partials', () => {
    const S = withLp()
    const parsed = parseWorkoutCSV(workoutsCSV(S), { unit: 'kg' })
    const into = fresh()
    mergeImport(into, parsed)
    mergeImport(into, parsed)
    expect(into.workouts.length).toBe(1)
    expect(into.workouts[0].entries[0].sets.find(s => s.lp).lp).toBe(4)
  })

  it('an older export without the column, imported over a history that has partials, leaves them alone', () => {
    const S = withLp()
    const into = { ...JSON.parse(JSON.stringify(S)), exWeights: {} }
    const old = withoutPartialsColumn(workoutsCSV(plainState()))
    mergeImport(into, parseWorkoutCSV(old, { unit: 'kg' }))
    const kept = into.workouts.find(w => w.id === 'w1')
    expect(kept.entries[0].sets[2].lp).toBe(4)
  })
})
