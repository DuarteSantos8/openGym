// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SectionManager, WorkoutPhase, usePhaseReorder } from './WorkoutSections.jsx'
import { normalizeState, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addSection, SECTION_PRESETS } from '../lib/workout-sections.js'
import { buildRoutineSession as buildSessionEntries } from '../lib/session-start.js'
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
afterEach(() => { act(() => root?.unmount()); host?.remove(); useUI.getState().stopRest(); useUI.getState().stopWork() })
const button = name => [...host.querySelectorAll('button')].find(el => el.textContent.trim() === name)
function mount(props, s) {
  render(<SectionManager {...props} />, s)
}
function render(node, s = {}) {
  useStore.setState({ S: normalizeState(s), user: null })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(node))
}
function pointer(target, type, { id = 7, kind = 'mouse', x = 20, y = 20 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({ pointerId: id, pointerType: kind, isPrimary: true, button: 0, clientX: x, clientY: y })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  act(() => target.dispatchEvent(event))
}

it('adds optional phases and presets without an exercise-assignment menu', () => {
  mount({ routineId: 'r' }, { routines: [{ id: 'r', ex: [{ id: '0025', sets: 1, reps: 5, weight: 40 }] }] })
  act(() => button('Warm-up').click())
  const r = useStore.getState().S.routines[0]
  expect(r.sections.map(s => s.type)).toEqual(['work', 'warmup'])
  expect(host.textContent).not.toContain('Exercises by phase')
  act(() => button('Add phase').click())
  const input = host.querySelector('.section-custom input[type="text"], .section-custom input:not([type])')
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Technique'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  act(() => host.querySelector('.section-custom form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useStore.getState().S.sectionPresets[0].label).toBe('Technique')
})

it('keeps rest ownership and the current occurrence when a whole phase moves', () => {
  const r = { id: 'r', ex: [{ id: '0025', sets: 1, reps: 5, weight: 40 }] }
  addSection(r, SECTION_PRESETS[0])
  r.ex.push({ id: '0047', sectionId: r.sections[1].id, sets: 1, reps: 5, weight: 20 })
  const s = normalizeState({ routines: [r], unit: 'kg' })
  const built = buildSessionEntries(s, s.routines[0])
  mount({ activeId: 'a' }, { ...s, active: { id: 'a', cur: 0, ...built } })
  act(() => useUI.getState().startRest(90, 0))
  act(() => host.querySelector('[aria-label="Move phase up: Warm-up"]').click())
  expect(useStore.getState().S.active.cur).toBe(1)
  expect(useUI.getState().timer.forIdx).toBe(1)
  act(() => useUI.getState().startWork(30, 'Hold', () => {}))
  expect(host.querySelector('fieldset').disabled).toBe(true)
})

it('edits phase colour inline and closes back to the same phase after saving', () => {
  const r = { id: 'r', ex: [] }
  addSection(r, SECTION_PRESETS[0])
  const id = r.sections[0].id
  mount({ routineId: 'r' }, { routines: [r] })
  function LivePhase() {
    const section = useStore(s => s.S.routines[0].sections[0])
    return <WorkoutPhase section={section} count={0} editor={{ routineId: 'r' }} />
  }
  act(() => root.render(<LivePhase />))
  act(() => host.querySelector('[aria-label="Edit phase: Warm-up"]').click())
  expect(host.querySelector('.phase-inline-settings')).toBeTruthy()
  const hex = host.querySelector('.phase-custom-color .input')
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(hex, '#oops'); hex.dispatchEvent(new Event('input', { bubbles: true })) })
  const error = host.querySelector('[role="alert"]')
  expect(error.textContent).toContain('six hex digits')
  expect(hex.getAttribute('aria-describedby')).toBe(error.id)
  expect(button('Save').disabled).toBe(true)
  act(() => host.querySelector('[aria-label="Violet"]').click())
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(button('Save').disabled).toBe(false)
  act(() => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(useStore.getState().S.routines[0].sections[0]).toMatchObject({ id, color: '#b59bff', countsAsWork: false })
  expect(host.querySelector('.phase-inline-settings')).toBeNull()
  expect(host.querySelector('[data-section-id]').style.getPropertyValue('--phase-color')).toBe('#b59bff')
})

it('collapses a phase without unmounting its contents', () => {
  const section = { id: 'warm', type: 'warmup', label: 'Warm-up', countsAsWork: false }
  render(<WorkoutPhase section={section} count={1}><input data-phase-child defaultValue="kept" /></WorkoutPhase>)
  const child = host.querySelector('[data-phase-child]')
  act(() => host.querySelector('[aria-label="Minimize: Warm-up"]').click())
  expect(host.querySelector('.workout-phase-body').hidden).toBe(true)
  expect(host.querySelector('[data-phase-child]')).toBe(child)
  expect(host.querySelector('[aria-label="Expand: Warm-up"]').getAttribute('aria-expanded')).toBe('false')
  act(() => host.querySelector('[aria-label="Expand: Warm-up"]').click())
  expect(host.querySelector('.workout-phase-body').hidden).toBe(false)
})

it('reorders phases from the dedicated grip and cancels cleanly', () => {
  const sections = [{ id: 'warm', label: 'Warm-up' }, { id: 'work', label: 'Working sets' }]
  const onDrop = vi.fn()
  function PhaseList() {
    const ref = React.useRef(null)
    const drag = usePhaseReorder(ref, sections, false, onDrop)
    return <div ref={ref} data-phase-list>{sections.map(section => <WorkoutPhase key={section.id} section={section} count={0} reorderable phaseDrag={drag} />)}</div>
  }
  render(<PhaseList />)
  const list = host.querySelector('[data-phase-list]')
  const phases = [...host.querySelectorAll('[data-section-zone]')]
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 300, top: 0, bottom: 220 })
  vi.spyOn(phases[0], 'getBoundingClientRect').mockReturnValue({ left: 0, right: 300, top: 0, bottom: 100 })
  vi.spyOn(phases[1], 'getBoundingClientRect').mockReturnValue({ left: 0, right: 300, top: 120, bottom: 220 })
  const firstGrip = phases[0].querySelector('[data-phase-drag-handle]')
  pointer(firstGrip, 'pointerdown', { y: 40 })
  pointer(document, 'pointermove', { y: 160 })
  expect(phases[1].classList.contains('is-phase-drop-target')).toBe(true)
  pointer(document, 'pointercancel', { y: 160 })
  expect(onDrop).not.toHaveBeenCalled()

  pointer(firstGrip, 'pointerdown', { y: 40 })
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  pointer(document, 'pointerup', { y: 160 })
  expect(onDrop).not.toHaveBeenCalled()

  pointer(firstGrip, 'pointerdown', { y: 40 })
  pointer(document, 'pointermove', { y: 160 })
  pointer(document, 'pointerup', { y: 160 })
  expect(onDrop).toHaveBeenCalledWith('warm', 'work')
})
