// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import { LEARN_SESSIONS, learnSessionById, startLearnSession } from './learn-sessions.js'
import { useStore } from '../store/useStore.js'
import { useCircuit } from '../store/useCircuit.js'
import { plannedLength, stationsOf } from './circuit.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { freestyleConfig, modeOf } from './history.js'

beforeEach(() => {
  useStore.setState(({ S }) => ({ user: null, S: { ...S, active: null, workouts: [], spokenCues: false } }))
  useCircuit.setState({ run: null, open: false, result: null })
})

it('opens the first move and clocks the advertised length of all eight sessions', () => {
  expect(LEARN_SESSIONS).toHaveLength(8)
  for (const session of LEARN_SESSIONS) {
    useStore.setState(({ S }) => ({ S: { ...S, active: null } }))
    expect(learnSessionById(session.id)).toBe(session)
    expect(startLearnSession(session.id, useStore)).toBe(true)
    const { active } = useStore.getState().S
    expect(useCircuit.getState().pending.idx).toBe(0)
    const unit = active.entries.map((_, index) => index)
    const cfg = active.entries[0].target.sgCircuit
    expect(plannedLength(cfg, stationsOf(active.entries, unit, modeOf))).toBe(session.minutes * 60)
  }
})

it('leaves a running workout alone when a session is already open or an id is unknown', () => {
  expect(learnSessionById('missing')).toBe(null)
  expect(startLearnSession('missing', useStore)).toBe(false)
  expect(startLearnSession('warmup-general', useStore)).toBe(true)
  const active = useStore.getState().S.active
  expect(startLearnSession('desk-break', useStore)).toBe(false)
  expect(useStore.getState().S.active).toBe(active)
})

it('carries a saved station duration into freestyle without turning it into a circuit', () => {
  startLearnSession('warmup-general', useStore)
  const active = useStore.getState().S.active
  const station = active.entries[0]
  const logged = { ...station, sets: [{ sec: 30, done: true }] }
  const freestyle = freestyleConfig({ workouts: [{ ...active, entries: [logged] }] }, { id: station.id })
  expect(freestyle.sec).toBe(30)
  expect(freestyle.sgCircuit).toBeUndefined()
})

it('can choose another Learn session after closing its untouched Ready screen', () => {
  startLearnSession('warmup-general', useStore)
  useCircuit.getState().openAt(0) // workout view opens a single circuit on mount
  useCircuit.getState().close()
  expect(startLearnSession('desk-break', useStore)).toBe(true)
})

it('leaves an ordinary workout alone on closing Ready', () => {
  startLearnSession('warmup-general', useStore)
  useCircuit.getState().reset()
  useStore.getState().update(s => { delete s.active.learnSession })
  const active = useStore.getState().S.active
  useCircuit.getState().openAt(0)
  useCircuit.getState().close()
  expect(useStore.getState().S.active).toBe(active)
})

it('closing Ready preserves edits, and closing a running clock keeps its workout', () => {
  startLearnSession('warmup-general', useStore)
  useStore.getState().update(s => { s.active.entries[0].note = 'remember this' })
  useCircuit.getState().close()
  expect(useStore.getState().S.active.entries[0].note).toBe('remember this')
  useCircuit.getState().openAt(0)
  useCircuit.getState().start()
  useCircuit.getState().close()
  expect(useStore.getState().S.active.entries[0].note).toBe('remember this')
  expect(useCircuit.getState().openAt(0)).toBe(true)
  expect(useCircuit.getState().run).toBeTruthy()
  useCircuit.getState().reset()
})

it('plays to the end in memory when device storage refuses writes', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  vi.useFakeTimers()
  try {
    expect(startLearnSession('mobility-hips', useStore)).toBe(true)
    useCircuit.getState().start()
    vi.advanceTimersByTime(620000)
    expect(useCircuit.getState().result).toBeTruthy()
  } finally {
    useCircuit.getState().close()
    vi.useRealTimers()
    setItem.mockRestore()
  }
})

it('keeps the current move readable with spoken cues switched off', async () => {
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { default: CircuitPlayer } = await import('../components/CircuitPlayer.jsx')
  const speech = await import('./speech.js')
  const speak = vi.spyOn(speech, 'speak').mockResolvedValue()
  const box = document.createElement('div')
  document.body.append(box)
  const root = createRoot(box)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  try {
    act(() => {
      startLearnSession('warmup-general', useStore)
      root.render(createElement(CircuitPlayer))
    })
    act(() => useCircuit.getState().start())
    act(() => vi.advanceTimersByTime(11000))
    const cue = box.querySelector('.cp-station h2')?.textContent
    expect(cue?.toLowerCase()).toContain('march')
    expect(box.querySelector('[aria-live="polite"]')?.textContent).toContain(cue)
    expect(speak).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    useCircuit.getState().close()
    vi.useRealTimers()
    speak.mockRestore()
    box.remove()
  }
})

it('includes every session title, cue and review label in all locale packs', () => {
  const packs = Object.values(import.meta.glob('../locales/*.js', { eager: true, import: 'default' }))
  expect(packs).toHaveLength(25)
  for (const pack of packs) {
    for (const { title, routine } of LEARN_SESSIONS) {
      for (const key of [title, routine.sessions[0].note, 'Draft']) expect(pack[key], key).toBeTruthy()
    }
  }
})

it('saves only finished mobility on a scheduled rest day, using the plan at the start', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-25T12:00:00'))
  try {
    const date = '2026-11-25'
    const run = (id, week, dayPlan = {}, stopEarly = false) => {
      useStore.setState(({ S }) => ({ S: { ...S, active: null, week, dayPlan, routines: [{ id: 'gym', ex: [{ id: 'lift' }] }] } }))
      expect(startLearnSession(id, useStore)).toBe(true)
      const active = useStore.getState().S.active
      expect(buildCompletedWorkout(active).restDayMobility).toBeUndefined()
      useStore.getState().update(s => { s.dayPlan[date] = dayPlan[date] === 'gym' ? 'rest' : 'gym' })
      useCircuit.getState().start()
      vi.advanceTimersByTime(stopEarly ? 61_000 : 21 * 60_000)
      if (stopEarly) useCircuit.getState().stop()
      const saved = buildCompletedWorkout(useStore.getState().S.active)
      useCircuit.getState().reset()
      return saved
    }
    expect(run('mobility-hips', { 4: 'gym' }).restDayMobility).toBe(date)
    expect(run('mobility-shoulders', { 3: 'gym' }, { [date]: 'rest' }).restDayMobility).toBe(date)
    expect(run('mobility-spine', { 4: 'gym' }, { [date]: 'gym' }).restDayMobility).toBeUndefined()
    expect(run('mobility-hips', {}).restDayMobility).toBeUndefined()
    expect(run('warmup-general', { 4: 'gym' }).restDayMobility).toBeUndefined()
    expect(run('mobility-hips', { 4: 'gym' }, {}, true).restDayMobility).toBeUndefined()
  } finally {
    useCircuit.getState().reset()
    vi.useRealTimers()
  }
})
