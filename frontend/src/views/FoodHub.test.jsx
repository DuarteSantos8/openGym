// @vitest-environment happy-dom
// The Nutrition root against the foundation's fake, routed: the hero and the macros for the
// shared date, over target, an empty day, a past day, the /food?date= deep link, yesterday's meal
// inside the empty meal it matches, the Library rows that open the places, the header's "left"
// readout, and the empty state without nutrition.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync } from '../lib/nutrition/sync.js'
import { isoOf, todayISO } from '../lib/format.js'
import { createFakeNutriTrace, fixtureDay, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import FoodHub from './FoodHub.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
const YESTERDAY = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) })()
let nt
let host
const mounted = []

// Polls the check between short act() sleeps, so the renders the awaited work queued are flushed.
const settle = async check => {
  const end = Date.now() + 3000
  for (;;) {
    try { check(); return } catch (e) {
      if (Date.now() > end) throw e
      await act(async () => { await new Promise(r => setTimeout(r, 25)) })
    }
  }
}
const tap = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const buttonSaying = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const toastText = () => useUI.getState().toastMsg
const libraryRow = title => [...host.querySelectorAll('.lrow')].find(x => x.querySelector('.lrow-t')?.textContent === title)
const heading = title => [...host.querySelectorAll('.sec-h-t')].find(h => h.textContent === title)
const heroValue = () => host.querySelector('.hero .hero-num')?.textContent
const heroUnit = () => host.querySelector('.hero .hero-u')?.textContent
const heroCaption = () => host.querySelector('.hero .hero-c')
const gauge = name => host.querySelector(`.mg[aria-label="${name}"]`)
const mealRow = name => [...host.querySelectorAll('.meal-row')].find(r => r.querySelector('.meal-name').textContent === name)

// A dinner yesterday that can be logged again (a food, rebuilt from its server id).
const yesterdayDinner = () => ({ ...fixtureDay(YESTERDAY).items[0], uuid: 'y-dinner', meal: 2, name: 'Lentil soup', addedAt: `${YESTERDAY}T19:00:00.000Z` })

async function openHub(path = '/food') {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/food" element={<FoodHub />} />
        <Route path="/food/foods" element={<div>FOODS PAGE</div>} />
        <Route path="/food/meals" element={<div>MEALS PAGE</div>} />
        <Route path="/food/recipes" element={<div>RECIPES PAGE</div>} />
        <Route path="/food/goals" element={<div>GOALS PAGE</div>} />
        <Route path="/food/fasting" element={<div>FASTING PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  ))
}
const remount = async () => {
  mounted.forEach(r => act(() => r.unmount()))
  mounted.length = 0
  document.body.innerHTML = ''
  await openHub()
}

