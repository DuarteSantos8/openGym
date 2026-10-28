import { describe, it, expect } from 'vitest'
import { splitState, joinDocs, splitHashes, docIdFor, keyForDocId } from './firestore-model.js'

const S = {
  unit: 'kg', week: { 1: 'r1' }, dayPlan: {}, exWeights: { 'fx-x': { w: 32.5 } },
  workouts: [{ id: 'w1', d: '2026-10-26', entries: [] }, { d: '2026-10-20', start: '18:00', entries: [] }],
  routines: [{ id: 'r1', name: 'Day 1' }],
  customEx: [{ id: 'fx-x', name: 'Press' }],
  bodyweight: [{ d: '2026-10-27', w: 151 }],
  measurements: [{ d: '2026-10-27', waist: 100 }],
  active: { id: 'live' },
}

describe('firestore-model', () => {
  it('splits lists into per-item docs and keeps the rest in meta', () => {
    const { meta, lists } = splitState(S)
    expect(meta.unit).toBe('kg')
    expect(meta.exWeights).toEqual({ 'fx-x': { w: 32.5 } })
    expect(meta.workouts).toBeUndefined()
    expect(meta.active).toBeUndefined() // the running workout never syncs
    expect([...lists.workouts.keys()].sort()).toEqual(['2026-10-20|18:00', 'w1'])
    expect([...lists.exercises.keys()]).toEqual(['fx-x'])
    expect([...lists.bodyweight.keys()]).toEqual(['2026-10-27'])
    expect([...lists.measurements.keys()]).toEqual(['2026-10-27'])
  })

  it('round-trips through joinDocs', () => {
    const back = joinDocs(splitState(S))
    expect(back.workouts).toHaveLength(2)
    expect(back.routines).toEqual(S.routines)
    expect(back.bodyweight).toEqual(S.bodyweight)
    expect(back.unit).toBe('kg')
    expect(back.active).toBeUndefined()
  })

  it('doc ids are Firestore-safe and reversible', () => {
    for (const k of ['2026-10-20|18:00', 'fx-x', 'a/b', 'w 1']) {
      const id = docIdFor(k)
      expect(id).not.toContain('/')
      expect(keyForDocId(id)).toBe(k)
    }
  })

  it('hashes move only for the entry that changed', () => {
    const a = splitHashes(splitState(S))
    const S2 = { ...S, workouts: [{ ...S.workouts[0], note: 'x' }, S.workouts[1]] }
    const b = splitHashes(splitState(S2))
    expect(b.lists.workouts.get('w1')).not.toBe(a.lists.workouts.get('w1'))
    expect(b.lists.workouts.get('2026-10-20|18:00')).toBe(a.lists.workouts.get('2026-10-20|18:00'))
    expect(b.meta).toBe(a.meta)
  })

  it('drops undefined leaves (Firestore refuses them)', () => {
    const { meta, lists } = splitState({ unit: 'kg', workouts: [{ id: 'w', note: undefined }] })
    expect(JSON.stringify(meta)).not.toContain('undefined')
    expect(lists.workouts.get('w')).toEqual({ id: 'w' })
  })
})
