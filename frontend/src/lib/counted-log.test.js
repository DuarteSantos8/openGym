import { describe, it, expect } from 'vitest'
import { countedWorkouts, countedS } from './counted-log.js'

const set = (w, r) => ({ w, r, done: true })
const bench = { id: '0025', sets: [set(100, 5)] }
const curl = { id: '0294', sets: [set(20, 10)], noProg: true }

describe('countedWorkouts', () => {
  it('leaves a log with nothing kept out as it is', () => {
    const ws = [{ d: '2026-10-01', entries: [bench], vol: 500 }]
    expect(countedWorkouts(ws)).toBe(ws)
  })
  it('drops an exercise kept out and works the volume out again', () => {
    const ws = [{ d: '2026-10-01', entries: [bench, curl], vol: 700 }]
    const out = countedWorkouts(ws)
    expect(out[0].entries.map(e => e.id)).toEqual(['0025'])
    expect(out[0].vol).toBe(500)
    expect(ws[0].entries).toHaveLength(2)
  })
  it('drops a workout kept out as a whole, or with every exercise kept out', () => {
    const ws = [
      { d: '2026-10-01', entries: [bench], excludeFromProgression: true },
      { d: '2026-10-02', entries: [curl] },
      { d: '2026-10-03', entries: [bench] },
    ]
    expect(countedWorkouts(ws).map(w => w.d)).toEqual(['2026-10-03'])
  })
  it('gives the statistics the counted log and keeps the rest of S', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-10-01', entries: [bench, curl] }] }
    const out = countedS(S)
    expect(out.unit).toBe('kg')
    expect(out.workouts[0].entries.map(e => e.id)).toEqual(['0025'])
    expect(S.workouts[0].entries).toHaveLength(2)
  })

  it('passes no state through as it is', () => {
    expect(countedS(null)).toBe(null)
    expect(countedS(undefined)).toBe(undefined)
  })
})
