// @vitest-environment happy-dom
// Progress › Body › Measurements segment.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindUI } from '../components/ui.jsx'
import { isoOf } from '../lib/format.js'
import { confirmSheet } from '../sheets.jsx'
import Measurements from './Measurements.jsx'

const mocks = vi.hoisted(() => ({ charts: [] }))
let search = ''
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search }), useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return null } }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
bindUI(useUI)

const KEY = 'gains.progressRange'
const ago = n => isoOf(new Date(Date.now() - n * 86400000))
const entry = (n, values) => ({ d: ago(n), t: Date.now() - n * 86400000, ...values })

let host, root
const setS = patch => useStore.setState(s => ({
  S: { ...s.S, unit: 'kg', measurements: [], customMeasurements: [], measurementEnabled: ['waist', 'chest'], ...patch },
}))
const mount = () => act(() => root.render(<Measurements />))
const text = () => host.textContent
const action = label => [...host.querySelectorAll('.act-b')].find(b => b.textContent === label)
const rangeButtons = () => [...host.querySelectorAll('.seg button')]
const rangeOn = () => rangeButtons().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
const sheetText = () => {
  const sheet = useUI.getState().sheets.at(-1)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const r = createRoot(el)
  act(() => r.render(sheet.render(() => {})))
  const out = el.textContent
  act(() => r.unmount())
  el.remove()
  return out
}

beforeEach(() => {
  mocks.charts = []
  search = ''
  localStorage.clear()
  vi.mocked(confirmSheet).mockClear()
  useUI.getState().closeAll()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll() })

describe('Measurements segment: actions', () => {
  it('has Log measurements and Choose fields, each opening its sheet', () => {
    setS()
    mount()
    act(() => action('Log measurements').click())
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(sheetText()).toContain('Log measurements')
    useUI.getState().closeAll()
    act(() => action('Choose fields').click())
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(sheetText()).toContain('Choose measurements')
  })
})

describe('Measurements segment: nothing chosen', () => {
  it('says there is nothing to chart and offers Choose measurements', () => {
    setS({ measurementEnabled: [] })
    mount()
    expect(text()).toContain('Nothing to chart yet')
    expect(mocks.charts).toHaveLength(0)
    expect(host.querySelector('.hero')).toBeNull()
    const pill = [...host.querySelectorAll('.empty button')].find(b => b.textContent === 'Choose measurements')
    act(() => pill.click())
    expect(sheetText()).toContain('Choose measurements')
  })

  it('says there are no measurements in the history', () => {
    setS({ measurementEnabled: [] })
    mount()
    expect(text()).toContain('Measurement history')
    expect(text()).toContain('No measurements yet')
  })
})

