// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { bindUI } from './components/ui.jsx'

// Simple mode (lib/simple.js): the exercise settings open on sets, reps, weight, rest and a note, and
// everything else sits behind "More options".
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
const open = cfg => {
  exConfigSheet(ex, { sets: 3, reps: 5, weight: 40, mode: 'reps', ...cfg }, vi.fn())
  return render(useUI.getState().sheets.at(-1))
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const ADVANCED = ['Last set to failure', 'Pyramid sets', 'Warm-up sets', 'Intensifier', 'Plate loading', 'Rest between warm-ups']

describe('exercise settings in simple mode', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  const simple = on => useStore.setState(s => ({ S: { ...s.S, unit: 'kg', simple: on } }))

  it('keeps sets, reps, weight, rest and the note, and folds the rest away', () => {
    simple(true)
    const host = open({})
    for (const word of ['Sets', 'Reps', 'Weight (kg)', 'Rest for this exercise']) expect(host.textContent).toContain(word)
    expect(host.querySelector('textarea')).not.toBeNull()
    for (const word of ADVANCED) expect(host.textContent).not.toContain(word)
    expect(button(host, 'More options')).toBeDefined()
  })

  it('shows everything behind "More options", and folds it again', () => {
    simple(true)
    const host = open({})
    act(() => button(host, 'More options').click())
    for (const word of ADVANCED) expect(host.textContent).toContain(word)
    expect(button(host, 'Fewer options')).toBeDefined()
    act(() => button(host, 'Fewer options').click())
    expect(host.textContent).not.toContain('Last set to failure')
  })

  it('opens an exercise that already uses an advanced option with it in view', () => {
    simple(true)
    const host = open({ lastToFailure: true })
    expect(host.textContent).toContain('Last set to failure')
    expect(button(host, 'More options')).toBeUndefined()
  })

  it('shows the full sheet, with no extra button, when simple mode is off', () => {
    simple(false)
    const host = open({})
    for (const word of ADVANCED) expect(host.textContent).toContain(word)
    expect(button(host, 'More options')).toBeUndefined()
  })
})