beforeEach(() => {
  nt = createFakeNutriTrace({ days: { [TODAY]: fixtureDay(TODAY), [YESTERDAY]: fixtureDay(YESTERDAY) } })
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState({ user: { id: 3, name: 'Ana' }, pushState: vi.fn(async () => {}) })
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
})
afterEach(() => {
  mounted.forEach(r => { try { act(() => r.unmount()) } catch { /* already unmounted */ } })
  mounted.length = 0
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the hero and the macros', () => {
  it('says what is left as the hero, eaten · goal under it, and each macro against its target', async () => {
    await openHub()
    // 2,200 target, 228 + 450 logged.
    await settle(() => expect(heroValue()).toBe('1,522'))
    expect(heroUnit()).toBe('kcal left')
    expect(heroCaption().textContent).toBe('678 kcal eaten · 2,200 kcal goal')
    expect(heroCaption().classList.contains('ink-orange')).toBe(false)
    expect(gauge('Protein').getAttribute('aria-valuetext')).toBe('8 g of 160 g')
    expect(gauge('Carbs').getAttribute('aria-valuetext')).toBe('36 g of 165 g')
    expect(gauge('Fat').getAttribute('aria-valuetext')).toBe('4 g of 70 g')
    expect([...host.querySelectorAll('.mg')].map(m => m.getAttribute('role'))).toEqual(['meter', 'meter', 'meter'])
    expect(heading('Today’s diary')).toBeTruthy()
  })

  it('over the target the hero says how far over, in orange ink, not red', async () => {
    nt.state.days[TODAY].items.push({ uuid: 'big', meal: 2, addedAt: `${TODAY}T19:00:00.000Z`, type: 'quick_calories', name: 'Quick Calories', nutrition: { calories: 2000 }, food_server_id: null })
    await openHub()
    await settle(() => expect(heroValue()).toBe('478'))
    expect(heroUnit()).toBe('kcal over')
    expect(heroCaption().textContent).toBe('2,678 kcal eaten · 2,200 kcal goal')
    expect(heroCaption().classList.contains('ink-orange')).toBe(true)
    expect(host.querySelector('.hero .ink-red, .hero .ink-danger')).toBeNull()
  })

  it('a macro over its target fills its gauge and says by how much, in orange ink', async () => {
    nt.state.days[TODAY].items.push({ ...fixtureDay(TODAY).items[0], uuid: 'more-oats', quantity: 5, addedAt: `${TODAY}T10:00:00.000Z` })
    await openHub()
    // 36 g of carbs, then five more portions: 216 g against 165 g.
    await settle(() => expect(gauge('Carbs').getAttribute('aria-valuetext')).toBe('216 g of 165 g, over by 51 g'))
    const over = gauge('Carbs').querySelector('.mg-of')
    expect(over.textContent).toBe('+51 g')
    expect(over.classList.contains('ink-orange')).toBe(true)
    expect(gauge('Carbs').querySelector('.mg-arc').style.getPropertyValue('--mg')).toBe('1')
    expect(gauge('Protein').querySelector('.mg-of').classList.contains('ink-orange')).toBe(false)
  })

  it('an empty day is the whole target left, nothing eaten, the gauges at 0 g and every meal empty', async () => {
    nt.state.days[TODAY].items = []
    await openHub()
    await settle(() => expect(heroValue()).toBe('2,200'))
    expect(heroCaption().textContent).toBe('0 kcal eaten · 2,200 kcal goal')
    expect(gauge('Protein').getAttribute('aria-valuetext')).toBe('0 g of 160 g')
    // The start cap still keys each gauge at 0 g.
    expect(host.querySelectorAll('.mg-cap')).toHaveLength(3)
    expect([...host.querySelectorAll('.meal-sub')].map(s => s.textContent)).toEqual(['Nothing yet', 'Nothing yet', 'Nothing yet', 'Nothing yet'])
  })

  it('puts the action row straight after the hero, then the macros', async () => {
    await openHub()
    await settle(() => expect(heroValue()).toBe('1,522'))
    const sections = [...host.querySelectorAll('.tab-sec')]
    expect(sections[0].querySelector('.hero')).not.toBeNull()
    expect(sections[1].querySelector('.act-row')).not.toBeNull()
    expect(sections[2].querySelector('.mg')).not.toBeNull()
  })

  it('names the day while a past day loads, not "today"', async () => {
    useDiarySelection.getState().setDate(YESTERDAY)
    await openHub()
    const text = host.querySelector('.hero[role="status"] .sr-only')?.textContent
    expect(text).toMatch(/^Loading /)
    expect(text).not.toBe('Loading today')
  })

  it('groups the water row\'s buttons under its title and total', async () => {
    await openHub()
    await settle(() => expect(heroValue()).toBe('1,522'))
    const group = host.querySelector('.water-adds')
    expect(group.getAttribute('role')).toBe('group')
    const name = group.getAttribute('aria-labelledby').split(' ').map(id => host.querySelector(`[id="${id}"]`).textContent).join(' ')
    expect(name).toMatch(/^Water \d[\d,.]* ml \/ [\d,.]+ ml$/)
    // The action row's button shares the quick-add's name: the group is what tells them apart.
    expect(host.querySelectorAll('button[aria-label^="Add "]').length).toBeGreaterThanOrEqual(2)
  })

  it('"Set targets" opens Goals', async () => {
    await openHub()
    await settle(() => expect(heroValue()).toBe('1,522'))
    tap(buttonSaying('Set targets'))
    expect(host.textContent).toBe('GOALS PAGE')
  })

  it('shows the day every tab shares: a past day picked on Home is the diary here, without yesterday\'s meal', async () => {
    nt.state.days[YESTERDAY].items = [fixtureDay(YESTERDAY).items[0]]
    useDiarySelection.getState().setDate(YESTERDAY)
    await openHub()
    await settle(() => expect(heroValue()).toBe('1,972'))
    expect(heroCaption().textContent).toBe('228 kcal eaten · 2,200 kcal goal')
    expect(heading('Diary')).toBeTruthy()
    expect(heading('Today’s diary')).toBeUndefined()
    // Yesterday's meal is offered on today only.
    expect(buttonSaying('Log again')).toBeUndefined()
    tap(buttonSaying('Today'))
    await settle(() => expect(heading('Today’s diary')).toBeTruthy())
    expect(useDiarySelection.getState().day()).toBe(TODAY)
    await settle(() => expect(heroValue()).toBe('1,522'))
  })

  it('says the diary did not load, without the error text, and tries again', async () => {
    nt.failNext('GET', `/nt/api/diary/${TODAY}`, { status: 500, error: 'database is locked' })
    await openHub()
    await settle(() => expect(host.querySelector('[role=alert]')?.textContent).toBe('The diary did not load.'))
    expect(host.textContent).not.toContain('database is locked')
    // No macros against a day that is not there.
    expect(host.querySelector('.mg')).toBeNull()
    tap(buttonSaying('Try again'))
    await settle(() => expect(heroValue()).toBe('1,522'))
  })
})

