// @vitest-environment happy-dom
// Plan → Schedule → a weekday (v1.3.11): one picker for the whole day. Tapping a routine puts it
// on the day or takes it off again, so two make a combined day (in the order tapped); "Rest day"
// clears the day and closes; the sheet stays open for a second pick until Done. The weekday key
// is dropped rather than left as an empty list.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dayAssignSheet } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
let host, root

const renderTop = () => {
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
const row = name => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
const tap = el => { act(() => el.click()); if (useUI.getState().sheets.length) renderTop() }
const week = () => useStore.getState().S.week

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const S = clone(useStore.getState().S)
  S.routines = [
    { id: 'push', name: 'Push', emoji: null, ex: [{ id: '0025' }] },
    { id: 'core', name: 'Core', emoji: null, ex: [] },
  ]
  S.week = { 1: ['push'] }
  useStore.setState({ S, user: null })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the weekday picker', () => {
  it('ticks what is on the day and adds a second routine for a combined day, staying open', () => {
    dayAssignSheet(1)
    renderTop()
    expect(host.querySelector('h3').textContent).toBe('Monday')
    expect(row('Push').getAttribute('aria-pressed')).toBe('true')
    expect(row('Core').getAttribute('aria-pressed')).toBe('false')
    tap(row('Core'))
    expect(week()[1]).toEqual(['push', 'core'])
    expect(useUI.getState().sheets.length).toBe(1)
    expect(row('Core').getAttribute('aria-pressed')).toBe('true')
  })

  it('takes a routine off again, and drops the day once nothing is left', () => {
    dayAssignSheet(1)
    renderTop()
    tap(row('Push'))
    expect(week()).not.toHaveProperty('1')
    expect(row('Rest day').querySelector('.menu-on').className).toContain('is-on')
  })

  it('Rest day clears a combined day and closes', () => {
    useStore.getState().update(s => { s.week[1] = ['push', 'core'] })
    dayAssignSheet(1)
    renderTop()
    tap(row('Rest day'))
    expect(week()).not.toHaveProperty('1')
    expect(useUI.getState().sheets.length).toBe(0)
  })

  it('plans an empty day and closes on Done', () => {
    dayAssignSheet(3)
    renderTop()
    tap(row('Core'))
    expect(week()[3]).toEqual(['core'])
    const done = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Done')
    act(() => done.click())
    expect(useUI.getState().sheets.length).toBe(0)
  })
})
