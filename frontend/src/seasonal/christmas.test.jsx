// @vitest-environment happy-dom
// Christmas's moving parts (seasonal/christmas.jsx): the snow at a start, what reduced motion and
// the workout screen take away, the present's one surprise a day, and the advent calendar.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ui = vi.hoisted(() => ({ toast: null, sheets: [] }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: ui.toast, openSheet: r => { ui.sheets.push(r); return {} } }) } }))
const store = vi.hoisted(() => ({ S: null, listeners: new Set() }))
vi.mock('../store/useStore.js', async () => {
  const React = await import('react')
  const update = fn => { const s = JSON.parse(JSON.stringify(store.S)); fn(s); store.S = s; store.listeners.forEach(l => l()) }
  const useStore = sel => {
    const [, bump] = React.useReducer(x => x + 1, 0)
    React.useEffect(() => { store.listeners.add(bump); return () => { store.listeners.delete(bump) } }, [])
    return sel({ S: store.S, update })
  }
  return { useStore }
})
const buzz = vi.hoisted(() => ({ vibrate: null }))
vi.mock('../lib/sound.js', () => ({ vibrate: p => buzz.vibrate(p) }))

let host, root, reduce = false
const load = async () => { vi.resetModules(); return import('./christmas.jsx') }
beforeEach(() => {
  localStorage.clear()
  reduce = false
  window.matchMedia = q => ({ matches: reduce && /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
  ui.toast = vi.fn(); ui.sheets = []; buzz.vibrate = vi.fn()
  store.S = { routines: [], workouts: [], bodyweight: [], unit: 'kg' }
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 11, 5, 9))
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const render = el => act(() => root.render(el))

describe('the snow', () => {
  it('falls at a start: a dozen flakes behind the page, nothing that takes a tap', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    const fall = host.querySelector('.xm-snowfall')
    expect(fall).not.toBeNull()
    expect(fall.getAttribute('aria-hidden')).toBe('true')
    expect(fall.querySelectorAll('.xm-flake').length).toBe(12)
    expect(fall.querySelector('button, a, [tabindex]')).toBeNull()
  })

  it('and is gone once every flake has landed', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    act(() => host.querySelectorAll('.xm-flake').forEach(f => f.dispatchEvent(new Event('animationend', { bubbles: true }))))
    expect(host.querySelector('.xm-snowfall')).toBeNull()
  })

  it('stops for reduced motion: no snow, no sleigh', async () => {
    reduce = true
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.innerHTML).toBe('')
  })

  it('pauses on the workout screen unless "Also during workouts" is on, and is lighter there', async () => {
    let { Layer } = await load()
    render(<Layer hidden fresh workout={false} />)
    expect(host.querySelector('.xm-snowfall')).toBeNull()
    act(() => root.unmount()); root = createRoot(host)
    ;({ Layer } = await load())
    render(<Layer hidden fresh workout />)
    expect(host.querySelectorAll('.xm-flake').length).toBe(6)
    expect(host.querySelector('.xm-sleigh')).toBeNull()
  })
})

describe('the sleigh', () => {
  it('crosses at most once a day, never with reduced motion', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(new Date(2026, 11, 5, 9))
    let { Layer } = await load()
    render(<Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(60000) })
    expect(host.querySelector('.xm-sleigh')).not.toBeNull()
    act(() => root.unmount()); root = createRoot(host)
    ;({ Layer } = await load())                    // a new start, the same day
    render(<Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(60000) })
    expect(host.querySelector('.xm-sleigh')).toBeNull()
  })
})

describe('the present', () => {
  it('peeks out of its card; one tap a day unwraps it, the next says come back tomorrow', async () => {
    const { Deco } = await load()
    const card = vi.fn()
    render(<div onClick={card}><Deco spot="home-streak" /></div>)
    const btn = host.querySelector('.xm-present')
    expect(btn.tabIndex).toBe(-1)
    act(() => btn.click())
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(ui.toast.mock.calls[0][0]).toMatch(/present|Unwrapped|Surprise/)
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
    expect(card).not.toHaveBeenCalled()
    act(() => host.querySelector('.xm-present').click())
    expect(ui.toast.mock.calls[1][0]).toBe('That one is unwrapped. A new present turns up tomorrow.')
  })
})

describe('the spots', () => {
  it('Santa hat, holly, baubles, gingerbread and snowman: all decoration, none in the way', async () => {
    const { Deco } = await load()
    render(<>{['streak-flame', 'home-hero', 'stats-hdr', 'stats-tile', 'stats-heatmap', 'stats-web', 'stats-peek', 'workout-hdr', 'finish'].map(s => <Deco key={s} spot={s} />)}</>)
    for (const sel of ['.xm-hat', '.xm-holly', '.xm-lights', '.xm-baubles', '.xm-ginger-hang', '.xm-peek-snowman', '.xm-wcorner', '.xm-finish']) {
      const el = host.querySelector(sel)
      expect(el, sel).not.toBeNull()
      expect(el.closest('[aria-hidden="true"]'), sel).not.toBeNull()
    }
    expect(host.querySelector('button, a, input, [tabindex]')).toBeNull()
    render(<Deco spot="plan-card" />)
    expect(host.innerHTML).toBe('')
  })

  it('with reduced motion the lights stay lit and still, and the rest bar has no flakes', async () => {
    reduce = true
    const { Deco } = await load()
    render(<><Deco spot="header-bats" /><Deco spot="rest-timer" /></>)
    expect(host.querySelector('.xm-lights.xm-still')).not.toBeNull()
    expect(host.querySelector('.xm-restflakes')).toBeNull()
  })
})

