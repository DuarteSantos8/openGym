// @vitest-environment happy-dom
// The heatmap used to hardcode Monday-first weeks. It should follow S.weekStart like every
// other "this week" surface (see lib/week-start.test.js and views/week-start.test.jsx).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Heatmap from './Heatmap.jsx'
import { isoOf } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container, root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const baseS = { workouts: [], unit: 'kg' }
const render = weekStart => act(() => root.render(<Heatmap S={{ ...baseS, weekStart }} onDay={() => {}} />))
const dayLabels = () => [...container.querySelectorAll('.hm-days span')].map(s => s.textContent)
const lastColumn = () => {
  const cols = container.querySelectorAll('.hm-grid .hm-col')
  return [...cols[cols.length - 1].querySelectorAll('.hm-c')]
}

describe('Heatmap — week start', () => {
  it('rows read Mon/Wed/Fri for a Monday-first week (default)', () => {
    render(undefined)
    expect(dayLabels()).toEqual(['Mon', '', 'Wed', '', 'Fri', '', ''])
  })

  it('shifts the same three labels down a row for a Sunday-first week', () => {
    render(0)
    expect(dayLabels()).toEqual(['', 'Mon', '', 'Wed', '', 'Fri', ''])
  })

  it('the current (rightmost) column starts on the chosen week-start day and includes today', () => {
    render(1)
    let cells = lastColumn()
    expect(new Date(cells[0].title.slice(0, 10) + 'T12:00:00').getDay()).toBe(1)
    expect(cells.map(c => c.title.slice(0, 10))).toContain(isoOf(new Date()))

    render(0)
    cells = lastColumn()
    expect(new Date(cells[0].title.slice(0, 10) + 'T12:00:00').getDay()).toBe(0)
    expect(cells.map(c => c.title.slice(0, 10))).toContain(isoOf(new Date()))
  })
})
