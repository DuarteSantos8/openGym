// @vitest-environment happy-dom
// Settings → Modules: a module with parts (lib/modules.js PARTS, #1087) unfolds them under its row,
// each with its switch; the search finds the parts and drops the rows of a part that is off.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSettings } from './settings-pages.js'
import { partOn } from '../lib/modules.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S, user: null, config: null, coachLocal: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../sheets.jsx', () => ({ confirmSheet: () => {} }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ connections: [] })) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))

import ModulesPage from './Modules.jsx'

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', workouts: [] }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = (props = {}) => act(() => root.render(<ModulesPage {...props} />))
const row = title => [...host.querySelectorAll('.module-row')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const opener = title => row(title).querySelector('.module-open')
const partsOf = title => document.getElementById(opener(title).getAttribute('aria-controls'))
const partSwitches = title => [...partsOf(title).querySelectorAll('[role="switch"]')]

describe('a module with parts on Settings → Modules', () => {
  it('is folded at first, says how many parts are on, and unfolds them in place', () => {
    mocks.S.modules = { 'body.photos': false }
    mount()
    expect(opener('Body').getAttribute('aria-expanded')).toBe('false')
    expect(opener('Body').getAttribute('aria-label')).toBe('Parts of Body')
    expect(row('Body').querySelector('.lrow-v').textContent).toBe('2 of 3')
    expect(row('Motivation').querySelector('.lrow-v').textContent).toBe('All')
    expect(partsOf('Body').hidden).toBe(true)
    act(() => opener('Body').click())
    expect(opener('Body').getAttribute('aria-expanded')).toBe('true')
    expect(partsOf('Body').hidden).toBe(false)
    expect([...partsOf('Body').querySelectorAll('.lrow-t')].map(e => e.textContent)).toEqual(['Body weight', 'Body measurements', 'Progress photos'])
    expect(partSwitches('Body').map(s => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'false'])
    expect(row('Body').querySelector('.lrow-v')).toBeNull()
    act(() => opener('Body').click())
    expect(partsOf('Body').hidden).toBe(true)
  })

  it('a part’s switch writes its own key and leaves the module alone', () => {
    mount()
    act(() => opener('Motivation').click())
    act(() => partSwitches('Motivation')[4].click())
    expect(mocks.S.modules).toEqual({ 'motivation.share': false })
    expect(partOn(mocks.S, 'motivation', 'share')).toBe(false)
    expect(partOn(mocks.S, 'motivation', 'streak')).toBe(true)
  })

  it('the module’s switch flips the module only, and does not unfold', () => {
    mount()
    act(() => row('Strength levels').querySelector(':scope > [role="switch"]').click())
    expect(mocks.S.modules).toEqual({ strength: false })
    expect(opener('Strength levels').getAttribute('aria-expanded')).toBe('false')
    mount()
    expect(row('Strength levels').querySelector('.lrow-v').textContent).toBe('Off')
  })

  it('with the module off its parts show as they were left, disabled, with a line saying so', () => {
    mocks.S.modules = { motivation: false, 'motivation.year': false }
    mount()
    act(() => opener('Motivation').click())
    expect(partSwitches('Motivation').map(s => s.disabled)).toEqual([true, true, true, true, true])
    expect(partSwitches('Motivation').map(s => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true', 'false', 'true'])
    expect(partsOf('Motivation').textContent).toContain('Motivation is off, so all of it is hidden.')
  })

  it('a module of one switch has no chevron', () => {
    mount()
    expect(row('Effort').querySelector('.module-open')).toBeNull()
    expect(row('Effort').querySelector('.lrow-c')).toBeNull()
  })

  it('a search hit on a part opens with its module unfolded', () => {
    mount({ find: 'Progress photos' })
    expect(partsOf('Body').hidden).toBe(false)
    expect(partsOf('Motivation').hidden).toBe(true)
  })
})

describe('the search and the parts', () => {
  const web = { user: null, mobile: false, android: false, demo: false, wakeOK: true, profiles: true, nfc: true }
  const has = (q, ctx, title, page) => searchSettings(q, ctx).some(h => h.title === title && (!page || h.page === page))

  it('finds a part on the Modules page, whatever its switch', () => {
    expect(has('photos', web, 'Progress photos', 'modules')).toBe(true)
    expect(has('pyramids', web, 'Drop-sets, rest-pause and pyramids', 'modules')).toBe(true)
    expect(has('photos', { ...web, mod: id => id !== 'body' }, 'Progress photos', 'modules')).toBe(true)
  })

  it('drops the rows of a part that is off', () => {
    const S = { modules: { 'body.weight': false, 'motivation.streak': false } }
    const ctx = { ...web, mod: () => true, part: (id, p) => partOn(S, id, p) }
    expect(has('weigh', web, 'Weigh in before workouts')).toBe(true)
    expect(has('weigh', ctx, 'Weigh in before workouts')).toBe(false)
    expect(has('freeze', ctx, 'Streak freezes')).toBe(false)
    expect(has('recap', ctx, 'Week and month recap')).toBe(true)
  })
})
