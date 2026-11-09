// @vitest-environment happy-dom
// Christmas's moving parts (seasonal/christmas.jsx): the snow at a start, what reduced motion and
// the workout screen take away, the present's one surprise a day, and the advent calendar.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
// The chunk pulls in the workout builders on its first import: slow on a busy machine.
vi.setConfig({ testTimeout: 20000 })

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

describe('Santa and his reindeer', () => {
  const timers = () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(new Date(2026, 11, 5, 9))
  }
  const visit = hash => act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')) })

  it('fly across once a screen visit, after a pause: all nine reindeer, Rudolph\'s nose in front, nothing to tap', async () => {
    timers()
    const m = await load()
    m._resetFlightForTests()
    render(<m.Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(host.querySelector('.xm-flight')).toBeNull()           // a pause first
    act(() => { vi.advanceTimersByTime(8000) })
    const f = host.querySelector('.xm-flight')
    expect(f).not.toBeNull()
    expect(f.getAttribute('aria-hidden')).toBe('true')
    expect(f.querySelectorAll('.xm-ear')).toHaveLength(9)          // one ear each: nine reindeer
    expect(f.querySelector('.xm-rudolph')).not.toBeNull()
    expect(f.querySelector('button, a, [tabindex]')).toBeNull()
    act(() => f.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect(host.querySelector('.xm-flight')).toBeNull()           // one pass, then gone
  })

  it('a touch anywhere and he steps aside at once', async () => {
    timers()
    const m = await load()
    m._resetFlightForTests()
    render(<m.Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(11000) })
    act(() => { window.dispatchEvent(new Event('pointerdown')) })
    const f = host.querySelector('.xm-flight')
    expect(f.className).toContain('xm-leave')
    act(() => f.dispatchEvent(new Event('transitionend', { bubbles: true })))
    expect(host.querySelector('.xm-flight')).toBeNull()
  })

  it('not again within a minute and a half, however many screens; then again on the next one', async () => {
    timers()
    const m = await load()
    m._resetFlightForTests()
    render(<m.Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(11000) })
    act(() => host.querySelector('.xm-flight').dispatchEvent(new Event('animationend', { bubbles: true })))
    visit('#/stats')
    act(() => { vi.advanceTimersByTime(11000) })
    expect(host.querySelector('.xm-flight')).toBeNull()
    act(() => { vi.advanceTimersByTime(90000) })
    visit('#/plan')
    act(() => { vi.advanceTimersByTime(11000) })
    expect(host.querySelector('.xm-flight')).not.toBeNull()
  })

  it('never on the workout screen, never with reduced motion', async () => {
    timers()
    let m = await load()
    m._resetFlightForTests()
    render(<m.Layer hidden fresh={false} workout />)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(host.querySelector('.xm-flight')).toBeNull()
    act(() => root.unmount()); root = createRoot(host)
    reduce = true
    m = await load()
    m._resetFlightForTests()
    render(<m.Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(host.querySelector('.xm-flight')).toBeNull()
  })
})

describe('round two: the workout, snow and the festive glow', () => {
  const setStore = S => { store.S = S; store.listeners.forEach(l => l()) }
  const active = done => ({ id: 'a', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done }] }] })

  it('a set ticked on the workout screen sparkles at the tap; never with reduced motion or with workouts off', async () => {
    const m = await load()
    store.S = { ...store.S, active: active(false) }
    render(<m.Layer hidden fresh={false} workout />)
    act(() => { window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300 })) })
    act(() => setStore({ ...store.S, active: active(true) }))
    const sp = host.querySelector('.xm-setspark')
    expect(sp).not.toBeNull()
    expect(sp.getAttribute('aria-hidden')).toBe('true')
    expect(sp.style.left).toBe('200px')
    act(() => root.unmount()); root = createRoot(host)
    store.S = { ...store.S, active: active(false) }
    render(<m.Layer hidden fresh={false} workout={false} />)
    act(() => { window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300 })) })
    act(() => setStore({ ...store.S, active: active(true) }))
    expect(host.querySelector('.xm-setspark')).toBeNull()
    act(() => root.unmount()); root = createRoot(host)
    reduce = true
    store.S = { ...store.S, active: active(false) }
    render(<m.Layer hidden fresh={false} workout />)
    act(() => { window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 200, clientY: 300 })) })
    act(() => setStore({ ...store.S, active: active(true) }))
    expect(host.querySelector('.xm-setspark')).toBeNull()
  })

  it('snow on the cards wherever the theme decorates, on the workout screen only with workouts on; the glow only with the colours', async () => {
    const m = await load()
    const de = document.documentElement
    render(<m.Layer hidden={false} fresh={false} />)
    expect(de.dataset.xmCaps).toBe('1')
    expect(de.dataset.xmTint).toBeUndefined()
    render(<m.Layer hidden fresh={false} workout={false} />)
    expect(de.dataset.xmCaps).toBeUndefined()
    act(() => setStore({ ...store.S, seasonal: { christmasColors: true } }))
    render(<m.Layer hidden fresh={false} workout />)
    expect(de.dataset.xmCaps).toBe('1')
    expect(de.dataset.xmTint).toBe('1')
    act(() => root.unmount()); root = createRoot(host)
    expect(de.dataset.xmCaps).toBeUndefined()
  })
})

