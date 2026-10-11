// @vitest-environment happy-dom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { isoOf } from './lib/format.js'
import { bwSheet, startFlow } from './sheets.jsx'

const { platform } = vi.hoisted(() => ({ platform: { name: 'ios' } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => platform.name }, registerPlugin: () => ({}) }))

beforeEach(() => {
  platform.name = 'ios'
  vi.useFakeTimers()
  useStore.setState({ S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-09-08', w: 80, t: 1 }] }, user: { id: 'paired-user' }, healthWeightStatus: 'pending' })
  useUI.setState({ sheets: [], toasts: [] })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

// A static render reads the store's initial state; the Health line depends on the live one.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
function rendered(sheet) {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(sheet.render(() => {})))
  const html = host.innerHTML
  act(() => root.unmount())
  return html
}

it('uses the original manual sheet in local-only mode without claiming Health is pending', () => {
  useStore.setState({ user: null })
  startFlow(null)
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet.locked).toBe(true)
  const html = renderToStaticMarkup(sheet.render(() => {}))
  expect(html).not.toContain('Apple Health')
  expect(html).not.toContain('Manual')
  expect(useStore.getState().S.active).toBeNull()
})

it('still asks, pre-filled with the Health weight, its source and its age', () => {
  const measuredAt = Date.now() - 3 * 86400000
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-09-08', w: 80, t: Date.now(), src: 'apple-health', m: measuredAt }] } })
  startFlow(null)
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet.locked).toBe(true)
  const html = rendered(sheet)
  expect(html).toContain('Apple Health · 3 days ago')
  expect(html).toContain('value="80"')
  expect(useStore.getState().S.active).toBeNull()
})

it('labels a typed weigh-in Manual with its own age', () => {
  useStore.setState({ healthWeightStatus: 'available' })
  useStore.getState().S.bodyweight.push({ d: '2026-09-09', w: 81, t: Date.now() - 2 * 86400000 })
  startFlow(null)
  const html = rendered(useUI.getState().sheets.at(-1))
  expect(html).toContain('Manual · 2 days ago')
  expect(html).not.toContain('Apple Health')
})

it('shows the label alone for a weigh-in that has no time', () => {
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-09-08', w: 80 }] } })
  startFlow(null)
  const html = rendered(useUI.getState().sheets.at(-1))
  expect(html).toContain('>Manual<')
  expect(html).not.toMatch(/NaN|Invalid/)
})

it('asks without a source line when there is no weigh-in', () => {
  useStore.setState({ healthWeightStatus: 'available', S: structuredClone(DEF) })
  startFlow(null)
  const html = rendered(useUI.getState().sheets.at(-1))
  expect(html).not.toContain('Apple Health')
  expect(html).not.toContain('Manual')
})

it('marks a Health weigh-in in the list, and only where the device has a health store', () => {
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-09-08', w: 80, t: Date.now(), src: 'apple-health', m: Date.now() }] } })
  bwSheet()
  expect(rendered(useUI.getState().sheets.at(-1))).toContain(' · Apple Health')
  platform.name = 'web'
  expect(rendered(useUI.getState().sheets.at(-1))).not.toContain('Apple Health')
})

it('saving the pre-filled Health weight unchanged leaves the Health weigh-in as it is', () => {
  const entry = { d: isoOf(new Date()), w: 80, t: Date.now(), src: 'apple-health', m: Date.now() - 3600000 }
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [entry] } })
  bwSheet()
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
  act(() => root.unmount())
  expect(useStore.getState().S.bodyweight).toEqual([entry])
})

it('drops the source line once the number shown is no longer the pre-filled weight', () => {
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-09-08', w: 80, t: Date.now(), src: 'apple-health', m: Date.now() - 3 * 86400000 }] } })
  startFlow(null)
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
  expect(host.innerHTML).toContain('Apple Health · 3 days ago')
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '+1').click())
  const html = host.innerHTML
  act(() => root.unmount())
  expect(html).not.toContain('Apple Health')
})

it('names no source for an id it does not know, in the sheet or in the list', () => {
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-09-08', w: 80, t: Date.now(), src: 'some-future-store', m: Date.now() - 86400000 }] } })
  startFlow(null)
  const sheetHtml = rendered(useUI.getState().sheets.at(-1))
  expect(sheetHtml).not.toContain('Manual')
  expect(sheetHtml).not.toContain('Apple Health')
  useUI.setState({ sheets: [] })
  bwSheet()
  const listHtml = rendered(useUI.getState().sheets.at(-1))
  expect(listHtml).not.toContain('Manual')
  expect(listHtml).not.toContain('Apple Health')
})

it('saving today\'s typed weight unchanged still refreshes its time', () => {
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [{ d: isoOf(new Date()), w: 80, t: Date.now() - 1000 }] } })
  bwSheet()
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
  act(() => root.unmount())
  const [saved] = useStore.getState().S.bodyweight
  expect(saved.t).toBe(Date.now())
  expect(saved.w).toBe(80)
})

it.each(['unsupported', 'no-readable-data', 'pending', 'failed'])('keeps the locked manual sheet and a visible reason when Health is %s', status => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  useStore.setState({ healthWeightStatus: status })
  startFlow(null)
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet.locked).toBe(true)
  const html = renderToStaticMarkup(sheet.render(() => {}))
  expect(html).toContain('Apple Health')
  expect(html).toContain('Save &amp; start workout')
  expect(useStore.getState().S.active).toBeNull()
  expect(warning).toHaveBeenCalled()
  warning.mockRestore()
})

it('puts the source line under the number it describes, between the number and the step chips', () => {
  useStore.setState({ healthWeightStatus: 'available', S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-09-08', w: 80, t: Date.now(), src: 'apple-health', m: Date.now() - 3 * 86400000 }] } })
  startFlow(null)
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
  const source = [...host.querySelectorAll('p')].find(p => p.textContent === 'Apple Health · 3 days ago')
  const number = host.querySelector('.bwstep')
  const chips = host.querySelector('.chips')
  expect(source.compareDocumentPosition(number) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  expect(source.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  act(() => root.unmount())
})
