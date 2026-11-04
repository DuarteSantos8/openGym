// @vitest-environment happy-dom
// The streak explained in the calendar (components/StreakCalendar.jsx in sheets.jsx Calendar):
// a mark per week, the frozen week washed, a tapped week's reason, the how-to once. And your own
// flame and freeze (components/StreakIconPicker.jsx) replacing the defaults everywhere.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { calendarSheet } from '../sheets.jsx'
import { todayISO, weekKey } from '../lib/format.js'
import { StreakFlame, Freezes } from './Streak.jsx'
import { StreakIconPicker } from './StreakIconPicker.jsx'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
const mount = node => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(node)); return host
}
const renderTop = () => { const sh = useUI.getState().sheets.at(-1); return mount(sh.render(() => useUI.getState().closeSheet(sh.id))) }
const plus = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

// This week open, last week frozen, the four weeks before trained (they earned the freeze).
const thisWeek = weekKey(todayISO(), 1)
const seeded = () => ({ ...clone(DEF), weekStart: 1, workouts: [2, 3, 4, 5].map((k, i) => ({ id: 'w' + i, d: plus(thisWeek, -7 * k + 1), start: 1, end: 2, name: 'Push', entries: [] })) })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState({ S: seeded(), user: null, tourSandbox: false })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('the calendar explains the streak', () => {
  it('marks every week, washes the frozen one and says why when tapped', () => {
    calendarSheet(plus(thisWeek, -7))
    const el = renderTop()
    expect(el.querySelector('.cal-grid.with-wk')).toBeTruthy()
    expect(el.querySelector('[data-streak-sum]').textContent).toContain('4 week streak')
    expect(el.querySelector('[data-streak-sum]').textContent).toContain('Weeks in a row with at least one workout.')
    const frozen = el.querySelector(`.cal-wk[data-wk="${plus(thisWeek, -7)}"]`)
    expect(frozen.classList.contains('is-frozen')).toBe(true)
    expect(frozen.getAttribute('aria-label')).toMatch(/Frozen$/)
    expect(el.querySelectorAll('.cal-d.wk-frozen').length).toBeGreaterThan(0)
    expect(el.querySelector('[data-wk-note]').textContent).toMatch(/Tap a week's mark/)
    act(() => frozen.click())
    expect(frozen.getAttribute('aria-pressed')).toBe('true')
    expect(el.querySelector('[data-wk-note]').textContent).toMatch(/a freeze covered it/)
    const open = el.querySelector(`.cal-wk[data-wk="${thisWeek}"]`)
    if (open) { act(() => open.click()); expect(el.querySelector('[data-wk-note]').textContent).toMatch(/Still open/) }
    expect(el.querySelector('[data-wk-legend]').textContent).toMatch(/Counted.*Frozen.*Missed.*Still open/)
  })

  it('shows the how-to until Got it, remembered in the synced state, and on demand after', () => {
    calendarSheet()
    let el = renderTop()
    const how = el.querySelector('[data-streak-howto]')
    expect(how.textContent).toMatch(/Every 4th week you train earns a freeze/)
    act(() => how.querySelector('button').click())
    expect(useStore.getState().S.streakHelpSeen).toBe(true)
    expect(el.querySelector('[data-streak-howto]')).toBe(null)
    act(() => { mounted.splice(0).forEach(r => r.unmount()) }); useUI.setState({ sheets: [] })
    calendarSheet(); el = renderTop()
    expect(el.querySelector('[data-streak-howto]')).toBe(null)
    act(() => el.querySelector('.streak-sum-i').click())
    expect(el.querySelector('[data-streak-howto]')).toBeTruthy()
    useUI.setState({ sheets: [] }); calendarSheet(undefined, { help: true })
    expect(renderTop().querySelector('[data-streak-howto]')).toBeTruthy()
  })

  it('leaves the plain calendar alone with Motivation off', () => {
    useStore.getState().update(s => { s.modules = { ...(s.modules || {}), motivation: false } })
    calendarSheet(); const el = renderTop()
    expect(el.querySelector('.cal-grid.with-wk')).toBe(null)
    expect(el.querySelector('.cal-wk')).toBe(null)
  })
})

describe('missed and moved planned days', () => {
  // Two weeks back: Push planned Mon and Wed, trained Mon, Wed missed; Thu was moved Push, trained.
  const mon = plus(thisWeek, -14)
  const planState = () => ({ ...seeded(), routines: [{ id: 'r1', name: 'Push', ex: [] }], week: { 1: ['r1'], 3: ['r1'] },
    dayPlan: { [plus(mon, 3)]: 'r1' },
    workouts: [...seeded().workouts, { id: 'p1', d: mon, start: 1, end: 2, name: 'Push', routineId: 'r1', entries: [] }, { id: 'p2', d: plus(mon, 3), start: 3, end: 4, name: 'Push', routineId: 'r1', entries: [] }] })

  it('a planned day gone by is a hollow dot, and says the week still counts', () => {
    useStore.setState({ S: planState() })
    calendarSheet(mon)
    const el = renderTop()
    const wed = [...el.querySelectorAll('.cal-d')].find(b => b.querySelector('span')?.textContent === String(Number(plus(mon, 2).slice(8))))
    expect(wed.classList.contains('missed')).toBe(true)
    expect(wed.querySelector('i').className).toBe('miss')
    expect(wed.getAttribute('aria-label')).toMatch(/Missed plan$/)
    expect(el.querySelector('.cal-legend').textContent).toContain('Missed plan')
    act(() => wed.click())
    // It stays on the calendar: the line explains, and opens the day on request.
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(wed.getAttribute('aria-pressed')).toBe('true')
    expect(el.querySelector('[data-wk-note]').textContent).toMatch(/Planned, not trained\. No harm done/)
    act(() => el.querySelector('.wk-note-a').click())
    expect(useUI.getState().sheets.length).toBeGreaterThan(0)
  })

  it('a moved day that was trained keeps an orange hint, the others plain', () => {
    useStore.setState({ S: planState() })
    calendarSheet(mon)
    const el = renderTop()
    const thu = [...el.querySelectorAll('.cal-d.has')].find(b => b.querySelector('span')?.textContent === String(Number(plus(mon, 3).slice(8))))
    expect(thu.querySelector('i').className).toBe('done moved')
    expect(el.querySelectorAll('.cal-d i.done:not(.moved)').length).toBeGreaterThan(0)
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/\.cal-d i\.miss[^{]*\{[^}]*box-shadow/)
    expect(css).toMatch(/\.cal-d i\.moved\{outline/)
  })
})

describe('your own flame and freeze', () => {
  it('replaces the drawn flame and the snowflake, and Reset brings them back', () => {
    const el = mount(<><StreakFlame /><Freezes n={1} /></>)
    expect(el.querySelector('svg.flame')).toBeTruthy()
    act(() => useStore.getState().update(s => { s.flameIcon = { k: 'icon', v: 'bolt', c: '#ffc93c' }; s.freezeIcon = { k: 'emoji', v: '🧊', c: '#88ccee' } }))
    expect(el.querySelector('svg.flame')).toBe(null)
    expect(el.querySelector('.flame-own [data-icon="bolt"]')).toBeTruthy()
    expect(el.querySelector('.frz.on .frz-own .own-e').textContent).toBe('🧊')
    // A freeze still to earn stays the plain outline.
    expect(el.querySelector('.frz:not(.on) [data-icon="snowflake"]')).toBeTruthy()
    act(() => useStore.getState().update(s => { delete s.flameIcon; delete s.freezeIcon }))
    expect(el.querySelector('svg.flame')).toBeTruthy()
  })

  it('the picker stores an icon, an emoji with its colour, and resets', () => {
    const el = mount(<StreakIconPicker kind="flame" close={() => {}} />)
    const heart = el.querySelector('.sip-grid [aria-label="Heart"]')
    act(() => heart.click())
    expect(useStore.getState().S.flameIcon).toEqual({ k: 'icon', v: 'heart', c: '#ff375f' })
    expect(heart.getAttribute('aria-checked')).toBe('true')
    const input = el.querySelector('.sip-input')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    act(() => { set.call(input, 'nope'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(el.querySelector('.sip-bad')).toBeTruthy()
    expect(useStore.getState().S.flameIcon.v).toBe('heart')
    act(() => { set.call(input, '🌶️'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const v = useStore.getState().S.flameIcon
    expect(v.k).toBe('emoji'); expect(v.v).toBe('🌶️'); expect(v.c).toMatch(/^#[0-9a-f]{6}$/)
    act(() => [...el.querySelectorAll('button')].find(b => b.textContent === 'Reset to default').click())
    expect(useStore.getState().S.flameIcon).toBeUndefined()
  })
})
