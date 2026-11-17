// @vitest-environment happy-dom
// Settings → Look & Home → Glass effect (Liquid Glass G9): an iPhone row, off makes the bars solid.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import DisplayRows from './DisplayRows.jsx'
import { applyDisplay } from '../lib/display-prefs.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = document.documentElement

function mount() {
  const el = document.createElement('div')
  document.body.replaceChildren(el)
  act(() => createRoot(el).render(<DisplayRows />))
  return [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Glass effect')
}

afterEach(() => { delete root.dataset.platform; applyDisplay({ motion: 'system', text: 'default' }, { save: true }); localStorage.clear() })

describe('Glass effect', () => {
  it('is an iPhone row only', () => {
    root.dataset.platform = 'web'
    expect(mount()).toBeUndefined()
  })

  it('on iPhone, off makes the bars solid and on brings the glass back', () => {
    root.dataset.platform = 'ios'
    const sw = () => mount().querySelector('[role="switch"]')
    expect(sw().getAttribute('aria-checked')).toBe('true')
    { const b = sw(); act(() => b.click()) }
    expect(root.hasAttribute('data-reduce-transparency')).toBe(true)
    expect(sw().getAttribute('aria-checked')).toBe('false')   // remembered on a fresh mount
    { const b = sw(); act(() => b.click()) }
    expect(root.hasAttribute('data-reduce-transparency')).toBe(false)
  })
})
