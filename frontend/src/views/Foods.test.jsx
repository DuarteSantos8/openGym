// @vitest-environment happy-dom
// Nutrition › Foods against the foundation's fake of NutriTrace and the hub: what the page lists,
// what a save, an edit and a delete send, what an online result becomes, and what a failure says.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync } from '../lib/nutrition/sync.js'
import { todayISO } from '../lib/format.js'
import { createFakeNutriTrace, fixtureFoods, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import { resetOnlineSearch } from '../lib/nutrition/use-online-search.js'
import { noteAnswer, resetOffBudget } from '../lib/nutrition/off-budget.js'
import Foods from './Foods.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// gains-hub #9 isFoodEdit: the keys PUT /api/foods/:id lets through.
const HUB_FOOD_EDIT = ['name', 'brand', 'barcode', 'portion', 'unit', 'category', 'notes', 'favorite', 'nutrition']

let nt
let page
const mounted = []

const bar = () => ({ id: 14, user_id: 3, name: 'Protein bar', brand: 'Gym', portion: 40, unit: 'g', nutrition: { calories: 160, proteins: 12, carbohydrates: 14, fat: 6 }, img_url: null, barcode: null, nutrition_basis: 'g', alt_units: null, density_g_ml: null, usage_count: 0, last_used_at: null, visibility: 'private', deleted_at: null })
const foodsFixture = () => [
  { ...fixtureFoods()[0], category: 'Pantry', favorite: 1 },
  { ...fixtureFoods()[1], category: 'Bakery' },
  fixtureFoods()[2],
  bar(),
]

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
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const buttons = host => [...host.querySelectorAll('button')]
const buttonSaying = (host, text) => buttons(host).find(b => (text instanceof RegExp ? text.test(b.textContent.trim()) : b.textContent.trim() === text))
const names = () => [...page.querySelectorAll('.item .tt')].map(el => el.textContent)
const rowOf = name => [...page.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === name)
const fieldNear = (host, label) => [...host.querySelectorAll('label')].find(l => l.textContent.startsWith(label)).querySelector('input,textarea')
const toastText = () => useUI.getState().toastMsg

// Renders the sheet the page just opened the way Modals does; closing it takes it off the stack.
function topSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

async function openPage() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Foods />))
  page = host
  await settle(() => expect(names().length).toBeGreaterThan(0))
}

