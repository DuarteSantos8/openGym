// @vitest-environment happy-dom
// The monthly challenges on Home and Stats (components/Challenges.jsx, lib/challenges.js).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { ChallengesCard, ChallengesStatsCard } from './Challenges.jsx'
import { monthKeyOf, shiftMonth } from '../lib/challenges.js'
import { searchSettings } from '../views/settings-pages.js'
import { buildWidgetSnapshot } from '../lib/widgets.js'

const clone = v => JSON.parse(JSON.stringify(v))
// Mid-month, so the "new month" line stays out of it unless a test wants it.
const NOW = new Date(2026, 10, 15, 12)
const KEY = monthKeyOf(NOW)
const pad = n => String(n).padStart(2, '0')
const wo = (day, id = '0025') => ({ id: 'w' + day + id, d: `${KEY}-${pad(day)}`, start: new Date(2026, 10, day, 18).getTime(), end: new Date(2026, 10, day, 19).getTime(), entries: [{ id, sets: [{ w: 60, r: 10, done: true }] }] })
const PICKED = [{ id: 'workouts', n: 3 }, { id: 'newex', n: 3 }, { id: 'muscles', n: 6 }]

let root, host, matches = false
function Home() { const S = useStore(s => s.S); return <ChallengesCard S={S} now={NOW} /> }
function Stats() { const S = useStore(s => s.S); return <ChallengesStatsCard S={S} now={NOW} /> }
const render = (C = Home) => { act(() => root.render(<C />)); return host }
const setS = patch => useStore.setState({ S: { ...useStore.getState().S, ...patch } })
const S = () => useStore.getState().S

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  matches = false
  globalThis.matchMedia = () => ({ matches, addEventListener () {}, removeEventListener () {} })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const s = clone(DEF)
  Object.assign(s, { unit: 'kg', workouts: [wo(2), wo(4)], routines: [], week: {}, dayPlan: {} })
  useStore.setState({ S: s, user: null, tourSandbox: false })
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete globalThis.matchMedia })

describe('Home card', () => {
  it('shows the month’s three with a bar each and keeps the picks', () => {
    const el = render()
    expect(el.querySelector('[data-challenges]')).toBeTruthy()
    expect(el.querySelectorAll('.ch-row')).toHaveLength(3)
    expect(el.querySelectorAll('[role="progressbar"]')).toHaveLength(3)
    expect(el.textContent).toContain('This month’s challenges')
    expect(S().challenges[KEY].picked).toHaveLength(3)
  })

  it('updates after a workout and celebrates a challenge done, once', () => {
    setS({ challenges: { [KEY]: { picked: PICKED, done: [], at: 1 } } })
    const el = render()
    const row = () => el.querySelector('[data-challenge="workouts"]')
    expect(row().textContent).toContain('2 / 3')
    expect(el.querySelector('.streak-party')).toBeNull()
    act(() => { useStore.getState().update(s => { s.workouts.push(wo(9)) }) })
    expect(row().textContent).toContain('3 / 3')
    expect(row().classList.contains('done')).toBe(true)
    expect(S().challenges[KEY].done).toEqual(['workouts'])
    const party = el.querySelector('.streak-party')
    expect(party.textContent).toContain('Challenge done: 3 workouts this month. New badge!')
    expect(party.classList.contains('still')).toBe(false)
    // the month's first badge is bronze, and the burst flies
    expect(party.querySelector('.medal-bronze')).toBeTruthy()
    expect(party.querySelectorAll('.burst i').length).toBeGreaterThan(6)
    // the bar carries its true ratio, done in full
    expect(row().querySelector('.pbar i').style.getPropertyValue('--p')).toBe('1')
    expect(row().querySelector('.ch-ok')).toBeTruthy()
    act(() => party.click())
    expect(el.querySelector('.streak-party')).toBeNull()
  })

  it('says gold when all three are done, and keeps still with reduced motion', () => {
    matches = true
    setS({ challenges: { [KEY]: { picked: [{ id: 'workouts', n: 3 }, { id: 'weeks', n: 1 }, { id: 'newex', n: 1 }], done: ['weeks', 'newex'], at: 1 } } })
    const el = render()
    act(() => { useStore.getState().update(s => { s.workouts.push(wo(9)) }) })
    const party = el.querySelector('.streak-party')
    expect(party.textContent).toContain('All three done. Gold month!')
    expect(party.classList.contains('still')).toBe(true)
    expect(party.querySelector('.sparks')).toBeNull()
    expect(el.textContent).toContain('Gold month. Take a bow.')
  })

  it('folds to a line, and the × hides it until next month', () => {
    const el = render()
    act(() => el.querySelector('.ch-head').click())
    expect(S().challengesFold).toBe(true)
    expect(el.querySelector('.ch-list')).toBeNull()
    expect(el.querySelectorAll('.ch-mini span')).toHaveLength(3)
    act(() => el.querySelector('button[aria-label="Hide until next month"]').click())
    expect(S().challengesHidden).toBe(KEY)
    expect(el.querySelector('[data-challenges]')).toBeNull()
    setS({ challengesHidden: shiftMonth(KEY, -1) })
    expect(render().querySelector('[data-challenges]')).toBeTruthy()
  })

  it('is not there when switched off, or before the first workout', () => {
    setS({ monthlyChallenges: false })
    expect(render().querySelector('[data-challenges]')).toBeNull()
    expect(S().challenges).toBeUndefined()
    setS({ monthlyChallenges: true, workouts: [] })
    expect(render().querySelector('[data-challenges]')).toBeNull()
  })

  it('writes nothing during the app tour', () => {
    useStore.setState({ tourSandbox: true })
    render()
    expect(S().challenges).toBeUndefined()
  })

  it('lets last month’s challenge end quietly, and says new month in the first days', () => {
    const prev = shiftMonth(KEY, -1)
    setS({ challenges: { [prev]: { picked: PICKED, done: [], at: 1 } } })
    const early = new Date(2026, 10, 2, 9)
    function Early() { const st = useStore(s => s.S); return <ChallengesCard S={st} now={early} /> }
    const el = render(Early)
    expect(el.textContent).toContain('New month, new challenges.')
    expect(el.textContent).not.toMatch(/missed|failed/i)
  })

  it('is found in Settings search', () => {
    expect(searchSettings('challenge', {}).map(r => r.title)).toContain('Monthly challenges')
  })
})

