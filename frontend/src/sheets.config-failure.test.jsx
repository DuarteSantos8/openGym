// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, setsLine } from './sheets.jsx'
import { migratedFixture, ruleOccurrence } from './lib/test-fixtures.js'
import { bindUI } from './components/ui.jsx'

// Sets to failure on the exercise's settings: none, the last set, all of them, or the numbers
// picked one by one. "Last" is the flag `lastToFailure` v1.4.0 wrote; the rest is `failureSets`.
// Either is written only when on.
const ex = EXDB.find(e => e.id === '0009')
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
// `cfg` is the v1 shape the fixture migrates; `fields` are v2 occurrence fields laid over the result.
const open = (cfg, onSave, fields = {}) => {
  const occurrence = migratedFixture({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: ex.id, sets: 3, reps: 5, weight: 40, mode: 'reps', ...cfg }] }] }).routines[0].ex[0]
  exConfigSheet(ex, { ...occurrence, ...fields }, onSave)
  return render(useUI.getState().sheets.at(-1))
}
const ranged = ruleOccurrence(ex.id, { preset: 'double', options: { sets: { min: 3, max: 5 } } }).rule
const section = host => host.querySelector('[data-section="failure"]')
const mode = (host, label) => [...section(host).querySelectorAll('.seg button')].find(b => b.textContent.trim() === label)
const setButton = (host, n) => [...section(host).querySelectorAll('.fs-sets button')].find(b => b.getAttribute('aria-label') === `Set ${n}`)
const pressed = host => [...section(host).querySelectorAll('.fs-sets button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => Number(b.getAttribute('aria-label').slice(4)))
const rowNamed = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const save = host => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())

describe('exercise settings: sets to failure', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('is on None by default, with a button for each of the plan\'s sets, and saves nothing then', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    expect(mode(host, 'None').getAttribute('aria-pressed')).toBe('true')
    expect([1, 2, 3].map(n => !!setButton(host, n))).toEqual([true, true, true])
    expect(setButton(host, 4)).toBeUndefined()
    expect(pressed(host)).toEqual([])
    save(host)
    expect('lastToFailure' in onSave.mock.calls[0][0]).toBe(false)
    expect('failureSets' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('Last presses the last set and saves the v1.4.0 flag, as before', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => mode(host, 'Last').click())
    expect(pressed(host)).toEqual([3])
    save(host)
    expect(onSave.mock.calls[0][0].lastToFailure).toBe(true)
    expect('failureSets' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('All presses every set and saves failureSets: all, without the flag', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => mode(host, 'All').click())
    expect(pressed(host)).toEqual([1, 2, 3])
    save(host)
    expect(onSave.mock.calls[0][0].failureSets).toBe('all')
    expect('lastToFailure' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('picks sets one by one, leaves the three modes unpressed, and saves the numbers', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => setButton(host, 3).click())
    act(() => setButton(host, 1).click())
    expect(pressed(host)).toEqual([1, 3])
    expect(section(host).querySelector('.seg').classList.contains('no-sel')).toBe(true)
    expect(['None', 'Last', 'All'].map(label => mode(host, label).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
    save(host)
    expect(onSave.mock.calls[0][0].failureSets).toEqual([1, 3])
    expect('lastToFailure' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('takes a set back out of All, and None clears the choice', () => {
    const onSave = vi.fn()
    const host = open({}, onSave, { failureSets: 'all' })
    expect(pressed(host)).toEqual([1, 2, 3])
    act(() => setButton(host, 2).click())
    expect(pressed(host)).toEqual([1, 3])
    act(() => mode(host, 'None').click())
    expect(pressed(host)).toEqual([])
    save(host)
    expect('failureSets' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('opens on what the occurrence says: the v1.4.0 flag as Last, failureSets as its numbers', () => {
    expect(pressed(open({ lastToFailure: true }))).toEqual([3])
    expect(mode(open({ lastToFailure: true }), 'Last').getAttribute('aria-pressed')).toBe('true')
    expect(pressed(open({}, vi.fn(), { failureSets: [2] }))).toEqual([2])
  })

  it('drops a number past the plan\'s sets when it saves', () => {
    const onSave = vi.fn()
    const host = open({}, onSave, { failureSets: [2, 9] })
    save(host)
    expect(onSave.mock.calls[0][0].failureSets).toEqual([2])
  })

  it('marks the sets a range may not reach as optional, and says so', () => {
    const host = open({}, vi.fn(), { rule: ranged })
    expect([1, 2, 3, 4, 5].map(n => setButton(host, n).textContent.includes('?'))).toEqual([false, false, false, true, true])
    expect(section(host).textContent).toContain('Sets marked ? are optional')
    const fixed = open({}, vi.fn())
    expect(section(fixed).textContent).not.toContain('Sets marked ? are optional')
  })

  it('comes on with Greyskull, whose last set is an AMRAP, unless it was already decided', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => rowNamed(host, 'Progression').click())
    const picker = render(useUI.getState().sheets.at(-1))
    act(() => [...picker.querySelectorAll('button.lrow')].find(el => el.querySelector('.lrow-t')?.textContent === 'Greyskull LP').click())
    expect(mode(host, 'Last').getAttribute('aria-pressed')).toBe('true')
    save(host)
    expect(onSave.mock.calls[0][0]).toMatchObject({ rule: { preset: 'greyskull' }, lastToFailure: true })
  })

  it('does not take Greyskull\'s own choice back once a set was picked by hand', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => setButton(host, 1).click())
    act(() => rowNamed(host, 'Progression').click())
    const picker = render(useUI.getState().sheets.at(-1))
    act(() => [...picker.querySelectorAll('button.lrow')].find(el => el.querySelector('.lrow-t')?.textContent === 'Greyskull LP').click())
    save(host)
    expect(onSave.mock.calls[0][0].failureSets).toEqual([1])
  })

  it('is not offered on a pyramid, which has its own Max set, nor under a rest-pause', () => {
    expect(section(open({ pyramid: [12, 8, 0] }))).toBeNull()
    const loaded = ruleOccurrence(ex.id, { preset: 'double', options: { load: { mode: 'absolute', value: 40, unit: 'kg' } } }).rule
    expect(section(open({}, vi.fn(), { rule: loaded }))).not.toBeNull()
    expect(section(open({}, vi.fn(), { rule: loaded, intensifier: { type: 'restpause', totalReps: 8, restSec: 15 } }))).toBeNull()
  })

  it('the finish summary line marks a failure set', () => {
    expect(setsLine([{ w: 60, r: 5 }, { w: 60, r: 9, f: true }], 'kg')).toBe('60 kg × 5, 9 F')
    expect(setsLine([{ w: 60, r: 5 }, { w: 65, r: 4, f: true }], 'kg')).toBe('60×5 · 65×4 F')
  })
})
