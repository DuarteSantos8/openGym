// @vitest-environment happy-dom
// Settings → Modules (lib/modules.js): the page, the preset row, the switches, the one question
// before a connected module goes off, and the Settings root and search following the modules.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSettings, pageVisible, SEARCH } from './settings-pages.js'
import { MODULES, isOn, presetOf } from '../lib/modules.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, config: null, coachLocal: null, confirms: [], sheets: [] }
  state.snapshot = () => ({
    S: state.S, user: state.user, config: state.config, coachLocal: state.coachLocal,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../sheets.jsx', () => ({ confirmSheet: opts => mocks.confirms.push(opts) }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ connections: [] })) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))

import ModulesPage, { connectionNotes } from './Modules.jsx'
import { bindUI } from '../components/ui.jsx'

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', workouts: [] }
  mocks.user = null
  mocks.config = null
  mocks.coachLocal = null
  mocks.confirms = []
  mocks.sheets = []
  bindUI({ getState: () => ({ openSheet: render => { mocks.sheets.push(render); return { close: vi.fn() } } }) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<ModulesPage />))
const row = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const sw = title => row(title).querySelector('[role="switch"]')

describe('the Modules page', () => {
  it('lists every module in its group, all on for a profile from before Modules', () => {
    mount()
    expect([...host.querySelectorAll('.sect-t')].map(h => h.textContent)).toEqual(expect.arrayContaining(['Training', 'Body and health', 'Extras']))
    for (const m of MODULES) {
      expect(row(m.title), m.id).toBeTruthy()
      expect(row(m.title).querySelector('.lrow-s').textContent).toBe(m.desc)
      expect(sw(m.title).getAttribute('aria-checked')).toBe('true')
    }
    expect(row('Start from').querySelector('.lrow-v').textContent).toBe('Everything')
  })

  it('a switch writes that one module, and the preset turns Custom', () => {
    mount()
    act(() => sw('Seasonal themes').click())
    expect(mocks.S.modules).toEqual({ seasonal: false })
    mount()
    expect(sw('Seasonal themes').getAttribute('aria-checked')).toBe('false')
    expect(row('Start from').querySelector('.lrow-v').textContent).toBe('Custom')
    expect(host.textContent).toContain('11 of 12 modules on.')
    act(() => sw('Seasonal themes').click())
    expect(isOn(mocks.S, 'seasonal')).toBe(true)
  })

  it('the preset row picks a preset for every module at once', () => {
    mount()
    act(() => row('Start from').click())
    const sheet = mocks.sheets.at(-1)
    const box = document.createElement('div'); document.body.appendChild(box)
    const r2 = createRoot(box)
    act(() => r2.render(sheet(() => {})))
    const opt = [...box.querySelectorAll('button')].find(b => b.textContent.includes('Just training'))
    act(() => opt.click())
    act(() => r2.unmount()); box.remove()
    expect(presetOf(mocks.S)).toBe('training')
    expect(isOn(mocks.S, 'body')).toBe(false)
    expect(isOn(mocks.S, 'effort')).toBe(true)
  })

  it('asks once before switching off a module that is connected, and pauses on yes', () => {
    mocks.coachLocal = { mode: 'byok' }
    mount()
    act(() => sw('AI Coach').click())
    expect(mocks.S.modules).toBeUndefined()
    expect(mocks.confirms).toHaveLength(1)
    expect(mocks.confirms[0].title).toBe('Switch off AI Coach?')
    act(() => mocks.confirms[0].onConfirm())
    expect(isOn(mocks.S, 'coach')).toBe(false)
    // back on needs no question
    mount()
    act(() => sw('AI Coach').click())
    expect(isOn(mocks.S, 'coach')).toBe(true)
    expect(mocks.confirms).toHaveLength(1)
  })

  it('names what pauses for each connected module, and nothing for the rest', () => {
    const notes = connectionNotes(['health', 'watch', 'integrations', 'coach', 'body'], { health: 'Health Connect', watch: true, webhooks: 2, coach: true })
    expect(notes).toHaveLength(4)
    expect(notes[0]).toBe('Health Connect stops syncing while Health is off. Nothing is disconnected, and it catches up once Health is back.')
    expect(connectionNotes(['health', 'watch'], {})).toEqual([])
    for (const n of notes) expect(n).not.toMatch(/—/)
  })
})

describe('Settings follows the modules', () => {
  const web = { user: null, mobile: false, android: false, demo: false, wakeOK: true, profiles: true, nfc: true }
  const off = (...ids) => ({ ...web, mod: id => !ids.includes(id) })

  it('a module that is off takes its pages away', () => {
    const phone = { ...web, user: { id: 'u' }, mobile: true, ios: true }
    for (const [page, mod] of [['coach', 'coach'], ['watch', 'watch'], ['zepp', 'watch'], ['apple-health', 'health'], ['themes', 'seasonal']]) {
      expect(pageVisible(page, phone), page).toBe(true)
      expect(pageVisible(page, { ...phone, mod: id => id !== mod }), page).toBe(false)
    }
    expect(pageVisible('modules', web)).toBe(true)
  })

  it('the search drops the rows and pages of a module that is off, and finds them when on', () => {
    const has = (q, ctx, title) => searchSettings(q, ctx).some(h => h.title === title && h.page !== 'modules')
    for (const [q, title, mod] of [
      ['rir', 'Effort per set', 'effort'], ['weigh', 'Weigh in before workouts', 'body'], ['recap', 'Week and month recap', 'motivation'],
      ['challenges', 'Monthly challenges', 'motivation'], ['halloween', 'Halloween', 'seasonal'], ['recovery', 'Recovery tips', 'health'],
      ['webhook', 'Webhooks', 'integrations'], ['nfc', 'Set up an NFC sticker', 'checkin'], ['about you', 'About you', 'strength'],
      ['warm-up', 'Automatic warm-ups', 'plates'],
    ]) {
      expect(has(q, web, title), title).toBe(true)
      expect(has(q, off(mod), title), title).toBe(false)
    }
  })

  it('every module is a hit of its own, on the Modules page', () => {
    for (const m of MODULES) expect(SEARCH.some(e => e.page === 'modules' && e.title === m.title), m.id).toBe(true)
    const hits = searchSettings('streak', off('motivation'))
    expect(hits.some(h => h.page === 'modules' && h.title === 'Motivation')).toBe(true)
    expect(searchSettings('modules', web)[0].page).toBe('modules')
  })
})
