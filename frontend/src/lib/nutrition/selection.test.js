// @vitest-environment happy-dom
// The one selected date every tab shares: back to today after half an hour in the background
// (ux-redesign-tabs §4.4), kept after a shorter trip away.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isoOf, todayISO } from '../format.js'
import { installDayReset, MEAL_PICK_MS, useDiarySelection } from './selection.js'

const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) })()
let clock = 0, state = 'visible', uninstall
const doc = Object.defineProperty(new EventTarget(), 'visibilityState', { get: () => state })
const go = (to, after = 0) => { clock += after; state = to; doc.dispatchEvent(new Event('visibilitychange')) }

beforeEach(() => {
  clock = 1_000_000
  state = 'visible'
  useDiarySelection.getState().reset()
  useDiarySelection.getState().setDate(yesterday)
  uninstall = installDayReset(doc, () => clock)
})
afterEach(() => uninstall())

describe('installDayReset', () => {
  it('keeps the picked day after a short trip away', () => {
    go('hidden')
    go('visible', MEAL_PICK_MS - 1)
    expect(useDiarySelection.getState().day()).toBe(yesterday)
  })

  it('goes back to today, and to the meal of the hour, after half an hour away', () => {
    useDiarySelection.getState().setMeal(3)
    go('hidden')
    go('visible', MEAL_PICK_MS)
    expect(useDiarySelection.getState().day()).toBe(todayISO())
    expect(useDiarySelection.getState().meal).toBeNull()
  })

  it('counts only time in the background, and stops once uninstalled', () => {
    go('visible', MEAL_PICK_MS * 2)
    expect(useDiarySelection.getState().day()).toBe(yesterday)
    uninstall()
    go('hidden')
    go('visible', MEAL_PICK_MS * 2)
    expect(useDiarySelection.getState().day()).toBe(yesterday)
    uninstall = () => {}
  })
})
