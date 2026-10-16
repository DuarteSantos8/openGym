// @vitest-environment happy-dom
// Profile's Nutrition settings change the Gains screens they name. Each test sets one setting on the
// fake NutriTrace and checks the screen: Home's water card and meals, the food picker, the
// portion sheet, the food search, Foods, Saved meals and Recipes, Trends, the scanner.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { resetOnlineSearch } from '../lib/nutrition/use-online-search.js'
import { createFakeNutriTrace, fixtureFoods, fixtureMeals, fixtureOffSearch, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import { mealRows } from '../lib/nutrition/meal-rows.js'
import { offResults } from '../lib/nutrition/off.js'
import { metricFrom, nutrientOptions } from '../lib/nutrition/trends.js'
import { unitsFor } from '../lib/nutrition/diary.js'
import Foods from '../views/Foods.jsx'
import MealCatalog from '../views/MealCatalog.jsx'
import { bindUI } from './ui.jsx'
import FoodPicker from './FoodPicker.jsx'
import FoodSearch from './FoodSearch.jsx'
import MealRow from './MealRow.jsx'
import PortionSheet from './PortionSheet.jsx'
import ScanSheet from './ScanSheet.jsx'
import WaterCard from './WaterCard.jsx'

const camera = { hit: null }
vi.mock('./CameraScan.jsx', () => ({
  default: ({ onFound }) => <button type="button" onClick={() => onFound(camera.hit)}>camera sees a code</button>,
}))
const beep = vi.hoisted(() => vi.fn())
vi.mock('../lib/sound.js', async orig => ({ ...(await orig()), beep }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/home', search: '' }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
let nt, host, root
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const click = async el => { await act(async () => { el.click() }); await settle() }
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}
const buttonSaying = (scope, text) => [...scope.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === text)
const rowNames = () => [...host.querySelectorAll('.item .tt')].map(e => e.textContent)
const rowOf = name => [...host.querySelectorAll('.item')].find(e => e.querySelector('.tt')?.textContent === name)
const puts = path => nt.requests.filter(r => r.method === 'PUT' && r.path === path)

async function mount(el, settings = {}, extra = {}) {
  act(() => root.render(null))
  useUI.setState({ sheets: [] })
  resetOnlineSearch()
  useNutrition.getState().reset()
  nt = createFakeNutriTrace({ settings: { ...fixtureSettings(), ...settings }, ...extra })
  vi.stubGlobal('fetch', nt.fetch)
  await act(async () => { await useNutrition.getState().loadSettings() })
  act(() => root.render(el))
  await settle()
}

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return sheets.map(s => <div key={s.id} data-sheet="">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)
}

beforeEach(() => {
  useStore.setState({ user: { id: 3, name: 'Ana' }, pushState: vi.fn(async () => {}) })
  useUI.setState({ sheets: [], toastMsg: '' })
  bindUI(useUI)
  beep.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('Water', () => {
  const water = { total: 500, goal: 2500 }

  it('waterUnit: the card reads the day in the unit, and the buttons carry it', async () => {
    await mount(<WaterCard date={TODAY} water={water} ready />, { waterUnit: 'oz' })
    expect(host.textContent).toContain('17 fl oz / 85 fl oz')
    expect(buttonSaying(host, 'Add a glass of water, 8 fl oz')).toBeTruthy()
    await mount(<WaterCard date={TODAY} water={water} ready />, { waterUnit: 'oz', waterContainers: [{ id: 'b', name: 'Standard Bottle', volumeMl: 500 }] })
    expect(buttonSaying(host, 'Add Standard Bottle, 17 fl oz')).toBeTruthy()
  })

  it('waterContainers: one button per container, and a tap logs that volume', async () => {
    await mount(<WaterCard date={TODAY} water={water} ready />, { waterContainers: [{ id: 'a', name: 'Mug', volumeMl: 300 }, { id: 'b', name: 'Flask', volumeMl: 750 }] })
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['300 ml', '750 ml'])
    await click(buttonSaying(host, 'Add Flask, 750 ml'))
    const [write] = puts(`/nt/api/diary/${TODAY}`)
    expect(write.body.water.at(-1)).toMatchObject({ amount: 750 })
  })

  it('waterContainers: a person who never set any keeps the plain 250 ml glass, not NutriTrace\'s two bottles', async () => {
    await mount(<WaterCard date={TODAY} water={water} ready />)
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['250 ml'])
    expect(buttonSaying(host, 'Add a glass of water, 250 ml')).toBeTruthy()
    await mount(<WaterCard date={TODAY} water={water} ready />, { waterContainers: [] })
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['250 ml'])
  })

  it('waterShowInDiary: off, Home has no water card', async () => {
    await mount(<WaterCard date={TODAY} water={water} ready />, { waterShowInDiary: false })
    expect(host.textContent).toBe('')
  })

  it('waterShowInStats: off, Trends no longer offers water', () => {
    expect(nutrientOptions({ waterShowInStats: false }).some(o => o.value === 'water')).toBe(false)
    expect(nutrientOptions({}).some(o => o.value === 'water')).toBe(true)
    expect(metricFrom('water', { waterShowInStats: false })).toBe('calories')
    expect(metricFrom('water', {})).toBe('water')
  })
})

