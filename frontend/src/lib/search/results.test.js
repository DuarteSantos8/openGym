// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DEF } from '../../store/useStore.js'
import { CATALOGUE } from '../exercises.js'
import { GROUP_ORDER, bestMatch, listAll, searchLocal, summaryOf } from './results.js'
import { PAGE_INDEX } from './pages.js'
import { shortcutsFor, suggestionsFor } from './start.js'
import { join } from 'node:path'

const today = '2026-10-15'
const bench = CATALOGUE.find(e => e.n === 'barbell bench press')
const workout = (id, d, name, exId = bench.id) => ({ id, d, start: Date.parse(d + 'T18:00:00'), end: Date.parse(d + 'T18:52:00'), name, entries: [{ id: exId, sets: [{ w: 80, r: 5, done: true }, { w: 80, r: 5, done: true }] }], prs: [] })

function data(over = {}) {
  const S = { ...structuredClone(DEF), routines: [{ id: 'r1', name: 'Push day', ex: [{ id: bench.id }] }], workouts: [workout('w1', '2026-10-13', 'Push day'), workout('w2', '2026-10-01', 'Legs')], ...over.S }
  return {
    S, exercises: CATALOGUE, nameOf: id => (id === bench.id ? 'Barbell bench press' : ''), nutrition: true, ntSettings: null, today, weekStart: 1,
    foods: [{ id: 11, name: 'Rolled oats', brand: 'Bio', portion: 100, unit: 'g', nutrition: { calories: 380 }, usage_count: 9 }, { id: 12, name: 'Chicken breast', portion: 100, unit: 'g', nutrition: { calories: 165 } }],
    meals: [{ id: 21, name: 'Chicken bowl', is_recipe: false, items: [{ name: 'Rice' }], nutrition: {} }], recipes: [],
    days: [{ date: '2026-10-11', rev: 'x', kcal: 1840, items: [{ uuid: 'u1', name: 'Chicken bowl', meal: 1, kcal: 640, food_id: null }, { uuid: 'u2', name: 'Chicken soup', meal: 2, kcal: 300, food_id: null }] }],
    mealNames: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
    pagesCtx: { nutrition: true, checkIn: true, coach: false, fastingOn: false },
    settingsCtx: { user: { id: 1 }, mobile: false, nutrition: true, ntSettings: null, lang: 'en' },
    ...over,
  }
}

