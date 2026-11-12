// @vitest-environment happy-dom
// The cardio plans sheet (components/CardioPlansSheet.jsx): the list, the editor, the paste box,
// saving the exercise's own sets as a plan, and deleting one.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CardioPlansSheet from './CardioPlansSheet.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { plansOf, savePlan, newPlan } from '../lib/cardio-plans.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const PASTED = `➡️ Minutos 0–3
Inclinação: 4
Velocidade: 5,0 km/h

➡️ Minutos 3–6
Inclinação: 7
Velocidade: 5,4 km/h`

let root, host
const mount = (props = {}, state = {}) => {
  const S = clone(DEF)
  Object.assign(S, state)
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onApply = vi.fn(), close = vi.fn()
  act(() => root.render(<CardioPlansSheet sets={[]} withIncline close={close} onApply={onApply} {...props} />))
  return { onApply, close }
}
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }) })
afterEach(() => { if (root) act(() => root.unmount()); if (host) host.remove(); root = host = null })

describe('the list', () => {
  it('says there are no plans yet, and offers to write or paste one', () => {
    mount()
    expect(host.textContent).toContain('No plans yet')
    expect(button('New plan')).toBeTruthy()
    expect(button('Paste a plan')).toBeTruthy()
    // Nothing to save while the exercise has no usable rows.
    expect(button('Save these sets as a plan')).toBeUndefined()
  })

  it('picking a plan hands it over and closes', () => {
    const seeded = clone(DEF)
    savePlan(seeded, newPlan('Hills', [{ min: 3, speed: 5, incline: 4 }, { min: 3, speed: 5.4 }], 1))
    const { onApply, close } = mount({}, { cardioPlans: seeded.cardioPlans })
    expect(host.textContent).toContain('Hills')
    expect(host.textContent).toContain('Segments: 2 · 6 min')
    act(() => host.querySelector('.cardio-plan-pick').click())
    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0][0].name).toBe('Hills')
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('writing a plan', () => {
  it('saves a new plan from the editor, needing a name first', () => {
    mount()
    act(() => button('New plan').click())
    expect(host.textContent).toContain('Segment 1')
    expect(button('Save plan').disabled).toBe(true)
    type(host.querySelector('input[type="text"]'), '  Easy   walk ')
    expect(button('Save plan').disabled).toBe(false)
    act(() => button('Add segment').click())
    expect(host.textContent).toContain('Segment 2')
    act(() => button('Save plan').click())
    const [plan] = plansOf(useStore.getState().S)
    expect(plan.name).toBe('Easy walk')
    expect(plan.segments).toEqual([{ min: 5, speed: 5 }, { min: 5, speed: 5 }])
    // Back on the list, where it now is.
    expect(host.querySelector('.cardio-plan-pick').textContent).toContain('Easy walk')
  })

  it('has no incline stepper on an exercise without a grade', () => {
    mount({ withIncline: false })
    act(() => button('New plan').click())
    expect(host.textContent).not.toContain('Incline (%)')
  })

  it('keeps at least one segment', () => {
    mount()
    act(() => button('New plan').click())
    expect(host.querySelector('button[aria-label="Remove segment"]').disabled).toBe(true)
    act(() => button('Add segment').click())
    expect(host.querySelector('button[aria-label="Remove segment"]').disabled).toBe(false)
  })

  it('saves the exercise’s own rows as a plan', () => {
    mount({ sets: [{ min: 10, speed: 5, incline: 2, done: true }, { min: 5, speed: 6, done: false }] })
    act(() => button('Save these sets as a plan').click())
    type(host.querySelector('input[type="text"]'), 'My usual')
    act(() => button('Save plan').click())
    expect(plansOf(useStore.getState().S)[0].segments).toEqual([{ min: 10, speed: 5, incline: 2 }, { min: 5, speed: 6 }])
  })
})

describe('pasting a plan', () => {
  it('reads the text into the editor, to check and name before saving', () => {
    mount()
    act(() => button('Paste a plan').click())
    expect(button('Read plan').disabled).toBe(true)
    type(host.querySelector('textarea'), PASTED)
    act(() => button('Read plan').click())
    expect(host.textContent).toContain('Read 2 segments. Check them, then save.')
    expect(host.textContent).toContain('Segment 2')
    type(host.querySelector('input[type="text"]'), 'Hills')
    act(() => button('Save plan').click())
    expect(plansOf(useStore.getState().S)[0].segments).toEqual([{ min: 3, speed: 5, incline: 4 }, { min: 3, speed: 5.4, incline: 7 }])
  })

  it('says so when nothing in the text is a plan', () => {
    mount()
    act(() => button('Paste a plan').click())
    type(host.querySelector('textarea'), 'good workout today')
    act(() => button('Read plan').click())
    expect(host.textContent).toContain('Nothing could be read from that text.')
    expect(host.textContent).not.toContain('Segment 1')
  })
})

describe('editing and deleting', () => {
  it('opens a saved plan with its segments, and deleting asks first', () => {
    const seeded = clone(DEF)
    const p = savePlan(seeded, newPlan('Hills', [{ min: 3, speed: 5 }], 1))
    mount({}, { cardioPlans: seeded.cardioPlans })
    act(() => host.querySelector('button[aria-label="Edit plan"]').click())
    expect(host.querySelector('input[type="text"]').value).toBe('Hills')
    act(() => button('Delete plan').click())
    expect(plansOf(useStore.getState().S)).toHaveLength(1)
    const ask = useUI.getState().sheets.at(-1)
    const askHost = document.createElement('div')
    document.body.appendChild(askHost)
    const r = createRoot(askHost)
    act(() => r.render(ask.render(() => useUI.getState().closeSheet(ask.id))))
    act(() => [...askHost.querySelectorAll('button')].find(b => b.textContent === 'Delete plan').click())
    expect(plansOf(useStore.getState().S)).toHaveLength(0)
    expect(p.id).toBeTruthy()
    // Back on the list.
    expect(host.textContent).toContain('No plans yet')
    act(() => r.unmount()); askHost.remove()
  })
})
