import { describe, expect, it } from 'vitest'
import { exerciseSpans, currentSpanStart, heartStats, heartByExercise } from './heart-steps.js'

const S = 1_000_000
const set = sec => ({ done: true, at: S + sec * 1000, r: 5, kg: 50 })
const w = {
  start: S, end: S + 900e3,
  entries: [
    { id: 'squat', sets: [set(120), set(240), { done: false }] },
    { id: 'row', sg: 'a', sets: [set(360)] },
    { id: 'press', sg: 'a', sets: [set(420)] },
    { id: 'curl', sets: [set(600), { sides: { L: { done: true, at: S + 650e3 }, R: { done: true, at: S + 700e3 } } }] },
  ],
}

describe('exerciseSpans', () => {
  it('runs each exercise from the tick before it to its last, a superset as one', () => {
    expect(exerciseSpans(w)).toEqual([
      { unit: 0, members: [0], from: S, to: S + 240e3 },
      { unit: 1, members: [1, 2], from: S + 240e3, to: S + 420e3 },
      { unit: 3, members: [3], from: S + 420e3, to: S + 700e3 },
    ])
  })
  it('makes a second span of an exercise come back to', () => {
    const back = { ...w, entries: [w.entries[0], { id: 'x', sets: [set(300)] }, { ...w.entries[0], sets: [] }] }
    back.entries[0] = { id: 'squat', sets: [set(120), set(400)] }
    expect(exerciseSpans(back).map(s => [s.unit, s.from - S, s.to - S])).toEqual([[0, 0, 120e3], [1, 120e3, 300e3], [0, 300e3, 400e3]])
  })
  it('leaves out ticks outside the workout', () => {
    expect(exerciseSpans({ start: S, end: S + 100e3, entries: [{ sets: [set(200)] }] })).toEqual([])
  })
  it('never pairs two routines across their edge, a superset inside one still one', () => {
    // a combined session: the last of routine A and the first of B share an `sg`, as the detail
    // sheet and the copied text read them back apart (history.js sessionSections)
    const both = { start: S, end: S + 900e3, entries: [
      { id: 'row', rid: 'A', sg: 'a', sets: [set(100)] },
      { id: 'press', rid: 'A', sg: 'a', sets: [set(200)] },
      { id: 'curl', rid: 'B', sg: 'a', sets: [set(300)] },
    ] }
    expect(exerciseSpans(both)).toEqual([
      { unit: 0, members: [0, 1], from: S, to: S + 200e3 },
      { unit: 2, members: [2], from: S + 200e3, to: S + 300e3 },
    ])
  })
})

describe('currentSpanStart', () => {
  it('starts the exercise in progress at the last tick of anything else', () => {
    expect(currentSpanStart({ ...w, cur: 3 }) - S).toBe(420e3)
    // Back to the superset after the curls: from the curls' last tick.
    expect(currentSpanStart({ ...w, cur: 2 }) - S).toBe(700e3)
    expect(currentSpanStart({ ...w, cur: 0 }) - S).toBe(700e3)
    expect(currentSpanStart({ start: S, entries: [{ sets: [] }], cur: 0 })).toBe(S)
  })
})

describe('heartStats', () => {
  it('averages, keeps the max and the time in zones 4 and 5', () => {
    // max 200: zone 4 from 160 bpm.
    const r = heartStats([[0, 100], [10e3, 170], [20e3, 180], [60e3, 120]], 0, 70e3, 200)
    expect(r).toEqual({ avg: 143, max: 180, high: 10e3 + 15e3, n: 4, sum: 570 })
  })
  it('is null without a reading', () => {
    expect(heartStats([], 0, 1, 200)).toBeNull()
    expect(heartStats([[5, 400]], 0, 10, 200)).toBeNull()
  })
})

describe('heartByExercise', () => {
  it('gives each exercise its numbers, in the order done', () => {
    const samples = [[S + 60e3, 110], [S + 200e3, 150], [S + 300e3, 170], [S + 500e3, 130]]
    const r = heartByExercise(w, samples, 200)
    expect(r.map(x => [x.unit, x.avg, x.max])).toEqual([[0, 130, 150], [1, 170, 170], [3, 130, 130]])
    expect(r[1].members).toEqual([1, 2])
  })
  it('counts an exercise done in two goes once', () => {
    const back = { start: S, end: S + 900e3, entries: [{ sets: [set(100), set(400)] }, { sets: [set(200)] }] }
    const r = heartByExercise(back, [[S + 50e3, 100], [S + 150e3, 140], [S + 300e3, 120]], 200)
    expect(r.map(x => [x.unit, x.avg, x.max])).toEqual([[0, 110, 120], [1, 140, 140]])
  })
  it('averages an exercise done in two goes over all its readings, rounded once', () => {
    // first go 100 and 101 (100.5), second go 100: 301 / 3 = 100, not the rounded 101 and 100 averaged to 101
    const back = { start: S, end: S + 900e3, entries: [{ sets: [set(100), set(400)] }, { sets: [set(200)] }] }
    const r = heartByExercise(back, [[S + 40e3, 100], [S + 50e3, 101], [S + 300e3, 100]], 200)
    expect(r.find(x => x.unit === 0).avg).toBe(100)
  })
})

describe('in the copied text', () => {
  it('puts each exercise its heart rate line under its sets', async () => {
    const { workoutText } = await import('./workout-text.js')
    const samples = [[S + 60e3, 110], [S + 200e3, 150], [S + 300e3, 170], [S + 310e3, 172], [S + 500e3, 130]]
    const steps = heartByExercise(w, samples, 180)
    const txt = workoutText({ ...w, name: 'Demo', d: '2026-11-15' }, { unit: 'kg', nameOf: e => e.id, heart: { avg: 140, max: 172, steps } })
    expect(txt).toMatch(/squat\n.*\n♥ Average 130 · Max 150 bpm/i)
    expect(txt).toMatch(/press\n.*\n♥ Average 171 · Max 172 bpm/i)
  })
})

describe('on the printed workout', () => {
  it('draws the curve and puts each exercise its heart rate line', async () => {
    const { workoutPrintHTML } = await import('./report-print.js')
    const samples = [[S + 60e3, 110], [S + 200e3, 150], [S + 300e3, 170], [S + 310e3, 172], [S + 500e3, 130]]
    const steps = heartByExercise(w, samples, 180)
    const html = workoutPrintHTML({ unit: 'kg' }, { ...w, name: 'Demo', d: '2026-11-15' }, { heart: { samples, steps } })
    expect(html).toContain('class="hr"')
    expect(html).toContain('fill="#ff0e75"')
    expect(html).toContain('class="seam"')
    expect(html).toContain('♥ Average 130 · Max 150 bpm')
    expect(workoutPrintHTML({ unit: 'kg' }, { ...w, name: 'Demo', d: '2026-11-15' })).not.toContain('class="hr"')
  })
})