describe('Rudolph', () => {
  it('hides his nose in one spot a day, a different one the next day', async () => {
    const m = await load()
    const spots = new Set()
    for (let d = 1; d <= 8; d++) spots.add(m.noseSpotOf(new Date(2026, 11, d, 9)))
    expect([...spots].sort()).toEqual([...m.NOSE_SPOTS].sort())
    expect(m.noseSpotOf(new Date(2026, 11, 5, 9))).not.toBe(m.noseSpotOf(new Date(2026, 11, 6, 9)))
    render(<>{m.NOSE_SPOTS.map(sp => <div key={sp} className="card"><m.Deco spot={sp} /></div>)}</>)
    const noses = host.querySelectorAll('[data-rudolph]')
    expect(noses).toHaveLength(1)
    expect(noses[0].getAttribute('data-rudolph')).toBe(m.noseSpotOf())
    expect(noses[0].getAttribute('aria-hidden')).toBe('true')
    expect(noses[0].querySelector('.xm-r-antler')).not.toBeNull()   // his antlers peek out too
    expect(noses[0].querySelectorAll('.xm-r-ear')).toHaveLength(2)
  })

  it('found with a tap: a buzz, a hello, and he is gone until tomorrow', async () => {
    reduce = true
    const m = await load()
    const card = vi.fn()
    render(<div onClick={card}><m.Deco spot={m.noseSpotOf()} /></div>)
    act(() => host.querySelector('.xm-nose').click())
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
    expect(ui.toast.mock.calls[0][0]).toMatch(/Rudolph/)
    expect(card).not.toHaveBeenCalled()
    expect(host.querySelector('[data-rudolph]')).toBeNull()
    render(<m.Deco spot={m.noseSpotOf()} key="again" />)
    expect(host.querySelector('[data-rudolph]')).toBeNull()      // the same day: still hiding
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
  it('Santa hat, holly, trees, a gingerbread house, baubles, gingerbread and snowman: all decoration, none in the way', async () => {
    const { Deco } = await load()
    render(<>{['streak-flame', 'home-hero', 'home-streak', 'plan-card', 'rest-timer', 'empty', 'stats-hdr', 'stats-tile', 'stats-heatmap', 'stats-web', 'stats-peek', 'workout-hdr', 'finish'].map(s => <Deco key={s} spot={s} />)}</>)
    for (const sel of ['.xm-hat', '.xm-holly', '.xm-peek-house', '.xm-peek-home [data-snowman], [data-snowman]', '.xm-canesvg', '.xm-wlights', '.xm-reststar', '.xm-plandeco', '.xm-lights', '.xm-baubles', '.xm-ginger-hang', '.xm-peek-snowman', '.xm-wcorner', '.xm-wtree', '.xm-finish']) {
      const el = host.querySelector(sel)
      expect(el, sel).not.toBeNull()
      expect(el.closest('[aria-hidden="true"]'), sel).not.toBeNull()
    }
    // the only things that take a tap are Rudolph's nose and the present, out of the keyboard's way
    expect([...host.querySelectorAll('button, a, input, [tabindex]')].every(el => (el.classList.contains('xm-nose') || el.classList.contains('xm-present')) && el.tabIndex === -1)).toBe(true)
    render(<Deco spot="plan-ideas" />)
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
    expect(m.open('advent')).toBe(true)
    render(<>{ui.sheets[0](() => {})}</>)
    return m
  }
  const door = n => host.querySelector(`[data-door="${n}"]`)
  const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text)
  // A door, from the grid to what is behind it, with reduced motion: a tap opens it at once.
  const openDay = async n => {
    reduce = true
    await openCal()
    act(() => door(n).click())
    act(() => host.querySelector('[data-bigdoor]').click())
  }

  it('24 doors under a tree; today glows, a future door is locked and only says no peeking', async () => {
    await openCal()
    expect(host.querySelectorAll('.xm-door')).toHaveLength(24)
    expect(host.querySelector('.xm-tree')).not.toBeNull()
    expect(host.querySelectorAll('.xm-tree .xm-hook')).toHaveLength(24)
    expect(door(5).className).toContain('xm-today')
    expect(door(2).className).toContain('xm-ready')
    expect(door(6).className).toContain('xm-locked')
    act(() => door(6).click())
    expect(ui.toast).toHaveBeenCalledWith('No peeking')   // its 👀 only with Settings → Icons on Emoji
    expect(store.S.advent).toBeUndefined()
    expect(door(6).className).toContain('xm-shake')
  })

  it('a door opens on a tap (or Enter): saved in the profile, a bauble on the tree, the surprise behind it', async () => {
    await openDay(5)
    expect(store.S.advent).toEqual({ year: 2026, opened: [5], done: [] })
    expect(host.querySelector('[data-door-open="5"]')).not.toBeNull()
    expect(buzz.vibrate).toHaveBeenCalled()
    act(() => host.querySelector('.xm-back').click())
    expect(door(5).className).toContain('xm-open')
    expect(host.querySelectorAll('.xm-tree [data-ball]')).toHaveLength(1)
    expect(host.textContent).toContain('1 bauble on the tree, 0 lit')
  })

  describe('with motion', () => {
    beforeEach(() => {
      vi.useRealTimers()
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
      vi.setSystemTime(new Date(2026, 11, 5, 9))
    })
    const pointer = (el, type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1 }))

    it('a tap swings the door open on its spring, and the surprise shows once it settles', async () => {
      await openCal()
      act(() => door(1).click())
      const flap = host.querySelector('[data-bigdoor]')
      act(() => { pointer(flap, 'pointerdown', 200); pointer(flap, 'pointerup', 200) })
      expect(store.S.advent).toBeUndefined()           // not yet: still swinging
      act(() => { vi.advanceTimersByTime(250) })
      expect(store.S.advent.opened).toEqual([1])        // past half way it counts
      expect(flap.style.transform).toMatch(/rotateY\(-\d/)
      act(() => { vi.advanceTimersByTime(2500) })
      expect(host.querySelector('[data-door-open="1"]')).not.toBeNull()
    })

    it('a small, slow drag lets go and the door springs back shut, nothing opened', async () => {
      await openCal()
      act(() => door(1).click())
      const flap = host.querySelector('[data-bigdoor]')
      act(() => { pointer(flap, 'pointerdown', 200); pointer(flap, 'pointermove', 190) })
      act(() => { vi.advanceTimersByTime(400); pointer(flap, 'pointermove', 180) })
      act(() => { vi.advanceTimersByTime(400); pointer(flap, 'pointerup', 180) })
      act(() => { vi.advanceTimersByTime(2500) })
      expect(store.S.advent).toBeUndefined()
      expect(host.querySelector('[data-bigdoor]')).not.toBeNull()
    })

    it('dragged past half way, it opens', async () => {
      await openCal()
      act(() => door(1).click())
      const flap = host.querySelector('[data-bigdoor]')
      act(() => { pointer(flap, 'pointerdown', 200); pointer(flap, 'pointermove', 150) })
      act(() => { vi.advanceTimersByTime(300); pointer(flap, 'pointermove', 60) })
      act(() => { vi.advanceTimersByTime(300); pointer(flap, 'pointerup', 60) })
      act(() => { vi.advanceTimersByTime(2500) })
      expect(store.S.advent.opened).toEqual([1])
    })
  })

  it('a counting door: plus by its step, a minus for a slip, and the goal does the door', async () => {
    await openDay(2)                                   // door 2 of 2026: 50 squats in tens
    expect(host.textContent).toContain('/ 50')
    act(() => button('10').click())
    act(() => button('10').click())
    expect(store.S.advent.reps).toEqual({ 2: 20 })
    act(() => button('Take 10 back').click())
    expect(store.S.advent.reps).toEqual({ 2: 10 })
    for (let i = 0; i < 4; i++) act(() => button('10').click())
    expect(store.S.advent.done).toEqual([2])
    expect(host.textContent).toContain('All 50. Done!')
    expect(host.querySelector('[data-lit="1"]')).not.toBeNull()
  })

  it('a finisher starts a quick workout of timed moves in a superset, and does the door', async () => {
    vi.setSystemTime(new Date(2026, 11, 1, 9))
    await openDay(1)                                   // door 1 of 2026: Jingle burner
    expect(host.textContent).toContain('Jingle burner')
    act(() => button('Start the finisher').click())
    const A = store.S.active
    expect(A.name).toBe('Jingle burner')
    expect(A.entries.map(e => e.id)).toEqual(['3094', '3948'])
    expect(A.entries[0].sg).toBeTruthy()
    expect(A.entries[0].sg).toBe(A.entries[1].sg)
    expect(A.entries.every(e => e.sets.length === 4 && e.sets.every(x => x.sec === 30))).toBe(true)
    expect(store.S.advent.done).toEqual([1])
  })

  it('with a workout running, the exercise of the day joins it at the end instead', async () => {
    store.S.active = { id: 'a', d: '2026-12-04', start: 1, routineIds: [], name: 'Legs', cur: 0, entries: [{ id: '0043', sets: [] }] }
    vi.setSystemTime(new Date(2026, 11, 4, 9))
    await openDay(4)                                   // door 4 of 2026: kettlebell swings
    act(() => button('Add to this workout').click())
    expect(store.S.active.id).toBe('a')
    expect(store.S.active.entries.map(e => e.id)).toEqual(['0043', '0549'])
    expect(ui.toast).toHaveBeenCalledWith('Added to this workout. Finish strong!')
  })

  it('the stretch door adds its routine once', async () => {
    vi.setSystemTime(new Date(2026, 11, 8, 9))
    await openDay(8)
    act(() => button('Add to my routines').click())
    expect(store.S.routines).toHaveLength(1)
    expect(store.S.routines[0]).toMatchObject({ name: 'Cosy stretch', emoji: 'stretch' })
    expect(store.S.routines[0].ex.every(e => e.mode === 'time' && e.sec > 0)).toBe(true)
    expect(store.S.advent.done).toEqual([8])
  })

  it('a workout that day lights the bauble, whatever the door', async () => {
    store.S.workouts = [{ id: 'w', d: '2026-12-05', start: 1, end: 2, entries: [] }]
    await openDay(5)
    expect(host.querySelector('[data-lit="1"]').textContent).toContain('Bauble lit')
  })

  it('door 24: the year so far, and the festive flame to keep', async () => {
    const set = (w, r) => ({ w, r, done: true })
    store.S.workouts = [{ id: 'a', d: '2026-03-02', start: 1, end: 3600001, entries: [{ id: '0025', sets: [set(70, 5)] }] }]
    vi.setSystemTime(new Date(2026, 11, 24, 9))
    await openDay(24)
    expect(host.querySelector('[data-review]').textContent).toContain('Workouts')
    act(() => button('Put it on').click())
    expect(store.S.flameIcon).toEqual({ k: 'icon', v: 'flameHat', c: '#ff5a5f' })
    expect(store.S.advent.done).toEqual([24])
    expect(host.textContent).toContain('Wearing it. Very merry.')
    act(() => host.querySelector('.xm-back').click())
    expect(host.querySelector('.xm-star.xm-lit')).not.toBeNull()
  })

  it('not before 1 December 2026: open() refuses and nothing is drawn on Home', async () => {
    vi.setSystemTime(new Date(2026, 10, 30, 23, 59))
    const m = await load()
    expect(m.open('advent')).toBe(false)
    expect(ui.sheets).toHaveLength(0)
    render(<m.Deco spot="home-advent" />)
    expect(host.innerHTML).toBe('')
  })
})

describe('the stat of the day', () => {
  const set = (w, r) => ({ w, r, done: true })
  const S = { unit: 'kg', routines: [], bodyweight: [], workouts: [
    { id: 'a', d: '2026-03-02', start: 1, end: 2, entries: [{ id: '0025', sets: [set(70, 5), set(75, 5)] }] },
    { id: 'b', d: '2026-06-02', start: 1, end: 2, entries: [{ id: '0025', sets: [set(80, 3)] }] },
    { id: 'c', d: '2025-06-02', start: 1, end: 2, entries: [{ id: '0025', sets: [set(120, 3)] }] },
  ] }

  it('the best set of the year\'s most-done lift, from the user\'s own workouts', async () => {
    const { statOf } = await load()
    const s = statOf(S, 'best', 2026)
    expect(s.big).toBe('80 kg')
    expect(s.line).toContain('2026')
    expect(statOf(S, 'year', 2026).big).toBe('2')
    expect(statOf({ ...S, workouts: [] }, 'best', 2026)).toBe(null)
  })

  it('the year in reindeer, the favourite muscle and the longest streak', async () => {
    const { statOf } = await load()
    const v = statOf(S, 'volume', 2026)
    expect(v.big).toBe('965 kg')
    expect(v.sub).toContain('8 reindeer')
    expect(statOf(S, 'muscle', 2026).big).toBeTruthy()
    expect(statOf(S, 'streak', 2026).big).toBe('1 week')
  })
})