describe('Home meals', () => {
  const oats = { uuid: 'u1', name: 'Rolled oats', brand: 'Quaker', portion: 60, unit: 'g', quantity: 1, meal: 0, addedAt: '2026-10-14T07:05:00.000Z', nutrition: { calories: 228, proteins: 8.1, carbohydrates: 36, fat: 4.2 } }
  const quick = (uuid, kcal) => ({ uuid, type: 'quick_calories', name: 'Quick kcal', meal: 0, addedAt: '2026-10-14T09:00:00.000Z', quantity: 1, nutrition: { calories: kcal } })
  const open = async () => { await click(host.querySelector('.meal-toggle')) }

  it('diaryShowBrands: the brand under the entry, off hides it', async () => {
    await mount(<MealRow date={TODAY} slot={0} name="Breakfast" items={[oats]} />, { diaryShowBrands: true })
    await open()
    expect(host.querySelector('.meal-item .ss').textContent).toBe('Quaker · 60 g')
    await mount(<MealRow date={TODAY} slot={0} name="Breakfast" items={[oats]} />, { diaryShowBrands: false })
    await open()
    expect(host.querySelector('.meal-item .ss').textContent).toBe('60 g')
  })

  it('diaryShowTimestamps: the time logged, in the 24 hour clock', async () => {
    const at = new Date(oats.addedAt)
    const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0')
    await mount(<MealRow date={TODAY} slot={0} name="Breakfast" items={[oats]} />, { diaryShowTimestamps: true, timeFormat: '24h' })
    await open()
    expect(host.querySelector('.meal-item .ss').textContent).toContain(hhmm)
  })

  it('diaryShowMacroSummary: protein, carbs and fat under the meal, off hides them', async () => {
    await mount(<MealRow date={TODAY} slot={0} name="Breakfast" items={[oats]} />, { diaryShowMacroSummary: true })
    expect(host.querySelector('.macro-line').textContent).toContain('Protein 8.1 g')
    await mount(<MealRow date={TODAY} slot={0} name="Breakfast" items={[oats]} />, { diaryShowMacroSummary: false })
    expect(host.querySelector('.macro-line')).toBeNull()
  })

  it('quickCaloriesDisplay: summed is one row, separate is one each', () => {
    const items = [quick('q1', 100), quick('q2', 50)]
    expect(mealRows(items, { summed: true }).map(r => [r.name, r.kcal])).toEqual([['Quick kcal', 150]])
    expect(mealRows(items, { summed: false }).map(r => r.kcal)).toEqual([100, 50])
  })

  it('mealNames: Home lists the meals under the names saved in Profile', async () => {
    const { default: MealsCard } = await import('./MealsCard.jsx')
    const day = { entry: { items: [] }, settings: { mealNames: ['Brunch', 'Supper'] }, activityRows: [], target: null, activitySum: null }
    await mount(<MealsCard date={TODAY} day={day} />, { mealNames: ['Brunch', 'Supper'] })
    expect([...host.querySelectorAll('.meal-name')].map(e => e.textContent)).toEqual(['Brunch', 'Supper'])
  })
})

