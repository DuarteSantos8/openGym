// @vitest-environment happy-dom
// Profile's Nutrition pages (ia-proposal §5) against the fake hub, which holds every write to the
// rules of fitness-hub src/nt-body-checks.ts: Water, Foods & scanning, Food sources,
// Categories, Custom units and the rest of Diary & meals. Each save is one
// { key, value } the hub takes, and a refused one keeps what was typed and says so.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { createFakeNutriTrace, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import { featuresFor, pageExists, pageVisible, ROOT_GROUPS, SEARCH, searchSettings } from '../views/settings-pages.js'
import { _setLangState } from '../lib/i18n-core.js'
import { bindUI } from './ui.jsx'
import CustomUnitsSettings from './CustomUnitsSettings.jsx'
import DiaryMealsSettings from './DiaryMealsSettings.jsx'
import FoodCategoriesSettings from './FoodCategoriesSettings.jsx'
import FoodSourcesSettings from './FoodSourcesSettings.jsx'
import FoodsSettings from './FoodsSettings.jsx'
import NtSettingsGate from './NtSettingsGate.jsx'
import WaterSettings from './WaterSettings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PAGES = {
  diary: DiaryMealsSettings, water: WaterSettings, foods: FoodsSettings, sources: FoodSourcesSettings,
  categories: FoodCategoriesSettings, customUnits: CustomUnitsSettings,
}

let host, root, nt, sheets, sheetRoots
const toast = vi.fn()
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) })
const puts = () => nt.requests.filter(r => r.method === 'PUT' && r.path === '/nt/api/settings').map(r => r.body)
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const titles = () => [...host.querySelectorAll('.lrow .lrow-t')].map(e => e.textContent)
const valueOf = title => rowTitled(title).querySelector('.lrow-v').textContent
const switchOf = title => rowTitled(title).querySelector('[role="switch"]')
const click = async el => { await act(async () => { el.click() }); await settle() }

// The sheet the last tap opened, mounted next to the page. `close` is what the sheet was given.
function openedSheet() {
  const render = sheets.at(-1)
  const box = document.createElement('div')
  document.body.appendChild(box)
  const sheetRoot = createRoot(box)
  const close = vi.fn()
  act(() => sheetRoot.render(render(close)))
  sheetRoots.push([sheetRoot, box])
  return { box, close }
}
const sheetBox = () => sheetRoots.at(-1)[1]
const fieldOf = (box, label) => box.querySelector(`input[aria-label="${label}"]`)
const buttonOf = (box, label) => [...box.querySelectorAll('button')].find(b => b.textContent === label)
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const pick = async (title, option) => {
  await click(rowTitled(title))
  const { box } = openedSheet()
  await click([...box.querySelectorAll('button.lrow')].find(b => b.querySelector('.lrow-t')?.textContent === option))
}

// A fresh page over a fresh hub; a second mount in one test starts from nothing, as a new visit.
async function mount(page, settings = {}) {
  act(() => root.render(null))
  useNutrition.getState().reset()
  nt = createFakeNutriTrace({ settings: { timeFormat: '24h', ...settings } })
  vi.stubGlobal('fetch', nt.fetch)
  const Page = PAGES[page]
  act(() => root.render(<NtSettingsGate><Page /></NtSettingsGate>))
  await settle()
}

