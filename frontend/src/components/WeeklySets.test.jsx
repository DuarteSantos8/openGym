// @vitest-environment happy-dom
// Weekly sets per muscle against a target range: the Stats card, the Home line and the ranges sheet.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { WeeklySetsCard, WeeklySetsHomeLine, muscleTargetsSheet } from './WeeklySets.jsx'

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
const bench = n => ({ id: 'w' + n, d: todayISO(), start: Date.now(), entries: [{ id: BENCH, sets: Array.from({ length: n }, () => ({ w: 60, r: 8, done: true })) }] })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState({ S: { ...structuredClone(DEF), workouts: [bench(12)] }, user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('weekly sets per muscle', () => {
  it('the card shows each main muscle against its range, said in words', () => {
    const host = render(<WeeklySetsCard S={useStore.getState().S} />)
    const rows = [...host.querySelectorAll('.wsets-row')]
    expect(rows).toHaveLength(10)
    expect(rows[0].querySelector('.wsets-num').textContent).toBe('12 / 10–20')
    expect(rows[0].getAttribute('aria-label')).toBe('Chest: 12 sets this week, range 10 to 20, in range')
    expect(host.textContent).toContain('room for more')
  })
  it('the Home line names the muscle with the most room, and says nothing before a set this week', () => {
    let host = render(<WeeklySetsHomeLine S={useStore.getState().S} onOpen={() => {}} />)
    expect(host.textContent).toMatch(/^Most room this week: .+, 0 of \d+–\d+ sets$/)
    host = render(<WeeklySetsHomeLine S={{ ...useStore.getState().S, workouts: [] }} onOpen={() => {}} />)
    expect(host.textContent).toBe('')
  })
  it('a range set in the sheet is the profile’s, and back to the defaults clears it', () => {
    muscleTargetsSheet()
    const sheet = useUI.getState().sheets.at(-1)
    const host = render(sheet.render(() => {}))
    act(() => host.querySelector('[aria-label="Increase Chest: low end"]').click())
    expect(useStore.getState().S.muscleTargets).toEqual({ chest: [11, 20] })
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Back to the defaults').click())
    expect(useStore.getState().S.muscleTargets).toBeUndefined()
  })
})