describe('adding food', () => {
  const pickerPage = <><FoodPicker date={TODAY} meal={0} mealName="Breakfast" /><Sheets /></>

  it('showQuickCalories: off, the picker has no Quick kcal row', async () => {
    await mount(pickerPage, { showQuickCalories: true })
    expect(rowNames()).toContain('Quick kcal')
    await mount(pickerPage, { showQuickCalories: false })
    expect(rowNames()).not.toContain('Quick kcal')
  })

  it('diaryPromptQuantity: on asks how much; off logs one serving at once', async () => {
    await mount(pickerPage, { diaryPromptQuantity: true }, { foods: fixtureFoods() })
    await click(rowOf('Rolled oats'))
    expect(host.querySelector('.portion-sheet')).toBeTruthy()
    expect(puts(`/nt/api/diary/${TODAY}`)).toHaveLength(0)
    await mount(pickerPage, { diaryPromptQuantity: false }, { foods: fixtureFoods() })
    await click(rowOf('Rolled oats'))
    expect(host.querySelector('.portion-sheet')).toBeNull()
    expect(puts(`/nt/api/diary/${TODAY}`)).toHaveLength(1)
    expect(puts(`/nt/api/diary/${TODAY}`)[0].body.items[0]).toMatchObject({ name: 'Rolled oats', portion: 100, unit: 'g', quantity: 1, meal: 0 })
  })

  it('diaryDefaultField: the cursor starts in servings, or in the serving size', async () => {
    const food = fixtureFoods()[0]
    await mount(<PortionSheet food={food} date={TODAY} meal={0} mealName="Breakfast" close={() => {}} />, { diaryDefaultField: 'portion' })
    expect(document.activeElement.getAttribute('aria-label')).toBe('Serving size')
    await mount(<PortionSheet food={food} date={TODAY} meal={0} mealName="Breakfast" close={() => {}} />, { diaryDefaultField: 'servings' })
    expect(document.activeElement.getAttribute('aria-label')).toBe('Servings')
  })

  it('diaryPromptQuantity: off, a scanned product is logged at once too', async () => {
    camera.hit = { value: '3017620422003', fmt: 'ean13' }
    await mount(<><ScanSheet date={TODAY} meal={0} mealName="Breakfast" close={() => {}} /><Sheets /></>, { diaryPromptQuantity: false })
    await click(buttonSaying(host, 'camera sees a code'))
    await click(buttonSaying(host, 'Log'))
    expect(host.querySelector('.portion-sheet')).toBeNull()
    expect(puts(`/nt/api/diary/${TODAY}`)[0].body.items[0]).toMatchObject({ name: 'Nutella', quantity: 1, meal: 0 })
    await mount(<><ScanSheet date={TODAY} meal={0} mealName="Breakfast" close={() => {}} /><Sheets /></>, { diaryPromptQuantity: true })
    await click(buttonSaying(host, 'camera sees a code'))
    await click(buttonSaying(host, 'Log'))
    expect(puts(`/nt/api/diary/${TODAY}`)).toHaveLength(0)
    expect(host.querySelector('.portion-sheet')).toBeTruthy()
  })

  it('customUnits: an entry in a custom unit is stored in it, scaled by the numbers alone (NutriTrace\'s ratio)', async () => {
    const settings = { customUnits: [{ abbr: 'shot', full: 'shot glass' }] }
    const log = async food => {
      await mount(<PortionSheet food={food} date={TODAY} meal={0} mealName="Breakfast" close={() => {}} />, settings)
      await click([...host.querySelectorAll('.portion-units [role="radio"]')].find(b => b.textContent === 'shot'))
      await type(host.querySelector('input[aria-label="Serving size"]'), '2')
      await click(buttonSaying(host, 'Log'))
      return puts(`/nt/api/diary/${TODAY}`)[0].body.items[0]
    }
    // Saved per 100 g: 2 shot compares 2 with 100, because a shot has no weight.
    const fromGrams = await log(fixtureFoods()[0])
    expect(fromGrams).toMatchObject({ portion: 2, unit: 'shot' })
    expect(fromGrams.nutrition.calories).toBeCloseTo(7.6, 5)
    // Saved as 1 shot: 2 shot is twice the nutrition.
    const fromShots = await log({ ...fixtureFoods()[0], portion: 1, unit: 'shot', nutrition: { calories: 50 } })
    expect(fromShots).toMatchObject({ portion: 2, unit: 'shot' })
    expect(fromShots.nutrition.calories).toBe(100)
  })

  it('customUnits: the portion sheet offers them, first among the catalogue', async () => {
    const settings = { customUnits: [{ abbr: 'shot', full: 'shot glass' }] }
    expect(unitsFor(fixtureFoods()[0], settings).slice(0, 2)).toEqual(['shot', 'g'])
    await mount(<PortionSheet food={fixtureFoods()[0]} date={TODAY} meal={0} mealName="Breakfast" close={() => {}} />, settings)
    expect([...host.querySelectorAll('.portion-units [role="radio"]')].map(b => b.textContent)).toContain('shot')
  })
})

