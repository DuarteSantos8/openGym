// @vitest-environment happy-dom
// Find my plan (EP22): six questions, a plan with its reasons, and "Use this plan".
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Onboarding, { forgetQuizDraft } from './Onboarding.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { isOn } from '../lib/modules.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root, container, where
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null; act(() => useUI.setState({ sheets: [] })); forgetQuizDraft() })

function Where() { where = useLocation().pathname; return null }

function mount(patch = {}) {
  const S = clone(DEF)
  Object.assign(S, patch)
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter initialEntries={['/start']}>
    <Where />
    <Routes><Route path="/start" element={<Onboarding />} /><Route path="*" element={<div data-elsewhere />} /></Routes>
  </MemoryRouter>))
}

const q = () => container.querySelector('.iv-quiz-q')?.textContent
const pick = value => act(() => container.querySelector(`[data-option="${value}"]`).click())
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const answerAll = ({ goal = 'general', days = 3, minutes = 45, equipment = 'gym', experience = 'never', limits = [] } = {}) => {
  pick(goal); pick(days); pick(minutes); pick(equipment); pick(experience)
  for (const l of limits) pick(l)
  act(() => button('Show my plan').click())
}

describe('Find my plan', () => {
  it('asks one question at a time and says how far along it is', () => {
    mount()
    expect(q()).toBe('What do you want most?')
    expect(container.querySelector('.hdr .sub').textContent).toBe('Question 1 of 6')
    expect(container.querySelector('[role="radiogroup"]').getAttribute('aria-labelledby')).toBe(container.querySelector('.iv-quiz-q').id)
    pick('muscle')
    expect(q()).toBe('How many days a week can you train?')
    expect(container.querySelector('.hdr .sub').textContent).toBe('Question 2 of 6')
  })

  it('starts with nothing chosen on a first visit', () => {
    mount()
    expect([...container.querySelectorAll('[role="radio"]')].every(o => o.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(container.querySelector('.iv-quiz-option.on')).toBe(null)
  })

  it('goes back a question and remembers what was answered', () => {
    mount()
    pick('strength'); pick(4)
    expect(q()).toBe('How long can one session be?')
    act(() => container.querySelector('[data-back]').click())
    expect(q()).toBe('How many days a week can you train?')
    expect(container.querySelector('[data-option="4"]').getAttribute('aria-checked')).toBe('true')
    act(() => container.querySelector('[data-back]').click())
    expect(container.querySelector('[data-option="strength"]').getAttribute('aria-checked')).toBe('true')
  })

  it('shows a plan with its reasons and the week', () => {
    mount()
    answerAll()
    const card = container.querySelector('.iv-quiz-plan')
    expect(card.dataset.plan).toBe('full-body')
    expect(card.textContent).toContain('Beginner')
    expect(card.textContent).toContain('3 days per week')
    expect(card.textContent).toContain('2 sets of 12 reps to start.')
    expect([...container.querySelectorAll('[data-why]')].map(x => x.dataset.why)).toEqual(['plan-full-body', 'goal-general'])
    const days = [...container.querySelectorAll('.iv-quiz-day .tt')].map(x => x.textContent)
    expect(days).toEqual(['Monday · Full Body A', 'Wednesday · Full Body B', 'Friday · Full Body C'])
    // every session lists exercises by name, never by catalogue id
    for (const ss of container.querySelectorAll('.iv-quiz-day .ss')) expect(ss.textContent).not.toMatch(/\d{4}/)
    expect(container.querySelector('.iv-quiz-ask')).toBe(null)
  })

  it('asks for a professional first when the answers call for one, and still shows a gentle plan', () => {
    mount()
    answerAll({ limits: ['pregnancy'] })
    expect(container.querySelector('.iv-quiz-ask').textContent).toContain('check with a doctor or physiotherapist')
    expect([...container.querySelectorAll('[data-why]')].map(x => x.dataset.why)).toContain('caution')
    expect(container.querySelector('.iv-quiz-plan').textContent).toContain('2 sets of 12 reps to start.')
  })

  it('loads the plan, sets the level and goes Home', () => {
    mount()
    answerAll({ goal: 'muscle', equipment: 'dumbbells' })
    act(() => button('Use this plan').click())
    const S = useStore.getState().S
    expect(S.routines.map(r => r.name)).toEqual(['Dumbbells A', 'Dumbbells B'])
    expect(S.week[1]).toEqual([S.routines[0].id])
    expect(S.week[3]).toEqual([S.routines[1].id])
    expect(S.week[5]).toEqual([S.routines[0].id])
    for (const r of S.routines) for (const e of r.ex) { expect(e.sets).toBe(3); expect(e.reps).toBe(10); expect(e.restSec).toBe(90) }
    expect(S.experience).toBe('beginner')
    expect(isOn(S, 'effort')).toBe(false)
    expect(S.quiz).toEqual({ goal: 'muscle', days: 3, minutes: 45, equipment: 'dumbbells', experience: 'never' })
    expect(where).toBe('/home')
  })

  it('never keeps the limitations', () => {
    mount()
    answerAll({ limits: ['knees', 'clinician'] })
    act(() => button('Use this plan').click())
    const text = JSON.stringify(useStore.getState().S)
    expect(text).not.toContain('knees')
    expect(text).not.toContain('clinician')
    expect(useStore.getState().S.quiz.limits).toBe(undefined)
  })

  it('asks before taking over a weekday that already has a routine, and leaves it alone on Cancel', () => {
    mount({ routines: [{ id: 'mine', name: 'My Monday', ex: [{ id: '0025', sets: 3, reps: 8, weight: 0 }] }], week: { ...clone(DEF).week, 1: ['mine'] } })
    answerAll()
    act(() => button('Use this plan').click())
    const before = useStore.getState().S
    expect(before.routines.length).toBe(1)
    expect(where).toBe('/start')
    const sheets = useUI.getState().sheets || []
    expect(sheets.length).toBeGreaterThan(0)
  })

  it('does not lower a level that was set by hand to Experienced', () => {
    mount({ experience: 'advanced' })
    answerAll({ experience: 'regular', days: 4, minutes: 60 })
    act(() => button('Use this plan').click())
    expect(useStore.getState().S.experience).toBe('advanced')
  })

  it('starts from the answers given last time, and lets them be changed from the result', () => {
    mount({ quiz: { goal: 'fatloss', days: 2, minutes: 30, equipment: 'bands', experience: 'some' } })
    expect(container.querySelector('[data-option="fatloss"]').getAttribute('aria-checked')).toBe('true')
    pick('fatloss')
    expect(container.querySelector('[data-option="2"]').getAttribute('aria-checked')).toBe('true')
    pick(2); pick(30); pick('bands'); pick('some')
    act(() => button('Show my plan').click())
    expect(container.querySelector('.iv-quiz-plan').dataset.plan).toBe('bands')
    act(() => button('Change my answers').click())
    expect(q()).toBe('What do you want most?')
  })

  // iPhone: closing a sheet over a page mounts the page afresh. The quiz must not start over.
  it('keeps its place when the page is mounted again, and forgets it once the plan is used', () => {
    mount()
    pick('muscle'); pick(4)
    expect(q()).toBe('How long can one session be?')
    act(() => root.unmount()); container.remove(); root = null
    mount()
    expect(q()).toBe('How long can one session be?')
    act(() => container.querySelector('[data-back]').click())
    expect(container.querySelector('[data-option="4"]').getAttribute('aria-checked')).toBe('true')
    pick(4); pick(45); pick('gym'); pick('some')
    act(() => button('Show my plan').click())
    act(() => root.unmount()); container.remove(); root = null
    mount()
    expect(container.querySelector('.iv-quiz-plan').dataset.plan).toBe('upper-lower')
    act(() => button('Use this plan').click())
    act(() => root.unmount()); container.remove(); root = null
    mount()
    expect(q()).toBe('What do you want most?')
  })

  it('gives every option a tap target of its own with a name', () => {
    mount()
    for (let i = 0; i < 5; i++) {
      const options = [...container.querySelectorAll('[role="radio"]')]
      expect(options.length).toBeGreaterThanOrEqual(3)
      for (const o of options) expect(o.textContent.trim().length).toBeGreaterThan(0)
      act(() => options[0].click())
    }
    const boxes = [...container.querySelectorAll('[role="checkbox"]')]
    expect(boxes.length).toBe(5)
    act(() => boxes[0].click())
    expect(boxes[0].getAttribute('aria-checked')).toBe('true')
    act(() => boxes[0].click())
    expect(container.querySelector('[role="checkbox"]').getAttribute('aria-checked')).toBe('false')
  })
})
