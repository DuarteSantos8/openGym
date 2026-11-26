// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import Workout from './Workout.jsx'
import { useUI } from '../store/useUI.js'

it('opens the definition for every Workout term from a standalone button', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
    expect(host.querySelector('.iv-term')).toBeNull()
    const glossary = host.querySelector('.iv-screen-glossary')
    await act(async () => {
      glossary.open = true
      glossary.dispatchEvent(new Event('toggle'))
      await import('../components/Term.jsx')
    })
    const buttons = [...host.querySelectorAll('button.iv-term')]
    for (const label of ['Warm-up', 'Working set', 'RIR', 'RPE', 'Drop set', 'Superset']) {
      const button = buttons.find(el => el.textContent === label)
      expect(button, label).toBeDefined()
      expect(button.parentElement.closest('button, a, summary, [role="button"]')).toBeNull()
      act(() => button.click())
      const sheet = useUI.getState().sheets.at(-1)
      expect(sheet.render(() => {}).props.entry.term).toBe(label)
      useUI.getState().closeSheet(sheet.id)
    }
  } finally { act(() => root.unmount()) }
})