describe('food sources', () => {
  const search = <FoodSearch onPick={() => {}} />
  const proxy = () => nt.requests.filter(r => r.path === '/nt/api/proxy')

  it('offEnabled: off, the food search has no Open Food Facts group and asks nothing online', async () => {
    await mount(search, { offEnabled: false }, { offSearch: fixtureOffSearch() })
    await type(host.querySelector('input'), 'nutella')
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    expect(host.textContent).not.toContain('Open Food Facts')
    expect(proxy()).toHaveLength(0)
  })

  it('offSearchLanguage: the search asks Open Food Facts in that language', async () => {
    await mount(search, { offSearchLanguage: 'de' }, { offSearch: fixtureOffSearch() })
    await type(host.querySelector('input'), 'nutella')
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    await settle()
    expect(proxy()[0].query.url).toContain('langs=de')
  })

  it('offSearchCountry: a country filters the search itself, inside q, and the hub takes the URL', async () => {
    await mount(search, { offSearchCountry: 'United Kingdom' }, { offSearch: fixtureOffSearch() })
    await type(host.querySelector('input'), 'nutella')
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    await settle()
    const inner = new URL(proxy()[0].query.url)
    expect([...inner.searchParams.keys()].sort()).toEqual(['langs', 'page', 'page_size', 'q'])
    expect(inner.searchParams.get('q')).toBe('nutella +countries_tags:"en:united-kingdom"')
    expect(host.textContent).toContain('Nutella')   // the fake answers 403 for a URL the hub's rule refuses
    await mount(search, { offSearchCountry: 'World' }, { offSearch: fixtureOffSearch() })
    await type(host.querySelector('input'), 'nutella')
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })
    await settle()
    expect(new URL(proxy()[0].query.url).searchParams.get('q')).toBe('nutella')
  })

  it('offSearchCountry: that country\'s products come first, Romania while it is World', () => {
    const data = { products: [
      { code: '1', product_name: 'A', countries_tags: ['en:france'], nutriments: { 'energy-kcal_100g': 100 } },
      { code: '2', product_name: 'B', countries_tags: ['en:united-kingdom'], nutriments: { 'energy-kcal_100g': 100 } },
      { code: '3', product_name: 'C', countries_tags: ['en:romania'], nutriments: { 'energy-kcal_100g': 100 } },
    ] }
    expect(offResults(data, 'en', 'United Kingdom').map(f => f.name)).toEqual(['B', 'A', 'C'])
    expect(offResults(data, 'en', 'World').map(f => f.name)).toEqual(['C', 'A', 'B'])
  })

  it('offEnabled: off, a scanned code that is not in your foods is a miss without a lookup', async () => {
    const { findByBarcode } = await import('../lib/nutrition/barcode.js')
    await mount(<div />, { offEnabled: false })
    expect(await findByBarcode('3017620422003')).toEqual({ kind: 'miss' })
    expect(nt.requests.filter(r => r.path === '/nt/api/proxy')).toHaveLength(0)
  })

  it('barcodeBeep: the camera reading a code beeps only when it is on', async () => {
    camera.hit = { value: '3017620422003', fmt: 'ean13' }
    await mount(<ScanSheet close={() => {}} />, { barcodeBeep: true })
    await click(buttonSaying(host, 'camera sees a code'))
    expect(beep).toHaveBeenLastCalledWith(true, 1040, 0.12)
    await mount(<ScanSheet close={() => {}} />, { barcodeBeep: false })
    await click(buttonSaying(host, 'camera sees a code'))
    expect(beep).toHaveBeenLastCalledWith(false, 1040, 0.12)
  })
})

