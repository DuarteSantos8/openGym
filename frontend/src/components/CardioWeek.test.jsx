// @vitest-environment happy-dom
// The cardio card with goals of your own (1.4.5): the first one big, the others as small rows, and
// the sheet that adds, changes, moves and removes them.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: mocks.S, update: fn => { const next = JSON.parse(JSON.stringify(mocks.S)); fn(next); mocks.S = next } }),
}))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ openSheet: () => {} }) } }))

import CardioWeekCard, { GoalSheet } from './CardioWeek.jsx'
import { cardioGoalsOf } from '../lib/cardio-goals.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })
function render(el) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}
const today = new Date().toISOString().slice(0, 10)
const run = (min, km) => ({ id: 'w' + min, d: today, start: Date.now() - 3600e3, end: Date.now(), entries: [{ id: '0685', sets: [{ min, km, done: true }] }] })
const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('the card', () => {
  it('shows an old minutes goal the way it did', () => {
    mocks.S = { unit: 'kg', cardioGoal: 150, workouts: [run(45, 7)] }
    render(<CardioWeekCard S={mocks.S} />)
    expect(host.querySelector('.cardio-num').textContent).toBe('45 of 150 min')
    expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('45')
    expect(host.querySelectorAll('.cardio-bar')).toHaveLength(8)
    expect(host.querySelector('.cardio-goals')).toBeNull()
  })
  it('puts the first goal big and the others in small rows, in the profile unit', () => {
    mocks.S = { unit: 'lb', cardioGoal: 150, cardioGoals: [{ kind: 'run', unit: 'km', v: 16.093 }, { kind: 'any', unit: 'min', v: 150 }, { kind: 'run', unit: 'n', v: 3 }], workouts: [run(45, 8.047)] }
    render(<CardioWeekCard S={mocks.S} />)
    expect(host.querySelector('.cardio-kind').textContent).toBe('Run')
    expect(host.querySelector('.cardio-num').textContent).toBe('5 of 10 mi')
    const rows = [...host.querySelectorAll('.cardio-goal-row')]
    expect(rows.map(r => r.querySelector('.cg-num').textContent)).toEqual(['45 of 150 min', '1 of 3 sessions'])
    expect(host.querySelectorAll('.cardio-bar')).toHaveLength(8)
    expect(host.textContent).toContain('Goals')
  })
  it('stays away with no cardio and no goal, and shows with a goal alone', () => {
    mocks.S = { unit: 'kg', workouts: [] }
    render(<CardioWeekCard S={mocks.S} />)
    expect(host.querySelector('[data-cardio-week]')).toBeNull()
    act(() => root.unmount()); host.remove()
    mocks.S = { unit: 'kg', cardioGoals: [{ kind: 'swim', unit: 'km', v: 2 }], workouts: [] }
    render(<CardioWeekCard S={mocks.S} />)
    expect(host.querySelector('.cardio-num').textContent).toBe('0 of 2,000 m')
  })
})

describe('the sheet', () => {
  it('adds a goal of any number of minutes, then a swim in metres', () => {
    mocks.S = { unit: 'kg', workouts: [] }
    render(<GoalSheet />)
    expect(host.textContent).toContain('No goal yet')
    click(button('Add a goal'))
    const input = host.querySelector('.stp input')
    expect(input.value).toBe('150')
    act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, '170'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    click(button('Add'))
    expect(mocks.S.cardioGoal).toBe(170)
    expect(cardioGoalsOf(mocks.S)).toEqual([{ kind: 'any', unit: 'min', v: 170 }])
    click(button('Add a goal'))
    click(host.querySelector('[data-kind="swim"]'))
    click(button('Distance'))
    expect(host.querySelector('.stp input').value).toBe('1000')
    expect(host.querySelector('.stp .val i').textContent).toBe('m')
    click(host.querySelectorAll('.stp button')[1])
    click(button('Add'))
    expect(cardioGoalsOf(mocks.S)).toEqual([{ kind: 'any', unit: 'min', v: 170 }, { kind: 'swim', unit: 'km', v: 1.25 }])
  })
  it('moves a goal first and removes one, the old number going with it', () => {
    mocks.S = { unit: 'kg', cardioGoal: 150, cardioGoals: [{ kind: 'any', unit: 'min', v: 150 }, { kind: 'ride', unit: 'n', v: 2 }], workouts: [] }
    render(<GoalSheet />)
    click(host.querySelectorAll('.lrow')[1])
    click(button('Show first'))
    expect(cardioGoalsOf(mocks.S).map(g => g.kind)).toEqual(['ride', 'any'])
    click(host.querySelectorAll('.lrow')[1])
    click(button('Remove goal'))
    expect(cardioGoalsOf(mocks.S)).toEqual([{ kind: 'ride', unit: 'n', v: 2 }])
    expect(mocks.S.cardioGoal).toBe(0)
  })
  it('offers distance only where it means something', () => {
    mocks.S = { unit: 'kg', workouts: [] }
    render(<GoalSheet initial={{ at: -1, kind: 'any', unit: 'min', val: 150 }} />)
    expect(button('Distance')).toBeUndefined()
    click(host.querySelector('[data-kind="run"]'))
    expect(button('Distance')).toBeDefined()
    click(host.querySelector('[data-kind="stairs"]'))
    expect(button('Distance')).toBeUndefined()
  })
})
