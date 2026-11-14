// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => { throw new Error('offline') }) }))
import Nutrition from './Nutrition.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { isOn } from '../lib/modules.js'
import { localDay, createEntry } from '../lib/nutrition/entry.js'
import { setWeightDecimals } from '../lib/format.js'
import { visibleOptionalEntries } from '../lib/sync-merge.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const visible = () => visibleOptionalEntries(useStore.getState().S, 'nutritionEntries')
const render = async node => act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>))
const click = async text => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text).click())
const input = async (name, value) => act(async () => {
  const el = host.querySelector(`[name="${name}"]`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
beforeEach(() => {
  localStorage.clear(); useUI.setState({ sheets: [] })
  useStore.setState({ S: { ...structuredClone(DEF), modules: { nutrition: true } }, user: null, ready: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState({ ready: false }); useUI.setState({ sheets: [] }) })
test('nutrition is off by default and a disabled view renders no diary', async () => {
  expect(isOn({}, 'nutrition')).toBe(false)
  useStore.setState({ S: { ...structuredClone(DEF) } })
  await render(<Nutrition />)
  expect(host.textContent).toBe('')
})
test('add, edit without scaling nutrients, delete and undo use persisted store records', async () => {
  await render(<Nutrition />); await click('Add food')
  let sheet = useUI.getState().sheets.at(-1)
  await render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
  expect(host.textContent).toContain('Totals for this entry')
  await input('label', 'Oats'); await input('amount', '100'); await input('energyKcal', '200')
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(visible()[0]).toMatchObject({ label: 'Oats', amountG: 100, energyKcal: 200, day: localDay() })
  await render(<Nutrition />); await click('Edit')
  sheet = useUI.getState().sheets.at(-1); await render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
  await input('amount', '200')
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(visible()[0]).toMatchObject({ amountG: 200, energyKcal: 200 })
  await render(<Nutrition />); await click('Delete')
  expect(visible()).toEqual([])
  await click('Undo'); expect(visible()).toHaveLength(1)
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries).toHaveLength(1)
})
test('unknown future rows stay opaque and read-only with unknown totals', async () => {
  const future = { id: 'future', schemaVersion: 20, day: localDay(), label: { opaque: true }, energyKcal: 999 }
  useStore.setState({ S: { ...useStore.getState().S, nutritionEntries: [future] } })
  await render(<Nutrition />)
  expect(host.textContent).toContain('Unsupported entry')
  expect(host.textContent).toContain('1 entries unknown')
  expect(host.textContent).not.toContain('999')
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Edit')).toBe(false)
  expect(useStore.getState().S.nutritionEntries[0]).toEqual(future)
})
for (const reason of ['module off', 'account switch', 'sign out']) test(`an open food sheet closes and cannot save after ${reason}`, async () => {
  useStore.setState({ user: { id: 'original-account' } })
  await render(<Nutrition />); await click('Add food')
  const sheet = useUI.getState().sheets.at(-1)
  const GlobalSheet = () => {
    const sheets = useUI(s => s.sheets)
    return <>{sheets.map(s => <React.Fragment key={s.id}>{s.render(() => useUI.getState().closeSheet(s.id))}</React.Fragment>)}</>
  }
  await render(<GlobalSheet />)
  await input('label', 'Stale food')
  await act(async () => {
    if (reason === 'module off') useStore.getState().update(s => { s.modules = { ...s.modules, nutrition: false } }, false)
    else useStore.setState({ user: reason === 'sign out' ? null : { id: 'other-account' }, S: { ...structuredClone(DEF), modules: { nutrition: true } } })
  })
  expect(host.querySelector('form')).toBeNull()
  expect(useUI.getState().sheets.some(s => s.id === sheet.id)).toBe(false)
  expect(visible()).toHaveLength(0)
})
test('malformed and missing day records have an explicit undated surface and can be deleted', async () => {
  const rows = [{ id: 'future-invalid', schemaVersion: 2, day: '2026-99-99', energyKcal: 999 }, { id: 'missing-day', schemaVersion: 1, label: 'old' }]
  useStore.setState({ S: { ...useStore.getState().S, nutritionEntries: rows } })
  await render(<Nutrition />)
  expect(host.textContent).toContain('Undated entries')
  expect(host.textContent.match(/Unsupported entry/g)).toHaveLength(2)
  expect(host.textContent).not.toContain('999')
  expect(host.textContent).toContain('0 entries unknown')
  expect(useStore.getState().S.nutritionEntries).toEqual(rows)
  await click('Delete')
  expect(visible().map(e => e.id)).toEqual(['missing-day'])
})
for (const decimals of [1, 2]) test(`nutrition keeps three-place precision independently of weight decimals=${decimals}`, async () => {
  setWeightDecimals(decimals)
  try {
    const row = createEntry({ label: 'Fractional serving', day: localDay(), meal: 'snack', amount: 0.024, unit: 'serving', servingLabel: 'portion', servingSize: 100, servingUnit: 'g', proteinG: 0.024 })
    useStore.setState({ S: { ...useStore.getState().S, nutritionEntries: [row] } })
    await render(<Nutrition />)
    expect(host.querySelector('.nutrition-entry').textContent).toContain('0.024 × portion (100 g)')
    expect([...host.querySelectorAll('.nutrition-summary .metric-v')].map(e => e.textContent)).toContain('0.024')
  } finally { setWeightDecimals(1) }
})
