// @vitest-environment happy-dom
// The daily-form check-in before a workout (v1.4.5, lib/daily-form.js): only when switched on,
// every answer optional, "go lighter" offered on a rough day and never picked for you.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { startFlow } from './sheets.jsx'
import { isWarmupRow } from './lib/workout-model.js'

const BENCH = '0025'
const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const pip = (host, row, n) => host.querySelectorAll('.dfc-scale')[row].querySelectorAll('button')[n - 1]

function install(extra = {}) {
  const st = clone(DEF)
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 80 }] }],
    week: {}, dayPlan: {}, active: null, workouts: [], weighIn: false,
  }, extra)
  useStore.setState({ S: st, user: null })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T12:00:00'))
  useUI.setState({ sheets: [], toasts: [] })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('the daily check-in on Start', () => {
  it('is not there until it is switched on: Start starts', () => {
    install()
    act(() => startFlow(['A']))
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(S().active).not.toBeNull()
  })

  it('switched on, it asks first; Skip starts the session as planned and stores nothing', () => {
    install({ dailyForm: true })
    act(() => startFlow(['A']))
    expect(S().active).toBeNull()
    const host = mountTopSheet()
    expect(host.querySelectorAll('.dfc-scale')).toHaveLength(4)
    act(() => button(host, 'Skip for today').click())
    expect(S().active).not.toBeNull()
    expect(S().dayForm).toEqual({})
  })

  it('a good day: the answers are kept for today and nothing about the session changes', () => {
    install({ dailyForm: true })
    act(() => startFlow(['A']))
    const host = mountTopSheet()
    act(() => pip(host, 0, 4).click())
    act(() => pip(host, 1, 5).click())
    expect(host.querySelector('.dfc-light')).toBeNull()
    act(() => button(host, 'Start workout').click())
    expect(S().dayForm['2026-11-06']).toMatchObject({ sleep: 4, energy: 5 })
    const work = S().active.entries[0].sets.filter(r => !isWarmupRow(r))
    expect(work.every(r => r.w === 80)).toBe(true)
    expect(S().active.noProg).toBeUndefined()
  })

  it('a rough day offers lighter, as planned stays the default, and picking it lightens today only', () => {
    install({ dailyForm: true })
    act(() => startFlow(['A']))
    const host = mountTopSheet()
    act(() => pip(host, 0, 1).click())
    act(() => pip(host, 1, 2).click())
    const light = host.querySelector('.dfc-light')
    expect(light).not.toBeNull()
    expect(light.querySelector('[aria-checked="true"], .on, [aria-pressed="true"]')?.textContent || 'As planned').toMatch(/As planned/)
    act(() => button(light, 'One set fewer').click())
    act(() => button(host, 'Start workout').click())
    expect(S().dayForm['2026-11-06']).toMatchObject({ sleep: 1, energy: 2, lighter: 'sets' })
    expect(S().active.entries[0].sets.filter(r => !isWarmupRow(r))).toHaveLength(2)
    expect(S().active.noProg).toBe(true)
    expect(S().routines[0].ex[0].sets).toBe(3)
    expect(useUI.getState().toastMsg).toMatch(/one set fewer/i)
  })

  it('asks once a day: the second workout of the day starts straight away', () => {
    install({ dailyForm: true, dayForm: { '2026-11-06': { energy: 3, _ts: 1 } } })
    act(() => startFlow(['A']))
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(S().active).not.toBeNull()
  })

  it('never with the Health module off', () => {
    install({ dailyForm: true, modules: { health: false } })
    act(() => startFlow(['A']))
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})
