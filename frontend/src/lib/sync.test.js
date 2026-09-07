import { describe, expect, it } from 'vitest'
import { generationChanged, mergePendingState } from './sync.js'

describe('mergePendingState', () => {
  it('detects edits that arrive after a request snapshot', () => {
    expect(generationChanged(4, 4)).toBe(false)
    expect(generationChanged(4, 5)).toBe(true)
  })

  it('keeps a phone edit and a remote routine addition in one state', () => {
    const base = { routines: [{ id: 'r1', name: 'Push' }], workouts: [] }
    const local = { routines: [{ id: 'r1', name: 'Push (phone)' }], workouts: [{ id: 'w1', d: '2026-09-06' }] }
    const remote = { routines: [{ id: 'r1', name: 'Push' }, { id: 'r2', name: 'AI draft' }], workouts: [] }
    const merged = mergePendingState(base, local, remote)
    expect(merged.routines).toEqual([{ id: 'r1', name: 'Push (phone)' }, { id: 'r2', name: 'AI draft' }])
    expect(merged.workouts).toEqual(local.workouts)
  })

  it('retains active device work while merging server state', () => {
    const active = { id: 'active-1', entries: [{ id: '0001', sets: [{ r: 5 }] }] }
    const merged = mergePendingState({}, { active }, { routines: [{ id: 'r1' }] })
    expect(merged.active).toEqual(active)
    expect(merged.routines).toEqual([{ id: 'r1' }])
  })

  it('handles concurrent deletions without undefined array members', () => {
    const base = { routines: [{ id: 'r1', name: 'Push' }, { id: 'r2', name: 'Pull' }] }
    expect(mergePendingState(base, { routines: [{ id: 'r2', name: 'Pull' }] }, base).routines)
      .toEqual([{ id: 'r2', name: 'Pull' }])
    expect(mergePendingState(base, base, { routines: [{ id: 'r1', name: 'Push' }] }).routines)
      .toEqual([{ id: 'r1', name: 'Push' }])
    const conflict = mergePendingState(base, { routines: [{ id: 'r2', name: 'Pull (phone)' }] }, { routines: [{ id: 'r1', name: 'Push' }] })
    expect(conflict.routines).toEqual([{ id: 'r1', name: 'Push' }, { id: 'r2', name: 'Pull (phone)' }])
    expect(conflict.routines.every(Boolean)).toBe(true)
  })
})
