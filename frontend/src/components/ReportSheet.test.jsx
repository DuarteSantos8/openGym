// @vitest-environment happy-dom
// "Performance report (PDF)": the range picker says what it will cover and hands that range to
// the printout, the four-week default included.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ S: null, printReport: vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S, user: { name: 'Ana' } })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../lib/report-print.js', () => ({ printReport: (...a) => mocks.printReport(...a) }))

const { ReportSheet } = await import('./ReportSheet.jsx')
const { todayISO } = await import('../lib/format.js')
const { reportRange } = await import('../lib/report.js')

let root, host, close
const iso = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

beforeEach(() => {
  mocks.printReport.mockReset()
  mocks.S = { unit: 'kg', workouts: [{ id: 'a', d: iso(2), entries: [] }, { id: 'b', d: iso(20), entries: [] }, { id: 'c', d: iso(60), entries: [] }], bodyweight: [] }
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<ReportSheet close={close} />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const summary = () => host.querySelector('[data-report-summary]').textContent

describe('ReportSheet', () => {
  it('starts on four weeks and counts the workouts in it', () => {
    expect(button('4 weeks').getAttribute('aria-pressed')).toBe('true')
    expect(summary()).toContain('2 workouts')
  })

  it('switches range and prints exactly that range for the signed-in person', () => {
    act(() => button('7 days').click())
    expect(summary()).toContain('1 workout')
    act(() => button('Create PDF').click())
    expect(close).toHaveBeenCalled()
    const [S, opts] = mocks.printReport.mock.calls[0]
    expect(S).toBe(mocks.S)
    expect(opts).toMatchObject({ range: '7d', owner: 'Ana', from: reportRange('7d', { today: todayISO() }).from, to: todayISO() })
  })

  it('custom shows two dates', () => {
    act(() => button('Custom').click())
    expect(host.querySelectorAll('input[type="date"]')).toHaveLength(2)
    act(() => button('3 months').click())
    expect(summary()).toContain('3 workouts')
  })
})
