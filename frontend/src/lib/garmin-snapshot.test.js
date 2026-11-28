// The Garmin watch's cut-down snapshot (lib/garmin-snapshot.js). The fixture in
// frontend/garmin/test/snapshot.json is what the watch's Monkey C code is written against
// (frontend/garmin/source/Core.mc); it is built here from the Wear OS fixture, which the phone
// builds (watch-sync.wear.test.js). Changes on purpose: UPDATE_GARMIN_FIXTURES=1 npx vitest run …
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { garminSnapshot, garminWindow, garminUpNow, garminTotals, garminLook, GARMIN_MAX_BYTES, GARMIN_ACKED_MAX } from './garmin-snapshot.js'
import { EXIDX } from './exercises.js'
import { exerciseNameText } from './format.js'

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
    // lean rows: what is null or no stays home (the watch reads a missing key as null or no)
    expect(out.active.entries[0].sets[0]).toEqual({ w: 60, r: 8, done: true, at: 1761742900000 })
    expect(out.active.entries[0].sets[1]).toEqual({ w: 60, r: 8 })
    expect(out.active.entries[1].sets[0]).toEqual({ w: 20, r: 10, warmup: true })
    expect(out.active.entries[1]).not.toHaveProperty('last')
    expect(out.active.rest).toEqual({ endsAt: 1761743000000 })
    expect(out.active.progress).toEqual([1, 3])
    expect(out.active.volume).toBe(480)
    expect(out.streak).toEqual({ weeks: 1, thisWeekDone: false })
    expect(out.settings).toEqual({ restHaptics: true, lang: 'de', show: { hr: true, last: true, next: true }, crown: 'reps' })
  })

  it('carries the redesign look (accent, crown, effort) only when the phone has it', () => {
    const snap = wearSnap()
    snap.settings = { ...snap.settings, accent: '#30D158', onAccent: '#000000', crown: 'weight', effort: 'rir', autoHolds: true, forgotten: { askMin: 30, graceMin: 2, leaveGym: true } }
    expect(garminSnapshot(snap).settings).toMatchObject({ accent: '#30d158', onAccent: '#000000', crown: 'weight', effort: 'rir', autoHolds: true, askMin: 30 })
    expect(garminLook({ forgotten: { askMin: 0 } })).toEqual({ askMin: 0 })
    // the phone's "left the gym" mark rides along with the workout
    snap.active.leftGymAt = 1761743100000
    expect(garminSnapshot(snap).active.leftGymAt).toBe(1761743100000)
    // a phone that sends none (or nonsense) leaves the keys out: an older watch app reads it as before
    expect(garminLook({ accent: 'green', onAccent: '#fff', crown: 'x', effort: 'pain', autoHolds: 'yes', forgotten: { askMin: -1 } })).toEqual({})
    expect(garminLook({ onAccent: '#000000' })).toEqual({})
    expect(garminLook()).toEqual({})
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
    // only cardio left (logged on the phone): that one, not the phone's cur, all done with
    const C = { cur: 0, unit: 'kg', entries: [ex('a', [row(true)]), ex('b', [row(true)]), ex('c', [row(false)], { mode: 'cardio' })] }
    expect(garminWindow(C)).toEqual([2])
  })

  it('sends a superset whole, plus the exercise after it', () => {
    const A = { cur: 1, unit: 'kg', entries: [ex('a', [row(true)]), ex('b', [row(false)], { group: 'g' }), ex('c', [row(false)], { group: 'g' }), ex('d', [row(false)]), ex('e', [row(false)])] }
    expect(garminWindow(A)).toEqual([1, 2, 3])
  })

  it('sends the next superset whole too, so the watch moves into it without waiting for the phone (#1295)', () => {
    const g = (id, k, done = false) => ex(id, [row(done), row(done), row(done)], { group: 'g' + k })
    // three supersets of four, as in the issue: the first one up now
    const A = { cur: 0, unit: 'kg', entries: [g('a', 1), g('b', 1), g('c', 1), g('d', 1), g('e', 2), g('f', 2), g('g', 2), g('h', 2), g('i', 3), g('j', 3)] }
    expect(garminWindow(A)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    // the first superset done: the second, and the third after it
    for (const e of A.entries.slice(0, 4)) e.sets.forEach(r => { r.done = true })
    expect(garminWindow(A)).toEqual([4, 5, 6, 7, 8, 9])
    // a single exercise after a superset, and a superset after a single exercise
    const B = { cur: 0, unit: 'kg', entries: [ex('a', [row(false)]), g('b', 1), g('c', 1), ex('d', [row(false)])] }
    expect(garminWindow(B)).toEqual([0, 1, 2])
    expect(garminUpNow(B)).toBe(0)
    // and it fits: the issue's workout, with real names, sends both supersets whole
    const names = ['0025', '0001', '0003', '0027', '0047', '0048', '0050', '0060', '0070', '0080']
    const C = { id: 'w', cur: 0, unit: 'kg', entries: A.entries.map((e, k) => ({ ...e, id: names[k], name: exerciseNameText(EXIDX[names[k]]), sets: e.sets.map((r, j) => ({ ...r, done: false, sid: 's' + k + 'x' + j + 'abcde' })) })) }
    const out = garminSnapshot({ unit: 'kg', restSec: 90, settings: { lang: 'en' }, active: C, ready: null })
    expect(bytes(out)).toBeLessThanOrEqual(GARMIN_MAX_BYTES)
    expect(out.active.entries.map(e => e.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
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
    // (with a workout running today goes by name only, below)
    const out = garminSnapshot({ ...snap, active: null })
    expect(out.ready.today.entries[0].last).toBeUndefined()
    expect(out.ready.today.entries[0].best).toBeUndefined()
    expect(out.ready.today.entries[0].sets).toHaveLength(1)
    expect(out.ready.others).toHaveLength(8)
    expect(out.ready.others[0]).toEqual({ routineIds: ['o0'], name: 'Routine 0', entries: [] })
  })

  it('sends today by name only while a workout runs (the snapshot with every set stays small)', () => {
    const snap = wearSnap()
    snap.ready = { today: { routineIds: ['r1'], name: 'Legs', entries: [ex('a', [row(false)])] }, others: [] }
    expect(garminSnapshot(snap).ready.today).toEqual({ routineIds: ['r1'], name: 'Legs', entries: [] })
    expect(garminSnapshot({ ...snap, active: null }).ready.today.entries).toHaveLength(1)
    // 3 KB: the Instinct 2 parses 3.2 KB in the simulator and runs out of memory at 3.5 KB
    expect(GARMIN_MAX_BYTES).toBe(3072)
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

  // #1471: a circuit of six exercises, four rows each, with real catalogue names (the longest
  // there are, and ordinary ones): every snapshot fits, and always has the exercise up now with
  // all of its sets, wherever in the circuit it is and however far the circuit has got.
  describe('a six-exercise circuit (#1471)', () => {
    const all = Object.values(EXIDX).map(e => ({ id: e.id, name: exerciseNameText(e) })).filter(e => e.name)
    const longest = [...all].sort((a, b) => b.name.length - a.name.length).slice(0, 6)
    const usual = ['0025', '0001', '0003', '0027', '0047', '0048'].map(id => ({ id, name: exerciseNameText(EXIDX[id]) }))
    let sid = 0
    const circuit = (exs, upNow, done, extra = []) => ({
      id: 'w-c', name: 'Circuit', cur: upNow, unit: 'kg', restSec: 90, start: 1761742800000,
      rest: { endsAt: 1761743000000, total: 90 }, restAt: 1761742990000, activeAt: 1761742990000,
      entries: [
        ...exs.map((e, k) => ({
          id: e.id, name: e.name, mode: 'reps', restSec: 60, last: '62.5×10, 62.5×10, 60×10, 60×9', step: 2.5, group: '7',
          best: { w: 70, r: 8 }, muscles: { chest: 1, triceps: 0.5 },
          sets: [0, 1, 2, 3].map(j => ({ w: 62.5, r: 10, sec: null, done: j < done || (j === done && k < upNow), warmup: false, sid: 's' + (++sid).toString(36).padStart(7, '0'), ...(j < done || (j === done && k < upNow) ? { at: 1761742900000 + j * 1000 } : {}) })),
        })),
        ...extra,
      ],
    })
    const snapOf = active => ({ unit: 'kg', restSec: 90, now: 1761743000000, acked: Array.from({ length: 16 }, (_, k) => 'g17617429' + String(k).padStart(5, '0') + '-' + (123456 + k)), discarded: ['w-old'],
      settings: { lang: 'en', accent: '#a3e635', onAccent: '#000000', crown: 'reps', effort: 'rir', autoHolds: true, forgotten: { askMin: 20 } },
      streak: { weeks: 12, thisWeekDone: true }, active, ready: { today: { name: 'Circuit', routineIds: ['r'], entries: [] }, others: [{ name: 'Pull', routineIds: ['p'] }] } })

    for (const [label, exs] of [['the longest names', longest], ['ordinary names', usual]]) {
      it('fits under 3 KB with ' + label + ', the exercise up now whole', () => {
        for (let done = 0; done < 4; done++) {
          for (let upNow = 0; upNow < 6; upNow++) {
            const A = circuit(exs, upNow, done)
            const out = garminSnapshot(snapOf(A))
            expect(bytes(out)).toBeLessThanOrEqual(GARMIN_MAX_BYTES)
            const mine = out.active.entries.find(e => e.i === upNow)
            expect(mine, `up now ${upNow}, round ${done}`).toBeTruthy()
            expect(mine.sets).toHaveLength(4)
            expect(mine.sets.map(r => !!r.done)).toEqual(A.entries[upNow].sets.map(r => r.done))
            expect(mine.sets.every(r => typeof r.sid === 'string')).toBe(true)
            // the whole circuit goes: the watch does it in turns, in the right order
            expect(out.active.entries.map(e => e.i)).toEqual([0, 1, 2, 3, 4, 5])
          }
        }
      })
    }

    it('a superset that ends the workout, its last member up now: the cut never drops it', () => {
      const A = circuit(longest, 5, 3)
      for (const max of [3072, 2048, 1200, 900, 600]) {
        const out = garminSnapshot(snapOf(A), { max })
        const mine = out.active.entries.find(e => e.i === 5)
        expect(mine, 'max ' + max).toBeTruthy()
        expect(mine.sets).toHaveLength(4)
        // what was cut from the circuit is what comes furthest after it (from the top, in turn)
        const kept = out.active.entries.map(e => e.i)
        expect(kept).toEqual([0, 1, 2, 3, 4, 5].slice(0, kept.length - 1).concat(5).sort())
      }
    })

    it('a circuit too big for any window keeps the exercise up now and the ones right after it', () => {
      const twelve = [...longest, ...longest].map((e, k) => ({ ...e, id: e.id + '-' + k }))
      const A = circuit(twelve, 9, 1)
      const out = garminSnapshot(snapOf(A))
      expect(bytes(out)).toBeLessThanOrEqual(GARMIN_MAX_BYTES)
      const kept = out.active.entries.map(e => e.i)
      expect(kept).toContain(9)
      expect(kept).toContain(10)
      expect(out.active.entries.find(e => e.i === 9).sets).toHaveLength(4)
      // the members in turn after 9 (10, 11, then 0, 1 ...): a run from 9 on, round to the top
      const turn = [10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8]
      const n = kept.length - 1
      expect(kept.filter(i => i !== 9).sort((a, b) => turn.indexOf(a) - turn.indexOf(b))).toEqual(turn.slice(0, n))
    })

    it('the block after the circuit goes whole or not at all', () => {
      const next = [0, 1].map(k => ({ id: longest[k].id + '-n', name: longest[k].name, mode: 'reps', restSec: 60, last: '50×10', step: 2.5, group: '8', sets: [0, 1, 2, 3].map(j => ({ w: 50, r: 10, sec: null, done: false, warmup: false, sid: 'n' + k + 'x' + j + 'abcdef' })) }))
      for (let upNow = 0; upNow < 6; upNow++) {
        const out = garminSnapshot(snapOf(circuit(longest, upNow, 0, next)))
        expect(bytes(out)).toBeLessThanOrEqual(GARMIN_MAX_BYTES)
        const after = out.active.entries.filter(e => e.i >= 6).length
        expect([0, 2]).toContain(after)
      }
    })
  })

  it('without a workout or anything ready, says so', () => {
    const out = garminSnapshot({ v: 1, unit: 'lb', restSec: 60, active: null, ready: null })
    expect(out.active).toBeNull()
    expect(out.ready).toBeNull()
    expect(out.unit).toBe('lb')
    expect(out.streak).toBeNull()
  })

  it('carries the newest acked ids, a short list, and never cuts them for size', () => {
    const ids = Array.from({ length: 40 }, (_, i) => 'g' + i)
    const out = garminSnapshot({ ...wearSnap(), acked: [...ids, 7] })
    expect(out.acked).toEqual(ids.slice(-GARMIN_ACKED_MAX))
    const tight = garminSnapshot({ ...wearSnap(), acked: ids }, { max: 300 })
    expect(tight.acked).toHaveLength(GARMIN_ACKED_MAX)
    expect(garminSnapshot(wearSnap()).acked).toBeUndefined()
  })
})

