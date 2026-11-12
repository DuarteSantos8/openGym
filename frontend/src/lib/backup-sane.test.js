import { describe, expect, it } from 'vitest'
import { dropBrokenRows } from './backup-sane.js'

const good = () => ({
  workouts: [{ id: 'w1', d: '2026-11-01', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }],
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }] }],
  bodyweight: [{ d: '2026-11-01', w: 81.4 }],
  customEx: [{ id: 'c1', n: 'trap bar deadlift' }],
  unit: 'kg',
})

describe('dropBrokenRows', () => {
  it('hands a healthy backup back untouched, the very same object', () => {
    const s = good()
    const r = dropBrokenRows(s)
    expect(r.dropped).toBe(0)
    expect(r.state).toBe(s)
  })

  // QA 1.4.5: `"workouts": [{...}, null, 5]` imported fine and then Home, History, Stats and the
  // Library all showed "Something went wrong" (Cannot read properties of null, reading 'd').
  it('drops a null and a number among the workouts and keeps the real one', () => {
    const s = good(); s.workouts.push(null, 5, 'x', [])
    const r = dropBrokenRows(s)
    expect(r.state.workouts).toEqual(good().workouts)
    expect(r.dropped).toBeGreaterThan(0)
    expect(s.workouts.length).toBe(5)   // the caller's object is not changed
  })

  it('drops a workout without entries, an entry without sets, and a set that is not an object', () => {
    const s = good()
    s.workouts.push({ id: 'w2', d: '2026-11-02' })
    s.workouts.push({ id: 'w3', d: '2026-11-03', entries: [null, { id: '0043' }, { id: '0043', sets: [null, { w: 100, r: 5, done: true }] }] })
    const r = dropBrokenRows(s)
    expect(r.state.workouts.map(w => w.id)).toEqual(['w1', 'w3'])
    expect(r.state.workouts[1].entries).toEqual([{ id: '0043', sets: [{ w: 100, r: 5, done: true }] }])
  })

  it('keeps a routine whose exercise list is missing, with an empty one', () => {
    const s = good(); s.routines.push({ id: 'r2', name: 'Empty' }, null, { name: 'no id' }, { id: 'r3', ex: [null, { id: '0043' }, { sets: 3 }] })
    const r = dropBrokenRows(s)
    expect(r.state.routines.map(x => x.id)).toEqual(['r1', 'r2', 'r3'])
    expect(r.state.routines[1].ex).toEqual([])
    expect(r.state.routines[2].ex).toEqual([{ id: '0043' }])
  })

  it('drops a weigh-in whose weight is not a number or that has no day', () => {
    const s = good(); s.bodyweight.push({ d: '2026-11-02', w: 'heavy' }, { d: '2026-11-03', w: 80.5 }, { w: 80 }, null, { d: '2026-11-04', w: null })
    const r = dropBrokenRows(s)
    expect(r.state.bodyweight.map(b => b.d)).toEqual(['2026-11-01', '2026-11-03'])
  })

  it('turns a list that is not a list into an empty one', () => {
    const s = good(); s.customEx = 'nope'; s.measurements = { a: 1 }
    const r = dropBrokenRows(s)
    expect(r.state.customEx).toEqual([])
    expect(r.state.measurements).toEqual([])
  })

  it('never judges the numbers: a huge or negative set stays', () => {
    const s = good(); s.workouts[0].entries[0].sets.push({ w: -5, r: 1e9, done: true })
    expect(dropBrokenRows(s).dropped).toBe(0)
  })

  it('leaves a key the backup does not carry out of the result', () => {
    const s = good(); delete s.customEx
    expect('customEx' in dropBrokenRows({ ...s, workouts: [null] }).state).toBe(false)
  })
})
