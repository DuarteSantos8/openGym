// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
vi.mock('../../lib/api.js', () => ({ api: vi.fn(), remoteAuth: vi.fn(() => null) }))
vi.mock('../../lib/mobile.js', async original => ({ ...await original(), MOBILE: false }))
import { api } from '../../lib/api.js'
import FoodLookup from './FoodLookup.jsx'
import EntrySheet from './EntrySheet.jsx'
import { DEF, useStore } from '../../store/useStore.js'
import { sourceFingerprint } from '../../lib/nutrition/food-source.js'
import { createEntry } from '../../lib/nutrition/entry.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const product = () => ({ source: 'open-food-facts', externalId: '012345678905', label: 'Synthetic oats', brand: 'Fixture', quantityText: '330 ml', per100: { basis: 'g', energyKcal: 200, proteinG: 8, fatG: 0 }, serving: { label: '30 g', grams: 30 }, fetchedAt: '2026-11-14T10:00:00Z', attribution: { text: 'Contains information from Open Food Facts, available under the Open Database License (ODbL).', license: 'ODbL-1.0' } })
let host, root
const render = async (node = <FoodLookup day="2026-11-14" />) => act(async () => root.render(node))
const click = async text => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text).click())
const input = async (name, value) => act(async () => {
  const el = host.querySelector(`[name="${name}"]`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const lookup = async () => { await input('barcode', '012345678905'); await click('Lookup') }
const rows = () => useStore.getState().S.nutritionEntries || []
beforeEach(() => {
  localStorage.clear(); api.mockReset(); api.mockResolvedValue(product())
  useStore.setState({ S: { ...structuredClone(DEF), modules: { nutrition: true } }, user: { id: 'one' }, config: { foodLookup: { status: 'configured-unverified' } }, ready: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState({ user: null, ready: false }) })
test('no request on open/typing; explicit lookup previews unknowns and saves only on Save once', async () => {
  await render(); expect(api).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Open Food Facts')
  await input('barcode', '012345678905'); expect(api).not.toHaveBeenCalled()
  await click('Lookup')
  expect(api).toHaveBeenCalledWith('/api/food-lookup?barcode=012345678905')
  expect(host.textContent).toContain('Per 100 g'); expect(host.textContent).toContain('Unknown')
  expect(rows()).toHaveLength(0)
  await input('lookupAmount', '25'); expect(rows()).toHaveLength(0)
  const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')
  await act(async () => { save.click(); save.click() })
  expect(rows()).toHaveLength(1)
  expect(rows()[0]).toMatchObject({ amountG: 25, energyKcal: 50, proteinG: 2, fatG: 0, createdBy: 'manual', sourceSnapshot: { label: 'Synthetic oats' } })
  expect(rows()[0]).not.toHaveProperty('carbohydrateG')
  const id = rows()[0].id
  await click('Lookup'); await click('Save')
  expect(rows()).toHaveLength(2); expect(rows()[1].id).not.toBe(id)
})
test('invalid barcode is local, invalid amount cannot save, changed barcode clears product', async () => {
  await render(); await input('barcode', '123'); await click('Lookup')
  expect(api).not.toHaveBeenCalled(); expect(host.textContent).toContain('Enter a valid barcode.')
  await lookup(); await input('lookupAmount', '')
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Save').disabled).toBe(true)
  await input('barcode', '3017620422003'); expect(host.textContent).not.toContain('Synthetic oats')
})
for (const [state, expected] of [
  [{ user: null }, 'Sign in to look up food.'],
  [{ config: null }, 'Food lookup is not supported by this server.'],
  [{ config: { foodLookup: { status: 'disabled' } } }, 'Food lookup is disabled on this server.'],
]) test(`unavailable: ${expected}`, async () => {
  useStore.setState(state); await render()
  expect(host.textContent).toContain(expected); expect(host.querySelector('[name="barcode"]')).toBeNull(); expect(api).not.toHaveBeenCalled()
})
test('module off hides lookup without a request', async () => {
  useStore.setState({ S: { ...useStore.getState().S, modules: { nutrition: false } } }); await render()
  expect(host.textContent).toBe(''); expect(api).not.toHaveBeenCalled()
})
for (const [code, expected] of [
  ['food-lookup-invalid-barcode', 'Enter a valid barcode.'], ['food-lookup-not-found', 'Product not found.'],
  ['food-lookup-auth-required', 'Sign in to look up food.'], ['food-lookup-disabled', 'Food lookup is disabled on this server.'],
  ['nutrition-disabled', 'Nutrition is not enabled on the server yet. Wait for sync, then try again.'],
  ['food-lookup-rate-limited', 'Too many lookups. Try again later.'], ['food-lookup-upstream', 'The food provider could not answer. Try again.'],
  ['food-lookup-timeout', 'Food lookup timed out. Try again.'],
]) test(`stable server failure ${code}, no raw error or automatic retry`, async () => {
  api.mockRejectedValue({ data: { code }, message: '<unsafe upstream>' }); await render(); await lookup()
  expect(host.textContent).toContain(expected); expect(host.textContent).not.toContain('unsafe upstream'); expect(api).toHaveBeenCalledTimes(1); expect(rows()).toHaveLength(0)
})
for (const [error, expected] of [[{ code: 'timeout' }, 'Food lookup timed out. Try again.'], [new TypeError('offline'), 'Could not reach the server. Manual logging still works.'], [{ code: 'not-paired' }, 'Connect this phone to a server to look up food.'], [{ code: 'bad-response', status: 200 }, 'The food provider could not answer. Try again.']]) test(`stable transport failure ${expected}`, async () => {
  api.mockRejectedValue(error); await render(); await lookup(); expect(host.textContent).toContain(expected)
})
for (const reason of ['barcode', 'account', 'module', 'day', 'unmount', 'new request']) test(`late response ignored after ${reason}`, async () => {
  let reply; api.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
  await render(); await lookup()
  if (reason === 'barcode' || reason === 'new request') await input('barcode', '3017620422003')
  if (reason === 'account') await act(async () => useStore.setState({ user: { id: 'two' } }))
  if (reason === 'module') await act(async () => useStore.setState({ S: { ...useStore.getState().S, modules: { nutrition: false } } }))
  if (reason === 'day') await render(<FoodLookup day="2026-11-15" />)
  if (reason === 'unmount') await render(<div />)
  if (reason === 'new request') { api.mockResolvedValueOnce({ ...product(), externalId: '3017620422003', label: 'New product' }); await click('Lookup') }
  await act(async () => reply(product()))
  expect(host.textContent).not.toContain('Synthetic oats'); expect(rows()).toHaveLength(0)
  if (reason === 'new request') expect(host.textContent).toContain('New product')
})
test('mismatched response barcode cannot become a preview', async () => {
  api.mockResolvedValue({ ...product(), externalId: '3017620422003' }); await render(); await lookup()
  expect(host.textContent).not.toContain('Synthetic oats'); expect(rows()).toHaveLength(0)
})
test('offline reopen and recent reuse retain attribution and provenance, with safe links and single submit', async () => {
  const p = product(), contentFingerprint = sourceFingerprint(p)
  const record = createEntry({ label: 'Corrected food', day: '2026-11-14', meal: 'snack', energyKcal: 1 }, { source: p.source, externalId: p.externalId, contentFingerprint, sourceSnapshot: p })
  record.sourceSnapshot.attribution.url = 'javascript:alert(1)'
  useStore.setState({ S: { ...useStore.getState().S, nutritionEntries: [record] } })
  const close = vi.fn()
  await render(<EntrySheet entry={record} owner="one" close={close} />)
  expect(host.textContent).toContain('Open Food Facts'); expect(api).not.toHaveBeenCalled()
  expect([...host.querySelectorAll('a')].map(a => a.href)).toEqual(['https://world.openfoodfacts.org/product/012345678905', 'https://opendatacommons.org/licenses/odbl/1-0/'])
  await render(<EntrySheet key="reuse" prefill={record} day="2026-11-15" owner="one" close={close} />)
  await act(async () => { const f = host.querySelector('form'); f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(rows()).toHaveLength(2); expect(rows()[1]).toMatchObject({ contentFingerprint, sourceSnapshot: { label: 'Synthetic oats' }, energyKcal: 1 })
  expect(rows()[1].id).not.toBe(record.id); expect(api).not.toHaveBeenCalled()
})
