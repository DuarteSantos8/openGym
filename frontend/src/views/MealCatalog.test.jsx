// @vitest-environment happy-dom
// Nutrition › Saved meals and Recipes against the foundation's fake of NutriTrace and the hub:
// what the pages list, what logging a meal or a recipe adds to the day (and that a retry adds it
// once), and what create, edit and delete send.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync } from '../lib/nutrition/sync.js'
import { nutritionOf } from '../lib/nutrition/diary.js'
import { mealDetailSheet } from '../components/MealDetailSheet.jsx'
import { createFakeNutriTrace, fixtureMeals, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import MealCatalog from './MealCatalog.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DAY = '2026-10-13'
let nt
let page
const mounted = []

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
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const buttonSaying = (host, text) => [...host.querySelectorAll('button')].find(b => (text instanceof RegExp ? text.test(b.textContent.trim()) : b.textContent.trim() === text))
const names = () => [...page.querySelectorAll('.item .tt')].map(el => el.textContent)
const rowOf = name => [...page.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
const fieldNear = (host, label) => [...host.querySelectorAll('label')].find(l => l.textContent.startsWith(label)).querySelector('input,textarea')
const toastText = () => useUI.getState().toastMsg
const dayItems = () => nt.state.days[DAY]?.items || []
const mealPosts = () => nt.writes().filter(r => r.path === '/nt/api/meals')

// Renders the sheet on top of the stack the way Modals does.
function topSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

async function openPage(recipes = false) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MealCatalog recipes={recipes} />))
  page = host
  await settle(() => {
    expect(names().length).toBeGreaterThan(0)
    expect(useNutrition.getState().settings.status).toBe('ready')
  })
}

// "Add ingredient" → pick a food → amount → Add, on the editor on screen.
async function addIngredient(editor, food, amount) {
  tap(buttonSaying(editor, 'Add ingredient'))
  const sheet = topSheet()
  await settle(() => expect(sheet.textContent).toContain(food))
  tap([...sheet.querySelectorAll('.item')].find(el => el.querySelector('.tt').textContent === food))
  if (amount != null) type(sheet.querySelector('input.num'), String(amount))
  tap(buttonSaying(sheet, 'Add'))
  return sheet
}

