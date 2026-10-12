// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet } from './sheets.jsx'

const mounted = []

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

describe('bwSheet date selection for past entries', () => {
  let original

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    original = useStore.getState().S
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
    useStore.setState({ S: { ...original, bodyweight: [], unit: 'kg' } })
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    useStore.setState({ S: original })
  })

  it('renders a date input when not required (manual log), allowing past dates', () => {
    act(() => bwSheet())
    const host = renderTop()
    const dateInput = host.querySelector('input[type="date"]')
    expect(dateInput).not.toBeNull()

    // Change date to past
    const pastDate = '2026-09-15'
    act(() => {
      dateInput.value = pastDate
      dateInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Click Save
    const saveBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')
    expect(saveBtn).not.toBeNull()
    act(() => saveBtn.click())

    const bwList = useStore.getState().S.bodyweight
    expect(bwList).toHaveLength(1)
    expect(bwList[0].d).toBe(pastDate)
    expect(bwList[0].w).toBe(70)
  })

  it('does not render date input when required for workout start', () => {
    act(() => bwSheet({ required: true }))
    const host = renderTop()
    const dateInput = host.querySelector('input[type="date"]')
    expect(dateInput).toBeNull()
  })
})
