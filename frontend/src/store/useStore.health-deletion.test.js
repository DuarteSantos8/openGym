// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../lib/apple-health.js', () => ({ queueAppleHealthWorkoutDeletion: vi.fn() }))
import { queueAppleHealthWorkoutDeletion } from '../lib/apple-health.js'
import { DEF, useStore } from './useStore.js'
const one = { id: 'one', start: 1000, end: 2000, entries: [], prs: [] }
const two = { ...one, id: 'two' }
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  useStore.setState({ S: { ...structuredClone(DEF), workouts: [one, two] }, user: null, ready: false })
})
it('only queues the explicitly selected record when it is actually removed', () => {
  useStore.getState().update(s => { s.workouts = [two] }, false, { deletedHealthWorkout: one })
  expect(queueAppleHealthWorkoutDeletion).toHaveBeenCalledOnce()
  expect(queueAppleHealthWorkoutDeletion.mock.calls[0][1]).toEqual(one)
})
it('never queues deletions on a generic history replacement', () => {
  useStore.getState().update(s => { s.workouts = [] }, false)
  expect(queueAppleHealthWorkoutDeletion).not.toHaveBeenCalled()
})
it('ignores a request for a record not present before the update', () => {
  useStore.getState().update(s => { s.workouts = [] }, false, { deletedHealthWorkout: { ...one, id: 'missing' } })
  expect(queueAppleHealthWorkoutDeletion).not.toHaveBeenCalled()
})
it('does not queue a deletion if that record remains present', () => {
  useStore.getState().update(s => { s.workouts = [one] }, false, { deletedHealthWorkout: one })
  expect(queueAppleHealthWorkoutDeletion).not.toHaveBeenCalled()
})
it('queues an explicit deletion from the empty workout editor', () => {
  useStore.setState(s => ({ S: { ...s.S, active: { editingWorkoutId: 'one', entries: [] } } }))
  expect(useStore.getState().deleteHistoryEdit()).toBe(true)
  expect(queueAppleHealthWorkoutDeletion.mock.calls[0][1]).toEqual(one)
  expect(useStore.getState().S.workouts).toEqual([two])
})