describe('the header\'s "left" readout', () => {
  let observers
  beforeEach(() => {
    observers = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { this.cb = cb; observers.push(this) }
      observe(el) { this.el = el }
      disconnect() {}
    })
  })
  const scrollHero = gone => act(() => {
    for (const o of observers.filter(x => x.el?.classList.contains('hero'))) {
      o.cb([{ isIntersecting: !gone, boundingClientRect: { top: gone ? -200 : 120 } }])
    }
  })
  const pill = () => host.querySelector('.hdr-slot .hdr-left')

  it('takes the header\'s context slot once the hero has scrolled away, and goes when it is back', async () => {
    await openHub()
    await settle(() => expect(heroValue()).toBe('1,522'))
    expect(pill()).toBeNull()
    scrollHero(true)
    await settle(() => expect(pill()).not.toBeNull())
    expect(pill().textContent).toBe('1,522 left')
    expect(pill().getAttribute('aria-label')).toBe('1,522 kcal left')
    scrollHero(false)
    await settle(() => expect(pill()).toBeNull())
  })

  it('scrolls back to the top when tapped', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    await openHub()
    await settle(() => expect(heroValue()).toBe('1,522'))
    scrollHero(true)
    await settle(() => expect(pill()).not.toBeNull())
    tap(pill())
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('says over, in orange ink, past the target', async () => {
    nt.state.days[TODAY].items.push({ uuid: 'big', meal: 2, addedAt: `${TODAY}T19:00:00.000Z`, type: 'quick_calories', name: 'Quick Calories', nutrition: { calories: 2000 }, food_server_id: null })
    await openHub()
    await settle(() => expect(heroValue()).toBe('478'))
    scrollHero(true)
    await settle(() => expect(pill()).not.toBeNull())
    expect(pill().textContent).toBe('478 over')
    expect(pill().classList.contains('over')).toBe(true)
  })
})

describe('/food?date=', () => {
  const openAt = path => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/food" element={<><FoodHub /><Where /></>} /></Routes>
      </MemoryRouter>,
    ))
  }
  // The address the page is left on, to see the link replaced.
  function Where() { return <output data-where="">{useLocation().search}</output> }
  const where = () => host.querySelector('[data-where]').textContent

  it('opens the diary on that day and leaves the address as the tab\'s own', async () => {
    openAt(`/food?date=${YESTERDAY}`)
    await settle(() => expect(useDiarySelection.getState().day()).toBe(YESTERDAY))
    await settle(() => expect(nt.requests.some(r => r.path === `/nt/api/diary/${YESTERDAY}`)).toBe(true))
    expect(where()).toBe('')
  })

  it('a day to come is today, and a date that is not one changes nothing', async () => {
    useDiarySelection.getState().setDate(YESTERDAY)
    openAt('/food?date=2026-02-31')
    await settle(() => expect(where()).toBe(''))
    expect(useDiarySelection.getState().day()).toBe(YESTERDAY)
    mounted.forEach(r => act(() => r.unmount()))
    mounted.length = 0
    document.body.innerHTML = ''
    openAt('/food?date=2999-01-01')
    await settle(() => expect(where()).toBe(''))
    expect(useDiarySelection.getState().day()).toBe(TODAY)
  })
})

