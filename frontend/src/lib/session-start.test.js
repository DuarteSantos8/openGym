import { describe, it, expect } from 'vitest'
import { buildSessionEntries } from './session-start.js'
import { readSession } from './progression.js'
import { isWarmupRow } from './workout-model.js'

// The session builder used by the live start and by "log a past workout".
describe('buildSessionEntries', () => {
  const st = { unit: 'kg', workouts: [], exWeights: {}, routines: [] }

  it('ramps the warm-ups on the exercise’s own increment, not the unit default', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, inc: 1.25, warmupSets: 2 }] }
    const entries = buildSessionEntries(st, r)
    const warm = entries[0].sets.filter(isWarmupRow).map(s => s.w)
    expect(warm).toHaveLength(2)
    for (const w of warm) expect(Math.round(w / 1.25 * 1000) / 1000 % 1).toBe(0)   // a multiple of 1.25
    expect(entries[0].sets.filter(s => !isWarmupRow(s)).every(s => s.w === 60)).toBe(true)
  })

  it('keeps the unit default for timed exercises, whose inc is seconds', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', mode: 'time', sets: 2, sec: 30, inc: 10, weight: 0 }] }
    const entries = buildSessionEntries(st, r)
    expect(entries[0].sets.every(s => s.sec === 30)).toBe(true)
  })

  it('persists the effective deload target so completing the opened rows reads as a hit', () => {
    const cfg = { id: '0025', sets: 3, reps: 8, weight: 60, prog: 'linear' }
    const st = {
      unit: 'kg', exWeights: {}, routines: [],
      workouts: [1, 2, 3].map((n) => ({
        d: `2026-01-0${n}`,
        entries: [{
          id: cfg.id,
          target: { sets: 3, reps: 8, weight: 60 },
          sets: [6, 6, 6].map(r => ({ w: 60, r, done: true }))
        }]
      }))
    }
    const r = { id: 'r', prog: 'linear', ex: [cfg] }
    const entries = buildSessionEntries(st, r)
    const entry = entries[0]
    const work = entry.sets.filter(s => !isWarmupRow(s))

    expect(entry.plan.kind).toBe('deload')
    expect(entry.target).toMatchObject({ reps: entry.plan.reps, weight: entry.plan.weight })
    expect(readSession({ ...entry, sets: entry.sets.map(s => ({ ...s, done: true })) }, cfg).ok).toBe(true)
    expect(work.every(s => s.r === entry.target.reps && s.w === entry.target.weight)).toBe(true)
  })

  it('returns a bare array — no { entries, excluded } wrapper', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }
    const out = buildSessionEntries(st, r)
    expect(Array.isArray(out)).toBe(true)
    expect(out).toHaveLength(1)
  })

  it('stamps noProg + plan.kind "off" on every entry of an excluded routine, and neither on a normal one', () => {
    const ex = [{ id: '0025', sets: 3, reps: 5, weight: 60 }, { id: '0031', sets: 3, reps: 8, weight: 40 }]
    const excluded = buildSessionEntries(st, { id: 'rehab', excludeFromProgression: true, ex })
    expect(excluded.every(e => e.noProg === true)).toBe(true)
    expect(excluded.every(e => e.plan.kind === 'off')).toBe(true)

    const normal = buildSessionEntries(st, { id: 'r', prog: 'off', ex })
    expect(normal.every(e => e.noProg === undefined)).toBe(true)
  })

  it('does not stamp rid — that is the merge helper’s job', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }
    expect(buildSessionEntries(st, r)[0].rid).toBeUndefined()
  })
})
