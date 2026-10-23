// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB, EXIDX } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, exercisePicker } from './sheets.jsx'
import { exerciseNameFor } from './lib/i18n.js'
import { exerciseNameText } from './lib/format.js'

/* Planned substitutes (Discord "Substitutions for a routine"): picked in the routine editor's
   exercise sheet, offered first by the swap picker, kept by every sheet that saves the slot. */
const ex = EXDB.find(e => e.id === '0025')
const mounted = []
function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const row = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

describe('the routine editor\'s exercise sheet', () => {
  it('shows the backups and keeps them on save; without any, no field', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps', subs: ['0047', '0289'] }, onSave, null, null, null, null, undefined, { backups: true })
    const host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Backups').querySelector('.lrow-v').textContent).toBe('2')
    expect(row(host, 'Backups').textContent).toContain(exerciseNameFor(EXIDX['0047']))
    act(() => save(host))
    expect(onSave.mock.calls[0][0].subs).toEqual(['0047', '0289'])

    const none = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps' }, none, null, null, null, null, undefined, { backups: true })
    const second = render(useUI.getState().sheets.at(-1))
    act(() => save(second))
    expect('subs' in none.mock.calls[0][0]).toBe(false)
  })

  it('adds one from the library and removes one', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps', subs: ['0047'] }, onSave, null, null, null, null, undefined, { backups: true })
    const host = render(useUI.getState().sheets.at(-1))
    act(() => row(host, 'Backups').click())
    const sheet = render(useUI.getState().sheets.at(-1))
    // The name in a sentence is title-cased like everywhere else it is shown (QA v1.4.2).
    expect(sheet.querySelector('h3').textContent).toBe('Backups for ' + exerciseNameText(ex))
    expect(sheet.querySelector('h3').textContent).toBe('Backups for Barbell Bench Press')
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Add a backup').click())
    const picker = render(useUI.getState().sheets.at(-1))
    const name = exerciseNameFor(EXIDX['0289'])
    act(() => [...picker.querySelectorAll('.chip')].find(c => c.textContent === 'All').click())
    const input = picker.querySelector('input.input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const pick = [...picker.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
    act(() => pick.click())
    act(() => [...sheet.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Remove “' + exerciseNameText(EXIDX['0047']) + '”').click())
    act(() => save(host))
    expect(onSave.mock.calls[0][0].subs).toEqual(['0289'])
  })

  it('elsewhere (a workout\'s own sheet) the row is not offered, and the backups still survive a save', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 8, weight: 60, mode: 'reps', subs: ['0047'] }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(row(host, 'Backups')).toBeUndefined()
    act(() => save(host))
    expect(onSave.mock.calls[0][0].subs).toEqual(['0047'])
  })
})

describe('the swap picker', () => {
  it('lists the slot\'s backups first, and leaves them out while searching', () => {
    exercisePicker(() => {}, { title: 'Swap exercise', like: '0025', backups: ['0289', 'gone'] })
    const host = render(useUI.getState().sheets.at(-1))
    const heads = [...host.querySelectorAll('h4.sec')].map(h => h.textContent)
    expect(heads.slice(0, 2)).toEqual(['Your backups', 'Everything else'])
    const first = host.querySelector('h4.sec').nextElementSibling
    expect(first.textContent).toContain(exerciseNameFor(EXIDX['0289']))
  })
  it('no backups, no section', () => {
    exercisePicker(() => {}, { title: 'Swap exercise', like: '0025' })
    const host = render(useUI.getState().sheets.at(-1))
    expect([...host.querySelectorAll('h4.sec')].map(h => h.textContent)).not.toContain('Your backups')
  })
})
