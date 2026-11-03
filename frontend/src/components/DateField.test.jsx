// @vitest-environment happy-dom
// openGym's own date field and picker (#809): ISO in, ISO out, min/max respected, today one tap
// away, months and years reachable, the profile's first weekday, and the labels a screen reader
// reads out.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { setLang } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import DateField from './DateField.jsx'
import { pickDate, dateValue } from './DateField.test-util.js'

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
// The picker the field opened, mounted like Modals would.
function openPicker(host, i = 0) {
  act(() => { host.querySelectorAll('[data-datefield]')[i].click() })
  const sheet = useUI.getState().sheets.at(-1)
  return mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
function Harness({ initial, onChange = () => {}, ...rest }) {
  const [v, setV] = useState(initial)
  return <DateField value={v} onChange={x => { setV(x); onChange(x) }} label="Date" {...rest} />
}
const days = p => [...p.querySelectorAll('[data-iso]')]
const title = p => p.querySelector('[data-datep-title] .datep-t').textContent

describe('DateField', () => {
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    await setLang('en')
    useUI.setState({ sheets: [], toasts: [], toast: vi.fn() })
    useStore.setState(s => ({ S: { ...s.S, weekStart: 1 } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }); vi.useRealTimers() })

  it('shows the date the way the app writes it and keeps the ISO value', () => {
    const host = mount(<Harness initial="2026-08-25" />)
    const field = host.querySelector('[data-datefield]')
    expect(field.tagName).toBe('BUTTON')
    expect(field.value).toBe('2026-08-25')
    expect(field.querySelector('time').getAttribute('datetime')).toBe('2026-08-25')
    expect(field.textContent).toMatch(/25 Aug 2026/)
    expect(field.getAttribute('aria-label')).toMatch(/^Date: .*25 Aug 2026/)
    expect(host.querySelector('input')).toBeNull()
  })

  it('opens on the value’s month, marks it and hands back an ISO string', () => {
    const onChange = vi.fn()
    const host = mount(<Harness initial="2026-08-25" onChange={onChange} />)
    const p = openPicker(host)
    expect(title(p)).toBe('August 2026')
    expect(days(p)).toHaveLength(31)
    expect(p.querySelector('[data-iso="2026-08-25"]').getAttribute('aria-pressed')).toBe('true')
    expect(p.querySelector('[data-iso="2026-08-25"]').getAttribute('aria-label')).toMatch(/25 Aug 2026/)
    act(() => { p.querySelector('[data-iso="2026-08-03"]').click() })
    expect(onChange).toHaveBeenCalledWith('2026-08-03')
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(dateValue(host)).toBe('2026-08-03')
  })

  it('disables days after max and before min, and the arrows that would leave the range', () => {
    const host = mount(<Harness initial="2026-08-10" min="2026-08-05" max="2026-08-20" />)
    const p = openPicker(host)
    expect(p.querySelector('[data-iso="2026-08-04"]').disabled).toBe(true)
    expect(p.querySelector('[data-iso="2026-08-05"]').disabled).toBe(false)
    expect(p.querySelector('[data-iso="2026-08-20"]').disabled).toBe(false)
    expect(p.querySelector('[data-iso="2026-08-21"]').disabled).toBe(true)
    expect(p.querySelector('[aria-label="Previous month"]').disabled).toBe(true)
    expect(p.querySelector('[aria-label="Next month"]').disabled).toBe(true)
    act(() => { p.querySelector('[data-iso="2026-08-25"]').click() })
    expect(dateValue(host)).toBe('2026-08-10')
  })

  it('with max = today, the future cannot be picked and Today is one tap', () => {
    const today = todayISO()
    const host = mount(<Harness initial="2020-01-02" max={today} />)
    expect(pickDate(host.querySelector('[data-datefield]'), '2099-01-01')).toBe(false)
    expect(dateValue(host)).toBe('2020-01-02')
    const p = openPicker(host)
    act(() => { [...p.querySelectorAll('button')].find(b => b.textContent === 'Today').click() })
    expect(dateValue(host)).toBe(today)
    // Opened again, it sits on this month with today ringed and picked.
    const again = openPicker(host)
    expect(again.querySelector('[aria-current="date"]').dataset.iso).toBe(today)
    expect(again.querySelector('[aria-current="date"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('hides Today when today is outside the range', () => {
    const host = mount(<Harness initial="2020-01-02" max="2020-12-31" />)
    const p = openPicker(host)
    expect([...p.querySelectorAll('button')].some(b => b.textContent === 'Today')).toBe(false)
  })

  it('steps months with the arrows, across the year', () => {
    const host = mount(<Harness initial="2026-01-15" />)
    const p = openPicker(host)
    act(() => { p.querySelector('[aria-label="Previous month"]').click() })
    expect(title(p)).toBe('December 2025')
    expect(days(p)).toHaveLength(31)
    act(() => { p.querySelector('[aria-label="Next month"]').click() })
    act(() => { p.querySelector('[aria-label="Next month"]').click() })
    expect(title(p)).toBe('February 2026')
    expect(days(p)).toHaveLength(28)
  })

  it('jumps years and months from the title', () => {
    const host = mount(<Harness initial="2026-08-25" max="2026-09-30" />)
    expect(pickDate(host.querySelector('[data-datefield]'), '2019-03-07')).toBe(true)
    expect(dateValue(host)).toBe('2019-03-07')
    // A month after max is not offered.
    const p = openPicker(host)
    act(() => { p.querySelector('[data-datep-title]').click() })
    act(() => { p.querySelector('[aria-label="Next year"]').click() })
    for (let i = 0; i < 7; i++) act(() => { p.querySelector('[aria-label="Next year"]').click() })
    expect(p.querySelector('[data-year]').dataset.year).toBe('2026')
    expect(p.querySelector('[aria-label="Next year"]').disabled).toBe(true)
    expect(p.querySelector('[data-month="8"]').disabled).toBe(false)
    expect(p.querySelector('[data-month="9"]').disabled).toBe(true)
  })

  it('starts the week on the profile’s first weekday', () => {
    // 1 Sep 2026 is a Tuesday.
    const host = mount(<Harness initial="2026-09-10" />)
    let p = openPicker(host)
    const heads = () => [...p.querySelectorAll('.cal-h')].map(h => h.textContent)
    const blanks = () => [...p.querySelector('.cal-grid').children].filter(c => !c.classList.contains('cal-h') && !c.dataset.iso).length
    expect(heads()[0]).toBe('Mo')
    expect(blanks()).toBe(1)
    act(() => { useUI.getState().closeAll() })
    act(() => { useStore.setState(s => ({ S: { ...s.S, weekStart: 0 } })) })
    p = openPicker(host)
    expect(heads()[0]).toBe('Su')
    expect(blanks()).toBe(2)
  })

  it('speaks the UI language', async () => {
    await setLang('de')
    const host = mount(<Harness initial="2026-08-25" />)
    expect(host.querySelector('[data-datefield]').textContent).toMatch(/25\. Aug\. 2026|25\. Aug 2026/)
    const p = openPicker(host)
    expect(title(p)).toBe('August 2026')
    expect(p.querySelector('[aria-label="Vorheriger Monat"]')).toBeTruthy()
    expect(p.querySelector('.cal-h').textContent).toBe('Mo')
    expect([...p.querySelectorAll('button')].some(b => b.textContent === 'Heute')).toBe(true)
  })

  it('moves by keyboard: arrows by day and week, PageDown by month, clamped to max', () => {
    const host = mount(<Harness initial="2026-08-25" max="2026-09-02" />)
    const p = openPicker(host)
    const grid = p.querySelector('.cal-grid')
    const key = k => act(() => { grid.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
    const focused = () => p.querySelector('[data-iso][tabindex="0"]').dataset.iso
    expect(focused()).toBe('2026-08-25')
    key('ArrowRight'); expect(focused()).toBe('2026-08-26')
    key('ArrowUp'); expect(focused()).toBe('2026-08-19')
    key('PageDown')
    expect(title(p)).toBe('September 2026')
    expect(focused()).toBe('2026-09-02')
    key('ArrowLeft'); key('ArrowLeft')
    expect(title(p)).toBe('August 2026')
    expect(focused()).toBe('2026-08-31')
  })
})
