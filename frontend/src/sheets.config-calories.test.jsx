// @vitest-environment happy-dom
// A cardio exercise's settings choose how long an interval is: a time or a calorie count, one or
// the other (lib/calories.js). The slot carries `min` or `kcal`, never both.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

const ROWER = '1161'       // rowing (with rowing machine)
const HIGH_KNEES = '3556'  // cardio with no machine
const mounted = []
function open(ex, existing) {
  useStore.setState({ S: structuredClone(DEF), user: null })
  const onSave = vi.fn()
  exConfigSheet(ex, existing, onSave, null, null)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const labels = () => [...host.querySelectorAll('.stp-l')].map(l => l.textContent.trim())
  const field = label => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label)?.querySelector('input.num')
  const type = (el, value) => act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const lengths = () => [...host.querySelectorAll('.seg-len button')].map(b => b.textContent.trim())
  const picked = () => host.querySelector('.seg-len button.on')?.textContent.trim()
  const pick = label => act(() => [...host.querySelectorAll('.seg-len button')].find(b => b.textContent.trim() === label).click())
  const save = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
  return { labels, field, type, save, onSave, lengths, picked, pick }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('time or calories in a cardio exercise\'s settings', () => {
  it('offers Time or Calories, on Time by default, with Minutes and no Calories', () => {
    const v = open(EXIDX[ROWER], { sets: 4, min: 5, speed: 10 })
    expect(v.lengths()).toEqual(['Time', 'Distance', 'Calories'])
    expect(v.picked()).toBe('Time')
    expect(v.labels()).toContain('Minutes')
    expect(v.labels()).not.toContain('Calories')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ sets: 4, min: 5, speed: 10 })
    expect(saved).not.toHaveProperty('kcal')
  })

  it('Calories swaps Minutes for a count and saves it without minutes', () => {
    const v = open(EXIDX[ROWER], { sets: 4, min: 5, speed: 10 })
    v.pick('Calories')
    expect(v.labels()).toContain('Calories')
    expect(v.labels()).not.toContain('Minutes')
    v.type(v.field('Calories'), '60')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ sets: 4, kcal: 60, speed: 10 })
    expect(saved).not.toHaveProperty('min')
  })

  it('reopens on Calories, and going back to Time drops the count', () => {
    const v = open(EXIDX[ROWER], { sets: 4, kcal: 50, speed: 10 })
    expect(v.picked()).toBe('Calories')
    expect(v.field('Calories').value).toBe('50')
    v.pick('Time')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ sets: 4, min: 20, speed: 10 })
    expect(saved).not.toHaveProperty('kcal')
  })
})

describe('distance in a cardio exercise\'s settings', () => {
  it('Distance swaps Minutes for a distance and saves it without minutes', () => {
    const v = open(EXIDX[ROWER], { sets: 4, min: 5, speed: 10 })
    v.pick('Distance')
    expect(v.labels()).toContain('Distance (km)')
    expect(v.labels()).not.toContain('Minutes')
    v.type(v.field('Distance (km)'), '0.5')
    v.save()
    const saved = v.onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ sets: 4, km: 0.5, speed: 10 })
    expect(saved).not.toHaveProperty('min')
    expect(saved).not.toHaveProperty('kcal')
  })

  it('reopens on Distance', () => {
    const v = open(EXIDX[ROWER], { sets: 4, km: 2, speed: 10 })
    expect(v.picked()).toBe('Distance')
    expect(v.field('Distance (km)').value).toBe('2')
  })
})

describe('calories only where the machine shows them', () => {
  it('a cardio drill offers Time and Distance only', () => {
    const v = open(EXIDX[HIGH_KNEES], { sets: 1, min: 10, speed: 8 })
    expect(v.lengths()).toEqual(['Time', 'Distance'])
  })
  it('a slot that already counts calories keeps the choice', () => {
    const v = open(EXIDX[HIGH_KNEES], { sets: 1, kcal: 80, speed: 8 })
    expect(v.lengths()).toEqual(['Time', 'Distance', 'Calories'])
    expect(v.picked()).toBe('Calories')
  })
})
