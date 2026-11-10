// @vitest-environment happy-dom
// The bar's controls for timed holds that run themselves (lib/auto-holds.js): the count-in with
// Go now, Pause, Restart and Stop auto; a hold that runs itself trades Cancel for that row; the
// rest before one names it and offers Stop auto; the polite announcement of 3, 2, 1, go.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

let host, root, saved
const spies = () => ({
  pauseAuto: vi.fn(), resumeAuto: vi.fn(), restartHold: vi.fn(), stopAuto: vi.fn(), goNow: vi.fn(),
  finishWorkEarly: vi.fn(), stopWork: vi.fn(), skipRest: vi.fn(),
})
const owner = { idx: 0, i: 1, id: 'plank', plan: 30, label: 'Plank' }
const buttons = () => [...host.querySelectorAll('#timer button')].map(b => b.textContent.trim() || b.getAttribute('aria-label'))
const press = label => act(() => [...host.querySelectorAll('#timer button')].find(b => b.textContent.trim() === label).click())

beforeEach(() => {
  saved = useUI.getState()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null))
  useUI.setState(saved, true)
  host.remove()
})

const show = state => {
  const s = spies()
  useUI.setState({ timer: null, work: null, countIn: null, autoSay: '', ...s, ...state })
  act(() => root.render(<RestTimer />))
  return s
}

describe('the count-in', () => {
  it('shows the number and the hold it is for, with Go now and the chain’s row', () => {
    show({ countIn: { owner, left: 2, total: 3, endsAt: Date.now() + 2000 } })
    expect(host.querySelector('#timer.countin .t').textContent).toBe('2')
    expect(host.querySelector('#timer .lbl').textContent).toBe('Get ready: Plank')
    expect(buttons()).toEqual(['Go now', 'Pause', 'Restart', 'Stop auto'])
  })
  it('wires each button to its action', () => {
    const s = show({ countIn: { owner, left: 3, total: 3, endsAt: Date.now() + 3000 } })
    press('Go now'); press('Pause'); press('Restart'); press('Stop auto')
    expect(s.goNow).toHaveBeenCalledOnce()
    expect(s.pauseAuto).toHaveBeenCalledOnce()
    expect(s.restartHold).toHaveBeenCalledOnce()
    expect(s.stopAuto).toHaveBeenCalledOnce()
  })
  it('offers Resume while paused, and says why it waits under a sheet', () => {
    const s = show({ countIn: { owner, left: 3, total: 3, endsAt: 0, paused: true, waiting: true } })
    expect(host.querySelector('#timer .lbl').textContent).toBe('Waiting till you close that')
    const resume = [...host.querySelectorAll('#timer .autorow button')][0]
    expect(resume.textContent.trim()).toBe('Resume')
    expect(resume.getAttribute('aria-pressed')).toBe('true')
    press('Resume')
    expect(s.resumeAuto).toHaveBeenCalledOnce()
  })
})

describe('a hold that runs itself', () => {
  it('has Done and the chain’s row instead of Cancel', () => {
    const s = show({ work: { left: 20, total: 30, endsAt: Date.now() + 20_000, label: 'Plank', owner, auto: true } })
    expect(buttons()).toEqual(['Done', 'Pause', 'Restart', 'Stop auto'])
    press('Done')
    expect(s.finishWorkEarly).toHaveBeenCalledOnce()
  })
  it('reads Paused beside the name while held', () => {
    show({ work: { left: 20, total: 30, endsAt: 0, label: 'Plank', owner, auto: true, paused: true } })
    expect(host.querySelector('#timer .lbl').textContent).toBe('Paused · Plank')
    expect(buttons()).toContain('Resume')
  })
  it('keeps Cancel and nothing else for a hold started by hand without the setting', () => {
    show({ work: { left: 20, total: 30, endsAt: Date.now() + 20_000, label: 'Plank' } })
    expect(buttons()).toEqual(['Cancel', 'Done'])
  })
})

describe('the rest before a hold that starts by itself', () => {
  it('names the hold and offers Stop auto under the rest’s own buttons, Skip still skipping', () => {
    const s = show({ timer: { left: 40, total: 60, endsAt: Date.now() + 40_000, autoNext: 'Plank' } })
    expect(host.querySelector('#timer .autorow .up').textContent).toBe('Up next: Plank, starts by itself')
    press('Stop auto')
    expect(s.stopAuto).toHaveBeenCalledOnce()
    act(() => host.querySelector('#timer .skip').click())
    expect(s.skipRest).toHaveBeenCalledOnce()
  })
  it('shows no such row for an ordinary rest', () => {
    show({ timer: { left: 40, total: 60, endsAt: Date.now() + 40_000 } })
    expect(host.querySelector('#timer .autorow')).toBeNull()
  })
})

describe('for a screen reader', () => {
  it('announces the count politely from one region that stays put between the bars', () => {
    show({ countIn: { owner, left: 1, total: 3, endsAt: Date.now() + 1000 }, autoSay: '1' })
    const region = host.querySelector('[aria-live="polite"]')
    expect(region.textContent).toBe('1')
    act(() => useUI.setState({ countIn: null, work: { left: 30, total: 30, endsAt: Date.now() + 30_000, label: 'Plank', owner, auto: true }, autoSay: 'Go!' }))
    expect(host.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region.textContent).toBe('Go!')
    act(() => useUI.setState({ work: null, autoSay: '' }))
    expect(host.querySelector('[aria-live="polite"]')).toBe(region)
  })
})
