// @vitest-environment happy-dom
// #261: "I want to write a note why I missed today, and see it in the heatmap." The day sheet
// offers a note on today and past days with nothing logged, the note sheet saves a quick pick
// and a line of text (or takes it away), and the calendar, heatmap, week strip and History show it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dayOverrideSheet, dayNoteSheet, calendarSheet } from './sheets.jsx'
import Heatmap from './components/Heatmap.jsx'
import History, { historyRows } from './views/History.jsx'
import { withDayNote, dayNoteOf } from './lib/day-notes.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const mountTopSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function install(extra = {}) {
  const st = clone(DEF)
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [] }],
    week: { 1: ['A'], 5: ['A'] }, dayPlan: {}, active: null, workouts: [], weighIn: false,
  }, extra)
  useStore.setState({ S: st, user: null })
}

beforeEach(() => {
  // Wednesday 16 September 2026, midday.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00:00'))
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], toasts: [] })
  document.body.innerHTML = ''
  install()
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  vi.useRealTimers()
})

describe('the day sheet offers a note', () => {
  const offered = iso => {
    useUI.setState({ sheets: [] })
    dayOverrideSheet(iso)
    return mountTopSheet().textContent.includes('Add a note for this day')
  }
  it('on today and past days with nothing logged, never on a future day or a trained one', () => {
    expect(offered('2026-09-14')).toBe(true)     // Monday, missed
    expect(offered('2026-09-15')).toBe(true)     // Tuesday, a rest day: any day can say why
    expect(offered('2026-09-16')).toBe(true)     // today
    expect(offered('2026-09-18')).toBe(false)    // Friday, still to come
    install({ workouts: [{ id: 'w', d: '2026-09-14', start: 1, end: 2, name: 'Push', entries: [], prs: [] }] })
    expect(offered('2026-09-14')).toBe(false)
  })

  it('shows a note that is there, and opens it for editing', () => {
    install({ dayNotes: withDayNote({}, '2026-09-14', { tag: 'sick', text: 'Flu' }, 5) })
    dayOverrideSheet('2026-09-14')
    const host = mountTopSheet()
    expect(host.textContent).toContain('Sick')
    expect(host.textContent).toContain('Flu')
    expect(host.textContent).not.toContain('Add a note for this day')
    act(() => { host.querySelector('.day-note-row').click() })
    expect(useUI.getState().sheets).toHaveLength(2)
    const note = mountTopSheet()
    expect(note.querySelector('textarea').value).toBe('Flu')
    expect(button(note, 'Sick').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the note sheet', () => {
  it('saves a quick pick with a line of text, stamped, and excuses the day', () => {
    dayNoteSheet('2026-09-14')
    const host = mountTopSheet()
    act(() => { button(host, 'Travelling').click() })
    act(() => { type(host.querySelector('textarea'), '  Lisbon, back Thursday ') })
    act(() => { button(host, 'Save').click() })
    expect(dayNoteOf(S(), '2026-09-14')).toEqual({ tag: 'travel', text: 'Lisbon, back Thursday' })
    expect(S().dayNotes['2026-09-14']._ts).toBeGreaterThan(0)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('a second tap on a pick takes it off again; text alone is a note', () => {
    dayNoteSheet('2026-09-14')
    const host = mountTopSheet()
    act(() => { button(host, 'Sick').click() })
    act(() => { button(host, 'Sick').click() })
    act(() => { type(host.querySelector('textarea'), 'Wedding') })
    act(() => { button(host, 'Save').click() })
    expect(dayNoteOf(S(), '2026-09-14')).toEqual({ tag: null, text: 'Wedding' })
  })

  it('saving nothing on a day without a note writes nothing', () => {
    dayNoteSheet('2026-09-14')
    const host = mountTopSheet()
    act(() => { button(host, 'Save').click() })
    expect(S().dayNotes).toEqual({})
  })

  it('Remove takes the note away as a stamped clear, so the removal syncs', () => {
    install({ dayNotes: withDayNote({}, '2026-09-14', { tag: 'injured' }, 5) })
    dayNoteSheet('2026-09-14')
    const host = mountTopSheet()
    act(() => { button(host, 'Remove note').click() })
    expect(dayNoteOf(S(), '2026-09-14')).toBeNull()
    expect(S().dayNotes['2026-09-14']._ts).toBeGreaterThan(5)
  })
})

describe('where a noted day shows', () => {
  const notes = withDayNote({}, '2026-09-14', { tag: 'sick', text: 'Flu' }, 5)

  it('the calendar marks it, with the note as its tooltip and a legend entry', () => {
    install({ dayNotes: notes })
    calendarSheet('2026-09-01')
    const host = mountTopSheet()
    const cell = [...host.querySelectorAll('.cal-d')].find(b => b.textContent === '14')
    expect(cell.className).toContain('noted')
    expect(cell.querySelector('i').className).toBe('noted')
    expect(cell.getAttribute('title')).toBe('Sick · Flu')
    expect(host.querySelector('.cal-legend').textContent).toContain('Day note')
    // a month without notes has no legend entry for them
    install()
    useUI.setState({ sheets: [] })
    calendarSheet('2026-09-01')
    expect(mountTopSheet().querySelector('.cal-legend').textContent).not.toContain('Day note')
  })

  it('the heatmap outlines it and lets you tap it', () => {
    install({ dayNotes: notes })
    const onDay = vi.fn()
    const host = mount(<Heatmap S={S()} onDay={onDay} />)
    const cell = [...host.querySelectorAll('.hm-c')].find(c => c.getAttribute('title')?.startsWith('2026-09-14'))
    expect(cell.className).toContain('noted')
    expect(cell.getAttribute('title')).toBe('2026-09-14 · Sick · Flu')
    act(() => { cell.click() })
    expect(onDay).toHaveBeenCalledWith('2026-09-14')
  })

  it('History lists it between the workouts, newest first; a trained day keeps only its workout', () => {
    const w = (id, d) => ({ id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), name: 'Push', entries: [], prs: [] })
    install({
      workouts: [w('a', '2026-09-11'), w('b', '2026-09-15'), w('c', '2026-09-15')],
      dayNotes: { ...notes, ...withDayNote({}, '2026-09-15', { tag: 'rest' }, 6), '2026-09-12': { _ts: 7 } },
    })
    expect(historyRows(S()).map(r => r.w ? r.w.id : 'note ' + r.d)).toEqual(['c', 'b', 'note 2026-09-14', 'a'])
    const host = mount(<MemoryRouter><History /></MemoryRouter>)
    const row = host.querySelector('.day-note-row')
    expect(row.textContent).toContain('Sick')
    expect(row.textContent).toContain('Flu')
    act(() => { row.click() })
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})
