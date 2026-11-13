// @vitest-environment happy-dom
// Picking the freeze rule (components/StreakRule.jsx): the Settings sheet says "From now on" before
// it saves and saves from this week on; a new profile's Home card saves its first pick for every
// week; the how-to and the calendar's week line follow the rule.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore, freshState } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO, weekKey } from '../lib/format.js'
import { StreakRuleSheet, StreakRuleWelcome } from './StreakRule.jsx'
import { StreakHowTo, WeekNote } from './StreakCalendar.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
const mount = node => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(node)); return host
}
const thisWeek = weekKey(todayISO(), 1)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState({ S: { ...clone(DEF), weekStart: 1 }, user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('Settings: the rule sheet', () => {
  it('shows the rule in force, says "From now on" for a new pick, and saves it from this week', () => {
    let closed = false
    const el = mount(<StreakRuleSheet close={() => { closed = true }} />)
    expect(el.querySelector('[data-rule="generous"]').getAttribute('aria-checked')).toBe('true')
    expect(el.querySelector('[data-rule-note]').textContent).toBe('Your rule right now: Generous.')
    const save = [...el.querySelectorAll('button')].find(b => b.textContent === 'Save')
    expect(save.disabled).toBe(true)
    act(() => el.querySelector('[data-rule="gentle"]').click())
    expect(el.querySelector('[data-rule-note]').textContent).toBe('From now on: Gentle. Weeks already counted stay as they are.')
    act(() => save.click())
    expect(useStore.getState().S.streakRule).toEqual({ rule: 'gentle', since: thisWeek, history: [{ rule: 'generous', since: null }] })
    expect(closed).toBe(true)
  })

  it('after a switch it says since when', () => {
    useStore.getState().update(s => { s.streakRule = { rule: 'off', since: thisWeek, history: [] } })
    const el = mount(<StreakRuleSheet close={() => {}} />)
    expect(el.querySelector('[data-rule-note]').textContent).toMatch(/^No freezes since the week of /)
  })
})

describe('a new profile picks once', () => {
  it('freshState asks, existing profiles do not', () => {
    expect(freshState().streakRuleAsk).toBe(true)
    expect(freshState().streakRule).toBeUndefined()
    expect(DEF.streakRuleAsk).toBeUndefined()
  })

  it('Gentle is ready, and the first pick judges every week', () => {
    useStore.getState().update(s => { s.streakRuleAsk = true })
    const el = mount(<StreakRuleWelcome />)
    expect(el.querySelector('[data-rule="gentle"]').getAttribute('aria-checked')).toBe('true')
    expect(el.querySelectorAll('[role="radio"]')).toHaveLength(3)
    act(() => el.querySelector('[data-rule="off"]').click())
    act(() => [...el.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
    const S = useStore.getState().S
    expect(S.streakRule).toEqual({ rule: 'off', since: null, history: [] })
    expect(S.streakRuleAsk).toBeUndefined()
  })
})

describe('the words follow the rule', () => {
  it('the how-to per rule', () => {
    expect(mount(<StreakHowTo rule="generous" />).textContent).toMatch(/You can bank 2\./)
    expect(mount(<StreakHowTo rule="gentle" />).textContent).toMatch(/You can bank 1\..*Two missed weeks in a row, and it starts over\./)
    const off = mount(<StreakHowTo rule="off" />).textContent
    expect(off).toMatch(/No freezes on your rule/)
    expect(off).not.toMatch(/bank/)
  })

  it('a week judged by a later pick says from when', () => {
    useStore.getState().update(s => { s.streakRule = { rule: 'gentle', since: thisWeek, history: [{ rule: 'generous', since: null }] } })
    const after = mount(<WeekNote wk={thisWeek} entry={{ s: 'open', run: 3 }} />)
    expect(after.querySelector('.wk-note-r').textContent).toMatch(/From the week of .* on: Gentle\./)
    const before = mount(<WeekNote wk="2026-01-05" entry={{ s: 'on', run: 3 }} />)
    expect(before.querySelector('.wk-note-r')).toBe(null)
  })
})
