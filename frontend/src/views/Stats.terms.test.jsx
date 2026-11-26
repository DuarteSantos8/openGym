// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'
import { useUI } from '../store/useUI.js'

// Device-only use must still work when a separate Learn chunk cannot be fetched.
vi.mock('../components/Term.jsx', () => { throw new Error('Offline') })

it('opens the definition for every Stats term from a standalone button', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    act(() => root.render(<MemoryRouter><Stats /></MemoryRouter>))
    expect(host.querySelector('.iv-term')).toBeNull()
    const glossary = host.querySelector('.iv-screen-glossary')
    await act(async () => {
      glossary.open = true
      glossary.dispatchEvent(new Event('toggle'))
    })
    const buttons = [...host.querySelectorAll('button.iv-term')]
    for (const label of ['PR', 'Volume', '1RM', 'Estimated 1RM']) {
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
