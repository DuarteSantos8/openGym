// @vitest-environment happy-dom
// Strength level per lift: the exercise-details block, the Stats card, hidden without a weigh-in,
// and the About you sheet that the levels read.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { StrengthLevelBlock, StrengthLevelsCard, aboutYouSheet } from './StrengthLevel.jsx'

const BENCH = '0025'
const mounted = []
const render = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const seed = extra => useStore.setState({ S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [{ id: 'w', d: '2026-10-02', start: 1, entries: [{ id: BENCH, target: { mode: 'reps' }, sets: [{ w: 100, r: 1, done: true }] }] }], ...extra }, user: null })
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; useUI.setState({ sheets: [] }); seed() })
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('strength level per lift', () => {
  it('shows the level, the ratio and the next step, with the men’s-table hint until sex is set', () => {
    const host = render(<StrengthLevelBlock exId={BENCH} />)
    expect(host.querySelector('.slevel-name').textContent).toBe('Intermediate lifter')
    expect(host.textContent).toContain('1.25 × body weight')
    expect(host.textContent).toContain('Advanced lifter from an estimated 1RM of 120 kg')
    expect(host.querySelectorAll('.slevel-bar .on')).toHaveLength(3)
    expect(host.textContent).toContain('Using the men’s table')
  })
  it('is hidden without a weigh-in, and for a lift with no standard', () => {
    seed({ bodyweight: [] })
    expect(render(<StrengthLevelBlock exId={BENCH} />).textContent).toBe('')
    // the card stays, and says why it has no levels yet
    expect(render(<StrengthLevelsCard S={useStore.getState().S} />).textContent).toContain('Add a bodyweight to see your levels.')
    seed()
    expect(render(<StrengthLevelBlock exId="0001" />).textContent).toBe('')
  })
  it('the Stats card lists the lifts; About you sets the sex the levels read', () => {
    expect(render(<StrengthLevelsCard S={useStore.getState().S} />).querySelectorAll('.slevel-row')).toHaveLength(1)
    aboutYouSheet()
    const sheet = useUI.getState().sheets.at(-1)
    const host = render(sheet.render(() => {}))
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Female').click())
    expect(useStore.getState().S.sex).toBe('female')
    expect(render(<StrengthLevelBlock exId={BENCH} />).querySelector('.slevel-name').textContent).toBe('Advanced lifter')
  })

  it('the Stats card names the lift in full and in title case, the level and ratio on the same line', () => {
    const row = render(<StrengthLevelsCard S={useStore.getState().S} />).querySelector('.slevel-row')
    expect(row.querySelector('.slevel-ex').textContent).toBe('Barbell Bench Press')
    expect(row.querySelector('.slevel-lvl').textContent).toBe('Intermediate lifter')
    expect(row.querySelector('.slevel-num').textContent).toBe('1.25×')
    expect(row.querySelectorAll('.slevel-num')[1].textContent).toBe('100 kg')
    // the cut-offs under the bands: Advanced starts at 1.5×
    expect([...row.querySelectorAll('.slevel-ticks span')].map(s => s.textContent)).toEqual(['', '0.75×', '1×', '1.5×', '2×'])
    // the whole line in words for a screen reader, the ratio said as a ratio of body weight
    expect(row.getAttribute('aria-label')).toBe('Barbell Bench Press: Intermediate lifter, 1.25 × body weight. Advanced lifter from an estimated 1RM of 120 kg')
  })
  it('draws a five-band colour bar, filled to the lifter’s place, and lists untried lifts under Not tried yet', () => {
    const host = render(<StrengthLevelsCard S={useStore.getState().S} />)
    const bands = host.querySelectorAll('.slevel-track > button')
    expect(bands).toHaveLength(5)
    // Intermediate (index 2): 1.25 sits halfway between its 1.0 and the Advanced 1.5, so the bands
    // read full, full, half, empty, empty
    expect(bands[2].querySelector('i').style.getPropertyValue('--f')).toBe('0.5')
    expect(bands[3].querySelector('i').style.getPropertyValue('--f')).toBe('0')
    expect(bands[0].querySelector('i').style.getPropertyValue('--f')).toBe('1')
    expect(host.querySelector('.slevel-row .slevel-track')).not.toBeNull()
    // the scale toggle: Weight is on at first; Population moves the fill to the population position (0.65)
    const seg = host.querySelector('.slevel-scale')
    expect(seg.querySelector('button.on').textContent).toBe('Weight')
    act(() => [...seg.querySelectorAll('button')].find(b => b.textContent === 'Population').click())
    expect(seg.querySelector('button.on').textContent).toBe('Population')
    expect(host.querySelectorAll('.slevel-track > button')[1].querySelector('i').style.getPropertyValue('--f')).toBe('1')
    expect(host.querySelectorAll('.slevel-track > button')[2].querySelector('i').style.getPropertyValue('--f')).toBe('0.5')
    // each band is a button: tapping one shows its cut-offs in the info line, and selects it
    const bandBtns = host.querySelectorAll('.slevel-track > button')
    expect(bandBtns[2].getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.slevel-info').textContent).toContain('Intermediate lifter')
    expect(host.querySelector('.slevel-info').textContent).toContain('1× – 1.5×')
    expect(host.querySelector('.slevel-info').textContent).toContain('50% – 80%')
    act(() => bandBtns[0].click())
    expect(bandBtns[0].getAttribute('aria-pressed')).toBe('true')
    expect(bandBtns[2].getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('.slevel-info').textContent).toContain('< 0.75×')
    expect(host.querySelector('.slevel-info').textContent).toContain('< 20%')
    expect(host.querySelector('.slevel-info').textContent).not.toContain('0% – 20%')
    act(() => bandBtns[4].click())
    expect(host.querySelector('.slevel-info').textContent).toContain('≥ 2×')
    expect(host.querySelector('.slevel-info').textContent).toContain('95% – 100%')
    const toggle = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Not tried yet')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('.slevel-todo')).toHaveLength(0)
    act(() => toggle.click())
    expect(host.querySelectorAll('.slevel-todo').length).toBeGreaterThan(0)
    expect(host.textContent).toContain('Log a set to see your level.')
  })
  it('About you: the unset year reads as a suggestion, its hint on one line, the sex choice named', () => {
    aboutYouSheet()
    const host = render(useUI.getState().sheets.at(-1).render(() => {}))
    expect(host.querySelector('.stp.unset')).not.toBeNull()
    expect(host.querySelector('.about-hint').textContent).toBe('Not set')
    const seg = host.querySelector('.seg')
    expect(seg.getAttribute('role')).toBe('group')
    expect(host.querySelector('#' + seg.getAttribute('aria-labelledby')).textContent).toBe('Sex')
  })
  it('for women the population shares are off: no toggle, no percentiles, and a note says why', () => {
    const S = { ...useStore.getState().S, sex: 'female' }
    const host = render(<StrengthLevelsCard S={S} />)
    expect(host.querySelector('.slevel-scale')).toBeNull()
    expect(host.textContent).toContain('Population shares are only shown for the men’s table, under 40.')
    // women's bench table: 1.25× is Advanced (1× to 1.5×), in kg at 80 kg bodyweight
    expect(host.querySelector('.slevel-info').textContent).toContain('Advanced lifter')
    expect(host.querySelector('.slevel-info').textContent).toContain('1× – 1.5× (80 – 120 kg)')
    expect(host.querySelector('.slevel-info').textContent).not.toContain('%')
    expect(host.querySelector('.slevel-ticks').textContent).not.toContain('%')
  })
  it('from 40 on the population shares are off, even for a man, and the note says why', () => {
    const S = { ...useStore.getState().S, sex: 'male', birthYear: new Date().getFullYear() - 45 }
    const host = render(<StrengthLevelsCard S={S} />)
    expect(host.querySelector('.slevel-scale')).toBeNull()
    expect(host.textContent).toContain('Population shares are only shown for the men’s table, under 40.')
    expect(host.querySelector('.slevel-info').textContent).not.toContain('%')
    expect(host.querySelector('.slevel-ticks').textContent).not.toContain('%')
  })
  it('the Weight / Population choice is remembered on this device', () => {
    localStorage.removeItem('gym_strength_scale')
    const host = render(<StrengthLevelsCard S={useStore.getState().S} />)
    act(() => [...host.querySelector('.slevel-scale').querySelectorAll('button')].find(b => b.textContent === 'Population').click())
    expect(localStorage.getItem('gym_strength_scale')).toBe('population')
    expect(render(<StrengthLevelsCard S={useStore.getState().S} />).querySelector('.slevel-scale button.on').textContent).toBe('Population')
    localStorage.removeItem('gym_strength_scale')
  })
})
