// @vitest-environment happy-dom
// #759: the weekly rate on the body-weight card, and the corridor it is held against.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { isoOf } from '../lib/format.js'
import WeightRate, { rateGoalSheet } from './WeightRate.jsx'

const mounted = []
function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(node))
  return host
}
const topSheet = () => { const sheet = useUI.getState().sheets.at(-1); return render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) }
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

// Losing 0.1 kg a day, weighed every other day for three weeks: -0.7 kg a week, about -0.85 %.
const days = i => isoOf(new Date(Date.now() - i * 86400000))
const cut = Array.from({ length: 11 }, (_, k) => ({ d: days(20 - 2 * k), w: Math.round((84 - 0.2 * k) * 10) / 10, t: 1 }))
const install = patch => useStore.setState({ S: { ...structuredClone(DEF), unit: 'kg', bodyweight: cut, ...patch }, user: null })
const Card = () => { const S = useStore(s => s.S); return <WeightRate S={S} /> }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toast: vi.fn() })
  install({})
})
afterEach(() => { act(() => mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() })) })

describe('weekly rate on the body-weight card', () => {
  it('shows the trend in the profile unit and in percent', () => {
    const host = render(<Card />)
    expect(host.querySelector('.bw-rate').textContent).toMatch(/Trend -0\.7 kg a week \(-0\.8\d %\)/)
  })

  it('stays out of the way with too few weigh-ins and no corridor', () => {
    install({ bodyweight: cut.slice(0, 3) })
    expect(render(<Card />).querySelector('.bw-rate')).toBeNull()
  })

  it('says whether a cut is on pace', () => {
    install({ rateGoal: { dir: 'lose', by: '%', lo: 0.5, hi: 1 } })
    expect(render(<Card />).querySelector('.bw-rate b').textContent).toBe('On pace')
    install({ rateGoal: { dir: 'lose', by: 'w', lo: 0.25, hi: 0.5 } })
    expect(render(<Card />).querySelector('.bw-rate b').textContent).toBe('Losing faster than planned')
    install({ rateGoal: { dir: 'gain', by: '%', lo: 0.25, hi: 0.5 } })
    expect(render(<Card />).querySelector('.bw-rate b').textContent).toBe('Slower than planned')
  })

  it('in pounds, says pounds', () => {
    install({ unit: 'lb', bodyweight: cut.map(b => ({ ...b, w: Math.round(b.w * 22.046) / 10 })) })
    expect(render(<Card />).querySelector('.bw-rate').textContent).toMatch(/Trend -1\.5\d? lb a week/)
  })

  it('sets a corridor from the sheet, and removes it again', () => {
    const host = render(<Card />)
    act(() => host.querySelector('.bw-rate').click())
    const sheet = topSheet()
    act(() => button(sheet, 'Gain').click())
    act(() => button(sheet, 'kg').click())
    type(sheet.querySelector('input[aria-label="From"]'), '0.1')
    type(sheet.querySelector('input[aria-label="To"]'), '0.25')
    act(() => button(sheet, 'Save').click())
    expect(useStore.getState().S.rateGoal).toEqual({ dir: 'gain', by: 'w', lo: 0.1, hi: 0.25 })
    expect(host.querySelector('.bw-rate b').textContent).toBe('Slower than planned')

    rateGoalSheet()
    const again = topSheet()
    expect(again.querySelector('input[aria-label="From"]').value).toBe('0.1')
    act(() => button(again, 'Remove range').click())
    expect(useStore.getState().S.rateGoal).toBeNull()
  })

  it('a hold keeps within plus or minus one number', () => {
    rateGoalSheet()
    const sheet = topSheet()
    act(() => button(sheet, 'Hold').click())
    type(sheet.querySelector('input[aria-label="Within ±"]'), '0.25')
    act(() => button(sheet, 'Save').click())
    expect(useStore.getState().S.rateGoal).toEqual({ dir: 'hold', by: '%', lo: 0, hi: 0.25 })
  })
})
