// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

/* #583: a bodyweight exercise with nothing added has no weight to step up, so the progression
   asks for no Step there; it climbs in reps, then sets. A weighted one keeps its Step. */
const mounted = []
function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')
const hasStep = host => host.textContent.includes('Step (kg)')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

describe('the progression step on bodyweight work (#583)', () => {
  it('push-ups with nothing added: no step, a word on how it climbs, and Save works even with a step of 0 stored', () => {
    const onSave = vi.fn()
    exConfigSheet(EXIDX['0662'], { sets: 3, reps: 10, weight: 0, mode: 'reps', prog: 'linear', inc: 0 }, onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(hasStep(host)).toBe(false)
    expect(host.textContent).toContain('it goes up in reps, then sets')
    expect(save(host).disabled).toBe(false)
    act(() => save(host).click())
    // what was stored stays as it was
    expect(onSave.mock.calls[0][0]).toMatchObject({ prog: 'linear' })
  })
  it('push-ups with a vest on (weight added) and a barbell lift keep the step', () => {
    exConfigSheet(EXIDX['0662'], { sets: 3, reps: 10, weight: 10, mode: 'reps', prog: 'linear' }, vi.fn())
    expect(hasStep(render(useUI.getState().sheets.at(-1)))).toBe(true)
    exConfigSheet(EXIDX['0025'], { sets: 3, reps: 8, weight: 60, mode: 'reps', prog: 'linear' }, vi.fn())
    expect(hasStep(render(useUI.getState().sheets.at(-1)))).toBe(true)
  })
})
