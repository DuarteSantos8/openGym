// @vitest-environment happy-dom
// The Nutrition hub against the foundation's fake: today's card, yesterday's meal to log again,
// and the tile that opens Foods.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync } from '../lib/nutrition/sync.js'
import { isoOf, todayISO } from '../lib/format.js'
import { createFakeNutriTrace, fixtureDay } from '../lib/nutrition/fake-nutritrace.js'
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
const tile = title => [...host.querySelectorAll('.hub-tile')].find(x => x.querySelector('.l').textContent === title)

async function openHub() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(
    <MemoryRouter initialEntries={['/food']}>
      <Routes>
        <Route path="/food" element={<FoodHub />} />
        <Route path="/food/foods" element={<div>FOODS PAGE</div>} />
        <Route path="/food/meals" element={<div>MEALS PAGE</div>} />
        <Route path="/food/recipes" element={<div>RECIPES PAGE</div>} />
        <Route path="/food/goals" element={<div>GOALS PAGE</div>} />
        <Route path="/home" element={<div>HOME PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  ))
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

describe('today\'s card', () => {
  it('shows what is left of the target and the macros against theirs', async () => {
    await openHub()
    await settle(() => expect(host.textContent).toContain('kcal left today'))
    // 2,200 target, 228 + 450 logged.
    expect(host.querySelector('.big').textContent).toBe('1,522')
    expect(host.textContent).toContain('8 of 160 g')
    expect(host.textContent).toContain('36 of 165 g')
    expect(host.textContent).toContain('4 of 70 g')
  })

  it('says over when the day is past the target, and opens the diary on a tap', async () => {
    nt.state.days[TODAY].items.push({ uuid: 'big', meal: 2, addedAt: `${TODAY}T19:00:00.000Z`, type: 'quick_calories', name: 'Quick Calories', nutrition: { calories: 2000 }, food_server_id: null })
    await openHub()
    await settle(() => expect(host.textContent).toContain('kcal over today'))
    expect(host.querySelector('.big').textContent).toBe('478')
    tap(host.querySelector('.card'))
    expect(host.textContent).toBe('HOME PAGE')
  })

  it('opens Home on today, whichever date Home was left on', async () => {
    useDiarySelection.getState().setDate(YESTERDAY)
    await openHub()
    await settle(() => expect(host.textContent).toContain('kcal left today'))
    tap(host.querySelector('.card'))
    expect(host.textContent).toBe('HOME PAGE')
    expect(useDiarySelection.getState().day()).toBe(TODAY)
  })

  it('says the diary did not load, without the error text, and tries again', async () => {
    nt.failNext('GET', `/nt/api/diary/${TODAY}`, { status: 500, error: 'database is locked' })
    await openHub()
    await settle(() => expect(host.querySelector('[role=alert]')?.textContent).toBe('Today’s diary did not load.'))
    expect(host.textContent).not.toContain('database is locked')
    expect(host.querySelector('.card').getAttribute('role')).toBeNull()
    tap(buttonSaying('Try again'))
    await settle(() => expect(host.textContent).toContain('kcal left today'))
  })
})