beforeEach(() => {
  useStore.setState({ user: { id: 3, name: 'Ana' }, pushState: vi.fn(async () => {}) })
  sheets = []
  sheetRoots = []
  useUI.setState({ toast, openSheet: render => { sheets.push(render); return { close: vi.fn() } } })
  bindUI(useUI)
  useNutrition.getState().reset()
  toast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  for (const [r, box] of sheetRoots) { act(() => r.unmount()); box.remove() }
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('Water', () => {
  it('shows NutriTrace\'s defaults until something is saved (no containers), and the unit one write', async () => {
    await mount('water')
    expect(titles()).toEqual(['Water unit', 'Show water in the diary', 'Show water in statistics', 'Add a container'])
    await mount('water', { waterContainers: [{ id: '2', name: 'Standard Bottle', volumeMl: 500 }] })
    expect(rowTitled('Standard Bottle').querySelector('.lrow-s').textContent).toBe('500 ml')
    expect(valueOf('Water unit')).toBe('Milliliters (ml)')
    expect(switchOf('Show water in the diary').getAttribute('aria-checked')).toBe('true')
    await pick('Water unit', 'Fluid ounces (fl oz)')
    expect(puts()).toEqual([{ key: 'waterUnit', value: 'oz' }])
    expect(valueOf('Water unit')).toBe('Fluid ounces (fl oz)')
    expect(rowTitled('Standard Bottle').querySelector('.lrow-s').textContent).toBe('17 fl oz')
  })

  it('switches write waterShowInDiary and waterShowInStats', async () => {
    await mount('water')
    await click(switchOf('Show water in the diary'))
    await click(switchOf('Show water in statistics'))
    expect(puts()).toEqual([{ key: 'waterShowInDiary', value: false }, { key: 'waterShowInStats', value: false }])
  })

  it('adds a container in the unit typed, as whole ml, beside the ones already there', async () => {
    await mount('water', { waterContainers: [{ id: '7', name: 'Mug', volumeMl: 300 }] })
    await click(rowTitled('Add a container'))
    const { box, close } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Flask')
    await type(fieldOf(box, 'Volume'), '1.5')
    await click(buttonOf(box, 'L'))
    await click(buttonOf(box, 'Add'))
    const [write] = puts()
    expect(write.key).toBe('waterContainers')
    expect(write.value).toEqual([{ id: '7', name: 'Mug', volumeMl: 300 }, { id: expect.stringMatching(/^\d+$/), name: 'Flask', volumeMl: 1500 }])
    expect(close).toHaveBeenCalled()
    expect(titles()).toContain('Flask')
  })

  it('a refused add keeps the sheet and what was typed, and a retry sends the same list', async () => {
    await mount('water', { waterContainers: [] })
    await click(rowTitled('Add a container'))
    const { box, close } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Flask')
    await type(fieldOf(box, 'Volume'), '750')
    nt.failNext('PUT', '/nt/api/settings', { status: 400 })
    await click(buttonOf(box, 'Add'))
    expect(close).not.toHaveBeenCalled()
    expect(box.querySelector('[role="alert"]').textContent).toBe('Not saved. Try again.')
    expect(fieldOf(box, 'Name').value).toBe('Flask')
    expect(fieldOf(box, 'Volume').value).toBe('750')
    expect(nt.state.settings.waterContainers).toEqual([])
    await click(buttonOf(box, 'Add'))
    expect(close).toHaveBeenCalled()
    expect(nt.state.settings.waterContainers).toEqual([expect.objectContaining({ name: 'Flask', volumeMl: 750 })])
  })

  it('says what is wrong with a name or a volume and sends nothing', async () => {
    await mount('water')
    await click(rowTitled('Add a container'))
    const { box, close } = openedSheet()
    await click(buttonOf(box, 'Add'))
    expect(box.querySelector('[role="alert"]').textContent).toContain('name')
    await type(fieldOf(box, 'Name'), 'Tank')
    await type(fieldOf(box, 'Volume'), '20000')
    await click(buttonOf(box, 'Add'))
    expect(box.querySelector('[role="alert"]').textContent).toContain('volume')
    expect(puts()).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('removes a container, and a failed removal toasts and leaves it', async () => {
    await mount('water', { waterContainers: [{ id: '1', name: 'Mug', volumeMl: 300 }, { id: '2', name: 'Jug', volumeMl: 900 }] })
    nt.failNext('PUT', '/nt/api/settings', 'offline')
    await click(rowTitled('Mug').querySelector('button'))
    expect(toast).toHaveBeenCalledWith('Not saved: no connection. Try again when you are back online.')
    expect(titles()).toContain('Mug')
    await click(rowTitled('Mug').querySelector('button'))
    expect(puts().at(-1)).toEqual({ key: 'waterContainers', value: [{ id: '2', name: 'Jug', volumeMl: 900 }] })
    expect(titles()).not.toContain('Mug')
  })
})

describe('Foods & scanning', () => {
  it('shows NutriTrace\'s defaults and writes each switch as one key', async () => {
    await mount('foods')
    expect(switchOf('Show categories').getAttribute('aria-checked')).toBe('true')
    expect(switchOf('Beep when a barcode scans').getAttribute('aria-checked')).toBe('false')
    await click(switchOf('Show category labels'))
    await click(switchOf('Beep when a barcode scans'))
    expect(puts()).toEqual([{ key: 'foodsShowLabels', value: false }, { key: 'barcodeBeep', value: true }])
  })

  it('has no flashlight, yesterday\'s meals or other key the hub refuses', async () => {
    await mount('foods')
    expect(titles().join('|')).not.toMatch(/flashlight|yesterday/i)
  })

  it('orders each list with the values the hub takes', async () => {
    await mount('foods')
    await pick('Foods order', 'Most used')
    await pick('Meals order', 'Most recent')
    await pick('Recipes order', 'A to Z')
    expect(puts()).toEqual([{ key: 'foodsSort', value: 'most' }, { key: 'mealsSort', value: 'recent' }, { key: 'recipesSort', value: 'alpha' }])
    expect(valueOf('Foods order')).toBe('Most used')
  })

  it('offers Open Food Facts as a search source only while it is on', async () => {
    await mount('foods', { offEnabled: false })
    await click(rowTitled('Search in'))
    expect([...openedSheet().box.querySelectorAll('.lrow-t')].map(e => e.textContent)).toEqual(['Your foods'])
    useNutrition.getState().reset()
    await mount('foods', { offEnabled: true })
    await pick('Search in', 'Open Food Facts')
    expect(puts()).toEqual([{ key: 'foodsDefaultSource', value: 'off' }])
  })

  it('a refused save leaves the switch as it was', async () => {
    await mount('foods')
    nt.failNext('PUT', '/nt/api/settings', { status: 400 })
    await click(switchOf('Beep when a barcode scans'))
    expect(toast).toHaveBeenCalledWith('Not saved. Try again.')
    expect(switchOf('Beep when a barcode scans').getAttribute('aria-checked')).toBe('false')
  })
})

describe('Food sources', () => {
  it('has the Open Food Facts switch, and its language, country and portion only while it is on', async () => {
    await mount('sources')
    expect(titles()).toEqual(['Search Open Food Facts', 'Search language', 'Search country'])
    await click(switchOf('Search Open Food Facts'))
    expect(puts()).toEqual([{ key: 'offEnabled', value: false }])
    expect(titles()).toEqual(['Search Open Food Facts'])
  })

  it('writes the language as two letters and the country by its English name', async () => {
    await mount('sources')
    expect(valueOf('Search country')).toBe('Worldwide')
    await pick('Search language', 'German')
    await pick('Search country', 'Germany')
    expect(puts()).toEqual([{ key: 'offSearchLanguage', value: 'de' }, { key: 'offSearchCountry', value: 'Germany' }])
    expect(valueOf('Search language')).toBe('German')
  })

  it('has no login, key or USDA row: the hub lets none of them through', async () => {
    await mount('sources')
    expect(titles().join('|')).not.toMatch(/usda|password|username|key/i)
  })
})

describe('Categories', () => {
  it('adds a name alone as a plain string and a labelled one as { name, label }', async () => {
    await mount('categories')
    await click(rowTitled('Add a category'))
    let { box } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Dairy')
    await click(buttonOf(box, 'Add'))
    await click(rowTitled('Add a category'))
    ;({ box } = openedSheet())
    await type(fieldOf(box, 'Name'), 'Fruit')
    await type(fieldOf(box, 'Label (an emoji, optional)'), '🍎')
    await click(buttonOf(box, 'Add'))
    expect(puts()).toEqual([
      { key: 'foodCategories', value: ['Dairy'] },
      { key: 'foodCategories', value: ['Dairy', { name: 'Fruit', label: '🍎' }] },
    ])
    expect(titles()).toEqual(['Dairy', '🍎 Fruit', 'Add a category'])
  })

  it('refuses a repeated name and a label over 16 characters before asking the hub', async () => {
    await mount('categories', { foodCategories: ['Dairy'] })
    await click(rowTitled('Add a category'))
    const { box } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Dairy')
    await click(buttonOf(box, 'Add'))
    expect(box.querySelector('[role="alert"]').textContent).toBe('You already have a category with that name.')
    expect(puts()).toEqual([])
  })

  it('removes one whichever shape it is stored in, and writes the rest in the shapes NutriTrace uses', async () => {
    await mount('categories', { foodCategories: ['Dairy', { name: 'Fruit', label: '🍎' }, { name: 'Veg', label: '' }] })
    await click(rowTitled('Dairy').querySelector('button'))
    expect(puts()).toEqual([{ key: 'foodCategories', value: [{ name: 'Fruit', label: '🍎' }, 'Veg'] }])
  })
})

describe('Custom units', () => {
  it('adds { abbr, full }, the full name defaulting to the abbreviation', async () => {
    await mount('customUnits')
    await click(rowTitled('Add a custom unit'))
    let { box } = openedSheet()
    await type(fieldOf(box, 'Abbreviation'), 'shot')
    await type(fieldOf(box, 'Full name (optional)'), 'shot glass')
    await click(buttonOf(box, 'Add'))
    await click(rowTitled('Add a custom unit'))
    ;({ box } = openedSheet())
    await type(fieldOf(box, 'Abbreviation'), 'scoop')
    await click(buttonOf(box, 'Add'))
    expect(puts().at(-1)).toEqual({ key: 'customUnits', value: [{ abbr: 'shot', full: 'shot glass' }, { abbr: 'scoop', full: 'scoop' }] })
    expect(rowTitled('shot glass').querySelector('.lrow-s').textContent).toBe('shot')
  })

  it('refuses a unit the built-in list has, with no request, and keeps the typing', async () => {
    await mount('customUnits')
    await click(rowTitled('Add a custom unit'))
    const { box, close } = openedSheet()
    await type(fieldOf(box, 'Abbreviation'), 'Cup')
    await click(buttonOf(box, 'Add'))
    expect(box.querySelector('[role="alert"]').textContent).toBe('That unit is already in the list.')
    expect(fieldOf(box, 'Abbreviation').value).toBe('Cup')
    expect(puts()).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('removes one and drops a gram weight an older client may have stored', async () => {
    await mount('customUnits', { customUnits: [{ abbr: 'shot', full: 'shot glass' }, { abbr: 'stick', grams: 8 }] })
    await click(rowTitled('shot glass').querySelector('button'))
    expect(puts()).toEqual([{ key: 'customUnits', value: [{ abbr: 'stick', full: 'stick' }] }])
  })
})

describe('Diary & meals', () => {
  it('shows NutriTrace\'s defaults and writes each switch as one key', async () => {
    await mount('diary')
    expect(switchOf('Show brand names').getAttribute('aria-checked')).toBe('true')
    expect(switchOf('Show time logged').getAttribute('aria-checked')).toBe('false')
    await click(switchOf('Show time logged'))
    await click(switchOf('Show macro summary'))
    await click(switchOf('Ask for quantity when adding'))
    expect(puts()).toEqual([
      { key: 'diaryShowTimestamps', value: true }, { key: 'diaryShowMacroSummary', value: false }, { key: 'diaryPromptQuantity', value: false },
    ])
  })

  it('has none of NutriTrace\'s options Gains has no screen for', async () => {
    await mount('diary')
    expect(titles().join('|')).not.toMatch(/photos|every nutrient|nutrition units|portion size|day notes|completion|unit details|conversions/)
  })

  it('the default field is one of the two the hub takes', async () => {
    await mount('diary')
    expect(valueOf('Quantity starts in')).toBe('Number of servings')
    await pick('Quantity starts in', 'Serving size')
    expect(puts()).toEqual([{ key: 'diaryDefaultField', value: 'portion' }])
  })

  it('writes how quick calories show and whether they are offered', async () => {
    await mount('diary')
    await pick('Quick calories shown', 'One row each')
    await click(switchOf('Show quick calories'))
    expect(puts()).toEqual([{ key: 'quickCaloriesDisplay', value: 'separate' }, { key: 'showQuickCalories', value: false }])
  })

  it('asks which wins, wearable or manual, only when activity counts toward the target', async () => {
    await mount('diary', { diaryShowActivity: true, calorieAdjustFromActivity: false })
    expect(titles()).not.toContain('Wearable and manual entries')
    useNutrition.getState().reset()
    await mount('diary', { diaryShowActivity: true, calorieAdjustFromActivity: true })
    await pick('Wearable and manual entries', 'Add them')
    expect(puts()).toEqual([{ key: 'manualActivityPolicy', value: 'additive' }])
  })

  it('lists the meals, and a tap renames one: the list is written whole', async () => {
    await mount('diary', { mealNames: ['Breakfast', 'Lunch', 'Dinner'] })
    await click(rowTitled('Lunch'))
    const { box, close } = openedSheet()
    expect(fieldOf(box, 'Name').value).toBe('Lunch')
    await type(fieldOf(box, 'Name'), 'Brunch')
    await click(buttonOf(box, 'Save'))
    expect(puts()).toEqual([{ key: 'mealNames', value: ['Breakfast', 'Brunch', 'Dinner'] }])
    expect(close).toHaveBeenCalled()
    expect(titles()).toEqual(expect.arrayContaining(['Breakfast', 'Brunch', 'Dinner']))
  })

  it('adds a meal at the end, moves one and removes one', async () => {
    await mount('diary', { mealNames: ['Breakfast', 'Lunch', 'Dinner'] })
    await click(rowTitled('Add a meal'))
    let { box } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Supper')
    await click(buttonOf(box, 'Save'))
    await click(rowTitled('Dinner'))
    ;({ box } = openedSheet())
    await click(buttonOf(box, 'Move up'))
    await click(rowTitled('Breakfast'))
    ;({ box } = openedSheet())
    await click(buttonOf(box, 'Remove'))
    expect(puts()).toHaveLength(2)   // asked first: what was logged under it moves
    expect(openedSheet().box.textContent).toContain('What was logged under it moves to the meal that takes its place.')
    await click(buttonOf(sheetBox(), 'Remove'))
    expect(puts().map(p => p.value)).toEqual([
      ['Breakfast', 'Lunch', 'Dinner', 'Supper'], ['Breakfast', 'Dinner', 'Lunch', 'Supper'], ['Dinner', 'Lunch', 'Supper'],
    ])
  })

  it('shows the default meal names in the app\'s language and saves them as shown once the list changes', async () => {
    await mount('diary', { mealNames: undefined })
    expect(titles()).toEqual(expect.arrayContaining(['Breakfast', 'Lunch', 'Dinner', 'Snacks']))
    await click(rowTitled('Snacks'))
    const { box } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Evening')
    await click(buttonOf(box, 'Save'))
    expect(puts()).toEqual([{ key: 'mealNames', value: ['Breakfast', 'Lunch', 'Dinner', 'Evening'] }])
  })

  it('keeps one meal, and a refused save keeps the sheet and the name', async () => {
    await mount('diary', { mealNames: ['Only'] })
    await click(rowTitled('Only'))
    const { box, close } = openedSheet()
    expect(buttonOf(box, 'Remove').disabled).toBe(true)
    await type(fieldOf(box, 'Name'), 'Everything')
    nt.failNext('PUT', '/nt/api/settings', { status: 400 })
    await click(buttonOf(box, 'Save'))
    expect(box.querySelector('[role="alert"]').textContent).toBe('Not saved. Try again.')
    expect(fieldOf(box, 'Name').value).toBe('Everything')
    expect(close).not.toHaveBeenCalled()
  })

  it('still writes the default fasting plan, and only while fasting is on', async () => {
    await mount('diary', { fastingEnabled: true, fastingDefaultHours: 16 })
    await pick('Default fasting plan', '20:4')
    expect(puts()).toEqual([{ key: 'fastingDefaultHours', value: 20 }])
  })
})

describe('a list is changed over what the server has now, not over what the page loaded', () => {
  it('meal names: a meal added in NutriTrace after the page loaded survives a rename here', async () => {
    await mount('diary', { mealNames: ['Breakfast', 'Lunch', 'Dinner'] })
    nt.state.settings.mealNames = ['Breakfast', 'Lunch', 'Dinner', 'Supper']
    await click(rowTitled('Lunch'))
    const { box } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Brunch')
    await click(buttonOf(box, 'Save'))
    expect(puts()).toEqual([{ key: 'mealNames', value: ['Breakfast', 'Brunch', 'Dinner', 'Supper'] }])
  })

  it('meal names: a meal that is no longer where it was is not renamed over another one', async () => {
    await mount('diary', { mealNames: ['Breakfast', 'Lunch', 'Dinner'] })
    nt.state.settings.mealNames = ['Breakfast', 'Dinner', 'Lunch']
    await click(rowTitled('Lunch'))
    const { box, close } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Brunch')
    await click(buttonOf(box, 'Save'))
    expect(puts()).toEqual([])
    expect(box.querySelector('[role="alert"]').textContent).toBe('The meals changed somewhere else. Close this and open it again.')
    expect(close).not.toHaveBeenCalled()
  })

  it('water containers: a container added elsewhere survives removing another', async () => {
    await mount('water', { waterContainers: [{ id: '1', name: 'Mug', volumeMl: 300 }] })
    nt.state.settings.waterContainers = [{ id: '1', name: 'Mug', volumeMl: 300 }, { id: '2', name: 'Pot', volumeMl: 900 }]
    await click(rowTitled('Mug').querySelector('button'))
    expect(puts()).toEqual([{ key: 'waterContainers', value: [{ id: '2', name: 'Pot', volumeMl: 900 }] }])
  })

  it('categories and custom units: an add keeps what was added elsewhere', async () => {
    await mount('categories', { foodCategories: ['Dairy'] })
    nt.state.settings.foodCategories = ['Dairy', 'Fish']
    await click(rowTitled('Add a category'))
    let { box } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Fruit')
    await click(buttonOf(box, 'Add'))
    expect(puts().at(-1)).toEqual({ key: 'foodCategories', value: ['Dairy', 'Fish', 'Fruit'] })
    await mount('customUnits', { customUnits: [{ abbr: 'shot', full: 'shot' }] })
    nt.state.settings.customUnits = [{ abbr: 'shot', full: 'shot' }, { abbr: 'scoop', full: 'scoop' }]
    await click(rowTitled('Add a custom unit'))
    ;({ box } = openedSheet())
    await type(fieldOf(box, 'Abbreviation'), 'stick')
    await click(buttonOf(box, 'Add'))
    expect(puts().at(-1).value.map(u => u.abbr)).toEqual(['shot', 'scoop', 'stick'])
  })

  it('a page asks again when it opens, so it shows what NutriTrace has now', async () => {
    await mount('water', { waterContainers: [{ id: '1', name: 'Mug', volumeMl: 300 }] })
    nt.state.settings.waterContainers = [{ id: '1', name: 'Mug', volumeMl: 300 }, { id: '2', name: 'Pot', volumeMl: 900 }]
    act(() => root.render(null))
    act(() => root.render(<NtSettingsGate><WaterSettings /></NtSettingsGate>))
    await settle()
    expect(titles()).toContain('Pot')
  })

  it('a failed re-read saves nothing and says so', async () => {
    await mount('categories', { foodCategories: ['Dairy'] })
    await click(rowTitled('Add a category'))
    const { box, close } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Fruit')
    nt.failNext('GET', '/nt/api/settings', 'offline')
    await click(buttonOf(box, 'Add'))
    expect(puts()).toEqual([])
    expect(box.querySelector('[role="alert"]').textContent).toBe('Not saved: no connection. Try again when you are back online.')
    expect(close).not.toHaveBeenCalled()
  })
})

describe('meal names only save what was typed', () => {
  const FR = { Breakfast: 'Petit-déjeuner', Lunch: 'Déjeuner', Dinner: 'Dîner', Snacks: 'Collations' }
  afterEach(() => _setLangState('en', {}))

  it('the default names show translated and stay NutriTrace\'s own when another meal is renamed', async () => {
    _setLangState('fr', FR)
    await mount('diary', { mealNames: undefined })
    expect(titles()).toEqual(expect.arrayContaining(['Petit-déjeuner', 'Déjeuner', 'Dîner', 'Collations']))
    await click(rowTitled('Collations'))
    const { box } = openedSheet()
    await type(fieldOf(box, 'Name'), 'Soir')
    await click(buttonOf(box, 'Save'))
    expect(puts()).toEqual([{ key: 'mealNames', value: ['Breakfast', 'Lunch', 'Dinner', 'Soir'] }])
  })

  it('saving a default name without changing it does not make the translation the saved name', async () => {
    _setLangState('fr', FR)
    await mount('diary', { mealNames: undefined })
    await click(rowTitled('Déjeuner'))
    const { box } = openedSheet()
    await click(buttonOf(box, 'Move up'))
    expect(puts()).toEqual([{ key: 'mealNames', value: ['Lunch', 'Breakfast', 'Dinner', 'Snacks'] }])
    await mount('diary', { mealNames: undefined })
    await click(rowTitled('Déjeuner'))
    await click(buttonOf(openedSheet().box, 'Save'))
    expect(puts().at(-1)).toEqual({ key: 'mealNames', value: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] })
  })
})

describe('Foods & scanning › Search in', () => {
  it('offers your foods and Open Food Facts, not the sources that do the same as your foods', async () => {
    await mount('foods', { offEnabled: true })
    await click(rowTitled('Search in'))
    expect([...openedSheet().box.querySelectorAll('.lrow-t')].map(e => e.textContent)).toEqual(['Your foods', 'Open Food Facts'])
  })

  it('shows a stored legacy value, marked, while it is the stored one', async () => {
    await mount('foods', { foodsDefaultSource: 'usda' })
    expect(valueOf('Search in')).toBe('USDA (legacy)')
    await mount('foods', { foodsDefaultSource: 'all' })
    expect(valueOf('Search in')).toBe('All sources (legacy)')
  })
})

describe('the remove buttons', () => {
  it('are named, with a 48px hit area class, not a small button', async () => {
    await mount('water', { waterContainers: [{ id: '1', name: 'Mug', volumeMl: 300 }] })
    const remove = rowTitled('Mug').querySelector('button')
    expect(remove.getAttribute('aria-label')).toBe('Remove Mug')
    expect(remove.className).toBe('iconbtn')
  })
})

describe('the Nutrition group, the search and Features', () => {
  const web = { user: { id: 'u' }, mobile: false, nutrition: true }
  const NEW_PAGES = ['water', 'foods', 'sources', 'categories', 'customUnits']

  it('puts every page in the Nutrition group, on the web app signed in only', () => {
    expect(ROOT_GROUPS.find(g => g.title === 'Nutrition').ids).toEqual(['goals', 'diary', ...NEW_PAGES])
    for (const id of NEW_PAGES) {
      expect(pageVisible(id, web), id).toBe(true)
      expect(pageVisible(id, { ...web, nutrition: false }), id).toBe(false)
      expect(pageExists(id, { user: { id: 'u' }, mobile: false }), id).toBe(true)
      expect(pageExists(id, { user: { id: 'u' }, mobile: true }), id).toBe(false)
      expect(pageExists(id, { user: null, mobile: false }), id).toBe(false)
    }
  })

  it('every search entry on these pages is a row on the page', async () => {
    const settings = { ...fixtureSettings(), calorieAdjustFromActivity: true, diaryShowActivity: true, fastingEnabled: true, offEnabled: true, showQuickCalories: true }
    for (const page of Object.keys(PAGES)) {
      await mount(page, settings)
      const ctx = { ...web, ntSettings: nt.state.settings, fastingOn: true }
      const want = SEARCH.filter(e => e.page === page && (!e.when || e.when(ctx))).map(e => e.title)
      expect(want.length, page).toBeGreaterThan(0)
      for (const title of want) expect(titles(), `${page}: ${title}`).toContain(title)
    }
  })

  it('every switch these pages show off in a new account is on Features, and says whether it is on', async () => {
    // A new account has saved nothing: the switches that read off are NutriTrace's defaults.
    const off = new Set()
    for (const page of Object.keys(PAGES)) {
      await mount(page, {})
      for (const row of host.querySelectorAll('.lrow')) {
        if (row.querySelector('[role="switch"][aria-checked="false"]')) off.add(page + ':' + row.querySelector('.lrow-t').textContent)
      }
    }
    const ctx = { ...web, ntSettings: {} }
    const listed = featuresFor(ctx).map(e => e.page + ':' + e.title).filter(k => k.split(':')[0] in PAGES)
    expect(new Set(listed)).toEqual(off)
    expect([...off].sort()).toEqual(['diary:Show activity under meals', 'diary:Show time logged', 'foods:Beep when a barcode scans'])
    const entry = featuresFor(ctx).find(e => e.title === 'Beep when a barcode scans')
    expect(entry.feature({}, { ntSettings: { barcodeBeep: true } })).toBe(true)
    expect(entry.feature({}, ctx)).toBe(false)
    expect(entry.feature({}, {})).toBeNull()
  })

  it('the search finds the pages and their rows', () => {
    const tr = s => s
    expect(searchSettings('water', web, tr)[0]).toMatchObject({ page: 'water', isPage: true })
    expect(searchSettings('open food facts', web, tr).map(h => h.title)).toEqual(expect.arrayContaining(['Food sources', 'Search Open Food Facts']))
    expect(searchSettings('emoji', web, tr).map(h => h.title)).toContain('Add a category')
    expect(searchSettings('scoop', web, tr).map(h => h.title)).toContain('Add a custom unit')
    expect(searchSettings('barcode', web, tr).map(h => h.title)).toContain('Beep when a barcode scans')
    expect(searchSettings('water', { ...web, nutrition: false }, tr)).toEqual([])
  })

  it('hides the rows that depend on another switch, as the page does', () => {
    const tr = s => s
    expect(searchSettings('search language', { ...web, ntSettings: { offEnabled: false } }, tr).map(h => h.title)).not.toContain('Search language')
    expect(searchSettings('search language', { ...web, ntSettings: {} }, tr).map(h => h.title)).toContain('Search language')
    expect(searchSettings('wearable manual', { ...web, ntSettings: { diaryShowActivity: true } }, tr).map(h => h.title)).not.toContain('Wearable and manual entries')
  })
})