beforeEach(() => {
  nt = createFakeNutriTrace()
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState({ user: { id: 3, name: 'Ana' }, pushState: vi.fn(async () => {}) })
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  useDiarySelection.getState().setDate(DAY)
  useDiarySelection.getState().setMeal(2)
  useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(() => {
  mounted.forEach(r => { try { act(() => r.unmount()) } catch { /* already unmounted */ } })
  mounted.length = 0
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the lists', () => {
  it('Saved meals lists meals and Recipes lists recipes, each with its energy', async () => {
    await openPage(false)
    expect(names()).toEqual(['Oats and bread'])
    expect(rowOf('Oats and bread').textContent).toContain('2 ingredients')
    expect(rowOf('Oats and bread').textContent).toContain('354 kcal')
    expect(nt.requests.find(r => r.path === '/nt/api/meals').query).toEqual({})

    page = null
    await openPage(true)
    expect(names()).toEqual(['Lentil soup'])
    expect(rowOf('Lentil soup').textContent).toContain('4 servings')
    expect(rowOf('Lentil soup').textContent).toContain('210 kcal')
    expect(nt.requests.filter(r => r.path === '/nt/api/meals').at(-1).query).toEqual({ recipes: '1' })
  })

  it('searches by name, accents aside', async () => {
    await openPage(false)
    type(page.querySelector('.searchf input'), 'zzz')
    expect(page.textContent).toContain('No match')
    type(page.querySelector('.searchf input'), 'OATS')
    expect(names()).toEqual(['Oats and bread'])
  })

  it('says so when there are none, with a way to make one', async () => {
    nt = createFakeNutriTrace({ meals: [] })
    vi.stubGlobal('fetch', nt.fetch)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(<MealCatalog recipes />))
    await settle(() => expect(host.textContent).toContain('No recipes yet'))
    tap(buttonSaying(host, 'New recipe'))
    expect(topSheet().textContent).toContain('New recipe')
  })

  it('says what failed, never the error text, and loads on Try again', async () => {
    nt.failNext('GET', '/nt/api/meals', { status: 502, error: 'upstream exploded: ECONNRESET' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(<MealCatalog recipes={false} />))
    await settle(() => expect(host.querySelector('[role="alert"]')).not.toBeNull())
    expect(host.textContent).toContain('Could not load. Try again.')
    expect(host.textContent).not.toContain('ECONNRESET')
    tap(buttonSaying(host, 'Try again'))
    await settle(() => expect(host.querySelector('.item .tt').textContent).toBe('Oats and bread'))
  })

  it('has nothing for a guest, and asks NutriTrace nothing', () => {
    useStore.setState({ user: null })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(<MealCatalog recipes={false} />))
    expect(host.textContent).toContain('Saved meals live in the web app')
    expect(nt.requests).toEqual([])
  })
})

describe('logging a saved meal', () => {
  it('adds each ingredient at its saved amount to the selected date and meal, in one write', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    const sheet = topSheet()
    expect(sheet.textContent).toContain('Rolled oats')
    expect(sheet.textContent).toContain('60 g')
    expect(sheet.textContent).toContain('354 kcal')
    const log = buttonSaying(sheet, 'Log to Dinner')
    expect(log).toBeTruthy()
    tap(log)
    await settle(() => expect(dayItems()).toHaveLength(2))
    expect(dayItems().map(i => [i.name, i.meal, i.food_server_id])).toEqual([['Rolled oats', 2, 11], ['Wholemeal bread', 2, 12]])
    expect(dayItems().reduce((s, i) => s + nutritionOf(i).calories, 0)).toBeCloseTo(354)
    expect(nt.writes().filter(r => r.path === `/nt/api/diary/${DAY}`)).toHaveLength(1)
    await settle(() => expect(nt.writes().some(r => r.path === '/nt/api/meals/21/used' && r.body.date === DAY)).toBe(true))
    expect(nt.writes().filter(r => /\/api\/foods\/\d+\/used/.test(r.path)).map(r => r.path).sort()).toEqual(['/nt/api/foods/11/used', '/nt/api/foods/12/used'])
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(toastText()).toBe('Logged to Dinner')
  })

  it('logs once when the answer to the first try was lost', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    const sheet = topSheet()
    nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 504 })
    tap(buttonSaying(sheet, 'Log to Dinner'))
    await settle(() => expect(sheet.querySelector('[role="alert"]')).not.toBeNull())
    expect(sheet.querySelector('[role="alert"]').textContent).toBe('Not saved. Try again.')
    expect(dayItems()).toHaveLength(2)
    tap(buttonSaying(sheet, 'Log to Dinner'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    expect(dayItems()).toHaveLength(2)
  })

  it('logs nothing and keeps the sheet when it was refused', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    const sheet = topSheet()
    nt.failNext('PUT', '/nt/api/diary/', 'offline')
    tap(buttonSaying(sheet, 'Log to Dinner'))
    await settle(() => expect(sheet.textContent).toContain('no connection'))
    expect(dayItems()).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('keeps the date and meal it opened with when the diary moves on', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    const sheet = topSheet()
    act(() => { useDiarySelection.getState().setDate('2026-10-01'); useDiarySelection.getState().setMeal(0) })
    tap(buttonSaying(sheet, 'Log to Dinner'))
    await settle(() => expect(dayItems()).toHaveLength(2))
    expect(nt.state.days['2026-10-01']).toBeUndefined()
  })

  it('takes the logged meal back with Undo', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Log to Dinner'))
    await settle(() => expect(dayItems()).toHaveLength(2))
    act(() => useUI.getState().runToastAction())
    await settle(() => expect(dayItems()).toHaveLength(0))
  })
})

describe('logging a recipe', () => {
  it('adds one entry for the servings eaten, at the per-serving nutrition', async () => {
    await openPage(true)
    tap(rowOf('Lentil soup'))
    const sheet = topSheet()
    expect(sheet.textContent).toContain('Per serving')
    type(fieldNear(sheet, 'Servings eaten'), '1.5')
    expect(sheet.textContent).toContain('315 kcal in total')
    tap(buttonSaying(sheet, 'Log to Dinner'))
    await settle(() => expect(dayItems()).toHaveLength(1))
    expect(dayItems()[0]).toMatchObject({ id: 22, is_recipe: true, name: 'Lentil soup', meal: 2, quantity: 1.5, portion: 300, unit: 'g' })
    expect(nutritionOf(dayItems()[0]).calories).toBeCloseTo(315)
    await settle(() => expect(nt.writes().some(r => r.path === '/nt/api/meals/22/used')).toBe(true))
    expect(nt.writes().some(r => r.path.startsWith('/nt/api/foods/'))).toBe(false)
  })

  it('will not log servings of 0', async () => {
    await openPage(true)
    tap(rowOf('Lentil soup'))
    const sheet = topSheet()
    type(fieldNear(sheet, 'Servings eaten'), '0')
    expect(buttonSaying(sheet, 'Log to Dinner').disabled).toBe(true)
    expect(sheet.textContent).toContain('Enter servings above 0.')
  })
})

