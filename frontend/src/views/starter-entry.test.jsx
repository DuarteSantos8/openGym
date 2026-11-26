// @vitest-environment happy-dom
// Home and Plan both offer the starter plan to someone who has no routines yet. Both used to
// wire the button straight to the loader, which quietly handed the click event in as the plan
// id and loaded nothing at all — so both entry points are pinned here.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Home from './Home.jsx'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, routines: [], week: {}, active: null }, user: null }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const starterButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Load starter plan')

describe.each([['Home', Home], ['Plan', Plan]])('%s empty state', (_name, View) => {
  it('opens the starter plan chooser instead of loading one plan blind', () => {
    act(() => root.render(<View />))
    const button = starterButton()
    expect(button).toBeTruthy()

    act(() => { button.click() })
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('drops the offer once the user has routines', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'r', name: 'Mine', emoji: 'star', ex: [] }] } }))
    act(() => root.render(<View />))
    expect(starterButton()).toBeFalsy()
  })
})

it('shows time, frequency, level, equipment and a secondary plan name on all eight cards', () => {
  act(() => root.render(<Plan />))
  act(() => starterButton().click())
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))

  const expected = [
    ['ppl', 'Build muscle', 'Push / Pull / Legs', 3, '47–54', 'Intermediate', 'Full gym'],
    ['upper-lower', 'Build muscle', 'Upper / Lower', 4, '38–47', 'Intermediate', 'Full gym'],
    ['full-body', 'General fitness', 'Full Body', 3, '46', 'Beginner', 'Full gym'],
    ['5x5', 'Get stronger', '5×5', 3, '63', 'Beginner', 'Full gym'],
    ['home-bw', 'General fitness', 'No equipment', 3, '42–43', 'Beginner', 'table'],
    ['dumbbells', 'General fitness', 'Dumbbells only', 3, '40–48', 'Beginner', 'pair of dumbbells'],
    ['bands', 'General fitness', 'Resistance bands', 3, '40', 'Beginner', 'door'],
    ['hotel', 'General fitness', 'Hotel room', 2, '50', 'Beginner', 'Two chairs'],
  ]
  expect(host.querySelectorAll('[data-plan]')).toHaveLength(expected.length)
  for (const [id, goal, name, days, minutes, level, kit] of expected) {
    const card = host.querySelector(`[data-plan="${id}"]`)
    expect(card.querySelector('.tt').textContent).toContain(`${days} days per week`)
    expect(card.querySelector('.tt').textContent).toContain(goal)
    expect(card.textContent).toContain(`${minutes} min per session`)
    expect(card.querySelector('.tt').textContent).not.toContain(name)
    expect(card.querySelector('.ss').textContent).toBe(name)
    expect(card.textContent).toContain(level)
    expect(card.textContent).toContain(kit)
  }
})