describe('yesterday\'s meal, inside the empty meal it matches', () => {
  beforeEach(() => { nt.state.days[YESTERDAY].items.push(yesterdayDinner()) })

  it('sits in today\'s empty Dinner, logs it again there, and Undo takes it back', async () => {
    useDiarySelection.getState().setMeal(2)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    const again = mealRow('Dinner').querySelector('.meal-again')
    expect(again.textContent).toContain('Yesterday’s Dinner')
    expect(again.textContent).toContain('Lentil soup · 228 kcal')
    expect(buttonSaying('Log again').getAttribute('aria-label')).toBe('Log yesterday’s Dinner again')
    tap(buttonSaying('Log again'))
    await settle(() => expect(toastText()).toBe('Logged to Dinner'))
    const fresh = nt.state.days[TODAY].items.find(i => i.name === 'Lentil soup')
    expect(fresh).toMatchObject({ meal: 2, food_server_id: 11, portion: 60, unit: 'g', quantity: 1 })
    // Dinner has something now: the offer goes, the toast's Undo stays, and focus lands on Dinner
    // rather than falling back to the body.
    await settle(() => expect(host.querySelector('.meal-again')).toBeNull())
    await settle(() => expect(document.activeElement).toBe(mealRow('Dinner').querySelector('.meal-toggle')))
    await act(async () => { useUI.getState().runToastAction() })
    await settle(() => expect(nt.state.days[TODAY].items.some(i => i.uuid === fresh.uuid)).toBe(false))
    await settle(() => expect(mealRow('Dinner').querySelector('.meal-again')).not.toBeNull())
  })

  it('does not log twice when the answer is lost and it is tapped again', async () => {
    useDiarySelection.getState().setMeal(2)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    nt.failNext('PUT', `/nt/api/diary/${TODAY}`, { lost: true })
    tap(buttonSaying('Log again'))
    await settle(() => expect(toastText()).toContain('Not saved: no connection.'))
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    tap(buttonSaying('Log again'))
    await settle(() => expect(toastText()).toBe('Logged to Dinner'))
    expect(nt.state.days[TODAY].items.filter(i => i.name === 'Lentil soup')).toHaveLength(1)
  })

  it('logs the whole meal in one write, and the same copy sent again adds nothing', async () => {
    nt.state.days[YESTERDAY].items.push({ uuid: 'y-tea', meal: 2, addedAt: `${YESTERDAY}T19:05:00.000Z`, type: 'quick_calories', name: 'Tea', nutrition: { calories: 40 }, food_server_id: null })
    useDiarySelection.getState().setMeal(2)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    const before = nt.state.days[TODAY].items.length
    tap(buttonSaying('Log again'))
    await settle(() => expect(toastText()).toBe('Logged to Dinner'))
    expect(nt.writes().filter(w => w.path === `/nt/api/diary/${TODAY}`)).toHaveLength(1)
    expect(nt.state.days[TODAY].items.length).toBe(before + 2)

    // A fresh mount (another tab, the app reopened) reads the meal off the diary and offers
    // nothing, and the same copy sent again is the same two entries.
    const sent = nt.writes().find(w => w.path === `/nt/api/diary/${TODAY}`).body.items.slice(-2)
    useNutrition.getState().reset()
    await remount()
    await settle(() => expect(mealRow('Dinner').querySelector('.meal-sub').textContent).toBe('2 items'))
    expect(buttonSaying('Log again')).toBeUndefined()
    await act(() => useNutrition.getState().logItems(TODAY, sent))
    expect(nt.state.days[TODAY].items.length).toBe(before + 2)
  })

  it('logs it again after an Undo (the undone entries stay tombstoned)', async () => {
    useDiarySelection.getState().setMeal(2)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    tap(buttonSaying('Log again'))
    await settle(() => expect(toastText()).toBe('Logged to Dinner'))
    const first = nt.state.days[TODAY].items.at(-1).uuid
    await act(async () => { useUI.getState().runToastAction() })
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    tap(buttonSaying('Log again'))
    await settle(() => expect(nt.state.days[TODAY].items.filter(i => i.name === 'Lentil soup')).toHaveLength(1))
    expect(nt.state.days[TODAY].items.find(i => i.name === 'Lentil soup').uuid).not.toBe(first)
  })

  it('logs a quick entry again as a quick entry', async () => {
    nt.state.days[YESTERDAY].items.push({ uuid: 'y-snack', meal: 3, addedAt: `${YESTERDAY}T16:00:00.000Z`, type: 'quick_calories', name: 'Quick Calories', nutrition: { calories: 300 }, food_server_id: null })
    useDiarySelection.getState().setMeal(3)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    expect(mealRow('Snacks').querySelector('.meal-again')).not.toBeNull()
    tap(buttonSaying('Log again'))
    await settle(() => expect(toastText()).toBe('Logged to Snacks'))
    const quick = nt.state.days[TODAY].items.filter(i => i.type === 'quick_calories' && i.meal === 3)
    expect(quick).toHaveLength(1)
    expect(quick[0]).toMatchObject({ meal: 3, nutrition: { calories: 300 } })
  })

  it('offers nothing in a meal that already has something today, or for one that cannot be rebuilt', async () => {
    // Breakfast: yesterday's oats, but today already has some.
    useDiarySelection.getState().setMeal(0)
    await openHub()
    await settle(() => expect(heroValue()).toBe('1,522'))
    expect(buttonSaying('Log again')).toBeUndefined()

    nt.state.days[YESTERDAY].items = nt.state.days[YESTERDAY].items.map(i => (i.uuid === 'y-dinner' ? { ...i, is_recipe: true } : i))
    useNutrition.getState().reset()
    useDiarySelection.getState().setMeal(2)
    await remount()
    await settle(() => expect(heroValue()).toBe('1,522'))
    expect(buttonSaying('Log again')).toBeUndefined()
  })
})

