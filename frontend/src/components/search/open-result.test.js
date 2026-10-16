// @vitest-environment happy-dom
// Where every type of result goes (ux-search.md §4): sheets over the overlay, routes on top of it.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({ exerciseDetailSheet: vi.fn(), workoutDetailSheet: vi.fn(), foodDetailSheet: vi.fn(), mealDetailSheet: vi.fn(), manageMeasurementsSheet: vi.fn() }))
const session = vi.hoisted(() => ({ visit: vi.fn() }))
vi.mock('../../sheets.jsx', () => ({ exerciseDetailSheet: sheets.exerciseDetailSheet, workoutDetailSheet: sheets.workoutDetailSheet }))
vi.mock('../FoodDetailSheet.jsx', () => ({ foodDetailSheet: sheets.foodDetailSheet }))
vi.mock('../MealDetailSheet.jsx', () => ({ mealDetailSheet: sheets.mealDetailSheet }))
vi.mock('../FoodEditSheet.jsx', () => ({ foodEditSheet: vi.fn() }))
vi.mock('../../views/Measurements.jsx', () => ({ manageMeasurementsSheet: sheets.manageMeasurementsSheet }))
vi.mock('../../lib/search/session.js', () => ({ visit: session.visit }))

const { openResult, targetOf } = await import('./open-result.js')
const { useRecents } = await import('../../lib/search/recents.js')

beforeEach(() => {
  vi.clearAllMocks()
  useRecents.setState({ list: [], opened: {} })
})

const open = r => openResult({ key: r.type + ':' + r.id, title: 'T', ...r }, { query: 'q' })

describe('opening a result', () => {
  it('a page: its route; a page whose feature is off: the switch, flashed', () => {
    open({ type: 'page', id: '/progress/body', path: '/progress/body' })
    expect(session.visit).toHaveBeenLastCalledWith('/progress/body', { date: undefined, state: undefined })
    open({ type: 'page', id: '/food/fasting', path: '/food/fasting', off: { page: 'features', find: 'Fasting' } })
    expect(session.visit).toHaveBeenLastCalledWith('/me/features', { date: undefined, state: { find: 'Fasting' } })
  })

  it('a setting: its page with { find, via }; a Profile page: the page; a sheet page: the sheet', () => {
    open({ type: 'setting', id: 'x', entry: { page: 'notifications', title: 'Reminder time', via: 'Push notifications', isPage: false } })
    expect(session.visit).toHaveBeenLastCalledWith('/me/notifications', { date: undefined, state: { find: 'Reminder time', via: 'Push notifications' } })
    open({ type: 'setting', id: 'y', entry: { page: null, title: 'Sync now', isPage: false } })
    expect(session.visit).toHaveBeenLastCalledWith('/me', { date: undefined, state: { find: 'Sync now' } })
    open({ type: 'setting', id: 'z', entry: { page: 'goals', title: 'Goals', isPage: true, to: '/food/goals' } })
    expect(session.visit).toHaveBeenLastCalledWith('/food/goals', { date: undefined, state: undefined })
    open({ type: 'setting', id: 'f', entry: { page: 'fields', title: 'Measurement fields', isPage: true, sheet: true } })
    expect(sheets.manageMeasurementsSheet).toHaveBeenCalled()
  })

  it('an exercise, a workout, a food, a meal, a recipe and an online food: their sheets, over the overlay', () => {
    open({ type: 'exercise', id: '0025', ex: { id: '0025' } })
    expect(sheets.exerciseDetailSheet).toHaveBeenCalledWith({ id: '0025' })
    open({ type: 'workout', id: 'w1', workout: { id: 'w1' } })
    expect(sheets.workoutDetailSheet).toHaveBeenCalledWith({ id: 'w1' })
    open({ type: 'food', id: 11, food: { id: 11 } })
    expect(sheets.foodDetailSheet).toHaveBeenLastCalledWith(expect.objectContaining({ food: { id: 11 }, onEdit: expect.any(Function) }))
    open({ type: 'meal', id: 21 })
    expect(sheets.mealDetailSheet).toHaveBeenLastCalledWith({ id: 21, recipe: false })
    open({ type: 'recipe', id: 22 })
    expect(sheets.mealDetailSheet).toHaveBeenLastCalledWith({ id: 22, recipe: true })
    open({ type: 'online', id: '123', food: { name: 'Nutella' } })
    expect(sheets.foodDetailSheet).toHaveBeenLastCalledWith(expect.objectContaining({ food: { name: 'Nutella' }, onSave: expect.any(Function) }))
    expect(session.visit).not.toHaveBeenCalled()
  })

  it('a routine: its editor; a day: Nutrition on that date with the entry to find, the date scoped', () => {
    open({ type: 'routine', id: 'r1' })
    expect(session.visit).toHaveBeenLastCalledWith('/train/routines/r1', { date: undefined, state: undefined })
    open({ type: 'day', id: '2026-10-11', date: '2026-10-11', uuid: 'u-1' })
    expect(session.visit).toHaveBeenLastCalledWith('/food?date=2026-10-11&find=u-1', { date: '2026-10-11', state: undefined })
    expect(targetOf({ type: 'day', date: '2026-10-11', uuid: null })).toMatchObject({ path: '/food?date=2026-10-11' })
  })

  it('remembers what was opened, and how often; never an online food', () => {
    open({ type: 'routine', id: 'r1' })
    open({ type: 'online', id: '1', food: {} })
    expect(useRecents.getState().list).toEqual([{ kind: 'result', type: 'routine', id: 'r1', label: 'T', query: 'q' }])
    expect(useRecents.getState().opened['routine:r1'].n).toBe(1)
  })
})
