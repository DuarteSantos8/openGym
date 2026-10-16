// @vitest-environment happy-dom
// Nutrition's pinned "left" readout (moved from Home's old date strip): what is left or over,
// nothing while the calories card is on screen.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useNutrition } from '../lib/nutrition/store.js'
import KcalLeftBar from './KcalLeftBar.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => {
  useNutrition.getState().reset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = el => act(() => root.render(el))
const pill = () => host.querySelector('.kcal-left-pill')

describe('KcalLeftBar', () => {
  it('says what is left, or what is over in orange ink, and nothing while the card is in view', () => {
    render(<KcalLeftBar left={1240} />)
    expect(pill().textContent).toBe('1,240 kcal left')
    expect(pill().classList.contains('over')).toBe(false)
    render(<KcalLeftBar left={-120} />)
    expect(pill().textContent).toBe('120 kcal over')
    expect(pill().classList.contains('over')).toBe(true)
    render(<KcalLeftBar left={null} />)
    expect(pill()).toBeNull()
    // The calories card says it to a screen reader; the bar is decoration.
    expect(host.querySelector('.kcal-left-bar').getAttribute('aria-hidden')).toBe('true')
  })
})
