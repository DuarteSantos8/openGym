import { describe, expect, it } from 'vitest'
import { curveReadings, exerciseCurve, exerciseHeart, heartFormat, heartLatest, heartPoints, packCurve, parseFormat, setCurve, unpackCurve } from './heart-history.js'

const DAY = 86400000
const T0 = Date.UTC(2026, 10, 1, 9)
const ROPE = '2612', PUSH = '0662'
const timed = (sec, avg, max, rest) => ({ done: true, sec, hr: { avg, max }, ...(rest ? { restHr: { avg: rest, max: rest + 5 } } : {}) })
const reps = (r, w, avg, max) => ({ done: true, r, w, hr: { avg, max } })
const workout = (i, entries) => ({ id: 'w' + i, d: new Date(T0 + i * DAY).toISOString().slice(0, 10), start: T0 + i * DAY, end: T0 + i * DAY + 3600000, entries })

describe('heartFormat', () => {
  it('names a timed set by its seconds and a rep set by its reps and load', () => {
    expect(heartFormat({ sec: 60 }, 'time')).toBe('t:60')
    expect(heartFormat({ r: 12, w: 0 }, 'reps')).toBe('r:12@0')
    expect(heartFormat({ r: 5, w: 62.5 }, 'reps')).toBe('r:5@62.5')
    expect(heartFormat({ min: 10 }, 'cardio')).toBeNull()
    expect(heartFormat({ sec: 0 }, 'time')).toBeNull()
    expect(parseFormat('r:5@62.5')).toEqual({ mode: 'reps', r: 5, w: 62.5 })
    expect(parseFormat('t:60')).toEqual({ mode: 'time', sec: 60 })
  })
})

describe('exerciseHeart', () => {
  const ws = [
    workout(0, [{ id: ROPE, target: { mode: 'time' }, sets: [timed(60, 160, 175, 120), timed(60, 166, 180, 128)] }]),
    workout(3, [{ id: ROPE, target: { mode: 'time' }, sets: [timed(60, 150, 170, 110), timed(30, 140, 150)] }]),
    workout(5, [{ id: ROPE, target: { mode: 'time' }, sets: [timed(60, 154, 172), { done: true, sec: 60 }, { done: false, sec: 60, hr: { avg: 90, max: 99 } }] }]),
    workout(6, [{ id: PUSH, target: { mode: 'reps' }, sets: [reps(16, 0, 120, 140)] }]),
  ]

  it('puts the format done in most sessions first', () => {
    const { formats } = exerciseHeart(ws, ROPE)
    expect(formats.map(f => f.key)).toEqual(['t:60', 't:30'])
    expect(formats[0]).toMatchObject({ sessions: 3, sets: 4 })
  })

  it('compares only the sets of one format, newest session first', () => {
    const s = exerciseHeart(ws, ROPE).sessions('t:60')
    expect(s.map(x => x.id)).toEqual(['w5', 'w3', 'w0'])
    expect(s[2]).toMatchObject({ n: 2, avg: 163, max: 180, rest: 124 })
    // the 30 s set stays out of the 60 s curve, the set without a reading and the unticked one too
    expect(s[1]).toMatchObject({ n: 1, avg: 150, max: 170, rest: 110 })
    expect(s[0]).toMatchObject({ n: 1, avg: 154, rest: null })
  })

  it('leaves warm-ups out and ignores readings that cannot be a heart', () => {
    const w = workout(0, [{ id: PUSH, target: { mode: 'reps' }, sets: [
      { ...reps(16, 0, 100, 110), phase: 'warmup' }, reps(16, 0, 300, 320), reps(16, 0, 130, 150),
    ] }])
    const h = exerciseHeart([w], PUSH)
    expect(h.formats).toHaveLength(1)
    expect(h.sessions('r:16@0')[0]).toMatchObject({ n: 1, avg: 130 })
  })

  it('draws a measure oldest first and gives the change since the session before', () => {
    const s = exerciseHeart(ws, ROPE).sessions('t:60')
    expect(heartPoints(s, 'avg').map(p => p.y)).toEqual([163, 150, 154])
    expect(heartPoints(s, 'rest').map(p => p.y)).toEqual([124, 110])
    expect(heartLatest(s, 'avg')).toEqual({ value: 154, delta: 4 })
    expect(heartLatest(s, 'rest')).toEqual({ value: 110, delta: -14 })
  })

  it('has nothing for an exercise without a reading', () => {
    expect(exerciseHeart(ws, '9999').formats).toEqual([])
    expect(exerciseHeart(null, ROPE).formats).toEqual([])
  })
})