describe('yesterday\'s meal', () => {
  it('logs it again to today at the same meal, and Undo takes it back', async () => {
    useDiarySelection.getState().setMeal(0)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    expect(host.textContent).toContain('Yesterday’s Breakfast')
    expect(host.textContent).toContain('Rolled oats')
    tap(buttonSaying('Log again'))
    await settle(() => expect(host.textContent).toContain('Logged'))
    const added = nt.state.days[TODAY].items.filter(i => i.name === 'Rolled oats')
    expect(added).toHaveLength(2)
    const fresh = added.find(i => i.uuid !== 'it-oats')
    expect(fresh).toMatchObject({ meal: 0, food_server_id: 11, portion: 60, unit: 'g', quantity: 1 })
    expect(toastText()).toBe('Logged to Breakfast')
    await act(async () => { useUI.getState().runToastAction() })
    await settle(() => expect(nt.state.days[TODAY].items.some(i => i.uuid === fresh.uuid)).toBe(false))
  })

  it('does not log twice when the answer is lost and it is tapped again', async () => {
    useDiarySelection.getState().setMeal(0)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    nt.failNext('PUT', `/nt/api/diary/${TODAY}`, { lost: true })
    tap(buttonSaying('Log again'))
    await settle(() => expect(toastText()).toContain('Not saved: no connection.'))
    tap(buttonSaying('Log again'))
    await settle(() => expect(host.textContent).toContain('Logged'))
    expect(nt.state.days[TODAY].items.filter(i => i.name === 'Rolled oats')).toHaveLength(2)
  })

  it('logs the whole meal in one write, and the same copy sent again adds nothing', async () => {
    nt.state.days[YESTERDAY].items.push({ uuid: 'it-coffee', meal: 0, addedAt: `${YESTERDAY}T08:05:00.000Z`, type: 'quick_calories', name: 'Coffee', nutrition: { calories: 40 }, food_server_id: null })
    useDiarySelection.getState().setMeal(0)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    const before = nt.state.days[TODAY].items.length
    tap(buttonSaying('Log again'))
    await settle(() => expect(host.textContent).toContain('Logged'))
    expect(nt.writes().filter(w => w.path === `/nt/api/diary/${TODAY}`)).toHaveLength(1)
    expect(nt.state.days[TODAY].items.length).toBe(before + 2)

    // A fresh mount (another tab, the app reopened) reads Logged off the diary, and the same
    // copy sent again is the same two entries.
    const sent = nt.writes().find(w => w.path === `/nt/api/diary/${TODAY}`).body.items.slice(-2)
    mounted.forEach(r => act(() => r.unmount()))
    document.body.innerHTML = ''
    useNutrition.getState().reset()
    await openHub()
    await settle(() => expect(host.textContent).toContain('Logged'))
    expect(buttonSaying('Log again')).toBeUndefined()
    await act(() => useNutrition.getState().logItems(TODAY, sent))
    expect(nt.state.days[TODAY].items.length).toBe(before + 2)
  })

  it('logs it again after an Undo (the undone entries stay tombstoned)', async () => {
    useDiarySelection.getState().setMeal(0)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    tap(buttonSaying('Log again'))
    await settle(() => expect(host.textContent).toContain('Logged'))
    const first = nt.state.days[TODAY].items.at(-1).uuid
    await act(async () => { useUI.getState().runToastAction() })
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    tap(buttonSaying('Log again'))
    await settle(() => expect(host.textContent).toContain('Logged'))
    const again = nt.state.days[TODAY].items.filter(i => i.name === 'Rolled oats' && i.uuid !== 'it-oats')
    expect(again).toHaveLength(1)
    expect(again[0].uuid).not.toBe(first)
  })

  it('logs a quick entry again as a quick entry', async () => {
    useDiarySelection.getState().setMeal(1)
    await openHub()
    await settle(() => expect(buttonSaying('Log again')?.disabled).toBe(false))
    tap(buttonSaying('Log again'))
    await settle(() => expect(host.textContent).toContain('Logged'))
    const quick = nt.state.days[TODAY].items.filter(i => i.type === 'quick_calories')
    expect(quick).toHaveLength(2)
    expect(quick.find(i => i.uuid !== 'it-quick')).toMatchObject({ meal: 1, nutrition: { calories: 450 } })
  })

  it('offers nothing for a meal with nothing in it, or one that cannot be rebuilt', async () => {
    useDiarySelection.getState().setMeal(2)
    await openHub()
    await settle(() => expect(host.textContent).toContain('kcal left today'))
    expect(buttonSaying('Log again')).toBeUndefined()

    nt.state.days[YESTERDAY].items[0] = { ...nt.state.days[YESTERDAY].items[0], is_recipe: true }
    useNutrition.getState().reset()
    useDiarySelection.getState().setMeal(0)
    mounted.forEach(r => act(() => r.unmount()))
    document.body.innerHTML = ''
    await openHub()
    await settle(() => expect(host.textContent).toContain('kcal left today'))
    expect(buttonSaying('Log again')).toBeUndefined()
  })
})

describe('the places', () => {
  it('has a Foods tile with the count, and opens Foods', async () => {
    await openHub()
    await settle(() => expect(tile('Foods').querySelector('.v').textContent).toBe('3 foods'))
    tap(tile('Foods'))
    expect(host.textContent).toBe('FOODS PAGE')
  })

  it('has a Goals tile with the daily target, and opens Goals', async () => {
    await openHub()
    expect([...host.querySelectorAll('.hub-tile .l')].map(l => l.textContent)).toEqual(['Foods', 'Saved meals', 'Recipes', 'Goals'])
    await settle(() => expect(tile('Goals').querySelector('.v').textContent).toBe('2,200 kcal'))
    tap(tile('Goals'))
    expect(host.textContent).toBe('GOALS PAGE')
  })

  it('has Saved meals and Recipes tiles with their counts, and opens each', async () => {
    await openHub()
    await settle(() => {
      expect(tile('Saved meals').querySelector('.v').textContent).toBe('1 meal')
      expect(tile('Recipes').querySelector('.v').textContent).toBe('1 recipe')
    })
    tap(tile('Saved meals'))
    expect(host.textContent).toBe('MEALS PAGE')
  })

  it('opens Recipes from its tile', async () => {
    await openHub()
    tap(tile('Recipes'))
    expect(host.textContent).toBe('RECIPES PAGE')
  })

  it('says nutrition is in the web app for someone with no session, and asks for nothing', async () => {
    useStore.setState({ user: null })
    await openHub()
    expect(host.textContent).toContain('Nutrition lives in the web app')
    expect(host.querySelector('.hub-tile')).toBeNull()
    expect(nt.requests).toHaveLength(0)
  })
})