describe('Measurements segment: the picked field', () => {
  it('picks the waist first, with its latest value and the change since the previous one', () => {
    setS({ measurements: [entry(30, { waist: 84, chest: 100 }), entry(2, { waist: 82.5, chest: 101 })] })
    mount()
    const hero = host.querySelector('.hero')
    expect(hero.querySelector('.hero-e').textContent).toBe('Waist')
    expect(hero.querySelector('.hero-num').textContent).toBe('82.5')
    expect(hero.querySelector('.hero-u').textContent).toBe('cm')
    expect(hero.querySelector('.hero-c').textContent).toBe('-1.5 cm since previous')
  })

  it('shows a rise with a plus and the date when there is only one reading', () => {
    setS({ measurements: [entry(2, { waist: 82 })] })
    mount()
    expect(host.querySelector('.hero-c').textContent).not.toContain('since previous')
    act(() => root.render(<div />))
    setS({ measurements: [entry(30, { waist: 82 }), entry(2, { waist: 83 })] })
    mount()
    expect(host.querySelector('.hero-c').textContent).toBe('+1 cm since previous')
  })

  it('says no measurements yet for a chosen field with no reading', () => {
    setS()
    mount()
    expect(host.querySelector('.hero-c').textContent).toBe('No measurements yet')
    expect(host.querySelector('.hero-num').textContent).toBe('–')
  })

  it('shows inches for a pound profile and converts from centimetres', () => {
    setS({ unit: 'lb', measurements: [entry(2, { waist: 91.44 })] })
    mount()
    expect(host.querySelector('.hero-num').textContent).toBe('36')
    expect(host.querySelector('.hero-u').textContent).toBe('in')
    expect(mocks.charts.at(-1).unit).toBe('in')
  })

  it('charts the field and switches field from the Measurement row', () => {
    setS({ measurements: [entry(30, { waist: 84, chest: 100 }), entry(2, { waist: 82, chest: 101 })] })
    mount()
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([84, 82])
    const row = [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Measurement'))
    expect(row.textContent).toContain('Waist')
    act(() => row.click())
    expect(useUI.getState().sheets).toHaveLength(1)
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    const r = createRoot(sheet)
    act(() => r.render(useUI.getState().sheets.at(-1).render(() => {})))
    expect(sheet.textContent).toContain('Choose measurement')
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Chest').click())
    act(() => r.unmount())
    sheet.remove()
    expect(host.querySelector('.hero-e').textContent).toBe('Chest')
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([100, 101])
  })

  it('offers a field that was switched off but still has readings', () => {
    setS({ measurementEnabled: ['waist'], measurements: [entry(2, { waist: 82, hips: 95 })] })
    mount()
    const row = [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Measurement'))
    act(() => row.click())
    const sheet = document.createElement('div')
    document.body.appendChild(sheet)
    const r = createRoot(sheet)
    act(() => r.render(useUI.getState().sheets.at(-1).render(() => {})))
    expect(sheet.textContent).toContain('Hips')
    act(() => r.unmount())
    sheet.remove()
  })
})

describe('Measurements segment: range', () => {
  const readings = () => [entry(300, { waist: 90 }), entry(60, { waist: 86 }), entry(10, { waist: 84 }), entry(1, { waist: 83 })]

  it('starts at 3M, the remembered range, or the address\'s', () => {
    setS({ measurements: readings() })
    mount()
    expect(rangeOn()).toEqual(['3M'])
    act(() => root.unmount())
    root = createRoot(host)
    localStorage.setItem(KEY, '0')
    mount()
    expect(rangeOn()).toEqual(['All'])
    act(() => root.unmount())
    root = createRoot(host)
    search = '?range=30'
    mount()
    expect(rangeOn()).toEqual(['1M'])
  })

  it('cuts the chart to the range, while the hero stays on the latest reading', () => {
    setS({ measurements: readings() })
    search = '?range=30'
    mount()
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([84, 83])
    act(() => rangeButtons().find(b => b.textContent === '3M').click())
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([86, 84, 83])
    act(() => rangeButtons().find(b => b.textContent === 'All').click())
    expect(mocks.charts.at(-1).points.map(p => p.y)).toEqual([90, 86, 84, 83])
    expect(host.querySelector('.hero-num').textContent).toBe('83')
  })
})

describe('Measurements segment: history', () => {
  it('lists the check-ins newest first with a count and a preview', () => {
    setS({ measurements: [entry(30, { waist: 84 }), entry(2, { waist: 82, chest: 101 })] })
    mount()
    const cards = [...host.querySelectorAll('.measure-history')]
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('2 measurements')
    expect(cards[0].textContent).toContain('Waist 82 cm')
    expect(cards[0].textContent).toContain('Chest 101 cm')
    expect(cards[1].textContent).toContain('1 measurement')
  })

  it('opens the entry for editing', () => {
    setS({ measurements: [entry(2, { waist: 82 })] })
    mount()
    act(() => host.querySelector('.measure-history button[aria-label="Edit"]').click())
    expect(sheetText()).toContain('Edit measurements')
  })

  it('asks before deleting, and deletes only that day on confirm', () => {
    setS({ measurements: [entry(30, { waist: 84 }), entry(2, { waist: 82 })] })
    mount()
    act(() => host.querySelector('.measure-history button[aria-label="Delete"]').click())
    expect(confirmSheet).toHaveBeenCalledTimes(1)
    const opts = vi.mocked(confirmSheet).mock.calls[0][0]
    expect(opts).toMatchObject({ title: 'Delete measurements?', confirmText: 'Delete', danger: true })
    expect(useStore.getState().S.measurements).toHaveLength(2)
    act(() => opts.onConfirm())
    expect(useStore.getState().S.measurements.map(e => e.d)).toEqual([ago(30)])
  })
})
