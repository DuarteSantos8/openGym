// @vitest-environment happy-dom
// QA 1.4.5: the Daily form card on Stats walked the whole workout history (form-insights.js
// workoutPerformance, ~120 ms over 2,000 workouts) on every visit, also when it only showed the
// one-time "Check in before workouts?" offer. Stats spent about 180 ms more on the main thread than
// in 1.4.4 for a long history. Now only the card that shows the comparison computes it, once per
// workout list, and changing the 1RM formula recomputes it (the memo listened to `formula`, a key
// nothing writes).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'

const perfSpy = vi.fn()
vi.mock('../lib/form-insights.js', async orig => {
  const real = await orig()
  return { ...real, workoutPerformance: S => { perfSpy(S); return real.workoutPerformance(S) } }
})
const { default: DailyFormCard, cachedPerformance } = await import('./DailyFormCard.jsx')

const clone = v => JSON.parse(JSON.stringify(v))
const W = (d, w = 60) => {
  const start = new Date(d + 'T18:00:00').getTime()
  return { id: d, d, start, end: start + 50 * 60000, name: 'Push', routineIds: ['A'], entries: [{ id: '0025', sets: [{ w, r: 8, done: true }] }], prs: [] }
}
const workouts = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'].map(d => W(d))
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  perfSpy.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Daily form card: the history walk only where it is shown', () => {
  it('the one-time offer does not walk the workouts', () => {
    const S = { ...clone(DEF), workouts: clone(workouts) }
    act(() => root.render(<DailyFormCard S={S} />))
    expect(host.querySelector('[data-daily-form="offer"]')).toBeTruthy()
    expect(perfSpy).not.toHaveBeenCalled()
  })
  it('switched off ("Not for me") and nothing logged: no card, no walk', () => {
    const S = { ...clone(DEF), workouts: clone(workouts), dailyForm: false }
    act(() => root.render(<DailyFormCard S={S} />))
    expect(host.innerHTML).toBe('')
    expect(perfSpy).not.toHaveBeenCalled()
  })
  it('switched on: computed once per workout list, again for a new 1RM formula', () => {
    const S = { ...clone(DEF), workouts: clone(workouts), dailyForm: true }
    act(() => root.render(<DailyFormCard S={S} />))
    act(() => root.unmount()); root = createRoot(host)
    act(() => root.render(<DailyFormCard S={S} />))
    expect(perfSpy).toHaveBeenCalledTimes(1)
    cachedPerformance({ ...S, oneRmFormula: 'brzycki' })
    expect(perfSpy).toHaveBeenCalledTimes(2)
    cachedPerformance({ ...S, workouts: [...S.workouts] })
    expect(perfSpy).toHaveBeenCalledTimes(3)
  })
})
void useStore
