// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ config: {}, result: null, calls: [], navs: [], S: null, user: null }))
vi.mock('../store/useStore.js', async () => {
  const React = await import('react')
  // A working store: update() runs the mutator on a copy and re-renders, like the real one.
  let listeners = new Set()
  const update = mut => { const S = structuredClone(mocks.S); mut(S); mocks.S = S; listeners.forEach(f => f()) }
  const useStore = selector => {
    const [, tick] = React.useReducer(x => x + 1, 0)
    React.useEffect(() => { listeners.add(tick); return () => listeners.delete(tick) }, [])
    return selector({ S: mocks.S, config: mocks.config, user: mocks.user, update })
  }
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: () => {} }) }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async url => {
    mocks.calls.push(url)
    if (mocks.result instanceof Error) throw mocks.result
    return mocks.result
  })
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => path => mocks.navs.push(path) }))
vi.mock('../components/Icon.jsx', () => ({ default: () => null }))
vi.mock('motion/react', async () => {
  const React = await import('react')
  return { motion: { header: ({ initial, animate, transition, ...rest }) => React.createElement('header', rest) },
    useReducedMotion: () => true }
})
import Addons from './Addons.jsx'

let host, root
beforeEach(() => {
  Object.assign(mocks, { config: {}, result: null, calls: [], navs: [], S: { workouts: [], unit: 'kg' }, user: { id: 'u1' } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => act(async () => { root.render(<Addons />) })
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('Add-on lab is opt-in and read-only', () => {
  it('does not enable third-party lookups without the server flag', async () => {
    await mount()
    expect(host.textContent).toContain('Nutrition lookup')
    expect(host.textContent).toContain('ADDON_NUTRITION=1')
    expect(host.querySelector('button[data-lookup]').disabled).toBe(true)
    expect(mocks.calls).toEqual([])
    expect(host.textContent).toContain('preview only')
  })

  it('lookup is user-initiated and displays data without saving to workout state', async () => {
    mocks.config = { addons: { nutrition: true } }
    mocks.result = { food: { name: 'Test yogurt', barcode: '3017620422003',
      brand: 'Example', quantity: '100 g', grade: 'B', serving: '50 g',
      per100: { kcal: 0, proteinG: 5, carbohydrateG: 6, fatG: 1, sugarG: 2 },
      allergens: ['milk'], source: 'Open Food Facts' } }
    await mount()
    const input = host.querySelector('input[name=barcode]')
    expect(mocks.calls).toEqual([])
    type(input, '3017620422003')
    await act(async () => host.querySelector('button[data-lookup]').click())
    expect(mocks.calls).toEqual(['/api/addons/food?barcode=3017620422003'])
    expect(host.textContent).toContain('Test yogurt')
    expect(host.textContent).toContain('0 kcal')
  })
})

describe('Add-on lab navigation and labelling', () => {
  it('says what the nutrients are per, from the basis the server sends', async () => {
    mocks.config = { addons: { nutrition: true } }
    mocks.result = { food: { name: 'Cola', barcode: '5449000000996', per100: { kcal: 44, proteinG: 0, carbohydrateG: 10.9, fatG: 0, sugarG: 10.9 }, basis: '100ml', allergens: [] } }
    await mount()
    type(host.querySelector('input[name=barcode]'), '5449000000996')
    await act(async () => host.querySelector('button[data-lookup]').click())
    expect(host.querySelector('[data-basis]').textContent).toBe('Values per 100 mL, as the label states.')
  })

  it('the back button goes up to Settings → Integrations when nothing is behind it', async () => {
    await mount()
    await act(async () => host.querySelector('.addons-back').click())
    expect(mocks.navs).toEqual(['/settings/integrations'])
  })
})

describe('a looked-up product goes into the diary', () => {
  it('logs the amount eaten, at the meal picked, with its source', async () => {
    mocks.config = { addons: { nutrition: true } }
    mocks.result = { food: { name: 'Nutella', barcode: '3017620422003', brand: 'Ferrero', basis: '100g',
      per100: { kcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9, sugarG: 56.3 }, allergens: [] } }
    await mount()
    type(host.querySelector('input[name=barcode]'), '3017620422003')
    await act(async () => host.querySelector('button[data-lookup]').click())
    type(host.querySelector('input[name=log-amount]'), '15')
    await act(async () => host.querySelector('button[data-log-lookup]').click())
    const entries = Object.values(mocks.S.foodLog)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Nutella', amount: 15, basis: 'g', meal: 'snack', src: { kind: 'off', code: '3017620422003' } })
    expect(host.querySelector('.diary').textContent).toContain('81 kcal')
    expect(host.textContent).toContain('Logged 15 g of Nutella to snacks.')
  })
})

describe('the training-volume card counts volume the way the rest of the app does', () => {
  it('uses the logged sets (sessionVolume), not a cached total that went stale', async () => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    // 3 x 100 kg = 300 kg from the sets; the cached `vol` (999) is from before an edit.
    mocks.S = { unit: 'kg', workouts: [{ id: 'w1', d: today, start: 1, vol: 999,
      entries: [{ id: '0025', sets: [{ w: 100, r: 3, done: true }] }] }] }
    await mount()
    const card = host.querySelector('.addon-trends')
    expect(card.textContent).toContain('300 kg of recorded training volume')
    expect(card.textContent).not.toContain('999')
  })
})

describe('after sign-out', () => {
  // Signing out clears the user but keeps the server config the signed-in session fetched, so the
  // signed-in-only add-ons must check the user, not the config alone (the API would answer 401).
  it('a guest gets neither the nutrition lookup nor the NutriTrace card, whatever config says', async () => {
    mocks.user = null
    mocks.config = { addons: { nutrition: true }, integrations: { providers: ['nutritrace'] } }
    await mount()
    expect(host.querySelector('button[data-lookup]').disabled).toBe(true)
    expect(host.querySelector('section[aria-labelledby=nt-title]')).toBe(null)
    expect(mocks.calls).toEqual([])
  })
})
