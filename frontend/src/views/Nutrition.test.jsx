// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setLang } from '../lib/i18n.js'
import Nutrition from './Nutrition.jsx'

const mocks = vi.hoisted(() => ({ user: { id: 'u1' }, api: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: mocks.api }))
vi.mock('../store/useStore.js', () => ({ useStore: select => select({ user: mocks.user }) }))
const values = { calories: 123.456, protein: 12.345, fat: 6.789, carbohydrates: 45.678 }
const product = { id: 'b8d5423d-a4f6-4759-a3cb-71bd068da786', name: 'Buckwheat', brand: 'Acme', ...values }
const entry = { id: 'c8d5423d-a4f6-4759-a3cb-71bd068da786', productId: product.id, name: 'Historical buckwheat', brand: 'Acme', date: '2026-10-13', time: null, quantityGrams: 100, nutrition: values, per100Grams: values }
const day = (date, entries = []) => ({ date, entries, totals: entries.length ? values : { calories: 0, protein: 0, fat: 0, carbohydrates: 0 } })
let host, root, recorded
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.user = { id: 'u1' }; mocks.api.mockReset(); recorded = []
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-13T12:00:00').getTime())
  mocks.api.mockImplementation(async (path, opts) => {
    if (opts) return { ...entry, ...JSON.parse(opts.body || '{}') }
    if (path.startsWith('/api/nutrition/diary')) return day(new URL(path, 'http://test').searchParams.get('date'), recorded)
    return { products: [product], hasMore: false }
  })
  await setLang('en')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); await setLang('en') })
const mount = () => act(() => root.render(<MemoryRouter initialEntries={['/nutrition']}><Routes>
  <Route path="/nutrition" element={<Nutrition />} /><Route path="/home" element={<div>Home route</div>} />
</Routes></MemoryRouter>))
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 240)))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const click = target => act(() => target.click())
const input = (target, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(target, value)
  target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true }))
})
const submit = form => act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

it('loads daily totals, empty state and existing back navigation', async () => {
  mount()
  expect(host.querySelector('[role="status"]').textContent).toBe('Loading…')
  await settle()
  expect(host.textContent).toContain('Daily totals')
  expect([...host.querySelectorAll('dd')].map(n => n.textContent)).toEqual(['0', '0', '0', '0'])
  expect(host.textContent).toContain('No food recorded for this day.')
  click(host.querySelector('[aria-label="Back"]'))
  expect(host.textContent).toBe('Home route')
})

it('shows a localized error and retries without inventing totals', async () => {
  await setLang('ru')
  mocks.api.mockRejectedValueOnce(new Error('offline'))
  mount(); await settle()
  expect(host.querySelector('[role="alert"]').textContent).toContain('Нутрициология недоступна.')
  expect(host.querySelector('dd')).toBe(null)
  click(button('Повторить')); await settle()
  expect(host.textContent).toContain('Итого за день')
})

it('requires an account without calling the API', () => {
  mocks.user = null; mount()
  expect(host.textContent).toContain('Sign in to use Nutrition.')
  expect(mocks.api).not.toHaveBeenCalled()
})

it('shows session revocation and rejects malformed diary data', async () => {
  mocks.api.mockRejectedValueOnce(Object.assign(new Error('revoked'), { status: 401 }))
  mount(); await settle()
  expect(host.querySelector('[role="alert"]').textContent).toContain('Sign in to use Nutrition.')
  mocks.api.mockResolvedValueOnce({ wrong: true })
  click(button('Retry')); await settle()
  expect(host.querySelector('[role="alert"]').textContent).toContain('Nutrition is unavailable.')
})

it('discards an old account answer', async () => {
  let oldAnswer
  mocks.api.mockReturnValueOnce(new Promise(resolve => { oldAnswer = resolve }))
  mount(); const date = host.querySelector('[type="date"]').value
  mocks.user = { id: 'u2' }; mount(); await settle()
  await act(async () => oldAnswer(day(date, [{ ...entry, name: 'First account private food' }])))
  expect(host.textContent).not.toContain('First account private food')
  expect(host.textContent).toContain('No food recorded')
})

it('rejects malformed nutrition values rather than crashing or displaying NaN', async () => {
  mocks.api.mockImplementationOnce(async path => ({ ...day(new URL(path, 'http://test').searchParams.get('date')), entries: [{ name: 'Invalid food' }] }))
  mount(); await settle()
  expect(host.querySelector('[role="alert"]').textContent).toContain('Nutrition is unavailable.')
  expect(host.textContent).not.toContain('NaN')
  expect(host.textContent).not.toContain('Invalid food')
})

it('navigates dates and discards a stale date response', async () => {
  let oldAnswer
  mocks.api.mockReturnValueOnce(new Promise(resolve => { oldAnswer = resolve }))
  mount(); const before = host.querySelector('[type="date"]').value
  click(host.querySelector('[aria-label="Next day"]')); await settle()
  const next = host.querySelector('[type="date"]').value
  expect(next).not.toBe(before)
  expect(mocks.api).toHaveBeenLastCalledWith('/api/nutrition/diary?date=' + next)
  await act(async () => oldAnswer(day(before, [entry])))
  expect(host.textContent).not.toContain('Historical buckwheat')
  click(host.querySelector('[aria-label="Previous day"]')); await settle()
  expect(host.querySelector('[type="date"]').value).toBe(before)
})

