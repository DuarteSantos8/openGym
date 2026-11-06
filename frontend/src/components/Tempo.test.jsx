// @vitest-environment happy-dom
// Tempo (#572): the picker saves a clean tempo, and the guide walks a set through it with a tone
// queued for every phase and a buzz at each one.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ S: {}, tones: [], buzz: [], silenced: 0 }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S, update: fn => { fn(mocks.S) } })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/sound.js', () => ({
  unlock: () => {},
  vibrate: p => mocks.buzz.push(p),
  queueTones: (on, notes) => { if (on) mocks.tones.push(...notes); return () => { mocks.silenced++ } },
}))

const { TempoEditor, TempoGuide } = await import('./Tempo.jsx')

let root, host
const mount = el => act(() => root.render(el))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  vi.useFakeTimers()
  mocks.S = {}; mocks.tones = []; mocks.buzz = []; mocks.silenced = 0
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('the tempo picker', () => {
  it('saves a preset in the dashed form', () => {
    const onDone = vi.fn()
    mount(<TempoEditor value={null} onDone={onDone} close={() => {}} />)
    act(() => button('2-0-1-0').click())
    expect(host.querySelector('.tempo-big').textContent).toBe('2-0-1-0')
    act(() => button('Save').click())
    expect(onDone).toHaveBeenCalledWith('2-0-1-0')
  })
  it('an explosive lift is an X, and an existing tempo can be taken away', () => {
    const onDone = vi.fn()
    mount(<TempoEditor value="3-1-1-0" onDone={onDone} close={() => {}} />)
    act(() => host.querySelector('[role="switch"]').click())
    expect(host.querySelector('.tempo-big').textContent).toBe('3-1-X-0')
    act(() => button('No tempo').click())
    expect(onDone).toHaveBeenCalledWith(null)
  })
})

describe('the tempo guide', () => {
  it('queues a tone per phase after the count-in, buzzes each phase, and offers the tick', () => {
    const onTick = vi.fn()
    mount(<TempoGuide tempo="3-0-1-0" reps={2} close={() => {}} onTick={onTick} />)
    expect(host.textContent).toContain('8 s under tension')
    act(() => button('Start').click())
    // 3 count-in ticks, 4 phases, 1 finish
    expect(mocks.tones.length).toBe(8)
    expect(mocks.tones.slice(3).map(n => n[2])).toEqual([3, 6, 7, 10, 11])
    act(() => { vi.advanceTimersByTime(3200) })
    expect(host.querySelector('.tempo-phase').textContent).toBe('Lower')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(host.querySelector('.tempo-phase').textContent).toBe('Lift')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(host.querySelector('.tempo-phase').textContent).toBe('Done')
    expect(mocks.buzz.length).toBe(4)
    act(() => button('Tick the set').click())
    expect(onTick).toHaveBeenCalled()
  })
  it('Stop calls the queued tones off; the switches keep it quiet', () => {
    mocks.S = { tempoSound: false, tempoVibrate: false }
    mount(<TempoGuide tempo="3-1-1-0" reps={3} close={() => {}} />)
    act(() => button('Start').click())
    expect(mocks.tones).toEqual([])
    act(() => { vi.advanceTimersByTime(8000) })
    expect(mocks.buzz).toEqual([])
    const before = mocks.silenced
    act(() => button('Stop').click())
    expect(mocks.silenced).toBeGreaterThan(before)
  })
})