describe('the advent card on Home', () => {
  it('1 to 24 December: today\'s door, and a tap opens the calendar', async () => {
    const { Deco } = await load()
    render(<Deco spot="home-advent" />)
    const card = host.querySelector('[data-advent-home]')
    expect(card.textContent).toContain('Door 5 is waiting for you')
    act(() => card.click())
    expect(ui.sheets).toHaveLength(1)
  })

  it('not there from the 25th, nor outside December', async () => {
    const { Deco } = await load()
    vi.setSystemTime(new Date(2026, 11, 25, 9))
    render(<Deco spot="home-advent" />)
    expect(host.querySelector('[data-advent-home]')).toBeNull()
    vi.setSystemTime(new Date(2027, 6, 1, 9))
    render(<Deco spot="home-advent" key="b" />)
    expect(host.querySelector('[data-advent-home]')).toBeNull()
  })

  it('the festive icon question never shows in a browser', async () => {
    const { Deco } = await load()
    render(<Deco spot="home-advent" />)
    await act(async () => { await Promise.resolve() })
    expect(host.querySelector('[data-xmas-icon]')).toBeNull()
  })
})

describe('the calendar', () => {
  const openCal = async () => {
    const m = await load()
    m.open('advent')
    render(<>{ui.sheets[0](() => {})}</>)
    return m
  }
  const door = n => host.querySelector(`[data-door="${n}"]`)

  it('24 doors; today glows, a future door is locked and only says no peeking', async () => {
    await openCal()
    expect(host.querySelectorAll('.xm-door')).toHaveLength(24)
    expect(door(5).className).toContain('xm-today')
    expect(door(2).className).toContain('xm-ready')
    expect(door(6).className).toContain('xm-locked')
    act(() => door(6).click())
    expect(ui.toast).toHaveBeenCalledWith('No peeking 👀')
    expect(store.S.advent).toBeUndefined()
    expect(door(6).className).toContain('xm-shake')
  })

  it('opening a door saves it in the profile and shows what is behind it', async () => {
    reduce = true                                     // no swing to wait for
    await openCal()
    act(() => door(5).click())
    expect(store.S.advent).toEqual({ year: 2026, opened: [5], done: [] })
    expect(host.querySelector('[data-door-open="5"]')).not.toBeNull()
    act(() => host.querySelector('.xm-back').click())
    expect(door(5).className).toContain('xm-open')
  })

  it('with motion the door swings open first, then the surprise pops up', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(new Date(2026, 11, 5, 9))
    await openCal()
    act(() => door(1).click())
    expect(door(1).className).toContain('xm-opening')
    act(() => { vi.advanceTimersByTime(800) })
    expect(host.querySelector('[data-door-open="1"]')).not.toBeNull()
  })

  it('a challenge behind a door is ticked off with a tap and earns its badge', async () => {
    reduce = true
    await openCal()
    act(() => door(2).click())                        // door 2 of 2026: 10 push-ups
    expect(host.textContent).toContain('10 push-ups before dinner')
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'I did it')
    act(() => btn.click())
    expect(store.S.advent.done).toEqual([2])
    expect(host.textContent).toContain('Done! Badge earned.')
  })

  it('the stretch door adds its routine once', async () => {
    reduce = true
    vi.setSystemTime(new Date(2026, 11, 9, 9))
    await openCal()
    act(() => door(9).click())
    const add = [...host.querySelectorAll('button')].find(b => b.textContent === 'Add to my routines')
    act(() => add.click())
    expect(store.S.routines).toHaveLength(1)
    expect(store.S.routines[0]).toMatchObject({ name: 'Cosy stretch', emoji: 'stretch' })
    expect(store.S.routines[0].ex.every(e => e.mode === 'time' && e.sec > 0)).toBe(true)
  })
})

describe('the stat of the day', () => {
  it('the best set of the year\'s most-done lift, from the user\'s own workouts', async () => {
    const { statOf } = await load()
    const set = (w, r) => ({ w, r, done: true })
    const S = { unit: 'kg', routines: [], bodyweight: [], workouts: [
      { id: 'a', d: '2026-03-02', start: 1, end: 2, entries: [{ id: '0025', sets: [set(70, 5), set(75, 5)] }] },
      { id: 'b', d: '2026-06-02', start: 1, end: 2, entries: [{ id: '0025', sets: [set(80, 3)] }] },
      { id: 'c', d: '2025-06-02', start: 1, end: 2, entries: [{ id: '0025', sets: [set(120, 3)] }] },
    ] }
    const s = statOf(S, 'best', 2026)
    expect(s.big).toBe('80 kg')
    expect(s.line).toContain('2026')
    expect(statOf(S, 'year', 2026).big).toBe('2')
    expect(statOf({ ...S, workouts: [] }, 'best', 2026)).toBe(null)
  })
})
