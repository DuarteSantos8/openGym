// The Garmin watch's cut-down snapshot (lib/garmin-snapshot.js). The fixture in
// frontend/garmin/test/snapshot.json is what the watch's Monkey C code is written against
// (frontend/garmin/source/Core.mc); it is built here from the Wear OS fixture, which the phone
// builds (watch-sync.wear.test.js). Changes on purpose: UPDATE_GARMIN_FIXTURES=1 npx vitest run …
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { garminSnapshot, garminWindow, garminTotals, GARMIN_MAX_BYTES } from './garmin-snapshot.js'

const here = dirname(fileURLToPath(import.meta.url))
const wearSnap = () => JSON.parse(readFileSync(join(here, '..', '..', 'android', 'wear', 'src', 'test', 'resources', 'snapshot.json'), 'utf8'))
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length

const row = (done, extra = {}) => ({ w: 50, r: 8, sec: null, done, warmup: false, ...extra })
const ex = (id, sets, extra = {}) => ({ id, name: 'Exercise ' + id, mode: 'reps', restSec: null, last: '50×8, 50×8', sets, step: 2.5, ...extra })

describe('the Garmin snapshot', () => {
  it('is the fixture the watch is written against', () => {
    const out = garminSnapshot(wearSnap())
    const file = join(here, '..', '..', 'garmin', 'test', 'snapshot.json')
    if (process.env.UPDATE_GARMIN_FIXTURES) writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(out)))
  })

  it('keeps the same fields as the other watches, with where each exercise sits', () => {
    const out = garminSnapshot(wearSnap())
    expect(out.active.id).toBe('w-1')
    expect(out.active.count).toBe(2)
    expect(out.active.entries.map(e => e.i)).toEqual([0, 1])
    expect(out.active.entries[0].sets[0]).toEqual({ w: 60, r: 8, sec: null, done: true, warmup: false, at: 1761742900000 })
    expect(out.active.rest).toEqual({ endsAt: 1761743000000 })
    expect(out.active.progress).toEqual([1, 3])
    expect(out.active.volume).toBe(480)
    expect(out.streak).toEqual({ weeks: 1, thisWeekDone: false })
    expect(out.settings).toEqual({ restHaptics: true, lang: 'de', show: { hr: true, last: true, next: true } })
  })

  it('sends the exercise up now and the one after it, not the whole workout', () => {
    const A = { cur: 1, unit: 'kg', entries: [ex('a', [row(true)]), ex('b', [row(true), row(false)]), ex('c', [row(false)]), ex('d', [row(false)])] }
    expect(garminWindow(A)).toEqual([1, 2])
    // the phone's cur is done with: the next exercise with a set to do comes up
    A.entries[1].sets[1].done = true
    expect(garminWindow(A)).toEqual([2, 3])
    // nothing left after it: round to the first open one
    const B = { cur: 2, unit: 'kg', entries: [ex('a', [row(false)]), ex('b', [row(true)]), ex('c', [row(true)])] }
    expect(garminWindow(B)).toEqual([0, 1])
    expect(garminWindow({ entries: [] })).toEqual([])
  })

  it('sends a superset whole, plus the exercise after it', () => {
    const A = { cur: 1, unit: 'kg', entries: [ex('a', [row(true)]), ex('b', [row(false)], { group: 'g' }), ex('c', [row(false)], { group: 'g' }), ex('d', [row(false)]), ex('e', [row(false)])] }
    expect(garminWindow(A)).toEqual([1, 2, 3])
  })

  it('counts work sets and volume over the whole workout, in the workout unit', () => {
    const A = { unit: 'kg', entries: [
      ex('a', [row(true, { warmup: true }), row(true), row(false)]),
      ex('b', [row(true, { w: 100, r: 1 })], { unit: 'lb' }),
      ex('c', [row(true, { w: null, r: null, sec: 30 })], { mode: 'time' }),
    ] }
    const t = garminTotals(A)
    expect(t.progress).toEqual([3, 4])
    expect(t.volume).toBe(Math.round((400 + 45.359237) * 10) / 10)
  })

  it('lists the other routines by name only', () => {
    const snap = wearSnap()
    snap.ready = {
      today: { routineIds: ['r1'], name: 'Legs', entries: [ex('a', [row(false)], { best: { w: 60, r: 5 } })] },
      others: Array.from({ length: 12 }, (_, k) => ({ routineIds: ['o' + k], name: 'Routine ' + k, entries: [ex('x', [row(false)])] })),
    }
    const out = garminSnapshot(snap)
    expect(out.ready.today.entries[0].last).toBeUndefined()
    expect(out.ready.today.entries[0].best).toBeUndefined()
    expect(out.ready.today.entries[0].sets).toHaveLength(1)
    expect(out.ready.others).toHaveLength(8)
    expect(out.ready.others[0]).toEqual({ routineIds: ['o0'], name: 'Routine 0', entries: [] })
  })

  it('stays under the size limit for a big workout and a long plan', () => {
    const many = n => Array.from({ length: n }, () => row(false))
    const long = 'A rather long exercise name, with a variation'
    const snap = {
      v: 1, unit: 'kg', restSec: 90,
      settings: { lang: 'en' },
      streak: { weeks: 3, thisWeekDone: true },
      active: { id: 'w', name: 'Big', cur: 0, unit: 'kg', entries: Array.from({ length: 20 }, (_, k) => ex('e' + k, many(10), { name: long + k, best: { w: 100, r: 5 }, last: '100×5, '.repeat(10) })) },
      ready: {
        today: { routineIds: ['t'], name: 'Today', entries: Array.from({ length: 20 }, (_, k) => ex('t' + k, many(10), { name: long + k })) },
        others: Array.from({ length: 8 }, (_, k) => ({ routineIds: ['o' + k], name: long + k, entries: [] })),
      },
    }
    const out = garminSnapshot(snap)
    expect(bytes(out)).toBeLessThanOrEqual(GARMIN_MAX_BYTES)
    // the exercise up now always stays, with its sets
    expect(out.active.entries[0].i).toBe(0)
    expect(out.active.entries[0].sets).toHaveLength(10)
    // today's routine is still there to start, by name
    expect(out.ready.today.name).toBe('Today')
  })

  it('without a workout or anything ready, says so', () => {
    const out = garminSnapshot({ v: 1, unit: 'lb', restSec: 60, active: null, ready: null })
    expect(out.active).toBeNull()
    expect(out.ready).toBeNull()
    expect(out.unit).toBe('lb')
    expect(out.streak).toBeNull()
  })
})