describe('making one', () => {
  it('saves a meal of your foods as private, without an image, with their total', async () => {
    await openPage(false)
    tap(buttonSaying(page, 'New'))
    const editor = topSheet()
    type(fieldNear(editor, 'Name'), 'Toast and oats')
    await addIngredient(editor, 'Rolled oats', 80)
    await settle(() => expect(editor.textContent).toContain('80 g'))
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(mealPosts()).toHaveLength(1))
    const body = mealPosts()[0].body
    expect(body).toMatchObject({ name: 'Toast and oats', is_recipe: false, visibility: 'private' })
    expect(body.client_key).toBeTruthy()
    expect(body).not.toHaveProperty('img_url')
    expect(body).not.toHaveProperty('imgUrl')
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 11, portion: 80, unit: 'g', quantity: 1 })
    expect(body.nutrition.calories).toBeCloseTo(304)
    await settle(() => expect(names()).toEqual(['Oats and bread', 'Toast and oats']))
    expect(toastText()).toBe('Meal saved')
  })

  it('saves once when the answer to the first try was lost', async () => {
    await openPage(false)
    tap(buttonSaying(page, 'New'))
    const editor = topSheet()
    type(fieldNear(editor, 'Name'), 'Toast and oats')
    await addIngredient(editor, 'Rolled oats', 80)
    await settle(() => expect(editor.textContent).toContain('80 g'))
    nt.failNext('POST', '/nt/api/meals', { lost: true, status: 504 })
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(editor.querySelector('[role="alert"]')).not.toBeNull())
    expect(editor.querySelector('[role="alert"]').textContent).toBe('Not saved. Try again.')
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    expect(nt.state.meals.filter(m => m.name === 'Toast and oats')).toHaveLength(1)
    expect(mealPosts()[0].body.client_key).toBe(mealPosts()[1].body.client_key)
  })

  it('saves a recipe per serving, with its weight taken from the ingredients', async () => {
    await openPage(true)
    tap(buttonSaying(page, 'New'))
    const editor = topSheet()
    type(fieldNear(editor, 'Name'), 'Porridge')
    await addIngredient(editor, 'Rolled oats', 200)
    await settle(() => expect(fieldNear(editor, 'Total weight').value).toBe('200'))
    type(fieldNear(editor, 'Servings'), '4')
    expect(editor.textContent).toContain('Per serving')
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(mealPosts()).toHaveLength(1))
    expect(mealPosts()[0].body).toMatchObject({ name: 'Porridge', is_recipe: true, servings: 4, portion: 50, unit: 'g' })
    expect(mealPosts()[0].body.nutrition.calories).toBeCloseTo(190)
    await settle(() => expect(names()).toContain('Porridge'))
  })

  it('refuses a form without a name or ingredients and sends nothing', async () => {
    await openPage(false)
    tap(buttonSaying(page, 'New'))
    const editor = topSheet()
    tap(buttonSaying(editor, 'Save'))
    expect(editor.textContent).toContain('Give it a name.')
    type(fieldNear(editor, 'Name'), 'Empty')
    tap(buttonSaying(editor, 'Save'))
    expect(editor.textContent).toContain('Add at least one ingredient.')
    expect(mealPosts()).toEqual([])
  })
})