describe('exerciseCurve', () => {
  // Push-ups ticked at +5 and +7 min, rope at +9 and +11, push-ups again at +13 min.
  const at = m => T0 + m * 60000
  const w = { id: 'w', start: T0, end: at(20), entries: [
    { id: PUSH, sets: [{ done: true, at: at(5) }, { done: true, at: at(7) }, { done: true, at: at(13) }] },
    { id: ROPE, sets: [{ done: true, at: at(9) }, { done: true, at: at(11) }] },
  ] }
  const samples = Array.from({ length: 21 }, (_, m) => [at(m), 100 + m])

  it('keeps the readings of the exercise from the start of its span, its later go straight after', () => {
    const c = exerciseCurve(w, PUSH, samples, 190)
    // first go: start → +7 min (8 readings), then +11 → +13 (3 readings) shifted to follow on
    expect(c.span).toBe(9 * 60000)
    expect(c.points[0]).toEqual({ t: 0, hr: 100 })
    expect(c.points.at(-1)).toEqual({ t: 9 * 60000, hr: 113 })
    expect(c.points).toHaveLength(11)
    expect(c.stats).toMatchObject({ max: 113, n: 11 })
  })

  it('takes in the rest before the exercise, from the last tick of the one before', () => {
    const c = exerciseCurve(w, ROPE, samples, 190)
    expect(c.span).toBe(4 * 60000)
    expect(c.points.map(p => p.hr)).toEqual([107, 108, 109, 110, 111])
  })

  it('has no curve without readings or without the exercise', () => {
    expect(exerciseCurve(w, ROPE, [], 190)).toBeNull()
    expect(exerciseCurve(w, '9999', samples, 190)).toBeNull()
  })
})

describe('setCurve', () => {
  it('lays a session out set by set from the sets\' own readings, one format only', () => {
    const w = workout(0, [{ id: ROPE, target: { mode: 'time' }, sets: [timed(60, 150, 170), timed(30, 140, 150), timed(60, 158, 175)] }])
    expect(setCurve(w, ROPE, 't:60')).toEqual([{ x: 1, hr: 150, max: 170 }, { x: 2, hr: 158, max: 175 }])
    expect(setCurve(w, ROPE, 't:45')).toEqual([])
  })
})

describe('packCurve', () => {
  const start = T0, end = T0 + 60000
  it('keeps one whole bpm per 5 s slot, the average of its readings, trimmed at both ends', () => {
    const c = packCurve([[start + 12000, 120], [start + 13000, 125], [start + 21000, 130], [start + 36000, 140]], start, end)
    expect(c).toEqual({ s: start + 10000, step: 5, v: [123, 0, 130, 0, 0, 140] })
    expect(unpackCurve(c)).toEqual([[start + 12500, 123], [start + 22500, 130], [start + 37500, 140]])
    expect(curveReadings(c)).toBe(3)
  })

  it('leaves out readings outside the workout or that cannot be a heart, and needs two', () => {
    expect(packCurve([[start - 1000, 120], [end + 1000, 130], [start + 1000, 300], [start + 2000, 110]], start, end)).toBeNull()
    expect(packCurve([], start, end)).toBeNull()
    expect(unpackCurve(null)).toEqual([])
    expect(unpackCurve({ s: 'x', v: [100] })).toEqual([])
  })

  it('holds an hour in a few kilobytes', () => {
    const hour = Array.from({ length: 3600 }, (_, i) => [start + i * 1000, 100 + (i % 60)])
    const c = packCurve(hour, start, start + 3600000)
    expect(c.v).toHaveLength(720)
    expect(JSON.stringify(c).length).toBeLessThan(3500)
  })
})
