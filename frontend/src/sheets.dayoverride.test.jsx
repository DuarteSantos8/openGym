// @vitest-environment happy-dom
// The day sheet's header names the plan the day would have without its override. In a coach
// week that is the queue's session for the day, in front of the weekday's own routines — the
// same answer the Home row gives — not the weekday list alone.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dayOverrideSheet } from './sheets.jsx'
import { todayISO, isoOf } from './lib/format.js'

const routines = [
  { id: 'd1', name: 'US W1 D1', emoji: null, ex: [{ id: '0025' }] },
  { id: 'd2', name: 'US W1 D2', emoji: null, ex: [{ id: '0025' }] },
  { id: 'own', name: 'Core', emoji: null, ex: [{ id: '0025' }] },
]
const SINCE = Date.now() - 2 * 86400000
const daysFromToday = n => { const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const queue = { ids: ['d1', 'd2'], since: SINCE, startsOn: daysFromToday(-1), label: 'US W1' }
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
