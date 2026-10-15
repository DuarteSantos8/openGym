// @vitest-environment happy-dom
// Barcode scanning: the + sheet's Scan tile and the picker's barcode button, down to the food
// logged. The camera is mocked (it hands the sheet a code); the lookups run against NutriTrace
// faked at the fetch boundary, under the hub's rules for the proxy.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { createFakeNutriTrace, fixtureDay, fixtureOffProduct } from '../lib/nutrition/fake-nutritrace.js'
import { openPlusSheet } from './PlusSheet.jsx'
import FoodPicker from './FoodPicker.jsx'

// The camera hands over whatever the test queues; it is a button in place of a live feed.
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
const settle = async (ms = 0) => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const mount = async el => { await act(async () => { root.render(<>{el}<Sheets /></>) }); await settle() }
const button = (label, scope = host) => [...scope.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === label)
const click = async el => { await act(async () => { el.click() }); await settle() }
const lastSheet = () => [...host.querySelectorAll('[data-sheet]')].at(-1)
const typeInto = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}
const scan = async value => { camera.hit = { value, fmt: 'ean13' }; await click(button('camera sees a code', lastSheet())) }
const proxyCalls = () => nt.requests.filter(r => r.path === '/nt/api/proxy')
const openScan = async () => {
  await mount(<div />)
  await act(async () => { openPlusSheet('/home') })
  await settle()
  await click(button('Scan', lastSheet()))
}

