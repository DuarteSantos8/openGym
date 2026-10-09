// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest'
import { DEF, useStore } from './useStore.js'
import { mergeStates } from '../lib/sync-merge.js'
const shared = { id: 'cshared', n: 'Press', custom: true, serverShared: true, _ts: 10, _f: { n: 10 } }
beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: { ...structuredClone(DEF), customEx: [structuredClone(shared)] }, user: null, ready: false })
})
it('a catalogue retirement does not become a newer personal edit or deletion', () => {
  useStore.getState().update(s => { s.customEx[0].serverRetired = true }, false, { stampExercises: false })
  const cached = useStore.getState().S
  expect(cached.customEx[0]._ts).toBe(10)
  expect(cached.customEx[0]._f).toEqual({ n: 10 })
  const privateCopy = { ...cached, customEx: [{ id: 'cshared', custom: true, n: 'Personal press', _ts: 11, _f: { n: 11 }, media: { hash: 'video' } }] }
  expect(mergeStates(cached, privateCopy).customEx[0]).toMatchObject({ n: 'Personal press', media: { hash: 'video' } })
})
it('a user edit retains the upstream field stamps and a time beyond the previous clock', () => {
  useStore.setState(s => ({ S: { ...s.S, _ts: Date.now() + 100000 } }))
  const before = useStore.getState().S._ts
  useStore.getState().update(s => { s.customEx[0].n = 'Edited press' }, false)
  const next = useStore.getState().S
  expect(next.customEx[0]._f.n).toBeGreaterThan(before)
  expect(next.customEx[0]._ts).toBe(next._ts)
})
it('a catalogue refresh still stamps unrelated settings and leaves cached removals without tombstones', () => {
  useStore.getState().update(s => { s.customEx = []; s.keepAwake = false }, false, { stampExercises: false })
  const next = useStore.getState().S
  expect(next.deleted?.customEx?.cshared).toBeUndefined()
  expect(next.edited.keepAwake).toBeGreaterThan(0)
  // persist may advance the document clock after the field has been stamped.
  expect(next.edited.keepAwake).toBeLessThanOrEqual(next._ts)
})
