// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GuidedWarmup from './GuidedWarmup.jsx'
import { createGuidedWarmup } from '../lib/guided-warmup-session.js'
import { discardedFor } from '../lib/watch-sync.js'

const mock = vi.hoisted(() => ({ S: null, nav: vi.fn(), confirm: vi.fn(), stopRest: vi.fn(), stopWork: vi.fn() }))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({ S: mock.S, update: fn => { const state = structuredClone(mock.S); fn(state); mock.S = state } })
  const useStore = selector => selector(snapshot())
  useStore.getState = snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ stopRest: mock.stopRest, stopWork: mock.stopWork }) } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mock.nav }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: options => mock.confirm(options) }))
vi.mock('../components/Media.jsx', () => ({ default: ({ ex }) => <div data-media={ex.id}>Animation</div> }))
vi.mock('../components/Icon.jsx', () => ({ default: () => <span /> }))
vi.mock('../components/ui.jsx', () => ({ Button: ({ children, variant, icon, ...props }) => <button {...props}>{children}</button> }))
vi.mock('../lib/i18n.js', () => ({
  t: (key, ...args) => key.replace(/\{(\d+)\}/g, (_, index) => args[index]),
  exerciseNameFor: ex => ex.id,
  exerciseNameClass: () => '',
  instrFor: () => ['Move slowly through a comfortable range.'],
  instrTranslated: () => true,
  getLang: () => 'en',
}))

let root, container
const step = { id: '3905', mode: 'time', sec: 30 }
const legs = { id: '3502', mode: 'reps', reps: 10, perSide: true }
const render = () => act(async () => root.render(<GuidedWarmup />))
const click = async label => {
  const button = [...container.querySelectorAll('button')].find(el => el.textContent === label || el.getAttribute('aria-label') === label)
  expect(button).toBeTruthy()
  await act(async () => button.click())
  await render()
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  vi.clearAllMocks()
  localStorage.clear()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mock.S = { active: {
    id: 'session', name: 'Test day', entries: [{ id: '0025', sets: [{ w: 50, r: 8, done: false }] }],
    warmup: createGuidedWarmup([{ warmup: { enabled: true, steps: [step, legs] } }], 1000),
  } }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

it('shows catalogue media/instructions and waits for explicit progress when the timer expires', async () => {
  const entries = structuredClone(mock.S.active.entries)
  await render()
  expect(container.querySelector('[data-media="3905"]')).toBeTruthy()
  expect(container.textContent).toContain('Move slowly through a comfortable range.')
  await click('Start timer')
  const deadline = mock.S.active.warmup.timer.endsAt
  await act(async () => vi.advanceTimersByTime(40000))
  expect(container.querySelector('[role="timer"]').textContent).toBe('0:00')
  expect(mock.S.active.warmup.timer.endsAt).toBe(deadline)
  expect(mock.S.active.warmup.current).toBe(0)
  await click('Done & next')
  expect(mock.S.active.warmup.timer).toBeUndefined()
  expect(container.textContent).toContain('Complete both sides before continuing.')
  expect(container.textContent).toContain('10 reps · per side')
  await click('Start workout')
  expect(mock.S.active.warmup.status).toBe('complete')
  expect(mock.S.active.entries).toEqual(entries)
})

it('persists a countdown through minimize/remount and clears it on a movement skip', async () => {
  await render()
  await click('Start timer')
  await click('Minimize')
  expect(mock.nav).toHaveBeenCalledWith('/home')
  await act(async () => root.unmount())
  vi.setSystemTime(11000)
  mock.S = JSON.parse(JSON.stringify(mock.S))
  root = createRoot(container)
  await render()
  expect(container.querySelector('[role="timer"]').textContent).toBe('0:20')
  await click('Skip movement')
  expect(mock.S.active.warmup.steps[0].status).toBe('skipped')
  expect(mock.S.active.warmup.timer).toBeUndefined()
  await click('Skip warm-up')
  expect(mock.S.active.warmup.status).toBe('skipped')
  expect(mock.S.active.entries[0].sets[0].done).toBe(false)
})

it('allows discarding preparation and protects a replacement session from a stale confirmation', async () => {
  await render()
  await click('Discard workout')
  const staleConfirmation = mock.confirm.mock.calls.at(-1)[0]
  mock.S.active.id = 'replacement'
  await act(async () => staleConfirmation.onConfirm())
  expect(mock.S.active.id).toBe('replacement')
  expect(discardedFor()).toEqual([])
  await render()
  await click('Discard workout')
  await act(async () => mock.confirm.mock.calls.at(-1)[0].onConfirm())
  expect(mock.S.active).toBeNull()
  expect(discardedFor()).toEqual(['replacement'])
  expect(mock.stopWork).toHaveBeenCalledOnce()
  expect(mock.stopRest).toHaveBeenCalledOnce()
  expect(mock.nav).toHaveBeenCalledWith('/home')
})