beforeEach(() => {
  resetOnlineSearch()
  resetOffBudget()
  nt = createFakeNutriTrace({ foods: foodsFixture(), settings: { ...fixtureSettings(), foodCategories: ['Pantry', 'Bakery', { name: 'Dairy' }] } })
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState({ user: { id: 3, name: 'Ana' }, pushState: vi.fn(async () => {}) })
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(() => {
  mounted.forEach(r => { try { act(() => r.unmount()) } catch { /* already unmounted */ } })
  mounted.length = 0
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('your foods', () => {
  it('lists favourites first, then A to Z, and sorts by use on request', async () => {
    await openPage()
    expect(names()).toEqual(['Rolled oats', 'Crème fraîche', 'Protein bar', 'Wholemeal bread'])
    tap(buttonSaying(page, 'Recent'))
    expect(names()).toEqual(['Rolled oats', 'Wholemeal bread', 'Crème fraîche', 'Protein bar'])
    tap(buttonSaying(page, 'Most used'))
    expect(names()).toEqual(['Rolled oats', 'Wholemeal bread', 'Crème fraîche', 'Protein bar'])
  })

  it('searches by name or brand, accents aside, and narrows by category', async () => {
    await openPage()
    type(page.querySelector('.searchf input'), 'creme')
    expect(names()).toEqual(['Crème fraîche'])
    type(page.querySelector('.searchf input'), 'gym')
    expect(names()).toEqual(['Protein bar'])
    type(page.querySelector('.searchf input'), '')
    tap(buttonSaying(page, 'Bakery'))
    expect(names()).toEqual(['Wholemeal bread'])
    tap(buttonSaying(page, 'All'))
    expect(names()).toHaveLength(4)
  })

  it('says so when a search matches nothing, and offers the online search for it', async () => {
    await openPage()
    type(page.querySelector('.searchf input'), 'zzzz')
    expect(page.textContent).toContain('No match')
    tap(buttonSaying(page, 'Search online'))
    expect(page.querySelector('.searchf input').value).toBe('zzzz')
  })

  it('shows a food per 100 g and per serving', async () => {
    await openPage()
    tap(rowOf('Protein bar'))
    const sheet = topSheet()
    // A 40 g bar: 160 kcal a serving is 400 kcal per 100 g, which it opens on.
    expect(sheet.textContent).toContain('400 kcal')
    expect(sheet.textContent).toContain('Protein30 g')
    tap(buttonSaying(sheet, 'Per serving'))
    expect(sheet.textContent).toContain('160 kcal')
    expect(sheet.textContent).toContain('Protein12 g')
    tap(buttonSaying(sheet, 'Per 100 g'))
    expect(sheet.textContent).toContain('400 kcal')
  })

  it('says what failed to load, never the error text', async () => {
    nt.failNext('GET', '/nt/api/foods', { status: 502, error: 'upstream exploded: ECONNRESET' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(<Foods />))
    await settle(() => expect(host.textContent).toContain('Foods did not load.'))
    expect(host.textContent).not.toContain('ECONNRESET')
    tap(buttonSaying(host, 'Try again'))
    await settle(() => expect(host.textContent).toContain('Rolled oats'))
  })
})

describe('creating, editing and deleting a food', () => {
  const openNew = async () => {
    tap(buttonSaying(page, 'New'))
    return topSheet()
  }

  it('saves a new food as private, without an image, with one key', async () => {
    await openPage()
    const sheet = await openNew()
    type(fieldNear(sheet, 'Name'), 'Skyr')
    type(fieldNear(sheet, 'Calories'), '63')
    type(fieldNear(sheet, 'Protein'), '11')
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(names()).toContain('Skyr'))
    const post = nt.writes().find(w => w.method === 'POST')
    expect(post.path).toBe('/nt/api/foods')
    expect(post.body).toMatchObject({ name: 'Skyr', portion: 100, unit: 'g', visibility: 'private', nutrition: { calories: 63, proteins: 11 } })
    expect(post.body).not.toHaveProperty('img_url')
    expect(post.body).not.toHaveProperty('imgUrl')
    expect(typeof post.body.client_key).toBe('string')
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(toastText()).toBe('Food saved')
  })

  it('asks for a name and a serving before sending anything', async () => {
    await openPage()
    const sheet = await openNew()
    tap(buttonSaying(sheet, 'Save'))
    expect(sheet.textContent).toContain('Give the food a name.')
    type(fieldNear(sheet, 'Name'), 'Skyr')
    type(fieldNear(sheet, 'Serving amount'), '0')
    tap(buttonSaying(sheet, 'Save'))
    expect(sheet.textContent).toContain('The serving needs an amount above 0.')
    type(fieldNear(sheet, 'Serving amount'), '100')
    type(fieldNear(sheet, 'Calories'), 'lots')
    tap(buttonSaying(sheet, 'Save'))
    expect(sheet.textContent).toContain('Calories must be a number, 0 or more.')
    expect(nt.writes()).toHaveLength(0)
  })

  it('keeps what was typed when the answer is lost, and a retry saves one food', async () => {
    await openPage()
    const sheet = await openNew()
    type(fieldNear(sheet, 'Name'), 'Skyr')
    type(fieldNear(sheet, 'Calories'), '63')
    nt.failNext('POST', '/nt/api/foods', { lost: true })
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(sheet.textContent).toContain('Not saved: no connection.'))
    expect(fieldNear(sheet, 'Name').value).toBe('Skyr')
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    const posts = nt.writes().filter(w => w.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[1].body.client_key).toBe(posts[0].body.client_key)
    expect(nt.state.foods.filter(f => f.name === 'Skyr')).toHaveLength(1)
    expect(names().filter(n => n === 'Skyr')).toHaveLength(1)
  })

  it('keeps a food\'s whole nutrition when only Favorite is changed', async () => {
    const full = { calories: 112.5, kilojoules: 470, 'omega-3': 0.3, 'saturated-fat': 0.004, proteins: 2.5 }
    nt.state.foods.find(f => f.id === 12).nutrition = { ...full }
    await openPage()
    tap(rowOf('Wholemeal bread'))
    tap(buttonSaying(topSheet(), 'Edit food'))
    const sheet = topSheet()
    tap(sheet.querySelector('[role=switch]'))
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    const put = nt.writes().find(w => w.method === 'PUT')
    expect(put.body.favorite).toBe(true)
    expect(put.body).not.toHaveProperty('nutrition')
    expect(nt.state.foods.find(f => f.id === 12).nutrition).toEqual(full)
  })

  it('edits energy in kJ for a kJ user and stores kcal', async () => {
    nt.state.settings.energyUnit = 'kJ'
    await openPage()
    await settle(() => expect(useNutrition.getState().settings.data?.energyUnit).toBe('kJ'))
    tap(rowOf('Wholemeal bread'))
    tap(buttonSaying(topSheet(), 'Edit food'))
    const sheet = topSheet()
    const field = fieldNear(sheet, 'Calories')
    expect(field.value).toBe('1033.45')
    expect(field.closest('label').textContent).toContain('kJ')
    type(field, '1046')
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    expect(nt.writes().find(w => w.method === 'PUT').body.nutrition.calories).toBe(250)
  })

  it('edits a food: only the fields, never an image or a visibility', async () => {
    await openPage()
    tap(rowOf('Wholemeal bread'))
    tap(buttonSaying(topSheet(), 'Edit food'))
    const sheet = topSheet()
    type(fieldNear(sheet, 'Calories'), '250')
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    const put = nt.writes().find(w => w.method === 'PUT')
    expect(put.path).toBe('/nt/api/foods/12')
    expect(put.body).toMatchObject({ name: 'Wholemeal bread', nutrition: { calories: 250, proteins: 13 } })
    for (const k of ['img_url', 'imgUrl', 'visibility', 'id']) expect(put.body).not.toHaveProperty(k)
    expect(Object.keys(put.body).every(k => HUB_FOOD_EDIT.includes(k))).toBe(true)
    expect(nt.state.foods.find(f => f.id === 12).img_url).toBe('/uploads/1700000000000-abcdef12.jpg')
  })

  it('sends only the edit fields, even for a whole food row as NutriTrace returned it', async () => {
    await openPage()
    const row = useNutrition.getState().foods.list.find(f => f.id === 14)
    await act(() => useNutrition.getState().saveFood({ ...row, favorite: true }))
    const put = nt.writes().find(w => w.method === 'PUT')
    expect(Object.keys(put.body).filter(k => !HUB_FOOD_EDIT.includes(k))).toEqual([])
    expect(put.body).toMatchObject({ name: 'Protein bar', favorite: true })
  })

  it('says the food was not saved when the hub refuses the body (400)', async () => {
    await openPage()
    tap(rowOf('Wholemeal bread'))
    tap(buttonSaying(topSheet(), 'Edit food'))
    const sheet = topSheet()
    nt.failNext('PUT', '/nt/api/foods/12', { status: 400, error: 'request body refused' })
    tap(buttonSaying(sheet, 'Save'))
    await settle(() => expect(sheet.querySelector('[role=alert]').textContent).toBe('The food was not saved. Try again.'))
  })

  it('deletes a food after asking, and keeps it when the delete fails', async () => {
    await openPage()
    tap(rowOf('Protein bar'))
    tap(buttonSaying(topSheet(), 'Edit food'))
    const editor = topSheet()
    tap(buttonSaying(editor, 'Delete food'))
    const confirm = topSheet()
    nt.failNext('DELETE', '/nt/api/foods/14', 'offline')
    tap(buttonSaying(confirm, 'Delete'))
    await settle(() => expect(toastText()).toContain('Not saved: no connection.'))
    expect(names()).toContain('Protein bar')
    expect(nt.state.foods.some(f => f.id === 14)).toBe(true)

    tap(buttonSaying(editor, 'Delete food'))
    tap(buttonSaying(topSheet(), 'Delete'))
    await settle(() => expect(names()).not.toContain('Protein bar'))
    expect(nt.state.foods.some(f => f.id === 14)).toBe(false)
    expect(toastText()).toBe('Food deleted')
  })
})

describe('online results', () => {
  const search = async text => {
    tap(buttonSaying(page, 'Online'))
    type(page.querySelector('.searchf input'), text)
    await settle(() => expect(page.querySelector('.item')).not.toBeNull())
  }

  it('lists what Open Food Facts has, leaves out what cannot be logged, and saves one as private', async () => {
    await openPage()
    await search('nutella')
    expect(names()).toEqual(['Nutella'])
    const proxied = nt.requests.find(r => r.path === '/nt/api/proxy')
    expect(proxied.query.url).toContain('https://search.openfoodfacts.org/search?')
    tap(buttonSaying(page, 'Save'))
    await settle(() => expect(page.textContent).toContain('Saved'))
    const post = nt.writes().find(w => w.method === 'POST')
    expect(post.body).toMatchObject({ name: 'Nutella', barcode: '3017620422003', visibility: 'private', portion: 100, unit: 'g' })
    expect(post.body).not.toHaveProperty('imgUrl')
    expect(post.body).not.toHaveProperty('img_url')
    tap(buttonSaying(page, 'My foods'))
    expect(names()).toContain('Nutella')
  })

  it('opens a result from its whole text block, and holds Save while it saves', async () => {
    await openPage()
    await search('nutella')
    const opener = page.querySelector('.item button.item-open')
    expect(opener.textContent).toBe('NutellaFerrero · per 100 g')
    const slow = nt.hold('POST', '/nt/api/foods')
    tap(buttonSaying(page, 'Save'))
    expect(buttonSaying(page, 'Save').disabled).toBe(true)
    tap(buttonSaying(page, 'Save'))
    slow.release()
    await settle(() => expect(page.textContent).toContain('Saved'))
    expect(nt.writes().filter(w => w.method === 'POST')).toHaveLength(1)
    tap(opener)
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('says per 100 ml for a drink', async () => {
    nt.state.offSearch = { count: 1, page: 1, page_size: 20, products: [{ code: '5449000000996', product_name: 'Cola', brands: 'Coca-Cola', nutrition_data_per: '100ml', serving_size: '330 ml', serving_quantity: 330, nutriments: { 'energy-kcal_100g': 42, carbohydrates_100g: 10.6, sugars_100g: 10.6 } }] }
    await openPage()
    await search('cola')
    expect(page.querySelector('.item .ss').textContent).toBe('Coca-Cola · per 100 ml')
  })

  it('does not search again for a query it answered when Mine and Online are toggled', async () => {
    await openPage()
    await search('nutella')
    tap(buttonSaying(page, 'My foods'))
    tap(buttonSaying(page, 'Online'))
    await settle(() => expect(names()).toEqual(['Nutella']))
    await act(async () => { await new Promise(r => setTimeout(r, 600)) })
    expect(nt.requests.filter(r => r.path === '/nt/api/proxy')).toHaveLength(1)
  })

  it('asks for more than a letter, and when the hub rate limit hits waits out its pause, asking nothing', async () => {
    await openPage()
    tap(buttonSaying(page, 'Online'))
    type(page.querySelector('.searchf input'), 'n')
    expect(page.textContent).toContain('Type a food to search Open Food Facts.')
    expect(nt.requests.some(r => r.path === '/nt/api/proxy')).toBe(false)
    nt.failNext('GET', '/nt/api/proxy', { status: 429, error: 'rate limited' })
    type(page.querySelector('.searchf input'), 'nutella')
    await settle(() => expect(page.textContent).toContain('Open Food Facts paused · back in'))
    const asked = nt.requests.filter(r => r.path === '/nt/api/proxy').length
    type(page.querySelector('.searchf input'), 'nutella spread')
    await act(async () => { await new Promise(r => setTimeout(r, 600)) })
    expect(nt.requests.filter(r => r.path === '/nt/api/proxy')).toHaveLength(asked)
    expect(page.textContent).toContain('Open Food Facts paused · back in')
    const note = [...page.querySelectorAll('[role=status]')].find(n => n.textContent.includes('paused'))
    expect(note.closest('.sr-card')).not.toBeNull()
    expect(note.querySelector('.sr-count').textContent).toMatch(/^\d+ s$/)
    expect(buttonSaying(page, /Search Open Food Facts for/)).toBeUndefined()
    await enter()
    expect(nt.requests.filter(r => r.path === '/nt/api/proxy')).toHaveLength(asked)
  })

  const enter = () => act(async () => {
    page.querySelector('.searchf input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 30))
  })
  const proxied = () => nt.requests.filter(r => r.path === '/nt/api/proxy')

  it('after a 429 whose pause is over, shows the ask as one row in a card, and Enter and the row each search', async () => {
    noteAnswer({ status: 429, headers: new Headers({ 'Retry-After': '1', 'RateLimit-Remaining': '0' }) }, Date.now() - 5000)
    await openPage()
    tap(buttonSaying(page, 'Online'))
    type(page.querySelector('.searchf input'), 'nutella')
    await settle(() => expect(buttonSaying(page, 'Search Open Food Facts for “nutella”')).toBeDefined())
    const row = buttonSaying(page, 'Search Open Food Facts for “nutella”')
    expect(row.closest('.sr-card')).not.toBeNull()
    expect(row.classList.contains('btn')).toBe(false)
    expect(row.querySelector('.icn')).not.toBeNull()
    expect(proxied()).toHaveLength(0)
    await enter()
    await settle(() => expect(names()).toEqual(['Nutella']))
    expect(proxied()).toHaveLength(1)
    expect(buttonSaying(page, /Search Open Food Facts for/)).toBeUndefined()
  })

  it('shows skeleton rows while it searches, and Enter asks nothing more', async () => {
    const slow = nt.hold('GET', '/nt/api/proxy')
    await openPage()
    tap(buttonSaying(page, 'Online'))
    type(page.querySelector('.searchf input'), 'nutella')
    await settle(() => expect(page.querySelector('.sr-card .sr-skel')).not.toBeNull())
    await enter()
    expect(buttonSaying(page, /Search Open Food Facts for/)).toBeUndefined()
    slow.release()
    await settle(() => expect(names()).toEqual(['Nutella']))
    expect(proxied()).toHaveLength(1)
    expect(page.querySelector('.sr-skel')).toBeNull()
  })

  it('says it cannot reach Open Food Facts, with a Retry that searches again; Enter does not', async () => {
    nt.failNext('GET', '/nt/api/proxy', 'offline')
    await openPage()
    tap(buttonSaying(page, 'Online'))
    type(page.querySelector('.searchf input'), 'nutella')
    await settle(() => expect(page.querySelector('[role=alert]')).not.toBeNull())
    expect(page.querySelector('[role=alert]').textContent).toBe('The search did not finish: no connection.')
    expect(page.querySelector('[role=alert]').closest('.sr-card')).not.toBeNull()
    await enter()
    expect(proxied()).toHaveLength(1)
    tap(buttonSaying(page, 'Retry'))
    await settle(() => expect(names()).toEqual(['Nutella']))
    expect(proxied()).toHaveLength(2)
  })

  describe('offline', () => {
    afterEach(() => { Reflect.deleteProperty(navigator, 'onLine') })

    it('says online results come back on reconnect, with no row, and Enter asks nothing', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      await openPage()
      tap(buttonSaying(page, 'Online'))
      type(page.querySelector('.searchf input'), 'nutella')
      await settle(() => expect(page.textContent).toContain('Online results come back when you reconnect'))
      expect(buttonSaying(page, /Search Open Food Facts for/)).toBeUndefined()
      await enter()
      expect(proxied()).toHaveLength(0)
    })
  })
})

describe('logging from a food', () => {
  it('logs the food at the amount and meal chosen, to the date it opened with', async () => {
    useDiarySelection.getState().setMeal(1)
    await openPage()
    tap(rowOf('Rolled oats'))
    const sheet = topSheet()
    type(fieldNear(sheet, 'Amount'), '150')
    tap(buttonSaying(sheet, 'Log to Lunch'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    const put = nt.writes().find(w => w.path === `/nt/api/diary/${todayISO()}`)
    const item = put.body.items.at(-1)
    expect(item).toMatchObject({ name: 'Rolled oats', meal: 1, portion: 150, unit: 'g', food_server_id: 11, quantity: 1 })
    expect(item.nutrition.calories).toBeCloseTo(570)
    expect(toastText()).toBe('Logged to Lunch')
  })

  it('does not log twice when the answer to a log is lost and it is tapped again', async () => {
    useDiarySelection.getState().setMeal(0)
    await openPage()
    tap(rowOf('Rolled oats'))
    const sheet = topSheet()
    nt.failNext('PUT', `/nt/api/diary/${todayISO()}`, { lost: true })
    tap(buttonSaying(sheet, 'Log to Breakfast'))
    await settle(() => expect(toastText()).toContain('Not saved: no connection.'))
    tap(buttonSaying(sheet, 'Log to Breakfast'))
    await settle(() => expect(useUI.getState().sheets).toHaveLength(0))
    expect(nt.state.days[todayISO()].items).toHaveLength(1)
  })

  it('refuses an amount of nothing', async () => {
    await openPage()
    tap(rowOf('Rolled oats'))
    const sheet = topSheet()
    type(fieldNear(sheet, 'Amount'), '0')
    tap(buttonSaying(sheet, /^Log to/))
    expect(toastText()).toBe('Enter an amount above 0.')
    expect(nt.writes()).toHaveLength(0)
  })
})
