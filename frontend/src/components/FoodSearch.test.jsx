// @vitest-environment happy-dom
// The one food search, in the places a food is picked: the diary picker and a recipe's ingredient
// picker. NutriTrace is faked at the fetch boundary, under the hub's rules for the proxy (so a
// search carrying anything but q, page, page_size and langs would be refused).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { clearOnlineSearchCache } from '../lib/nutrition/use-online-search.js'
import { offResults } from '../lib/nutrition/off.js'
import { createFakeNutriTrace, fixtureDay, fixtureOffProduct } from '../lib/nutrition/fake-nutritrace.js'
import FoodPicker from './FoodPicker.jsx'
import { ingredientSheet } from './IngredientSheet.jsx'

const camera = { hit: null }
vi.mock('./CameraScan.jsx', () => ({
  default: ({ onFound }) => <button type="button" onClick={() => onFound(camera.hit)}>camera sees a code</button>,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
let nt, host, root

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return sheets.map(s => <div key={s.id} data-sheet="">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)
}
const settle = async (ms = 0) => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const mount = async el => { await act(async () => { root.render(<>{el}<Sheets /></>) }); await settle() }
const lastSheet = () => [...host.querySelectorAll('[data-sheet]')].at(-1)
const buttonIn = (scope, label) => [...scope.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === label)
const click = async el => { await act(async () => { el.click() }); await settle() }
const typeInto = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
// Typing, then the search's pause.
const search = async (scope, value) => { await typeInto(scope.querySelector('input'), value); await settle(260) }
const row = (scope, title) => [...scope.querySelectorAll('.item')].find(r => r.querySelector('.tt')?.textContent === title)
const titles = scope => [...scope.querySelectorAll('.item .tt')].map(n => n.textContent)
const headings = scope => [...scope.querySelectorAll('h4')].map(n => n.textContent)
const searches = () => nt.requests.filter(r => r.path === '/nt/api/proxy' && r.query.url.includes('/search?'))
const foodPosts = () => nt.writes().filter(r => r.path === '/nt/api/foods')

const off = (code, name, countries) => ({
  code, product_name: name, brands: '', countries_tags: countries, nutrition_data_per: '100g',
  nutriments: { 'energy-kcal_100g': 100, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 },
})

beforeEach(() => {
  nt = createFakeNutriTrace({ days: { [TODAY]: fixtureDay(TODAY) }, offProducts: { '3017620422003': fixtureOffProduct('3017620422003') } })
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg' },
  }))
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  clearOnlineSearchCache()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  camera.hit = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('Romanian products first', () => {
  it('moves products sold in Romania up, each group keeping Open Food Facts order', () => {
    const answer = { hits: [off('1', 'German milk', ['en:germany']), off('2', 'Lapte A', ['en:france', 'en:romania']), off('3', 'No countries'), off('4', 'Lapte B', ['en:romania'])] }
    expect(offResults(answer).map(f => f.name)).toEqual(['Lapte A', 'Lapte B', 'German milk', 'No countries'])
  })

  it('asks Open Food Facts for nothing the hub would refuse', async () => {
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    await search(host, 'nutella')
    expect(searches()).toHaveLength(1)
    const url = new URL(searches()[0].query.url)
    expect([...url.searchParams.keys()].sort()).toEqual(['langs', 'page', 'page_size', 'q'])
  })
})

describe('the diary picker', () => {
  it('groups recents and your foods, then Open Food Facts with its source named', async () => {
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    expect(headings(host)).toEqual(['Recent', 'Saved meals', 'Your foods'])
    expect(titles(host)).toContain('Rolled oats')
    await search(host, 'nutella')
    expect(headings(host)).toEqual(['Your foods', 'Open Food Facts'])
    expect(titles(host)).toContain('Nutella')
    expect(searches()).toHaveLength(1)
  })

  it('leaves out a product you already saved', async () => {
    nt.state.foods[0].barcode = '3017620422003'
    nt.state.foods[0].name = 'Nutella jar'
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    await search(host, 'nutella')
    expect(titles(host).filter(n => n.startsWith('Nutella'))).toEqual(['Nutella jar'])
  })

  it('says so when Open Food Facts cannot be reached, and your foods still work', async () => {
    nt.failNext('GET', '/nt/api/proxy', 'offline')
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    await search(host, 'bread')
    expect(host.querySelector('[role=alert]').textContent).toBe('The search did not finish: no connection.')
    expect(titles(host)).toContain('Wholemeal bread')
  })

  it('logs a picked online result, saving it as a food first', async () => {
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    await search(host, 'nutella')
    await click(row(host, 'Nutella'))
    await click(buttonIn(lastSheet(), 'Log'))
    expect(foodPosts()[0].body).toMatchObject({ name: 'Nutella', visibility: 'private' })
    expect(nt.writes().find(r => r.method === 'PUT').body.items.at(-1)).toMatchObject({ name: 'Nutella' })
  })

  it('opens the create sheet with the typed name, and logs the new food once saved', async () => {
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    await search(host, 'Zucchini')
    await click(row(host, 'Create food'))
    expect(lastSheet().querySelector('input').value).toBe('Zucchini')
    await click(buttonIn(lastSheet(), 'Save'))
    expect(foodPosts()[0].body).toMatchObject({ name: 'Zucchini' })
    expect(lastSheet().textContent).toContain('Serving size')
  })
})

describe('saved meals in the diary picker', () => {
  const putItems = () => nt.writes().filter(r => r.method === 'PUT').map(r => r.body.items)
  const open = title => row(host, title).querySelector('button.item-open')

  it('lists saved meals and recipes, and filters them by the typed name', async () => {
    await mount(<FoodPicker date={TODAY} meal={1} mealName="Lunch" />)
    expect(titles(host)).toEqual(expect.arrayContaining(['Oats and bread', 'Lentil soup']))
    await search(host, 'lentil')
    expect(titles(host)).toContain('Lentil soup')
    expect(titles(host)).not.toContain('Oats and bread')
  })

  it('logs a saved meal in one tap: each ingredient, to the meal, in one write, with Undo', async () => {
    const onLogged = vi.fn()
    await mount(<FoodPicker date={TODAY} meal={1} mealName="Lunch" onLogged={onLogged} />)
    await click(open('Oats and bread'))
    expect(putItems()).toHaveLength(1)
    const added = nt.state.days[TODAY].items.filter(i => ['Rolled oats', 'Wholemeal bread'].includes(i.name) && i.meal === 1)
    expect(added.map(i => i.name)).toEqual(['Rolled oats', 'Wholemeal bread'])
    expect(useUI.getState().toastMsg).toBe('Logged to Lunch')
    expect(onLogged).toHaveBeenCalledTimes(1)
    await act(async () => { useUI.getState().runToastAction() })
    await settle()
    expect(nt.state.days[TODAY].items.some(i => added.some(a => a.uuid === i.uuid))).toBe(false)
  })

  it('asks how many servings of a recipe while "Ask for quantity" is on, and logs that many', async () => {
    await mount(<FoodPicker date={TODAY} meal={2} mealName="Dinner" />)
    await click(open('Lentil soup'))
    expect(putItems()).toHaveLength(0)
    expect(lastSheet().querySelector('h3').textContent).toBe('Lentil soup')
    await typeInto(lastSheet().querySelector('input[aria-label="Servings eaten"]'), '2')
    await click(buttonIn(lastSheet(), 'Log to Dinner'))
    expect(nt.state.days[TODAY].items.find(i => i.name === 'Lentil soup')).toMatchObject({ meal: 2, quantity: 2, is_recipe: true })
  })

  it('logs one serving of a recipe at once while "Ask for quantity" is off', async () => {
    nt.state.settings.diaryPromptQuantity = false
    await useNutrition.getState().loadSettings()
    await mount(<FoodPicker date={TODAY} meal={2} mealName="Dinner" />)
    await click(open('Lentil soup'))
    expect(host.querySelectorAll('[data-sheet]')).toHaveLength(0)
    expect(nt.state.days[TODAY].items.find(i => i.name === 'Lentil soup')).toMatchObject({ meal: 2, quantity: 1, is_recipe: true })
  })

  it('never prompts for a saved meal, whatever the setting', async () => {
    await mount(<FoodPicker date={TODAY} meal={1} mealName="Lunch" />)
    await click(open('Oats and bread'))
    expect(host.querySelectorAll('[data-sheet]')).toHaveLength(0)
    expect(nt.state.days[TODAY].items.filter(i => i.meal === 1 && ['Rolled oats', 'Wholemeal bread'].includes(i.name))).toHaveLength(2)
  })

  it('keeps a row a focused button, marked busy, while its write is in flight', async () => {
    await mount(<FoodPicker date={TODAY} meal={1} mealName="Lunch" />)
    const slow = nt.hold('PUT', '/nt/api/diary/')
    const btn = open('Oats and bread')
    btn.focus()
    await act(async () => { btn.click() })
    expect(open('Oats and bread')).toBe(btn)
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.disabled).toBe(false)
    expect(document.activeElement).toBe(btn)
    await act(async () => { slow.release() })
    await settle()
    expect(open('Oats and bread').hasAttribute('aria-busy')).toBe(false)
  })

  it('sends the same entries when a tap follows a save whose answer was lost', async () => {
    await mount(<FoodPicker date={TODAY} meal={1} mealName="Lunch" />)
    nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 504 })
    await click(open('Oats and bread'))
    expect(useUI.getState().toastMsg).toBe('Not saved. Try again.')
    await click(open('Oats and bread'))
    expect(nt.state.days[TODAY].items.filter(i => i.name === 'Rolled oats' && i.meal === 1)).toHaveLength(1)
    expect(nt.state.days[TODAY].items.filter(i => i.name === 'Wholemeal bread')).toHaveLength(1)
  })

  it('stays out of the ingredient picker', async () => {
    await act(async () => { ingredientSheet({ onDone: vi.fn() }) })
    await mount(<></>)
    await settle()
    expect(headings(lastSheet())).not.toContain('Saved meals')
  })
})

