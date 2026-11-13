// @vitest-environment happy-dom
// #232 follow-up: the exercise settings say whether the machine helps (less load is harder), and
// let the user say so where the catalogue cannot tell (bands, machines not named "assisted").
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { exOr } from './lib/exercises.js'
import { ruleOccurrence } from './lib/test-fixtures.js'

const ASSISTED = '0017', PULLUP = '0652', BENCH = '0025'
const mounted = []

function open(id, extra = {}) {
  const onSave = vi.fn()
  exConfigSheet(exOr(id), { ...ruleOccurrence(id, { occurrenceId: 'o1', routineId: 'r1' }), ...extra }, onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return { host, onSave }
}
const field = host => host.querySelector('[data-field="Assistance"]')
const choose = (host, label) => act(() => [...field(host).querySelectorAll('button')].find(b => b.textContent.trim() === label).click())
const save = host => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())

describe('exercise settings: assistance', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('says what the catalogue decided', () => {
    expect(field(open(ASSISTED).host).textContent).toContain('Automatic: assisted')
    expect(field(open(PULLUP).host).textContent).toContain('Automatic: not assisted')
  })

  it('saves Assisted, Not assisted, and Automatic as no flag at all', () => {
    let { host, onSave } = open(BENCH)
    choose(host, 'Assisted'); save(host)
    expect(onSave.mock.calls[0][0].assisted).toBe(true);
    ({ host, onSave } = open(ASSISTED))
    choose(host, 'Not assisted'); save(host)
    expect(onSave.mock.calls[0][0].assisted).toBe(false);
    ({ host, onSave } = open(BENCH, { assisted: true }))
    expect(field(host).querySelector('[aria-pressed="true"]').textContent).toBe('Assisted')
    choose(host, 'Automatic'); save(host)
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('assisted')
  })

  it('on a chain, Automatic reads the exercise of the step the track is on', () => {
    const chain = { rule: ruleOccurrence(PULLUP, { occurrenceId: 'o1', routineId: 'r1', preset: 'bodyweight_ladder', options: { rungs: [{ name: 'Assisted', exerciseId: ASSISTED }, 'Pull-up'] } }).rule }
    expect(field(open(PULLUP, chain).host).textContent).toContain('Automatic: assisted')
  })

  it('the progression labels follow the choice', () => {
    const { host } = open(BENCH)
    expect(host.textContent).toContain('Increase load by')
    choose(host, 'Assisted')
    expect(host.textContent).toContain('Reduce assistance by')
  })
})
