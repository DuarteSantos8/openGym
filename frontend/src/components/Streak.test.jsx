// @vitest-environment happy-dom
// The week streak's pieces (components/Streak.jsx): the drawn flame, the freezes, the tiered
// medals, the Stats card with its next-badge bar, and Home's party with its burst and buzz.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { StreakFlame, Freezes, StreakCard, StreakParty, Medal } from './Streak.jsx'
import { setNativeBuzzer } from '../lib/sound.js'

const clone = v => JSON.parse(JSON.stringify(v))
let root, host, matches = false
const render = node => { act(() => root.render(node)); return host }
const info = (over = {}) => ({ current: 13, best: 13, freezes: 1, frozen: [], thisWeekDone: true, badges: [4, 12], next: 26, toNextFreeze: 3, weekKey: '2026-10-26', ...over })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  matches = false
  globalThis.matchMedia = () => ({ matches, addEventListener () {}, removeEventListener () {} })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState({ S: clone(DEF), user: null, tourSandbox: false })
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete globalThis.matchMedia; setNativeBuzzer(null) })

describe('flame', () => {
  it('is drawn with its own gradients, unique per flame, and grey when out', () => {
    const el = render(<><StreakFlame /><StreakFlame lit={false} /></>)
    const [a, b] = el.querySelectorAll('svg.flame')
    expect(a.classList.contains('lit')).toBe(true)
    expect(b.classList.contains('out')).toBe(true)
    expect(a.getAttribute('aria-hidden')).toBe('true')
    const ids = [...el.querySelectorAll('linearGradient')].map(g => g.id)
    expect(new Set(ids).size).toBe(4)
    expect(a.querySelector('path').getAttribute('fill')).toBe(`url(#${ids[0]})`)
  })
})

describe('freezes and medals', () => {
  it('fills the banked freezes and says the count', () => {
    const el = render(<Freezes n={1} />)
    expect(el.querySelector('.streak-freezes').getAttribute('aria-label')).toBe('Streak freezes: 1 of 2')
    expect([...el.querySelectorAll('.frz')].map(f => f.classList.contains('on'))).toEqual([true, false])
  })

  it('draws a medal per tier', () => {
    const el = render(<Medal tier="silver" />)
    expect(el.querySelector('svg.medal').classList.contains('medal-silver')).toBe(true)
  })
})

describe('Stats card', () => {
  it('shows tiered medals for the badges reached, locks the rest, and the bar to the next', () => {
    const el = render(<StreakCard info={info()} />)
    const badges = el.querySelectorAll('.streak-badge')
    expect(badges).toHaveLength(5)
    expect(badges[0].querySelector('.medal-bronze')).toBeTruthy()
    expect(badges[1].querySelector('.medal-silver')).toBeTruthy()
    expect(badges[2].querySelector('.medal-locked')).toBeTruthy()
    expect(badges[2].querySelector('[data-icon="lock"]')).toBeTruthy()
    expect(badges[2].getAttribute('aria-label')).toBe('26 weeks: not yet')
    const bar = el.querySelector('[role="progressbar"]')
    expect(bar.getAttribute('aria-valuenow')).toBe('13')
    expect(bar.getAttribute('aria-valuemax')).toBe('26')
    expect(bar.querySelector('i').style.getPropertyValue('--p')).toBe('0.5')
    expect(el.textContent).toContain('13 / 26')
    expect(el.textContent).toContain('Next badge at 26 weeks.')
    expect(el.textContent).toContain('3 more weeks with a workout earn a freeze.')
  })

  it('has no bar once every badge is collected', () => {
    const el = render(<StreakCard info={info({ current: 110, best: 110, badges: [4, 12, 26, 52, 104], next: null, freezes: 2, toNextFreeze: 0 })} />)
    expect(el.querySelector('[role="progressbar"]')).toBeNull()
    expect(el.querySelectorAll('.streak-badge .medal-legend')).toHaveLength(1)
    expect(el.textContent).toContain('Every badge collected. Legend.')
  })
})

describe('Home party', () => {
  const Party = ({ inf }) => { const S = useStore(s => s.S); return <StreakParty S={S} info={inf} tally={{ done: 2, planned: 0 }} /> }

  it('celebrates the top badge once, with its tier, a burst and one buzz', () => {
    const buzz = vi.fn()
    setNativeBuzzer(buzz)
    const el = render(<Party inf={info()} />)
    const party = el.querySelector('.streak-party')
    expect(party.textContent).toContain('12 weeks in a row. New badge!')
    // announced from a live region around it, and still a button
    expect(party.parentElement.getAttribute('role')).toBe('status')
    expect(party.getAttribute('role')).toBeNull()
    expect(party.querySelector('.medal-silver')).toBeTruthy()
    expect(party.querySelectorAll('.burst i')).toHaveLength(12)
    expect(buzz).toHaveBeenCalledTimes(1)
    expect(useStore.getState().S.streakSeen).toEqual({ badge: 12, wk: '2026-10-26' })
    act(() => party.click())
    expect(el.querySelector('.streak-party')).toBeNull()
  })

  it('says a week done with the flame, and stays still with reduced motion', () => {
    matches = true
    useStore.getState().update(s => { s.streakSeen = { badge: 12, wk: null } })
    const el = render(<Party inf={info()} />)
    const party = el.querySelector('.streak-party')
    expect(party.textContent).toContain('Week done. The flame lives on.')
    expect(party.querySelector('svg.flame')).toBeTruthy()
    expect(party.classList.contains('still')).toBe(true)
    expect(party.querySelector('.burst')).toBeNull()
  })

  it('never celebrates in the app tour', () => {
    useStore.setState({ tourSandbox: true })
    expect(render(<Party inf={info()} />).querySelector('.streak-party')).toBeNull()
  })
})