describe('what the search says and shows', () => {
  const live = () => host.querySelector('.fp-live')

  it('announces the result count in one node that stays in the page', async () => {
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    const node = live()
    expect(node.getAttribute('role')).toBe('status')
    expect(node.getAttribute('aria-live')).toBe('polite')
    expect(node.textContent).toBe('')
    await search(host, 'nutella')
    expect(live()).toBe(node)
    expect(node.textContent).toBe('Results: 1')
    nt.state.offSearch = { products: [] }
    await search(host, 'zzzz')
    expect(live()).toBe(node)
    expect(node.textContent).toBe('No results')
  })

  it('lists your other foods most used first when nothing is typed', async () => {
    for (const f of nt.state.foods) f.last_used_at = null
    nt.state.foods[0].usage_count = 1
    nt.state.foods[1].usage_count = 5
    nt.state.foods[2].usage_count = 3
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    expect(titles(host).filter(n => !['Create food', 'Quick kcal', 'Oats and bread', 'Lentil soup'].includes(n))).toEqual(['Wholemeal bread', 'Crème fraîche', 'Rolled oats'])
  })

  it('shows a saved copy of a product under its new name, and not the product again', async () => {
    nt.state.foods[0].barcode = '3017620422003'
    nt.state.foods[0].name = 'Hazelnut spread'
    await mount(<FoodPicker date={TODAY} meal="breakfast" mealName="Breakfast" />)
    await search(host, 'nutella')
    expect(titles(host)).toContain('Hazelnut spread')
    expect(titles(host)).not.toContain('Nutella')
    expect(host.textContent).toContain('Nothing found online.')
  })

  it('matches a product with no barcode by the key it was saved under, not by its name', async () => {
    nt.state.offSearch = { products: [{ product_name: 'Plain oats', nutriments: { 'energy-kcal_100g': 370 } }] }
    await mount(<div />)
    await act(async () => { ingredientSheet({ onDone: vi.fn() }) })
    await settle()
    await search(lastSheet(), 'plain')
    await click(row(lastSheet(), 'Plain oats'))
    useNutrition.setState(s => ({ foods: { ...s.foods, list: s.foods.list.map(f => (f.name === 'Plain oats' ? { ...f, name: 'Granola' } : f)) } }))
    await click(buttonIn(lastSheet(), 'Choose another food'))
    await search(lastSheet(), 'plain')
    expect(titles(lastSheet())).toContain('Granola')
    expect(titles(lastSheet())).not.toContain('Plain oats')
  })

  it('carries no string the pickers retired', () => {
    const packs = import.meta.glob('../locales/*.js', { eager: true })
    const retired = ['No foods yet. Save some under Foods first.', 'Too many online searches. Wait a minute and try again.', 'Online search failed. Your own foods still work.']
    expect(Object.keys(packs).length).toBe(18)
    for (const [file, pack] of Object.entries(packs)) {
      const keys = Object.keys(pack.default)
      for (const key of retired) expect(keys, `${file}: ${key}`).not.toContain(key)
    }
  })
})