describe('Stats', () => {
  it('shows this month and the trophy shelf, gold months crowned', () => {
    setS({ challenges: { [KEY]: { picked: PICKED, done: [], at: 1 }, '2026-10': { picked: PICKED, done: ['workouts', 'newex', 'muscles'], at: 1 }, '2026-09': { picked: PICKED, done: ['newex'], at: 1 } } })
    const el = render(Stats)
    expect(el.querySelector('[data-challenge-shelf]')).toBeTruthy()
    const months = el.querySelectorAll('.ch-month')
    expect(months).toHaveLength(2)
    expect(months[0].classList.contains('gold')).toBe(true)
    expect(months[0].getAttribute('aria-label')).toMatch(/^Gold month: .*3 of 3 challenges$/)
    // a medal per challenge done, bronze first, and an empty slot for each still open
    expect(months[1].querySelectorAll('.ch-medals > .got')).toHaveLength(1)
    expect(months[1].querySelector('.ch-medals > .got').classList.contains('medal-bronze')).toBe(true)
    expect(months[1].querySelectorAll('.ch-medals > .ch-slot')).toHaveLength(2)
    expect(months[0].querySelectorAll('.ch-medals > .medal-gold')).toHaveLength(3)
    expect(months[0].querySelector('.ch-crown')).toBeTruthy()
  })

  it('keeps the shelf when switched off, says what it is for when empty', () => {
    setS({ monthlyChallenges: false, challenges: { '2026-10': { picked: PICKED, done: ['newex'], at: 1 } } })
    let el = render(Stats)
    expect(el.querySelectorAll('.ch-row')).toHaveLength(0)
    expect(el.querySelectorAll('.ch-month')).toHaveLength(1)
    setS({ monthlyChallenges: true, challenges: undefined })
    el = render(Stats)
    expect(el.textContent).toContain('Every challenge you finish puts a badge here')
    expect(el.querySelectorAll('.ch-shelf-empty .medal-locked')).toHaveLength(3)
  })
})

describe('widgets', () => {
  it('carry the month’s challenges, or null when they are off', () => {
    setS({ challenges: { [KEY]: { picked: PICKED, done: [], at: 1 } } })
    const snap = buildWidgetSnapshot(S(), { today: `${KEY}-15` })
    expect(snap.challenges).toMatchObject({ month: KEY, done: 0, total: 3, line: '0 of 3 done' })
    expect(snap.challenges.items[0]).toMatchObject({ id: 'workouts', count: '2 / 3', pct: 67, done: false })
    expect(snap.challenges.next).toBe('3 workouts this month · 2 / 3')
    expect(snap.labels.kinds.challenges).toBe('Challenges')
    expect(buildWidgetSnapshot({ ...S(), monthlyChallenges: false }, { today: `${KEY}-15` }).challenges).toBeNull()
  })
})
