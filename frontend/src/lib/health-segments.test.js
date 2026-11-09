import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { segmentType, workoutSegments, SEGMENT_TYPES } from './health-segments.js'
import { sessionRecord, healthRecords } from './health-connect.js'

// The sets of a workout as Health Connect segments (#816): what each set was and when.
const T = 1_762_400_000_000
const w = (entries, over = {}) => ({ id: 'w1', name: 'Push', start: T, end: T + 3_600_000, entries, ...over })

describe('segmentType', () => {
  it('names the moves Health Connect knows and calls the rest weightlifting', () => {
    expect(segmentType('0025')).toBe('bench_press')       // barbell bench press
    expect(segmentType('0043')).toBe('squat')             // barbell full squat
    expect(segmentType('0032')).toBe('deadlift')
    expect(segmentType('0334')).toBe('dumbbell_lateral_raise')
    expect(segmentType('0294')).toBe('arm_curl')
    expect(segmentType('0652')).toBe('pull_up')
    expect(segmentType('2330')).toBe('lat_pull_down')
    expect(segmentType('0739')).toBe('leg_press')
    expect(segmentType('cx1', [{ id: 'cx1', n: 'My weird machine' }])).toBe('weightlifting')
    expect(segmentType('cx2', [{ id: 'cx2', n: 'Bulgarian split squat' }])).toBe('lunge')
  })
  it('only hands out types the native side maps', () => {
    const java = readFileSync(new URL('../../android/app/src/main/java/ch/duartesantos/opengym/HealthWrite.java', import.meta.url), 'utf8')
    for (const t of SEGMENT_TYPES) if (t !== 'weightlifting') expect(java, t).toContain(`case "${t}"`)
  })
})

describe('workoutSegments', () => {
  it('gives each ticked set its slice, ending at its tick, in order and never overlapping', () => {
    const segs = workoutSegments(w([
      { id: '0025', sets: [{ w: 60, r: 8, done: true, at: T + 120_000 }, { w: 60, r: 8, done: true, at: T + 125_000 }, { w: 60, r: 8, done: false }] },
      { id: '0463', target: { mode: 'time' }, sets: [{ sec: 60, done: true, at: T + 600_000 }] },
    ]))
    expect(segs).toEqual([
      { start: T + 92_000, end: T + 120_000, type: 'bench_press', reps: 8 },
      { start: T + 120_000, end: T + 125_000, type: 'bench_press', reps: 8 },
      { start: T + 540_000, end: T + 600_000, type: expect.any(String), reps: 0 },
    ])
  })
  it('counts both sides and the drops, and leaves out cardio and unstamped sets', () => {
    const segs = workoutSegments(w([
      { id: '0294', sets: [{ sides: { L: { w: 10, r: 10, done: true }, R: { w: 10, r: 9, done: true } }, done: true, at: T + 300_000 }] },
      { id: '0294', sets: [{ w: 12, r: 6, done: true, drops: [{ w: 8, r: 6 }], drop: true, at: T + 400_000 }] },
      { id: '2138', target: { mode: 'cardio' }, sets: [{ min: 10, speed: 20, done: true, at: T + 1_000_000 }] },
      { id: '0025', sets: [{ w: 60, r: 5, done: true }] },
    ]))
    expect(segs.map(s => s.reps)).toEqual([19, expect.any(Number)])
    expect(segs).toHaveLength(2)
  })
  it('stays inside the session, and is empty without times', () => {
    const segs = workoutSegments(w([{ id: '0025', sets: [{ w: 60, r: 8, done: true, at: T + 5000 }] }]))
    expect(segs[0].start).toBe(T)
    expect(workoutSegments(w([], { start: 0 }))).toEqual([])
  })
})

describe('the Health Connect session', () => {
  const S = { unit: 'kg', workouts: [w([{ id: '0025', sets: [{ w: 60, r: 8, done: true, at: T + 120_000 }] }])] }
  const opts = { nameOf: id => id, speedUnit: 'kmh' }
  it('carries the segments only when asked (Android), so Apple Health records stay as written', () => {
    expect(healthRecords(S, opts).sessions[0].segments).toBeUndefined()
    expect(healthRecords(S, { ...opts, segments: true }).sessions[0].segments).toHaveLength(1)
  })
  it('gives a cardio session none', () => {
    const run = w([{ id: '0685', target: { mode: 'cardio' }, sets: [{ min: 30, speed: 10, done: true, at: T + 1_800_000 }] }])
    expect(sessionRecord(run, { unit: 'kg', ...opts, segments: true }).segments).toBeUndefined()
  })
})
