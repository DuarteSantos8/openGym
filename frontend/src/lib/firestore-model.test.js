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

// Two workouts with no id and the same day+start used to share the fallback key
// `${d}|${start}` and collapse into a single Firestore doc: 2 workouts in, 1 doc
// out. The first keeps the plain key; repeats take an occurrence suffix. Keys
// for id-carrying workouts are untouched.
const noId = (note) => ({ d: '2026-10-20', start: '18:00', entries: [], ...(note ? { note } : {}) })

describe('splitState workout doc keys', () => {
  it('a lone id-less workout keeps the plain fallback key', () => {
    const { lists } = splitState({ workouts: [noId()] })
    expect([...lists.workouts.keys()]).toEqual(['2026-10-20|18:00'])
  })

  it('two id-less workouts with the same day+start stay two docs', () => {
    const { lists } = splitState({ workouts: [noId('first'), noId('second')] })
    expect([...lists.workouts.keys()]).toEqual(['2026-10-20|18:00', '2026-10-20|18:00#2'])
    expect(lists.workouts.get('2026-10-20|18:00').note).toBe('first')
    expect(lists.workouts.get('2026-10-20|18:00#2').note).toBe('second')
    const back = joinDocs(splitState({ workouts: [noId('first'), noId('second')] }))
    expect(back.workouts).toHaveLength(2)
    expect(back.workouts.map(w => w.note).sort()).toEqual(['first', 'second'])
  })

  it('even fully identical id-less workouts stay separate docs', () => {
    const { lists } = splitState({ workouts: [noId(), noId(), noId()] })
    expect([...lists.workouts.keys()]).toEqual(['2026-10-20|18:00', '2026-10-20|18:00#2', '2026-10-20|18:00#3'])
  })

  it('id-carrying workouts keep their exact keys, duplicates included', () => {
    const { lists } = splitState({ workouts: [{ id: 'w1', note: 'a' }, { id: 'w1', note: 'b' }] })
    expect([...lists.workouts.keys()]).toEqual(['w1'])
    expect(lists.workouts.get('w1').note).toBe('b') // overwrite by id, as before
  })

  it('an id-less workout next to an id-carrying one on the same day is unaffected', () => {
    const { lists } = splitState({ workouts: [{ id: 'w9', d: '2026-10-20', start: '18:00', entries: [] }, noId()] })
    expect([...lists.workouts.keys()].sort()).toEqual(['2026-10-20|18:00', 'w9'])
  })
})