describe('the Library', () => {
  it('lists Foods, Saved meals, Recipes, Goals and Fasting, each with a glyph and a chevron', async () => {
    await openHub()
    expect(heading('Library')).toBeTruthy()
    const titles = ['Foods', 'Saved meals', 'Recipes', 'Goals', 'Fasting']
    expect(titles.map(x => !!libraryRow(x))).toEqual([true, true, true, true, true])
    for (const x of titles) {
      expect(libraryRow(x).querySelector('.lrow-g svg'), x).not.toBeNull()
      expect(libraryRow(x).querySelector('.lrow-c'), x).not.toBeNull()
    }
  })

  it('has Foods with the count, and opens Foods', async () => {
    await openHub()
    await settle(() => expect(libraryRow('Foods').querySelector('.lrow-s').textContent).toBe('3 foods'))
    tap(libraryRow('Foods'))
    expect(host.textContent).toBe('FOODS PAGE')
  })

  it('has Goals with the daily target, and opens Goals', async () => {
    await openHub()
    await settle(() => expect(libraryRow('Goals').querySelector('.lrow-s').textContent).toBe('2,200 kcal'))
    tap(libraryRow('Goals'))
    expect(host.textContent).toBe('GOALS PAGE')
  })

  it('always has Fasting, "Off" while fasting is off, so the page where it is switched on is reachable', async () => {
    await openHub()
    await settle(() => expect(libraryRow('Fasting').querySelector('.lrow-s').textContent).toBe('Off'))
    tap(libraryRow('Fasting'))
    expect(host.textContent).toBe('FASTING PAGE')
    expect(nt.requests.some(r => r.path.startsWith('/nt/api/fasts'))).toBe(false)
  })

  it('Fasting reads "Start a fast" while fasting is on, and opens the Fasting page', async () => {
    nt = createFakeNutriTrace({ days: { [TODAY]: fixtureDay(TODAY) }, settings: { ...fixtureSettings(), fastingEnabled: true } })
    vi.stubGlobal('fetch', nt.fetch)
    await openHub()
    await settle(() => expect(libraryRow('Fasting').querySelector('.lrow-s').textContent).toBe('Start a fast'))
    tap(libraryRow('Fasting'))
    expect(host.textContent).toBe('FASTING PAGE')
  })

  it('has Saved meals and Recipes with their counts, and opens each: Recipes has its way in here', async () => {
    await openHub()
    await settle(() => {
      expect(libraryRow('Saved meals').querySelector('.lrow-s').textContent).toBe('1 meal')
      expect(libraryRow('Recipes').querySelector('.lrow-s').textContent).toBe('1 recipe')
    })
    tap(libraryRow('Recipes'))
    expect(host.textContent).toBe('RECIPES PAGE')
    await remount()
    tap(libraryRow('Saved meals'))
    expect(host.textContent).toBe('MEALS PAGE')
  })
})

describe('without nutrition', () => {
  it('is the empty state with its line art and nothing else, and asks NutriTrace for nothing', async () => {
    useStore.setState({ user: null })
    await openHub()
    expect(host.textContent).toContain('Nutrition lives in the web app')
    expect(host.querySelector('.empty .lineart[data-scene="plate"]')).not.toBeNull()
    expect(host.querySelector('.wk-strip, .hero, .mg, .act-row, .meals-card, .lrow')).toBeNull()
    expect(nt.requests).toHaveLength(0)
  })
})
