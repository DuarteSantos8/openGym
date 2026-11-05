// @vitest-environment happy-dom
// The day sheet's header names the plan the day would have without its override. In a coach
// week that is the queue's session for the day, in front of the weekday's own routines — the
// same answer the Home row gives — not the weekday list alone. The list itself puts the
// week's remaining sessions first under 'Coach week': picking one pins it to the day (the
// same per-date override), and one already pinned to another day shows that day.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dayOverrideSheet } from './sheets.jsx'
import { todayISO, isoOf, fmtDate, exCount } from './lib/format.js'

const routines = [
  { id: 'd1', name: 'US W1 D1', emoji: null, ex: [{ id: '0025' }] },
  { id: 'd2', name: 'US W1 D2', emoji: null, ex: [{ id: '0025' }] },
  { id: 'own', name: 'Core', emoji: null, ex: [{ id: '0025' }] },
]
const SINCE = Date.now() - 2 * 86400000
const daysFromToday = n => { const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const queue = { ids: ['d1', 'd2'], since: SINCE, startsOn: daysFromToday(-1), label: 'US W1' }
// A finished workout on `id`, started after the apply — the DONE RULE counts it for this week.
const logged = id => {
  const start = SINCE + 3600000
  return { id: 'w-' + id, d: isoOf(new Date(start)), start, end: start + 3600000, routineIds: [id], routineId: id, name: routines.find(r => r.id === id).name, entries: [] }
}
const mounted = []

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const header = host => host.querySelector('.muted.small').textContent
const heading = host => host.querySelector('h4.sec')?.textContent
const lists = host => [...host.querySelectorAll('.list')].map(l => [...l.querySelectorAll('.item .tt')].map(e => e.textContent))
const rowOf = (host, name) => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
const setS = (over = {}) => useStore.setState(s => ({ S: { ...s.S, routines, week: {}, dayPlan: {}, workouts: [], active: null, queue, ...over }, user: null }))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('Day sheet header in a coach week', () => {
  it('names the queue session for today, with the weekday\'s own routine after it', () => {
    setS()
    dayOverrideSheet(todayISO())
    expect(header(renderTop())).toMatch(/^Weekly plan: US W1 D1/)
    setS({ week: { [new Date().getDay()]: ['own'] } })
    dayOverrideSheet(todayISO())
    expect(header(renderTop())).toMatch(/^Weekly plan: US W1 D1 \+ Core/)
  })

  it('a rest override for today still shows the plan it replaced, marked as changed', () => {
    setS({ dayPlan: { [todayISO()]: 'rest' } })
    dayOverrideSheet(todayISO())
    const h = header(renderTop())
    expect(h).toMatch(/^Weekly plan: US W1 D1/)
    expect(h).toContain('changed for this day')
  })

  it('another day has no queue session: the weekday alone, or Rest', () => {
    const tomorrow = daysFromToday(1)
    setS({ week: { [new Date(tomorrow + 'T12:00:00').getDay()]: ['own'] } })
    dayOverrideSheet(tomorrow)
    expect(header(renderTop())).toMatch(/^Weekly plan: Core/)
    setS()
    dayOverrideSheet(tomorrow)
    expect(header(renderTop())).toMatch(/^Weekly plan: Rest/)
  })
})

describe('Day sheet list in a coach week', () => {
  it('a fulfilled pin — the session pinned here already done — reads as no change; the clear row stays', () => {
    setS({ dayPlan: { [todayISO()]: 'd1' }, workouts: [logged('d1')] })
    dayOverrideSheet(todayISO())
    const host = renderTop()
    expect(header(host)).toMatch(/^Weekly plan: US W1 D2/)
    expect(header(host)).not.toContain('changed for this day')
    expect(rowOf(host, 'Back to weekly plan')).toBeTruthy()
  })

  it("the pinned day's own sheet shows the exercise count, not its own date again", () => {
    const friday = daysFromToday(2)
    setS({ dayPlan: { [friday]: 'd2' } })
    dayOverrideSheet(friday)
    const host = renderTop()
    expect(rowOf(host, 'US W1 D2').querySelector('.ss').textContent).toBe(exCount(1))
    // …while from today's sheet the same session wears Friday.
    dayOverrideSheet(todayISO())
    expect(rowOf(renderTop(), 'US W1 D2').querySelector('.ss').textContent).toBe(fmtDate(friday, true))
    // A session pinned to today wears today from another day's sheet, though the row lights it as next.
    setS({ dayPlan: { [todayISO()]: 'd2' } })
    dayOverrideSheet(friday)
    expect(rowOf(renderTop(), 'US W1 D2').querySelector('.ss').textContent).toBe(fmtDate(todayISO(), true))
  })

  it('lists the remaining sessions first under Coach week, a done session down in the plain list', () => {
    setS({ workouts: [logged('d1')] })
    dayOverrideSheet(todayISO())
    const host = renderTop()
    expect(heading(host)).toBe('Coach week')
    const [coach, plain] = lists(host)
    expect(coach).toEqual(['US W1 D2'])
    expect(plain).toEqual(['US W1 D1', 'Core', 'Rest / skip this day'])
  })

  it('picking a coach row pins that session to the day', () => {
    const friday = daysFromToday(2)
    setS()
    dayOverrideSheet(friday)
    const host = renderTop()
    act(() => rowOf(host, 'US W1 D2').click())
    expect(useStore.getState().S.dayPlan[friday]).toBe('d2')
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toBe(`US W1 D2 planned for ${fmtDate(friday)}`)
  })

  it('a session pinned to another day shows that day instead of its exercise count', () => {
    const friday = daysFromToday(2)
    setS({ dayPlan: { [friday]: 'd2' } })
    dayOverrideSheet(todayISO())
    const host = renderTop()
    expect(rowOf(host, 'US W1 D2').querySelector('.ss').textContent).toBe(fmtDate(friday, true))
    expect(rowOf(host, 'US W1 D1').querySelector('.ss').textContent).toBe(exCount(1))
  })

  it('without a queue there is no heading and one plain list', () => {
    setS({ queue: null })
    dayOverrideSheet(todayISO())
    const host = renderTop()
    expect(heading(host)).toBeUndefined()
    expect(lists(host)).toEqual([['US W1 D1', 'US W1 D2', 'Core', 'Rest / skip this day']])
  })
})
