// @vitest-environment happy-dom
// "Export as spreadsheet (CSV)" (#647): the range picker says what the file will hold, and each
// button saves its own file through the share sheet on the phone (as the JSON backup does).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ S: null, share: vi.fn(async () => {}), toast: vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, shareExport: (...a) => mocks.share(...a) }))

const { CsvExportSheet } = await import('./CsvExportSheet.jsx')
const { todayISO } = await import('../lib/format.js')

let root, host, close
const iso = n => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const wk = (id, n) => ({ id, d: iso(n), start: new Date(iso(n) + 'T18:00:00').getTime(), entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }] })

beforeEach(() => {
  mocks.share.mockClear(); mocks.toast.mockClear()
  mocks.S = { unit: 'kg', workouts: [wk('a', 2), wk('b', 200)], bodyweight: [{ d: iso(1), w: 80 }] }
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<CsvExportSheet close={close} />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const summary = () => host.querySelector('[data-csv-summary]').textContent
const count = kind => host.querySelector(`[data-csv-count="${kind}"]`).textContent
const flush = () => act(async () => { await Promise.resolve() })

describe('CsvExportSheet', () => {
  it('starts on everything and counts workouts and sets', () => {
    expect(button('All').getAttribute('aria-pressed')).toBe('true')
    expect(summary()).toBe('All')
    expect(count('workouts')).toBe('2 workouts · 4 sets')
    act(() => button('4 weeks').click())
    expect(count('workouts')).toContain('1 workout')
  })

  it('counts weigh-ins and measurements under the body file, not sets', () => {
    mocks.S = { ...mocks.S, bodyweight: [{ d: iso(1), w: 80 }, { d: iso(300), w: 82 }], measurements: [{ d: iso(3), waist: 80 }] }
    act(() => root.render(<CsvExportSheet close={close} />))
    expect(count('body')).toBe('2 weigh-ins · 1 measurement')
    expect(count('body')).not.toContain('set')
    act(() => button('4 weeks').click())
    expect(count('body')).toBe('1 weigh-in · 1 measurement')
  })

  it('leaves measurements out of the line when there are none', () => {
    expect(count('body')).toBe('1 weigh-in')
  })

  it('shares the workouts file on the phone, named by the day', async () => {
    act(() => button('4 weeks').click())
    act(() => button('Workouts (CSV)').click())
    await flush()
    expect(close).toHaveBeenCalled()
    const [text, name] = mocks.share.mock.calls[0]
    expect(name).toBe('opengym-workouts-' + todayISO() + '.csv')
    expect(text.trim().split('\r\n')).toHaveLength(3)
    expect(mocks.toast).toHaveBeenCalledWith('CSV exported')
  })

  it('shares body weight as its own file', async () => {
    act(() => button('Body weight & measurements (CSV)').click())
    await flush()
    const [text, name] = mocks.share.mock.calls[0]
    expect(name).toBe('opengym-body-' + todayISO() + '.csv')
    expect(text).toContain('weight_kg')
  })
})
