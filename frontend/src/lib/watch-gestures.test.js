// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { actionsFor, pageAt, setupState, testState, TEST_WAIT_MS } from './watch-gestures.js'
import { readGestureState, writeGestureState, noteGestureEvent } from './watch-settings.js'

beforeEach(() => localStorage.clear())

describe('which actions each input offers', () => {
  it('Smart first; Show metrics and Next exercise (no button on screen) for the Action Button only', () => {
    const dt = actionsFor('doubleTap').map(a => a.id), ab = actionsFor('actionButton').map(a => a.id)
    expect(dt[0]).toBe('smart')
    expect(ab[0]).toBe('smart')
    expect(dt).toHaveLength(6)
    expect(dt).not.toContain('showMetrics')
    expect(dt).not.toContain('nextExercise')
    expect(ab).toContain('showMetrics')
    expect(ab).toHaveLength(8)
  })
})

describe('the carousel', () => {
  it('finds the page it rests on, left to right or right to left, and survives no width', () => {
    expect(pageAt(0, 340, 7)).toBe(0)
    expect(pageAt(340 * 2 + 50, 340, 7)).toBe(2)
    expect(pageAt(-340 * 3, 340, 7)).toBe(3)
    expect(pageAt(99999, 340, 7)).toBe(6)
    expect(pageAt(10, 0, 7)).toBe(0)
  })
})

describe('the Action Button setup', () => {
  it('says working only once a press has been seen, done on the lifter’s word, else to do', () => {
    expect(setupState(readGestureState())).toBe('todo')
    writeGestureState({ setup: true })
    expect(setupState(readGestureState())).toBe('done')
    noteGestureEvent({ type: 'actionButtonSeen', at: 50 })
    expect(setupState(readGestureState())).toBe('working')
  })
})

describe('the test ping', () => {
  it('waits, then works or times out calmly', () => {
    expect(testState(0, 0, 10)).toBe('idle')
    expect(testState(1000, 0, 1000 + 5000)).toBe('waiting')
    expect(testState(1000, 0, 1000 + TEST_WAIT_MS + 1)).toBe('timeout')
    expect(testState(1000, 1000, 1500)).toBe('ok')
    expect(testState(1000, 900, 1500)).toBe('waiting')   // an older answer is not this test's
    expect(testState(1000, 1200, 99999)).toBe('ok')
  })
  it('the watch’s answer is kept by its stamp, falling back to its time, and never goes backwards', () => {
    noteGestureEvent({ type: 'gestureTestOk', stamp: 2000, at: 2500 })
    expect(readGestureState().testOk).toBe(2000)
    noteGestureEvent({ type: 'gestureTestOk', at: 3000 })
    expect(readGestureState().testOk).toBe(3000)
    noteGestureEvent({ type: 'gestureTestOk', stamp: 100 })
    expect(readGestureState().testOk).toBe(3000)
    noteGestureEvent({ type: 'gestureTestOk' })
    noteGestureEvent({ type: 'other', at: 9 })
    expect(readGestureState()).toEqual({ setup: false, testOk: 3000, seenAt: 0 })
  })
  it('reads a broken store as nothing known', () => {
    localStorage.setItem('gym_watch_gesture_v1', '{nope')
    expect(readGestureState()).toEqual({ setup: false, testOk: 0, seenAt: 0 })
    localStorage.setItem('gym_watch_gesture_v1', JSON.stringify({ setup: 'yes', testOk: -4, seenAt: 'x' }))
    expect(readGestureState()).toEqual({ setup: false, testOk: 0, seenAt: 0 })
  })
})