describe('Foods', () => {
  const foods = () => [
    { ...fixtureFoods()[0], category: 'Pantry', notes: 'Weekday', usage_count: 1 },
    { ...fixtureFoods()[1], category: 'Bakery', usage_count: 9 },
    fixtureFoods()[2],
  ]
  const settings = { foodCategories: ['Pantry', { name: 'Bakery', label: '🥖' }, 'Dairy'] }

  it('foodsSort: the page opens in that order', async () => {
    await mount(<Foods />, { ...settings, foodsSort: 'most' }, { foods: foods() })
    await settle()
    expect(rowNames()).toEqual(['Wholemeal bread', 'Rolled oats', 'Crème fraîche'])
  })

  it('foodsShowCategories, foodsShowLabels and foodsShowNotes: what each row says, and the chips', async () => {
    await mount(<Foods />, settings, { foods: foods() })
    await settle()
    expect(rowOf('Wholemeal bread').querySelector('.ss').textContent).toContain('🥖 Bakery')
    expect(rowOf('Rolled oats').querySelector('.ss').textContent).toContain('Weekday')
    await mount(<Foods />, { ...settings, foodsShowLabels: false, foodsShowNotes: false, foodsShowCategories: true }, { foods: foods() })
    await settle()
    expect(rowOf('Wholemeal bread').querySelector('.ss').textContent).toContain('Bakery')
    expect(rowOf('Wholemeal bread').querySelector('.ss').textContent).not.toContain('🥖')
    expect(rowOf('Rolled oats').querySelector('.ss').textContent).not.toContain('Weekday')
    await mount(<Foods />, { ...settings, foodsShowCategories: false }, { foods: foods() })
    await settle()
    expect(rowOf('Wholemeal bread').querySelector('.ss').textContent).not.toContain('Bakery')
  })

  it('foodCategories: Profile\'s categories are filters even before a food uses them', async () => {
    await mount(<Foods />, settings, { foods: foods() })
    await settle()
    const chips = [...host.querySelectorAll('.chip')].map(c => c.textContent)
    expect(chips).toEqual(expect.arrayContaining(['All', 'Pantry', '🥖 Bakery', 'Dairy']))
  })

  it('offEnabled: off, the Online tab is gone; foodsDefaultSource off opens on it', async () => {
    await mount(<Foods />, { offEnabled: false, foodsDefaultSource: 'off' }, { foods: foods() })
    await settle()
    expect(buttonSaying(host, 'Online')).toBeUndefined()
    expect(rowNames()).toContain('Rolled oats')
    await mount(<Foods />, { offEnabled: true, foodsDefaultSource: 'off' }, { foods: foods() })
    await settle()
    expect(host.textContent).toContain('Type a food to search Open Food Facts.')
  })

  it('mealsSort and recipesSort: Saved meals and Recipes open in that order', async () => {
    const meals = [
      { ...fixtureMeals()[0], name: 'Alpha', usage_count: 1 }, { ...fixtureMeals()[0], id: 23, name: 'Zulu', usage_count: 7 },
    ]
    await mount(<MealCatalog recipes={false} />, { mealsSort: 'most' }, { meals })
    await settle()
    expect(rowNames()).toEqual(['Zulu', 'Alpha'])
    const recipes = [
      { ...fixtureMeals()[1], name: 'Soup', usage_count: 1 }, { ...fixtureMeals()[1], id: 24, name: 'Stew', usage_count: 7 },
    ]
    await mount(<MealCatalog recipes />, { recipesSort: 'most' }, { meals: recipes })
    await settle()
    expect(rowNames()).toEqual(['Stew', 'Soup'])
  })
})
