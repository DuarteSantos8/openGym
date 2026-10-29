// @vitest-environment happy-dom
// Strength level per lift: the exercise-details block, the Stats card, hidden without a weigh-in,
// and the About you sheet that the levels read.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { StrengthLevelBlock, StrengthLevelsCard, aboutYouSheet } from './StrengthLevel.jsx'

const BENCH = '0025'
const mounted = []
const render = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const seed = extra => useStore.setState({ S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [{ id: 'w', d: '2026-10-02', start: 1, entries: [{ id: BENCH, target: { mode: 'reps' }, sets: [{ w: 100, r: 1, done: true }] }] }], ...extra }, user: null })
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; useUI.setState({ sheets: [] }); seed() })
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('strength level per lift', () => {
  it('shows the level, the ratio and the next step, with the men’s-table hint until sex is set', () => {
    const host = render(<StrengthLevelBlock exId={BENCH} />)
    expect(host.querySelector('.slevel-name').textContent).toBe('Intermediate lifter')
    expect(host.textContent).toContain('1.25 × body weight')
    expect(host.textContent).toContain('Advanced lifter from an estimated 1RM of 120 kg')
    expect(host.querySelectorAll('.slevel-bar .on')).toHaveLength(3)
    expect(host.textContent).toContain('Using the men’s table')
  })
  it('is hidden without a weigh-in, and for a lift with no standard', () => {
    seed({ bodyweight: [] })
    expect(render(<StrengthLevelBlock exId={BENCH} />).textContent).toBe('')
    expect(render(<StrengthLevelsCard S={useStore.getState().S} />).textContent).toBe('')
    seed()
    expect(render(<StrengthLevelBlock exId="0001" />).textContent).toBe('')
  })
  it('the Stats card lists the lifts; About you sets the sex the levels read', () => {
    expect(render(<StrengthLevelsCard S={useStore.getState().S} />).querySelectorAll('.slevel-row')).toHaveLength(1)
    aboutYouSheet()
    const sheet = useUI.getState().sheets.at(-1)
    const host = render(sheet.render(() => {}))
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Female').click())
    expect(useStore.getState().S.sex).toBe('female')
    expect(render(<StrengthLevelBlock exId={BENCH} />).querySelector('.slevel-name').textContent).toBe('Advanced lifter')
  })
})
