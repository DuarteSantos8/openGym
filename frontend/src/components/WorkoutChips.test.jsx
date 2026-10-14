// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import WorkoutChips from './WorkoutChips.jsx'

let root
let host
afterEach(() => { act(() => root?.unmount()); host?.remove() })
const phase = (id, color = '#45c9b0') => ({ id, type: 'custom', label: id, color })
function render(ids, sections) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onPick = vi.fn()
  const entries = ids.map((sectionId, i) => ({ id: '0025', sectionId, sets: [{ done: i === 0 }, { done: i < 2 }] }))
  act(() => root.render(<WorkoutChips entries={entries} sections={sections} cur={1} onPick={onPick} />))
  return onPick
}
it('joins only adjacent chips of the same phase, even when other phases share its colour', () => {
  const onPick = render(['warm', 'warm', 'work', 'warm', undefined], [phase('warm'), phase('work')])
  const buttons = [...host.querySelectorAll('button')]
  const lines = [...host.querySelectorAll('.wchip-phase')]
  expect(lines.map(line => line.classList.contains('continues'))).toEqual([true, false, false, false])
  expect(lines.map(line => line.dataset.phaseId)).toEqual(['warm', 'warm', 'work', 'warm'])
  expect(lines[0].style.getPropertyValue('--phase-color')).toBe('#45c9b0')
  expect(buttons[0].classList.contains('done')).toBe(true)
  expect(buttons[1].classList.contains('partial')).toBe(true)
  expect(buttons[1].getAttribute('aria-current')).toBe('step')
  expect(buttons[2].classList.contains('todo')).toBe(true)
  expect(buttons[0].getAttribute('aria-label')).toContain('warm')
  act(() => buttons[3].click())
  expect(onPick.mock.calls[0][0].unit).toEqual([3])
})
it('leaves workouts without phases unchanged', () => {
  render([undefined, undefined], null)
  expect(host.querySelector('.wchip-phase')).toBeNull()
  expect(host.querySelector('.has-phases')).toBeNull()
})