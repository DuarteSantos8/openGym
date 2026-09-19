// @vitest-environment happy-dom
// Exercise parity (issue #199): the single custom-exercise editor also edits a built-in via
// exOverrides, and Hide/Delete share one safe-deletion guard regardless of exercise kind.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exerciseDetailSheet, customExSheet, exConfigSheet } from './sheets.jsx'

const mounted = []
const S = () => useStore.getState().S

// Renders whatever sheet is on top and returns its host element.
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

const clickByText = (host, text) => act(() => {
  const btn = [...host.querySelectorAll('button')].find(b => b.textContent === text)
  btn.click()
})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('built-in exercise detail parity', () => {
  it('offers Edit and Hide for a built-in detail sheet', () => {
    exerciseDetailSheet(EXDB[0])
    const host = renderTop()
    expect(host.textContent).toContain('Edit')
    expect(host.textContent).toContain('Hide')
  })

  it('blocks hiding a built-in that is in the active workout, like the custom delete guard', () => {
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'a', entries: [{ id: EXDB[0].id }] } } }))
    exerciseDetailSheet(EXDB[0])
    const host = renderTop()
    clickByText(host, 'Hide')
    expect(useUI.getState().toastMsg).toBe('Finish your current workout first')
    expect(useUI.getState().sheets).toHaveLength(1)   // no confirm sheet stacked on top
  })

  it('hides a built-in through the confirm dialog and lists it in deletedEx', () => {
    useStore.setState(s => ({ S: { ...s.S, favEx: [EXDB[0].id] } }))
    exerciseDetailSheet(EXDB[0])
    const host = renderTop()
    clickByText(host, 'Hide')
    expect(useUI.getState().sheets).toHaveLength(2)
    const confirmHost = renderTop()
    clickByText(confirmHost, 'Hide')
    expect(S().deletedEx).toEqual([EXDB[0].id])
    expect(S().favEx).toEqual([])
  })
})

describe('unified exercise editor', () => {
  it('does not retain a built-in override when every field equals its catalogue row', () => {
    customExSheet(EXDB[0])
    const host = renderTop()
    clickByText(host, 'Save')
    expect(S().exOverrides?.[EXDB[0].id]).toBeUndefined()
  })

  it('writes an override only for a field that actually changed', () => {
    customExSheet(EXDB[0])
    const host = renderTop()
    const nameInput = host.querySelector('input.input')
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(nameInput, 'My renamed sit-up')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickByText(host, 'Save')
    expect(S().exOverrides[EXDB[0].id]).toEqual({ n: 'My renamed sit-up' })
  })

  it('stores only trimmed non-empty built-in steps', () => {
    customExSheet(EXDB[0])
    const host = renderTop()
    clickByText(host, 'Add step')
    act(() => {
      const step = host.querySelector('[aria-label="Step 1"]')
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(step, ' Set up ')
      step.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickByText(host, 'Save')
    expect(S().exOverrides[EXDB[0].id].st).toEqual(['Set up'])
  })

  it('resets a single overridden field back to its catalogue value without touching others', () => {
    customExSheet(EXDB[0])
    const host = renderTop()
    const nameInput = host.querySelector('input.input')
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(nameInput, 'My renamed sit-up')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const resetBtn = () => host.querySelector('[aria-label="Reset to default"]')
    expect(resetBtn()).not.toBeNull()
    act(() => resetBtn().click())
    expect(nameInput.value).toBe(EXDB[0].n)
    expect(resetBtn()).toBeNull()
    clickByText(host, 'Save')
    expect(S().exOverrides?.[EXDB[0].id]).toBeUndefined()
  })

  // The dataset has real duplicate names ("lever chest press" is both 0576 and 0577). The dup
  // check exists so customs stay unique by construction — it must not also block a built-in
  // edit that leaves the name untouched, just because some other unrelated catalogue row
  // happens to share that name.
  it('saves a built-in edit even when its name collides with another catalogue entry', () => {
    const dup = EXDB.find(e => e.id === '0577')
    expect(dup.n.toLowerCase()).toBe('lever chest press')
    expect(EXDB.some(e => e.id !== dup.id && e.n.toLowerCase() === dup.n.toLowerCase())).toBe(true)
    customExSheet(dup)
    const host = renderTop()
    clickByText(host, 'Add step')
    act(() => {
      const step = host.querySelector('[aria-label="Step 1"]')
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(step, 'A tweak')
      step.dispatchEvent(new Event('input', { bubbles: true }))
    })
    clickByText(host, 'Save')
    expect(useUI.getState().toastMsg).not.toMatch(/already exists/)
    expect(S().exOverrides[dup.id].st).toEqual(['A tweak'])
    expect(S().exOverrides[dup.id].n).toBeUndefined() // name itself was never touched
  })
})

describe('ExConfig for an unresolvable exercise', () => {
  // RoutineEdit passes exOr(e.id) for a routine entry whose id is no longer in the dataset,
  // which resolves to the { missing: true } placeholder. Editing/hiding it would write an
  // exOverrides entry effectiveCatalogue can never surface (CATALOGUE.find fails on a fake id)
  // or pollute deletedEx with a permanently meaningless row — so the button must not appear.
  it('does not offer "Edit or delete this exercise" for a missing placeholder', () => {
    const placeholder = { id: 'ghost-id', n: 'Unknown exercise', bp: '', tg: '', eq: '', sm: [], st: [], missing: true }
    exConfigSheet(placeholder, null, () => {}, null, null, null)
    const host = renderTop()
    expect(host.textContent).not.toContain('Edit or delete this exercise')
  })

  it('still offers the button for a real (non-missing) exercise', () => {
    exConfigSheet(EXDB[0], null, () => {}, null, null, null)
    const host = renderTop()
    expect(host.textContent).toContain('Edit or delete this exercise')
  })
})
