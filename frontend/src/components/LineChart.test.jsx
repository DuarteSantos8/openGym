// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
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

// A chart is the only place these numbers exist, and it is drawn as shapes: without a name and a
// spoken run of the line, a screen reader hears the axis ticks and nothing else. The values are
// otherwise reachable only by hovering, which needs a pointer. (CONTRIBUTING: "Accessibility passes
// on the workout and chart screens".) StackBar already does this with role="img" + aria-label.
describe('LineChart accessible name', () => {
  const label = () => {
    const svg = container.querySelector('svg')
    return { role: svg.getAttribute('role'), label: svg.getAttribute('aria-label') }
  }

  it('names the chart and says where the line runs', () => {
    act(() => root.render(<LineChart points={firstPoints} axes={false} unit="kg" ariaLabel="Body weight" />))
    const { role, label: aria } = label()
    expect(role).toBe('img')
    expect(aria.startsWith('Body weight: ')).toBe(true)
    // both endpoints, date and value, so the shape of the line comes across
    expect(aria).toContain(fmtDate('2026-01-01', true))
    expect(aria).toContain('80 kg')
    expect(aria).toContain(fmtDate('2026-01-15', true))
    expect(aria).toContain('82 kg')
  })

  it('says one value for one point, instead of a range from it to itself', () => {
    act(() => root.render(<LineChart points={[firstPoints[0]]} axes={false} unit="kg" ariaLabel="Body weight" />))
    const { label: aria } = label()
    expect(aria.match(/80 kg/g)).toHaveLength(1)
    expect(aria).not.toContain(' to ')
  })

  it('adds the goal it draws, and the year when the span crosses one', () => {
    act(() => root.render(<LineChart points={firstPoints} axes={false} unit="kg" goal={75} ariaLabel="Body weight" />))
    expect(label().label).toContain('75 kg')
    const across = [{ t: Date.UTC(2025, 10, 30), y: 80, d: '2025-11-30' }, { t: Date.UTC(2026, 0, 15), y: 82, d: '2026-01-15' }]
    act(() => root.render(<LineChart points={across} axes={false} unit="kg" ariaLabel="Body weight" />))
    expect(label().label).toContain(fmtDate('2025-11-30', true, true))
  })

  it('says the shared days once for several lines, then only each line’s own values', () => {
    const sys = [{ t: Date.UTC(2026, 0, 1), y: 120, d: '2026-01-01' }, { t: Date.UTC(2026, 0, 15), y: 118, d: '2026-01-15' }]
    const dia = [{ t: Date.UTC(2026, 0, 1), y: 80, d: '2026-01-01' }, { t: Date.UTC(2026, 0, 15), y: 79, d: '2026-01-15' }]
    act(() => root.render(<LineChart points={sys} axes={false} unit="mmHg" ariaLabel="Blood pressure"
      series={[{ points: sys, color: 'var(--red)', label: 'Systolic' }, { points: dia, color: 'var(--blue)', label: 'Diastolic' }]} />))
    const { label: aria } = label()
    expect(aria).toContain('Systolic')
    expect(aria).toContain('Diastolic')
    expect(aria.indexOf('Systolic')).toBeLessThan(aria.indexOf('Diastolic'))
    // the two days appear once, in the span, not twice per line
    expect(aria.match(/1 Jan/g)).toHaveLength(1)
    expect(aria.match(/15 Jan/g)).toHaveLength(1)
    expect(aria).toContain('Systolic 120 mmHg to 118 mmHg')
    expect(aria).toContain('Diastolic 80 mmHg to 79 mmHg')
  })

  it('says the day once when several lines share a single day, though not one instant', () => {
    // Two sessions on one day are two timestamps but one day: what the per-set chart really gets.
    const at = h => [{ t: Date.UTC(2026, 0, 15, 8 + h), y: 100, d: '2026-01-15' }, { t: Date.UTC(2026, 0, 15, 9 + h), y: 110, d: '2026-01-15' }]
    act(() => root.render(<LineChart points={at(0)} axes={false} unit="kg" ariaLabel="Per set"
      series={[{ points: at(0), color: 'var(--red)', label: 'Set 1' }, { points: at(4), color: 'var(--blue)', label: 'Set 2' }]} />))
    const { label: aria } = label()
    expect(aria.match(/15 Jan/g)).toHaveLength(1)
    expect(aria).toContain('(' + fmtDate('2026-01-15', true) + ')')
    expect(aria).toContain('Set 1 100 kg to 110 kg')
  })

  it('spans the widest line, not whichever series comes first', () => {
    const short = [{ t: Date.UTC(2026, 0, 5), y: 10, d: '2026-01-05' }, { t: Date.UTC(2026, 0, 10), y: 12, d: '2026-01-10' }]
    const long = [{ t: Date.UTC(2026, 0, 1), y: 5, d: '2026-01-01' }, { t: Date.UTC(2026, 0, 20), y: 7, d: '2026-01-20' }]
    act(() => root.render(<LineChart points={short} axes={false} unit="kg" ariaLabel="Per set"
      series={[{ points: short, color: 'var(--red)', label: 'Set 1' }, { points: long, color: 'var(--blue)', label: 'Set 2' }]} />))
    const { label: aria } = label()
    expect(aria).toContain('(' + fmtDate('2026-01-01', true) + ' to ' + fmtDate('2026-01-20', true) + ')')
  })

  // A blood-pressure entry may hold the top number without the bottom one: measurementSeries drops
  // the missing key, so the second series arrives empty. The chart draws nothing for it, and the
  // name must not reach for a value that is not there.
  it('leaves a series with no points out of the name instead of reaching for a value', () => {
    const sys = [{ t: Date.UTC(2026, 0, 1), y: 120, d: '2026-01-01' }, { t: Date.UTC(2026, 0, 15), y: 118, d: '2026-01-15' }]
    act(() => root.render(<LineChart points={sys} axes={false} unit="mmHg" ariaLabel="Blood pressure"
      series={[{ points: sys, color: 'var(--red)', label: 'Systolic' }, { points: [], color: 'var(--blue)', label: 'Diastolic' }]} />))
    const { role, label: aria } = label()
    expect(role).toBe('img')
    expect(aria).toContain('Systolic 120 mmHg to 118 mmHg')
    expect(aria).not.toContain('Diastolic')
  })

  it('names the chart alone when no series has a point', () => {
    const anchors = [{ t: Date.UTC(2026, 0, 1), y: 120, d: '2026-01-01' }]
    act(() => root.render(<LineChart points={anchors} axes={false} unit="mmHg" ariaLabel="Blood pressure"
      series={[{ points: [], color: 'var(--red)', label: 'Systolic' }, { points: [], color: 'var(--blue)', label: 'Diastolic' }]} />))
    expect(label().label).toBe('Blood pressure')
  })

  // The year is said when the span crosses one. The flag comes from the points the hover walks,
  // and a lone diastolic reading (the CSV import does not check the pair) sits in a series but not
  // in those points, so the span can reach a year the flag has never seen: two dates a year apart
  // then read as one day.
  it('says the year when only a series reaches into another one', () => {
    const sys = [{ t: Date.UTC(2026, 0, 5), y: 120, d: '2026-01-05' }, { t: Date.UTC(2026, 0, 20), y: 118, d: '2026-01-20' }]
    const dia = [{ t: Date.UTC(2025, 0, 5), y: 80, d: '2025-01-05' }]
    act(() => root.render(<LineChart points={sys} axes={false} unit="mmHg" ariaLabel="Blood pressure"
      series={[{ points: sys, color: 'var(--red)', label: 'Systolic' }, { points: dia, color: 'var(--blue)', label: 'Diastolic' }]} />))
    const { label: aria } = label()
    expect(aria).toContain('2025')
    expect(aria).toContain('2026')
    // one day, not two dates a year apart collapsed into it
    expect(aria).not.toContain('(5 Jan)')
  })

  it('stays an ordinary svg when nothing names it, rather than an image with no name', () => {
    act(() => root.render(<LineChart points={firstPoints} axes={false} unit="kg" />))
    expect(label().role).toBeNull()
    expect(label().label).toBeNull()
  })

  it('never leaves the drawn axis text to be read on its own next to the name', () => {
    act(() => root.render(<LineChart points={firstPoints} unit="kg" ariaLabel="Body weight" />))
    // role="img" with a name makes the subtree presentational; the ticks must not also be read.
    expect(container.querySelector('svg').getAttribute('aria-hidden')).not.toBe('true')
    expect(container.querySelector('.ctip')).toBeNull()   // the hover tooltip is not a second name
  })
})

// Every chart on screen has to carry a name; a new call site that forgets one is what this stops.
// Walked from the tree rather than a list of files, so a chart added in a new file cannot slip in
// unnamed the way four view files here did (sheets.jsx and five Stats branches were among them).
describe('every LineChart call site names its chart', () => {
  const jsx = (dir) => readdirSync(resolve(process.cwd(), 'src', dir), { withFileTypes: true }).flatMap(d => {
    const name = dir ? dir + '/' + d.name : d.name
    if (d.isDirectory()) return jsx(name)
    return /\.(jsx|js)$/.test(d.name) && !/\.test\./.test(d.name) ? [name] : []
  })
  const files = jsx('').filter(f => readFileSync(resolve(process.cwd(), 'src', f), 'utf8').includes('<LineChart'))

  it('finds the charts, so an empty run is not a pass', () => {
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  for (const f of files) {
    it(f + ' names every chart', () => {
      const src = readFileSync(resolve(process.cwd(), 'src', f), 'utf8')
      const tags = src.match(/<LineChart\b[\s\S]*?\/>/g) || []
      expect(tags.length).toBeGreaterThan(0)
      for (const tag of tags) expect(tag).toMatch(/ariaLabel=\{/)
    })
  }
})