beforeEach(() => {
  nt = createFakeNutriTrace({ days: { [TODAY]: fixtureDay(TODAY) }, offProducts: { '3017620422003': fixtureOffProduct('3017620422003'), '0036000291452': fixtureOffProduct('0036000291452') } })
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg' },
  }))
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  camera.hit = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('scanning a product', () => {
  it('logs one of your own foods straight from its barcode, with no lookup', async () => {
    await openScan()
    await scan('5000000000001')
    expect(lastSheet().textContent).toContain('Wholemeal bread')
    expect(lastSheet().textContent).toContain('One of your foods')
    expect(proxyCalls()).toEqual([])
    await click(button('Log', lastSheet()))
    // The portion sheet, as for a food picked from the list.
    expect(lastSheet().textContent).toContain('Serving size')
    await click(button('Log', lastSheet()))
    const put = nt.writes().find(r => r.method === 'PUT')
    expect(put.path).toBe(`/nt/api/diary/${TODAY}`)
    expect(put.body.items.at(-1)).toMatchObject({ name: 'Wholemeal bread', food_server_id: 12, quantity: 1 })
    expect(nt.writes().some(r => r.path === '/nt/api/foods')).toBe(false)
  })

  it('an own food saved under the UPC form still matches the EAN scan', async () => {
    nt.state.foods[1].barcode = '5000000000001'
    await openScan()
    await scan('05000000000001')
    expect(lastSheet().textContent).toContain('Wholemeal bread')
  })

  it('looks up a product Open Food Facts knows and logs it, saving it as one of your foods first', async () => {
    await openScan()
    await scan('3017620422003')
    expect(lastSheet().textContent).toContain('Nutella')
    expect(lastSheet().textContent).toContain('From Open Food Facts')
    expect(proxyCalls().length).toBe(1)
    expect(proxyCalls()[0].query.url).toBe('https://world.openfoodfacts.org/api/v3/product/3017620422003?lc=en')
    await click(button('Log', lastSheet()))
    await click(button('Log', lastSheet()))
    const saved = nt.writes().find(r => r.path === '/nt/api/foods')
    expect(saved.body).toMatchObject({ name: 'Nutella', barcode: '3017620422003', visibility: 'private' })
    expect(saved.body).not.toHaveProperty('imgUrl')
    expect(nt.writes().find(r => r.method === 'PUT').body.items.at(-1)).toMatchObject({ name: 'Nutella' })
  })

  it('saves a product as a food without logging it', async () => {
    await openScan()
    await scan('3017620422003')
    await click(button('Save to my foods', lastSheet()))
    expect(nt.writes().map(r => `${r.method} ${r.path}`)).toEqual(['POST /nt/api/foods'])
    expect(button('Saved', lastSheet()).disabled).toBe(true)
    expect(nt.writes().some(r => r.method === 'PUT')).toBe(false)
    expect(useNutrition.getState().foods.list.some(f => f.barcode === '3017620422003')).toBe(true)
  })

  it('an 8-digit UPC-E is expanded to its UPC-A, then the EAN-13, before the lookup', async () => {
    await openScan()
    await scan('04252614')
    expect(proxyCalls()[0].query.url).toContain('/product/0042100005264?')
  })

  it('announces each step and moves focus to its heading', async () => {
    await openScan()
    await scan('3017620422003')
    const hit = lastSheet().querySelector('.scan-hit')
    expect(hit.getAttribute('role')).toBe('status')
    expect(document.activeElement).toBe(hit.querySelector('.tt'))
    await click(button('Scan another', lastSheet()))
    expect(document.activeElement.tagName).toBe('H3')
    await scan('9999999999999')
    expect(document.activeElement).toBe(lastSheet().querySelector('.scan-hit .tt'))
  })

  it('a 12-digit UPC-A is looked up as the EAN-13 Open Food Facts files it under', async () => {
    await openScan()
    await scan('036000291452')
    expect(proxyCalls()[0].query.url).toContain('/product/0036000291452?')
    expect(lastSheet().textContent).toContain('Nutella')
  })

  it('a barcode nobody knows says so and offers search and a quick kcal', async () => {
    await openScan()
    await scan('9999999999999')
    expect(lastSheet().textContent).toContain('No product found for 9999999999999')
    expect(button('Search foods', lastSheet())).toBeTruthy()
    expect(button('Quick kcal', lastSheet())).toBeTruthy()
    await click(button('Search foods', lastSheet()))
    expect(lastSheet().textContent).toContain('Log food')
  })

  it('a miss opens the create-food sheet with the scanned barcode filled in', async () => {
    await openScan()
    await scan('9999999999999')
    await click(button('New food', lastSheet()))
    const field = [...lastSheet().querySelectorAll('input')].find(i => i.value === '9999999999999')
    expect(field).toBeTruthy()
    await typeInto([...lastSheet().querySelectorAll('input')][0], 'Mystery bar')
    await click(button('Save', lastSheet()))
    const post = nt.writes().find(w => w.method === 'POST' && w.path === '/nt/api/foods')
    expect(post.body).toMatchObject({ name: 'Mystery bar', barcode: '9999999999999' })
  })

  it('a product listed without calories cannot be logged and says why', async () => {
    const bare = fixtureOffProduct('1234567890128')
    bare.product.nutriments = { proteins_100g: 3 }
    nt = createFakeNutriTrace({ offProducts: { '1234567890128': bare } })
    vi.stubGlobal('fetch', nt.fetch)
    await openScan()
    await scan('1234567890128')
    expect(lastSheet().textContent).toContain('No energy value for 1234567890128')
    expect(button('Log', lastSheet())).toBeUndefined()
  })

  it('a lookup that fails is not a miss: it says so and tries again', async () => {
    await openScan()
    nt.failNext('GET', '/nt/api/proxy', 'offline')
    await scan('3017620422003')
    expect(lastSheet().querySelector('[role="alert"]').textContent).toBe('The lookup did not go through: no connection.')
    await click(button('Try again', lastSheet()))
    expect(lastSheet().textContent).toContain('Nutella')
  })

  it('too many lookups asks to wait', async () => {
    await openScan()
    nt.failNext('GET', '/nt/api/proxy', { status: 429 })
    await scan('3017620422003')
    expect(lastSheet().querySelector('[role="alert"]').textContent).toBe('Too many lookups. Wait a minute and try again.')
  })

  it('types a code when there is no camera, and refuses what is not a barcode', async () => {
    await openScan()
    const field = lastSheet().querySelector('input[aria-label="Barcode"]')
    await typeInto(field, 'hello')
    await click(button('Look up', lastSheet()))
    expect(lastSheet().querySelector('[role="alert"]').textContent).toBe('That is not a product barcode.')
    expect(proxyCalls()).toEqual([])
    await typeInto(field, '3017 6204 22003')
    await click(button('Look up', lastSheet()))
    expect(lastSheet().textContent).toContain('Nutella')
  })

  it('Scan another goes back to the camera', async () => {
    await openScan()
    await scan('9999999999999')
    await click(button('Scan another', lastSheet()))
    expect(button('camera sees a code', lastSheet())).toBeTruthy()
  })
})

describe('the picker', () => {
  it('has a barcode button in its search field that scans for the same date and meal', async () => {
    await mount(<FoodPicker date={TODAY} meal={2} mealName="Dinner" />)
    await click(button('Scan a barcode'))
    await scan('5000000000001')
    await click(button('Log', lastSheet()))
    await click(button('Log', lastSheet()))
    expect(nt.writes().find(r => r.method === 'PUT').body.items.at(-1)).toMatchObject({ name: 'Wholemeal bread', meal: 2 })
  })
})
