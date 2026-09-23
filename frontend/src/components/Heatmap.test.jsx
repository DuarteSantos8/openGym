// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Heatmap from './Heatmap.jsx'
import { isoOf } from '../lib/format.js'
import { workoutDay } from '../lib/history.js'

let root, host
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

it('changes shading and legend by metric while retaining day actions and history', () => {
  const now = new Date(), workouts = [1, 2, 3, 4].map((n, i) => {
    const d = new Date(now); d.setDate(d.getDate() - n)
    return { d: isoOf(d), start: +d, end: +d + n * 60000, vol: (4 - i) * 100 }
  })
  const S = { workouts, unit: 'kg' }, before = structuredClone(S), onDay = vi.fn(), onMetricChange = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Heatmap S={S} onDay={onDay} onMetricChange={onMetricChange} />))
  const first = () => [...host.querySelectorAll('.hm-c[title]')].find(e => e.title.startsWith(workouts[0].d))
  expect(first().classList.contains('l1')).toBe(true)
  act(() => [...host.querySelectorAll('button')].find(e => e.textContent === 'Volume').click())
  expect(first().classList.contains('l4')).toBe(true); expect(host.textContent).toContain('More volume')
  expect(onMetricChange).toHaveBeenCalledWith('vol')
  act(() => first().click()); expect(onDay).toHaveBeenCalledWith(workouts[0].d)
  expect(S).toEqual(before)
})

it('uses the local session day and canonical completed volume', () => {
  const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(8, 0, 0, 0)
  const day = isoOf(start)
  const workout = {
    d: 'not-a-day', start: +start, end: +start + 15 * 60000, vol: 999,
    entries: [{ sets: [
      { w: 100, r: 10, done: true, phase: 'warmup' },
      { w: 14, r: 16, done: true, sides: {
        L: { w: 14, r: 10, done: true }, R: { w: 12.5, r: 6, done: true },
      } },
    ] }],
  }
  expect(workoutDay(workout)).toBe(day)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Heatmap S={{ workouts: [workout], unit: 'lb' }} />))
  const cell = () => [...host.querySelectorAll('.hm-c[title]')].find(e => e.title.startsWith(day))
  expect(cell().title).toContain('15 min · 215 lb')
  act(() => [...host.querySelectorAll('button')].find(e => e.textContent === 'Volume').click())
  expect(cell().classList.contains('l4')).toBe(true)
})

it('keeps a valid saved day ahead of a mismatched timestamp', () => {
  const timestamp = new Date(); timestamp.setDate(timestamp.getDate() - 2)
  const savedDay = isoOf(new Date(timestamp)); timestamp.setDate(timestamp.getDate() - 1)
  expect(workoutDay({ d: savedDay, start: +timestamp })).toBe(savedDay)
})

it('leaves malformed history out of the activity map', () => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Heatmap S={{ workouts: [{ d: 'not-a-day', start: NaN, end: NaN, vol: 100 }], unit: 'kg' }} />))
  expect(host.querySelectorAll('.hm-grid .hm-c:not(.l0)')).toHaveLength(0)
})

it('honors a saved volume preference on the next render', () => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Heatmap S={{ workouts: [], unit: 'kg', heatmapMetric: 'vol' }} />))
  expect(host.textContent).toContain('More volume')
  expect([...host.querySelectorAll('button')].find(e => e.textContent === 'Volume').getAttribute('aria-pressed')).toBe('true')
})

const baseS = { workouts: [], unit: 'kg' }
const render = weekStart => {
  if (!host) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) }
  act(() => root.render(<Heatmap S={{ ...baseS, weekStart }} onDay={() => {}} />))
}
const dayLabels = () => [...host.querySelectorAll('.hm-days span')].map(s => s.textContent)
const lastColumn = () => {
  const cols = host.querySelectorAll('.hm-grid .hm-col')
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

it.each([0, 1])('retains week start %i when switching the activity metric', weekStart => {
  render(weekStart)
  const firstDay = lastColumn()[0].title.slice(0, 10)
  const labels = dayLabels()
  act(() => [...host.querySelectorAll('button')].find(e => e.textContent === 'Volume').click())
  expect(lastColumn()[0].title.slice(0, 10)).toBe(firstDay)
  expect(new Date(firstDay + 'T12:00:00').getDay()).toBe(weekStart)
  expect(dayLabels()).toEqual(labels)
  expect(host.textContent).toContain('More volume')
})