describe('the local search', () => {
  it('orders its groups by the tab it was opened from, Online always last', () => {
    for (const tab of Object.keys(GROUP_ORDER)) expect(GROUP_ORDER[tab].at(-1)).toBe('online')
    expect(GROUP_ORDER.train.slice(0, 3)).toEqual(['exercises', 'routines', 'workouts'])
    expect(GROUP_ORDER.food.slice(0, 2)).toEqual(['foods', 'days'])
    expect(searchLocal('push', data(), 'progress').order[0]).toBe('pages')
  })

  it('finds settings with a typo, and shows their current value', () => {
    const { groups } = searchLocal('thme', data())
    const theme = groups.settings.find(r => r.title === 'Theme')
    expect(theme).toMatchObject({ subtitle: 'Profile › Appearance', value: 'Dark' })
  })

  it('lists a page whose feature is off with its switch, and hides one that cannot be had', () => {
    const { groups } = searchLocal('fasting', data())
    expect(groups.pages.find(r => r.path === '/food/fasting')).toMatchObject({ off: { page: 'features', find: 'Fasting' } })
    expect(searchLocal('fasting', data({ pagesCtx: { nutrition: false } })).groups.pages).toEqual([])
    expect(searchLocal('coach', data()).groups.pages.find(r => r.path === '/train/coach')).toBeUndefined()
  })

  it('names the workouts an exercise was in, with the exercise in bold', () => {
    const { groups } = searchLocal('barbell bench', data())
    const hit = groups.workouts.find(r => r.id === 'w2')
    expect(hit.subtitle).toBe('Includes Barbell bench press')
    expect(hit.subRanges.length).toBeGreaterThan(0)
  })

  it('reads date words: workouts and days of that date', () => {
    const { groups } = searchLocal('tuesday', data())
    expect(groups.workouts.map(r => r.id)).toEqual(['w1'])
    expect(searchLocal('chicken sunday', data()).groups.days).toMatchObject([{ date: '2026-10-11', title: 'Chicken bowl', uuid: 'u1', value: 1840 }])
  })

  it('finds a day by what was eaten, with the meal and how many more matched', () => {
    const { groups } = searchLocal('chicken', data())
    expect(groups.days[0]).toMatchObject({ type: 'day', subtitle: expect.stringContaining('Lunch'), uuid: 'u1' })
    expect(groups.days[0].subtitle).toContain('+1 more')
    expect(groups.foods.map(r => r.type)).toEqual(expect.arrayContaining(['food', 'meal']))
  })

  it('finds a day the index holds only part of by what it holds, and says it is partial', () => {
    const days = [{ ...data().days[0], truncated: true }]
    const [hit] = searchLocal('chicken', data({ days })).groups.days
    expect(hit).toMatchObject({ uuid: 'u1', partial: true, subtitle: expect.stringContaining('partly indexed') })
    expect(listAll('days', data({ days }))[0].subtitle).toBe('2 items · partly indexed')
    expect(searchLocal('chicken', data()).groups.days[0].partial).toBe(false)
  })

  it('every setting row has its own key and glyph', () => {
    const { groups } = searchLocal('rest', data())
    const keys = groups.settings.map(r => r.key)
    expect(keys.every(k => typeof k === 'string' && k.startsWith('setting:'))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(groups.settings.every(r => r.media?.kind === 'glyph' && r.media.glyph)).toBe(true)
  })

  it('leaves nutrition out when it is off', () => {
    const { groups } = searchLocal('chicken', data({ nutrition: false }))
    expect(groups.foods).toEqual([])
    expect(groups.days).toEqual([])
  })

  it('takes the one clear winner out of its group as Best match, and none on a tie', () => {
    const local = searchLocal('history', data())
    expect(local.best).toMatchObject({ group: 'pages', result: { path: '/train/history' } })
    expect(local.groups.pages.some(r => r.path === '/train/history')).toBe(false)
    expect(bestMatch({ pages: [{ exact: true }, { exact: true }] }, ['pages'])).toBeNull()
  })

  it('summarises the groups, the largest count marked', () => {
    const s = summaryOf({ pages: [1], exercises: [1, 2, 3] }, ['pages', 'exercises', 'online'])
    expect(s).toEqual([{ group: 'pages', count: 1, emphasized: false }, { group: 'exercises', count: 3, emphasized: true }])
  })

  it('lists a whole group when scoped with nothing typed', () => {
    expect(listAll('exercises', data()).length).toBe(CATALOGUE.length)
    expect(listAll('workouts', data()).map(r => r.id)).toEqual(['w1', 'w2'])
  })
})

describe('before typing', () => {
  it('has four shortcuts per tab, training ones in place of nutrition when it is off', () => {
    for (const tab of ['home', 'train', 'food', 'progress']) expect(shortcutsFor(tab, true)).toHaveLength(4)
    expect(shortcutsFor('home', true).map(c => c.id)).toEqual(['history', 'exercises', 'foods', 'body'])
    expect(shortcutsFor('home', false).map(c => c.id)).toEqual(['history', 'exercises', 'routines', 'body'])
    expect(shortcutsFor('food', false).map(c => c.id)).toEqual(shortcutsFor('train', true).map(c => c.id))
  })

  it('suggests at most three rows for right now, each with its reason', () => {
    const rows = suggestionsFor('train', data(), new Date(today + 'T12:00:00'))
    expect(rows.length).toBeLessThanOrEqual(3)
    expect(rows.find(r => r.type === 'workout')).toMatchObject({ id: 'w1', reason: 'Last workout' })
    expect(rows.find(r => r.type === 'exercise')).toMatchObject({ id: bench.id, reason: 'Most trained this month' })
  })
})

describe('the pages registry', () => {
  it('has every path routed in App.jsx', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    for (const p of PAGE_INDEX) expect(src, p.path).toContain(`path="${p.path}"`)
  })
})