describe('changing one', () => {
  it('edits a meal: a new name and an ingredient dropped, saved without an image or visibility', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    const detail = topSheet()
    tap(buttonSaying(detail, 'Edit'))
    const editor = topSheet()
    expect(fieldNear(editor, 'Name').value).toBe('Oats and bread')
    type(fieldNear(editor, 'Name'), 'Oats')
    tap([...editor.querySelectorAll('.item')].find(el => el.querySelector('.tt').textContent === 'Wholemeal bread'))
    tap(buttonSaying(topSheet(), 'Remove Wholemeal bread'))
    await settle(() => expect(editor.textContent).not.toContain('Wholemeal bread'))
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(nt.writes().some(r => r.method === 'PUT' && r.path === '/nt/api/meals/21')).toBe(true))
    const put = nt.writes().find(r => r.method === 'PUT' && r.path === '/nt/api/meals/21')
    expect(put.body).toMatchObject({ name: 'Oats' })
    expect(put.body.items.map(i => i.name)).toEqual(['Rolled oats'])
    expect(put.body.nutrition.calories).toBeCloseTo(228)
    for (const k of ['img_url', 'imgUrl', 'visibility', 'id', 'client_key']) expect(put.body).not.toHaveProperty(k)
    await settle(() => expect(names()).toEqual(['Oats']))
    // The sheet that was open under the editor shows the change.
    expect(detail.textContent).toContain('1 ingredient')
  })

  // A meal made in NutriTrace's own UI: its ingredients carry fields the hub does not let through.
  const madeInNutriTrace = () => {
    const [made] = fixtureMeals()
    made.items = made.items.map(i => ({ ...i, img_url: '/uploads/x.jpg', imgUrl: '/uploads/x.jpg', category: 'grain', barcode: '123', alt_units: i.alt_units && i.alt_units.map(u => ({ ...u, note: 'x' })) }))
    nt = createFakeNutriTrace({ meals: [{ ...made, favorite: 1, client_key: 'k', owner: 'x' }] })
    vi.stubGlobal('fetch', nt.fetch)
  }

  it('a rename sends only the name: the ingredients and totals NutriTrace holds are left alone', async () => {
    madeInNutriTrace()
    const before = structuredClone(nt.state.meals[0].items)
    await openPage(false)
    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    type(fieldNear(editor, 'Name'), 'Oats')
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(nt.state.meals[0].name).toBe('Oats'))
    const put = nt.writes().find(r => r.method === 'PUT')
    expect(put.body).toEqual({ name: 'Oats' })
    expect(nt.state.meals[0].items).toEqual(before)
  })

  it('changed ingredients are cut to the fields the hub lets through, extras on them and on the nested units dropped', async () => {
    madeInNutriTrace()
    await openPage(false)
    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    tap([...editor.querySelectorAll('.item')].find(el => el.querySelector('.tt').textContent === 'Rolled oats'))
    const sheet = topSheet()
    type(sheet.querySelector('input.num'), '70')
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(editor.textContent).toContain('70 g'))
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(nt.writes().some(r => r.method === 'PUT')).toBe(true))
    const put = nt.writes().find(r => r.method === 'PUT')
    expect(Object.keys(put.body).sort()).toEqual(['items', 'nutrition'])
    for (const i of put.body.items) expect(Object.keys(i).every(k => ['id', 'name', 'brand', 'portion', 'unit', 'quantity', 'nutrition', 'nutrition_basis', 'alt_units', 'density_g_ml', 'is_recipe'].includes(k))).toBe(true)
    expect(put.body.items[1].alt_units).toEqual([{ abbr: 'slice', grams: 36 }])
  })

  it('the fake refuses a meal body the hub would: an unlisted key, a wrong kind of value', async () => {
    const send = (method, path, body) => nt.fetch(`/nt${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const item = { name: 'Oats', portion: 60, unit: 'g', nutrition: { calories: 1 } }
    expect((await send('PUT', '/api/meals/21', { items: [{ ...item, img_url: 'x' }] })).status).toBe(400)
    expect((await send('PUT', '/api/meals/21', { name: 'A', img_url: 'x' })).status).toBe(400)
    expect((await send('PUT', '/api/meals/21', { servings: '4' })).status).toBe(400)
    expect((await send('PUT', '/api/meals/21', { servings: null })).status).toBe(400)
    expect((await send('PUT', '/api/meals/21', { items: [{ ...item, portion: '60' }] })).status).toBe(400)
    expect((await send('PUT', '/api/meals/21', { items: [{ ...item, is_recipe: 1 }] })).status).toBe(400)
    expect((await send('PUT', '/api/meals/21', { items: [{ ...item, nutrition: { calories: -1 } }] })).status).toBe(400)
    expect((await send('PUT', '/api/meals/21', { items: [{ ...item, is_recipe: true }], servings: 2 })).status).toBe(200)
    expect((await send('POST', '/api/meals/21/used', { date: DAY, extra: 1 })).status).toBe(400)
  })

  it('a recipe used as an ingredient keeps is_recipe when the meal is saved, and logging bumps the recipe, not a food', async () => {
    const [oatsAndBread, lentil] = fixtureMeals()
    oatsAndBread.items = [{ ...oatsAndBread.items[0] }, { id: 22, name: 'Lentil soup', brand: '', portion: 300, unit: 'g', quantity: 1, nutrition: lentil.nutrition, is_recipe: true }]
    nt = createFakeNutriTrace({ meals: [oatsAndBread, lentil] })
    vi.stubGlobal('fetch', nt.fetch)
    await openPage(false)
    tap(rowOf('Oats and bread'))
    const detail = topSheet()
    await settle(() => expect(buttonSaying(detail, 'Log to Dinner')).toBeTruthy())
    tap(buttonSaying(detail, 'Log to Dinner'))
    await settle(() => expect(nt.writes().some(r => r.path === '/nt/api/meals/22/used')).toBe(true))
    await settle(() => expect(nt.writes().some(r => r.path === '/nt/api/foods/11/used')).toBe(true))
    expect(nt.writes().some(r => r.path === '/nt/api/foods/22/used')).toBe(false)
    expect(dayItems().find(i => i.name === 'Lentil soup')).toMatchObject({ id: 22, is_recipe: true })

    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    tap([...editor.querySelectorAll('.item')].find(el => el.querySelector('.tt').textContent === 'Lentil soup'))
    const sheet = topSheet()
    type(sheet.querySelector('input.num'), '150')
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(editor.textContent).toContain('150 g'))
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(nt.writes().some(r => r.method === 'PUT')).toBe(true))
    expect(nt.writes().find(r => r.method === 'PUT').body.items.find(i => i.name === 'Lentil soup')).toMatchObject({ id: 22, is_recipe: true })
  })

  it('changes the amount of an ingredient and rescales its nutrients', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    tap([...editor.querySelectorAll('.item')].find(el => el.querySelector('.tt').textContent === 'Rolled oats'))
    const sheet = topSheet()
    type(sheet.querySelector('input.num'), '120')
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(editor.textContent).toContain('120 g'))
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(nt.writes().some(r => r.method === 'PUT')).toBe(true))
    const put = nt.writes().find(r => r.method === 'PUT')
    expect(put.body.items[0]).toMatchObject({ portion: 120, quantity: 1 })
    expect(put.body.items[0].nutrition.calories).toBeCloseTo(456)
  })

  it('edits a recipe with its servings and total weight as saved', async () => {
    await openPage(true)
    tap(rowOf('Lentil soup'))
    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    expect(fieldNear(editor, 'Servings').value).toBe('4')
    expect(fieldNear(editor, 'Total weight').value).toBe('1200')
    type(fieldNear(editor, 'Servings'), '6')
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(nt.writes().some(r => r.method === 'PUT' && r.path === '/nt/api/meals/22')).toBe(true))
    const put = nt.writes().find(r => r.method === 'PUT')
    expect(put.body).toMatchObject({ servings: 6, portion: 200 })
    expect(put.body).not.toHaveProperty('items')
    expect(put.body.nutrition.calories).toBeCloseTo(140)
    expect(nt.state.meals.find(m => m.id === 22).items).toHaveLength(2)
  })

  it('leaves a recipe with no servings unset when something else changes', async () => {
    nt = createFakeNutriTrace({ meals: fixtureMeals().map(m => (m.id === 22 ? { ...m, servings: null } : m)) })
    vi.stubGlobal('fetch', nt.fetch)
    await openPage(true)
    tap(rowOf('Lentil soup'))
    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    expect(fieldNear(editor, 'Servings').value).toBe('')
    type(fieldNear(editor, 'Name'), 'Soup')
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(nt.state.meals.find(m => m.id === 22).name).toBe('Soup'))
    expect(nt.writes().find(r => r.method === 'PUT').body).toEqual({ name: 'Soup' })
    expect(nt.state.meals.find(m => m.id === 22).servings).toBeNull()
  })

  it('keeps a total weight that was typed when an ingredient is added', async () => {
    await openPage(true)
    tap(buttonSaying(page, 'New'))
    const editor = topSheet()
    type(fieldNear(editor, 'Name'), 'Porridge')
    await addIngredient(editor, 'Rolled oats', 200)
    await settle(() => expect(fieldNear(editor, 'Total weight').value).toBe('200'))
    type(fieldNear(editor, 'Total weight'), '900')
    await addIngredient(editor, 'Rolled oats', 100)
    await settle(() => expect(editor.textContent).toContain('100 g'))
    expect(fieldNear(editor, 'Total weight').value).toBe('900')
  })

  it('asks before throwing away what was typed, and a tap outside cannot close the editor', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Edit'))
    expect(useUI.getState().sheets.at(-1).locked).toBe(true)
    const untouched = topSheet()
    tap(untouched.querySelector('button[aria-label="Cancel"]'))
    expect(useUI.getState().sheets).toHaveLength(1)

    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    type(fieldNear(editor, 'Name'), 'Oats')
    tap(editor.querySelector('button[aria-label="Cancel"]'))
    const ask = topSheet()
    expect(ask.textContent).toContain('Discard changes?')
    tap(buttonSaying(ask, 'Keep editing'))
    expect(fieldNear(editor, 'Name').value).toBe('Oats')
    tap(editor.querySelector('button[aria-label="Cancel"]'))
    tap(buttonSaying(topSheet(), 'Discard'))
    expect(nt.writes().some(r => r.method === 'PUT')).toBe(false)
    expect(names()).toEqual(['Oats and bread'])
  })

  it('takes a removed ingredient back with Undo', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Edit'))
    const editor = topSheet()
    tap([...editor.querySelectorAll('.item')].find(el => el.querySelector('.tt').textContent === 'Rolled oats'))
    tap(buttonSaying(topSheet(), 'Remove Rolled oats'))
    await settle(() => expect(editor.textContent).not.toContain('Rolled oats'))
    expect(toastText()).toBe('Removed Rolled oats')
    act(() => useUI.getState().runToastAction())
    await settle(() => expect([...editor.querySelectorAll('.item .tt')].map(el => el.textContent)).toEqual(['Rolled oats', 'Wholemeal bread']))
    tap(buttonSaying(editor, 'Save'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(1))
    expect(nt.writes().some(r => r.method === 'PUT')).toBe(false)
  })

  it('shows the energy unit and meal names the person set, even when the sheet opens before the page loaded them', async () => {
    nt = createFakeNutriTrace({ settings: { ...fixtureSettings(), energyUnit: 'kJ', mealNames: ['Brunch', 'Supper'] } })
    vi.stubGlobal('fetch', nt.fetch)
    await act(async () => { await useNutrition.getState().loadMeals({ recipes: false }) })
    useDiarySelection.getState().setMeal(1)
    act(() => mealDetailSheet({ id: 21, recipe: false }))
    const sheet = topSheet()
    await settle(() => expect(buttonSaying(sheet, 'Log to Supper')).toBeTruthy())
    expect(sheet.textContent).toContain('1481 kJ')
  })

  it('deletes after a confirmation, and not before', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    const detail = topSheet()
    tap(buttonSaying(detail, 'Delete Oats and bread'))
    expect(nt.writes().some(r => r.method === 'DELETE')).toBe(false)
    const confirm = topSheet()
    expect(confirm.textContent).toContain('Delete this meal?')
    tap(buttonSaying(confirm, 'Delete'))
    await settle(() => expect(nt.writes().some(r => r.method === 'DELETE' && r.path === '/nt/api/meals/21')).toBe(true))
    await settle(() => expect(page.textContent).toContain('No saved meals yet'))
    expect(toastText()).toBe('Meal deleted')
    expect(nt.state.meals.find(m => m.id === 21).deleted_at).toBeTruthy()
  })

  it('says it was not deleted when the call failed, and keeps the meal', async () => {
    await openPage(false)
    tap(rowOf('Oats and bread'))
    tap(buttonSaying(topSheet(), 'Delete Oats and bread'))
    nt.failNext('DELETE', '/nt/api/meals/', { status: 500 })
    tap(buttonSaying(topSheet(), 'Delete'))
    await settle(() => expect(toastText()).toBe('Not saved. Try again.'))
    expect(names()).toEqual(['Oats and bread'])
  })
})
