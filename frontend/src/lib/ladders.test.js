import { describe, expect, it } from 'vitest'
import { LADDERS, allLadders, ladderOf, nextRung, prevRung, reachedRung, saveLadder, deleteLadder, ownLadders } from './ladders.js'
import { nextPrescription, POLICIES_FOR, LADDER_TOP } from './progression.js'
import { EXIDX } from './exercises.js'

const done = (d, id, reps, sets = 3) => ({ d, entries: [{ id, target: { id, sets, reps, prog: 'ladder', weight: 0 }, sets: Array.from({ length: sets }, () => ({ w: 0, r: reps, done: true })) }] })

describe('ladders', () => {
  it('every built-in rung is a catalogue exercise, easiest first', () => {
    for (const l of LADDERS) {
      expect(l.steps.length).toBeGreaterThanOrEqual(4)
      for (const id of l.steps) expect(EXIDX[id], id).toBeTruthy()
    }
    expect(nextRung({}, '0662')).toBe('0283')   // push-up → diamond push-up
    expect(prevRung({}, '0662')).toBe('3211')
    expect(nextRung({}, '0725')).toBe(null)      // one-arm push-up: the top
    expect(nextRung({}, '0025')).toBe(null)      // a barbell lift is in no ladder
  })

  it('your own chain wins for its exercises and can be edited and deleted', () => {
    const s = {}
    const l = saveLadder(s, { name: '  My  push ', steps: ['0662', '0725', '0662'] })
    expect(l.steps).toEqual(['0662', '0725'])
    expect(ownLadders(s)[0].name).toBe('My push')
    expect(nextRung(s, '0662')).toBe('0725')
    expect(allLadders(s)[0].own).toBe(true)
    expect(saveLadder(s, { name: 'x', steps: ['0662'] })).toBe(null)
    saveLadder(s, { id: l.id, name: 'Renamed', steps: ['0493', '0662'] })
    expect(ownLadders(s)).toHaveLength(1)
    expect(ladderOf(s, '0493').ladder.name).toBe('Renamed')
    deleteLadder(s, l.id)
    expect('ladders' in s).toBe(false)
  })

  it('knows the highest rung you logged', () => {
    const push = LADDERS.find(l => l.id === 'push-up')
    expect(reachedRung({ workouts: [] }, push)).toBe(-1)
    expect(reachedRung({ workouts: [done('2026-11-01', '0662', 8)] }, push)).toBe(3)
  })
})

describe('the Skill ladder rule', () => {
  const cfg = { id: '0662', sets: 3, reps: 12, repsMin: 5, weight: 0, bodyweight: true, prog: 'ladder', mode: 'reps' }
  it('is a reps rule', () => { expect(POLICIES_FOR.reps).toContain('ladder'); expect(POLICIES_FOR.time).not.toContain('ladder') })

  it('starts at the bottom, climbs a rep per clean session, repeats a miss', () => {
    expect(nextPrescription({ workouts: [] }, cfg)).toMatchObject({ kind: 'first', reps: 5 })
    expect(nextPrescription({ workouts: [done('2026-11-01', '0662', 8)] }, cfg)).toMatchObject({ kind: 'up', reps: 9 })
    const miss = done('2026-11-01', '0662', 8)
    miss.entries[0].sets[2].r = 6
    expect(nextPrescription({ workouts: [miss] }, cfg)).toMatchObject({ kind: 'hold', reps: 8 })
  })

  it('at the top names the next rung, and at the last rung holds', () => {
    const p = nextPrescription({ workouts: [done('2026-11-01', '0662', LADDER_TOP)] }, cfg)
    expect(p).toMatchObject({ kind: 'ladder', next: '0283', reps: 12 })
    const last = nextPrescription({ workouts: [done('2026-11-01', '0725', 12)] }, { ...cfg, id: '0725' })
    expect(last.kind).toBe('hold')
    expect(last.next).toBeUndefined()
  })
})