describe('the ingredient picker', () => {
  const open = async onDone => {
    await mount(<div />)
    await act(async () => { ingredientSheet({ onDone }) })
    await settle()
  }

  it('is the same search: your foods and Open Food Facts, not only what you saved', async () => {
    await open(vi.fn())
    expect(headings(lastSheet())).toEqual(['Recent', 'Your foods'])
    await search(lastSheet(), 'nutella')
    expect(headings(lastSheet())).toEqual(['Your foods', 'Open Food Facts'])
    expect(titles(lastSheet())).toContain('Nutella')
  })

  it('uses one of your foods without saving anything', async () => {
    const onDone = vi.fn()
    await open(onDone)
    await click(row(lastSheet(), 'Rolled oats'))
    await click(buttonIn(lastSheet(), 'Add'))
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rolled oats' }))
    expect(nt.writes()).toEqual([])
  })

  it('saves an online result as a food first, then uses it', async () => {
    const onDone = vi.fn()
    await open(onDone)
    await search(lastSheet(), 'nutella')
    await click(row(lastSheet(), 'Nutella'))
    expect(foodPosts()).toHaveLength(1)
    expect(foodPosts()[0].body).toMatchObject({ name: 'Nutella', barcode: '3017620422003', visibility: 'private' })
    await click(buttonIn(lastSheet(), 'Add'))
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nutella', id: nt.state.foods.find(f => f.name === 'Nutella').id }))
  })

  it('a save whose answer was lost, tapped again, makes one food', async () => {
    const onDone = vi.fn()
    nt.failNext('POST', '/nt/api/foods', { lost: true, status: 504 })
    await open(onDone)
    await search(lastSheet(), 'nutella')
    await click(row(lastSheet(), 'Nutella'))
    expect(lastSheet().querySelector('[role=alert]')).not.toBeNull()
    expect(lastSheet().textContent).not.toContain('Amount')
    await click(row(lastSheet(), 'Nutella'))
    expect(foodPosts()).toHaveLength(2)
    expect(foodPosts()[1].body.client_key).toBe(foodPosts()[0].body.client_key)
    expect(nt.state.foods.filter(f => f.name === 'Nutella')).toHaveLength(1)
    expect(lastSheet().textContent).toContain('Amount')
  })

  it('uses a scanned product the same way, saved first', async () => {
    const onDone = vi.fn()
    await open(onDone)
    await click(buttonIn(lastSheet(), 'Scan a barcode'))
    camera.hit = { value: '3017620422003', fmt: 'ean13' }
    await click(buttonIn(lastSheet(), 'camera sees a code'))
    expect(buttonIn(lastSheet(), 'Save to my foods')).toBeUndefined()
    expect(buttonIn(lastSheet(), 'Quick kcal')).toBeUndefined()
    await click(buttonIn(lastSheet(), 'Use'))
    expect(foodPosts()).toHaveLength(1)
    expect(lastSheet().textContent).toContain('Amount')
    await click(buttonIn(lastSheet(), 'Add'))
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nutella' }))
  })

  it('a scanned product whose save failed is retried with the same key, from Try again', async () => {
    const onDone = vi.fn()
    nt.failNext('POST', '/nt/api/foods', { lost: true, status: 504 })
    await open(onDone)
    await click(buttonIn(lastSheet(), 'Scan a barcode'))
    camera.hit = { value: '3017620422003', fmt: 'ean13' }
    await click(buttonIn(lastSheet(), 'camera sees a code'))
    await click(buttonIn(lastSheet(), 'Use'))
    // The scan sheet is gone; the failure and the way to retry are at the top of the picker.
    const alert = lastSheet().querySelector('[role=alert]')
    expect(alert).not.toBeNull()
    expect(lastSheet().querySelector('.food-picker').compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    await click(buttonIn(lastSheet(), 'Try again'))
    expect(foodPosts()).toHaveLength(2)
    expect(foodPosts()[1].body.client_key).toBe(foodPosts()[0].body.client_key)
    expect(nt.state.foods.filter(f => f.name === 'Nutella')).toHaveLength(1)
    expect(lastSheet().textContent).toContain('Amount')
  })

  it('shows Saving… at the top and holds the rows while a save is out', async () => {
    await open(vi.fn())
    await search(lastSheet(), 'nutella')
    const slow = nt.hold('POST', '/nt/api/foods')
    await click(row(lastSheet(), 'Nutella'))
    const saving = [...lastSheet().querySelectorAll('[role=status]')].find(n => n.textContent === 'Saving…')
    expect(saving.compareDocumentPosition(lastSheet().querySelector('.food-picker')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row(lastSheet(), 'Nutella').getAttribute('aria-disabled')).toBe('true')
    await click(row(lastSheet(), 'Nutella'))
    expect(foodPosts()).toHaveLength(1)
    await act(async () => { slow.release() })
    await settle()
    expect(lastSheet().textContent).toContain('Amount')
  })

  it('lists 50 of your foods with Show more', async () => {
    for (let i = 0; i < 60; i++) nt.state.foods.push({ ...structuredClone(nt.state.foods[2]), id: 200 + i, name: `Food ${String(i).padStart(2, '0')}`, usage_count: 0 })
    await open(vi.fn())
    const shown = () => lastSheet().querySelectorAll('.list .item').length
    const before = shown()
    expect(lastSheet().querySelectorAll('h4')[1].nextElementSibling.querySelectorAll('.item')).toHaveLength(50)
    await click(buttonIn(lastSheet(), 'Show more'))
    expect(shown()).toBeGreaterThan(before)
    expect(buttonIn(lastSheet(), 'Show more')).toBeUndefined()
    expect(titles(lastSheet())).toContain('Food 59')
  })

  it('offers Try again when your foods did not load', async () => {
    nt.failNext('GET', '/nt/api/foods', 'offline')
    await open(vi.fn())
    expect(lastSheet().textContent).toContain('Your foods did not load.')
    await click(buttonIn(lastSheet(), 'Try again'))
    expect(titles(lastSheet())).toContain('Rolled oats')
  })

  it('creates a food from the typed name and uses it', async () => {
    const onDone = vi.fn()
    await open(onDone)
    await search(lastSheet(), 'Zucchini')
    await click(row(lastSheet(), 'Create food'))
    expect(lastSheet().querySelector('input').value).toBe('Zucchini')
    await click(buttonIn(lastSheet(), 'Save'))
    await click(buttonIn(lastSheet(), 'Add'))
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: 'Zucchini' }))
  })
})
