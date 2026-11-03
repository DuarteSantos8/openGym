// @vitest-environment happy-dom
// #859 (Borgna02): several weigh-ins a day, each with its time. The log sheet has a time field,
// the list shows every weigh-in of a day with its time under the day's value, and each one can
// be edited or deleted (with Undo) on its own.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet, weighInsSheet } from './sheets.jsx'
import { readingsOf, settleAll, timeOf } from './lib/weigh-ins.js'
import { todayISO } from './lib/format.js'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const setValue = (input, value) => {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const D = '2026-09-09'
const LOG = [
  { d: '2026-09-07', w: 80.5, t: 3 },
  { d: D, w: 79.5, t: 30, ins: [{ id: 'am', at: '07:10', w: 79.5, t: 10 }, { id: 'pm', at: '21:30', w: 80.6, t: 30 }] },
]
const S = () => useStore.getState().S
const dayOf = d => S().bodyweight.find(b => b.d === d)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  document.body.innerHTML = ''
  const st = clone(DEF)
  Object.assign(st, { unit: 'kg', bodyweight: clone(LOG), weekStart: 1, targetW: null })
  useStore.setState({ S: st, user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('the log sheet', () => {
  it('starts on now, and a second weigh-in today joins the first', () => {
    bwSheet()
    const log = mountTopSheet()
    const time = log.querySelector('input[type="time"]')
    expect(time.value).toBe(timeOf(Date.now()))
    setValue(time, '06:30')
    act(() => { button(log, 'Save').click() })
    bwSheet()
    const again = mountTopSheet()
    setValue(again.querySelector('input[type="time"]'), '22:00')
    act(() => { button(again, 'Save').click() })
    expect(readingsOf(dayOf(todayISO())).map(r => r.at)).toEqual(['06:30', '22:00'])
  })

  it('the check-in before a workout saves at now, with no time to pick', () => {
    bwSheet({ required: true })
    const log = mountTopSheet()
    expect(log.querySelector('input[type="time"]')).toBeNull()
    act(() => { button(log, 'Save & start workout').click() })
    expect(readingsOf(dayOf(todayISO()))[0].at).toBe(timeOf(Date.now()))
  })

  it('takes a weight an assistant heard', () => {
    bwSheet({ initial: 77.26 })
    expect(mountTopSheet().querySelector('.bw-read input').value).toContain('77.3')
  })
})

describe('the weigh-ins list', () => {
  it('lists each weigh-in of a day with its time, under the day\'s value', () => {
    weighInsSheet()
    const host = mountTopSheet()
    expect(host.textContent).toContain('3 weigh-ins')
    const day = host.querySelector(`[data-day="${D}"]`)
    expect(day.textContent).toContain('Morning value 79.5 kg')
    expect([...day.querySelectorAll('[data-reading]')].map(r => r.dataset.reading)).toEqual(['am', 'pm'])
    expect(day.textContent).toContain('07:10')
    expect(day.textContent).toContain('21:30')
  })

  it('names the day\'s value by the setting', () => {
    useStore.setState({ S: { ...S(), bwDaily: 'avg', bodyweight: S().bodyweight.map(b => (b.d === D ? { ...b, w: 80.05 } : b)) } })
    weighInsSheet()
    expect(mountTopSheet().querySelector(`[data-day="${D}"]`).textContent).toContain('Day average 80.1 kg')
  })

  it('deletes one weigh-in of a day, and Undo brings it back', () => {
    weighInsSheet()
    const host = mountTopSheet()
    act(() => { host.querySelector('[data-reading="am"] button[aria-label="Delete weigh-in"]').click() })
    const ask = mountTopSheet()
    expect(ask.textContent).toContain('07:10')
    act(() => { button(ask, 'Delete').click() })
    expect(readingsOf(dayOf(D)).map(r => r.id)).toEqual(['pm'])
    expect(dayOf(D).w).toBe(80.6)
    act(() => { useUI.getState().runToastAction() })
    expect(readingsOf(dayOf(D)).map(r => r.id)).toEqual(['am', 'pm'])
    expect(dayOf(D).w).toBe(79.5)
  })

  it('opens one weigh-in to change its weight and time', () => {
    weighInsSheet()
    const host = mountTopSheet()
    act(() => { host.querySelector('[data-reading="pm"] .bw-when-btn').click() })
    const edit = mountTopSheet()
    expect(edit.querySelector('h3').textContent).toBe('Edit weigh-in')
    expect(edit.querySelector('input[type="time"]').value).toBe('21:30')
    setValue(edit.querySelector('input[type="time"]'), '20:45')
    act(() => { button(edit, '+1').click() })
    act(() => { button(edit, 'Save').click() })
    expect(readingsOf(dayOf(D)).map(r => [r.id, r.at, r.w])).toEqual([['am', '07:10', 79.5], ['pm', '20:45', 81.6]])
    expect(useUI.getState().toastMsg).toBe('Weigh-in updated')
  })
})

describe('Settings: daily value', () => {
  // What the Settings row does in one update: the setting, and every day settled to it. Only the
  // number moves: no weigh-in counts as edited, so nothing outranks a real edit on another device.
  it('a change of the setting settles every day at once, without stamping any as edited', () => {
    useStore.getState().update(s => { s.bwDaily = 'last'; settleAll(s, 'last') })
    expect(dayOf(D).w).toBe(80.6)
    expect(dayOf(D).t).toBe(30)
    expect(readingsOf(dayOf(D)).map(r => r.t)).toEqual([10, 30])
  })
})
