// @vitest-environment happy-dom
// Your week / Your month: the Home card on the first day of a week, its sheet, and the ×.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { RecapHomeCard } from './Recap.jsx'

vi.mock('../lib/report-print.js', () => ({ printReport: vi.fn() }))
const { printReport } = await import('../lib/report-print.js')
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
const wk = d => ({ id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(), end: new Date(d + 'T11:00:00').getTime(), prs: [BENCH], entries: [{ id: BENCH, target: { mode: 'reps' }, sets: [{ w: 100, r: 5, done: true }] }] })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T09:00:00'))   // a Monday
  useUI.setState({ sheets: [] })
  useStore.setState({ S: { ...structuredClone(DEF), weekStart: 1, workouts: [wk('2026-10-20'), wk('2026-10-22')] }, user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }); vi.useRealTimers() })

describe('Your week on Home', () => {
  it('shows last week on a Monday, opens the sheet with Share and PDF, and the × puts it away', () => {
    const host = render(<RecapHomeCard S={useStore.getState().S} />)
    expect(host.querySelector('.ttl').textContent).toBe('Your week')
    expect(host.querySelector('.ss').textContent).toBe('2 workouts · 1,000 kg · 2 new bests')
    act(() => host.querySelector('.recap-card').click())
    const sheet = useUI.getState().sheets.at(-1)
    const sh = render(sheet.render(() => {}))
    expect([...sh.querySelectorAll('.recap-v')].map(e => e.textContent)).toEqual(['2', '1,000 kg', '2', '1'])
    act(() => [...sh.querySelectorAll('button')].find(b => b.textContent.includes('Save as PDF')).click())
    expect(printReport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ range: 'custom', from: '2026-10-19', to: '2026-10-25' }))
    act(() => host.querySelector('[aria-label="Put it away"]').click())
    expect(useStore.getState().S.recapSeen).toBe('w:2026-10-19')
  })
  it('switched off, no card', () => {
    useStore.setState(s => ({ S: { ...s.S, recap: false } }))
    expect(render(<RecapHomeCard S={useStore.getState().S} />).textContent).toBe('')
  })
})
