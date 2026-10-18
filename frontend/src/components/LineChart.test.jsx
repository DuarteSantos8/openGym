// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LineChart from './LineChart.jsx'
import { fmtDate, isoOf } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const point = (year, month, day, y) => ({
  d: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  t: new Date(year, month - 1, day, 12).getTime(),
  y
})

const firstPoints = [
  { t: Date.UTC(2026, 0, 1), y: 80, d: '2026-01-01' },
  { t: Date.UTC(2026, 0, 15), y: 82, d: '2026-01-15' },
]
const nextPoints = [
  { t: Date.UTC(2026, 1, 1), y: 78, d: '2026-02-01' },
  { t: Date.UTC(2026, 1, 15), y: 79, d: '2026-02-15' },
]

function renderChart(points) {
  act(() => root.render(<LineChart points={points} axes={false} unit="kg" />))
}

function hoverAt(clientX) {
  act(() => {
    container.querySelector('.chart-i').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX }))
  })
  return container.querySelector('.ctip').textContent
}

describe('LineChart hover date', () => {
  it('keeps same-year points in the compact format', () => {
    const first = point(2026, 1, 15, 70)
    renderChart([first, point(2026, 2, 15, 71)])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true)} · 70 kg`)
  })

  it('includes the calendar year at a short cross-year boundary', () => {
    const first = point(2025, 11, 30, 70)
    const last = point(2026, 2, 1, 71)
    renderChart([first, last])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true, true)} · 70 kg`)
    expect(hoverAt(340)).toBe(`${fmtDate(last.d, true, true)} · 71 kg`)
  })

  it('keeps a single point compact', () => {
    const only = point(2026, 7, 4, 70)
    renderChart([only])

    expect(hoverAt(170)).toBe(`${fmtDate(only.d, true)} · 70 kg`)
  })

  it('uses timestamp-only points when deciding whether to show the year', () => {
    const first = point(2025, 12, 31, 70)
    const last = point(2026, 1, 1, 71)
    const timestampOnly = [{ t: first.t, y: first.y }, { t: last.t, y: last.y }]
    renderChart(timestampOnly)

    const lastIso = isoOf(new Date(last.t))
    expect(hoverAt(340)).toBe(`${fmtDate(lastIso, true, true)} · 71 kg`)
  })
})

describe('LineChart hover state', () => {
  it('clears the tooltip and hover markers when points are replaced, then allows hovering again', () => {
    renderChart(firstPoints)
    hoverAt(170)

    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
    expect(container.querySelector('.chl')).toBeTruthy()

    renderChart(nextPoints)

    expect(container.querySelector('.ctip')).toBeNull()
    expect(container.querySelector('.cvl')).toBeNull()
    expect(container.querySelector('.chl')).toBeNull()

    hoverAt(170)
    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
  })
})

describe('LineChart y axis', () => {
  it('labels the zero line 0, never -0, when the range dips just below zero', () => {
    act(() => root.render(<LineChart points={[point(2026, 1, 1, 70), point(2026, 1, 8, 9999)]} axes unit="kg" />))
    const labels = [...container.querySelectorAll('text')].map(n => n.textContent)
    expect(labels).toContain('0')
    expect(labels.some(l => /^[-\u2212]0$/.test(l))).toBe(false)
  })
})

describe('LineChart x axis', () => {
  // The date labels under the plot, left to right (the y labels sit at the left edge, end-anchored).
  const xLabels = (points, h = 150) => {
    act(() => root.render(<LineChart points={points} h={h} axes unit="kg" />))
    return [...container.querySelectorAll('text')].filter(n => n.getAttribute('y') === String(h - 7)).map(n => n.textContent)
  }
  const at = (year, month, day, hour, y) => ({ t: new Date(year, month - 1, day, hour).getTime(), y })

  it('writes each date once over a span of two days', () => {
    expect(xLabels([at(2026, 10, 16, 10, 50), at(2026, 10, 17, 18, 60)])).toEqual(['16 Oct', '17 Oct'])
  })

  it('writes one date for a span inside one day', () => {
    expect(xLabels([at(2026, 10, 16, 9, 50), at(2026, 10, 16, 19, 60)])).toEqual(['16 Oct'])
  })

  it('keeps three dates when they differ', () => {
    expect(xLabels([at(2026, 10, 1, 12, 50), at(2026, 10, 15, 12, 60)])).toEqual(['1 Oct', '8 Oct', '15 Oct'])
  })

  it('gives the months their year over more than a year, and not within one', () => {
    const long = xLabels([at(2025, 3, 18, 12, 50), at(2026, 10, 17, 12, 60)])
    expect(long[0]).toBe("Apr '25")
    expect(long.at(-1)).toBe("Oct '26")
    expect(new Set(long).size).toBe(long.length)
    expect(xLabels([at(2025, 10, 20, 12, 50), at(2026, 9, 30, 12, 60)]).every(l => !l.includes("'"))).toBe(true)
  })

  it('gives the months their year at exactly 366 days, where Apr comes round again', () => {
    const edge = xLabels([at(2025, 3, 31, 0, 50), at(2026, 4, 1, 0, 60)])
    expect(edge[0]).toBe("Apr '25")
    expect(edge.at(-1)).toBe("Apr '26")
    expect(new Set(edge).size).toBe(edge.length)
  })
})