it('adds selected food with grams and reuses the creation id after network failure', async () => {
  mount(); await settle(); click(button('Add food')); await settle()
  click(host.querySelector('.nutrition-choice'))
  input(host.querySelector('[aria-label="Quantity (g)"]'), '125,5')
  mocks.api.mockRejectedValueOnce(new Error('connection lost'))
  submit(host.querySelector('form')); await settle()
  const first = mocks.api.mock.calls.find(([path, opts]) => path === '/api/nutrition/entries' && opts)
  const payload = JSON.parse(first[1].body)
  expect(payload).toMatchObject({ productId: product.id, quantityGrams: 125.5, time: null })
  expect(payload.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(host.querySelector('[role="alert"]')).not.toBe(null)
  submit(host.querySelector('form')); await settle()
  const writes = mocks.api.mock.calls.filter(([path, opts]) => path === '/api/nutrition/entries' && opts)
  expect(writes).toHaveLength(2)
  expect(writes[1][1].body).toBe(first[1].body)
  expect(host.querySelector('form')).toBe(null)
})

it('edits a historical entry without replacing its snapshot and deletes with confirmation', async () => {
  recorded = [entry]; mount(); await settle()
  expect(host.textContent).toContain('Historical buckwheat')
  expect(host.textContent).toContain('No time')
  click(button('Edit')); await settle()
  input(host.querySelector('[aria-label="Quantity (g)"]'), '200')
  submit(host.querySelector('form')); await settle()
  const update = mocks.api.mock.calls.find(([path, opts]) => path.endsWith(entry.id) && opts?.method === 'PUT')
  expect(JSON.parse(update[1].body)).toMatchObject({ quantityGrams: 200, productId: null, time: null, date: entry.date })
  click(button('Delete'))
  expect(mocks.api.mock.calls.some(([, opts]) => opts?.method === 'DELETE')).toBe(false)
  click(button('Confirm')); await settle()
  expect(mocks.api).toHaveBeenCalledWith('/api/nutrition/entries/' + entry.id, { method: 'DELETE' })
})

it('explicit product selection replaces the entry snapshot', async () => {
  recorded = [entry]; mount(); await settle(); click(button('Edit')); await settle()
  click(host.querySelector('.nutrition-choice')); submit(host.querySelector('form')); await settle()
  const update = mocks.api.mock.calls.find(([, opts]) => opts?.method === 'PUT')
  expect(JSON.parse(update[1].body).productId).toBe(product.id)
})

it('creates, searches, edits and deletes catalog products', async () => {
  mount(); await settle(); click(button('My products')); await settle()
  input(host.querySelector('[aria-label="Search products"]'), 'rice'); await settle()
  expect(mocks.api).toHaveBeenLastCalledWith('/api/nutrition/products?search=rice&offset=0')
  click(button('Create product'))
  const form = host.querySelector('form')
  input(form.querySelector('input'), 'Rice')
  for (const [label, value] of [['Calories (kcal)', '100'], ['Protein (g)', '2'], ['Fat (g)', '0'], ['Carbohydrates (g)', '20']]) input(form.querySelector(`[aria-label="${label}"]`), value)
  submit(form); await settle(); await settle()
  const created = mocks.api.mock.calls.find(([path, opts]) => path === '/api/nutrition/products' && opts?.method === 'POST')
  expect(JSON.parse(created[1].body)).toEqual({ name: 'Rice', brand: '', calories: 100, protein: 2, fat: 0, carbohydrates: 20 })
  click(button('Edit')); input(host.querySelector('form input'), 'Updated rice'); submit(host.querySelector('form')); await settle(); await settle()
  expect(mocks.api.mock.calls.find(([, opts]) => opts?.method === 'PUT')[0]).toBe('/api/nutrition/products/' + product.id)
  click(button('Delete')); expect(host.textContent).toContain('Your diary history will be kept.')
  click(button('Confirm')); await settle()
  expect(mocks.api).toHaveBeenCalledWith('/api/nutrition/products/' + product.id, { method: 'DELETE' })
})

it('creates a product inline and selects it for logging', async () => {
  mount(); await settle(); click(button('Add food')); await settle(); click(button('Create product'))
  const form = host.querySelector('.nutrition-product-form')
  input(form.querySelector('input'), 'Milk')
  for (const label of ['Calories (kcal)', 'Protein (g)', 'Fat (g)', 'Carbohydrates (g)']) input(form.querySelector(`[aria-label="${label}"]`), '1')
  mocks.api.mockResolvedValueOnce({ ...product, name: 'Milk' })
  submit(form); await settle()
  expect(host.textContent).toContain('Selected product: Milk')
  expect(host.querySelector('.nutrition-product-form')).toBe(null)
})
