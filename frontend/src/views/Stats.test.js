// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Social from './Social.jsx'
import SocialProfile from './SocialProfile.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'

vi.mock('../lib/api.js', async importOriginal => ({ ...await importOriginal(), api: vi.fn() }))
import { readFileSync } from 'node:fs'
import { URL as FileURL } from 'node:url'
import { bestWeightForEntry, metricModeForEntry, metricRowsForEntry } from '../lib/history.js'

const source = readFileSync(new FileURL('./Stats.jsx', import.meta.url), 'utf8')
const profileSource = readFileSync(new FileURL('./Profile.jsx', import.meta.url), 'utf8')
const socialSource = readFileSync(new FileURL('./Social.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new FileURL('../App.jsx', import.meta.url), 'utf8')
const tabBarSource = readFileSync(new FileURL('../components/TabBar.jsx', import.meta.url), 'utf8')
const uiSource = readFileSync(new FileURL('../components/ui.jsx', import.meta.url), 'utf8')
const cssSource = readFileSync(new FileURL('../index.css', import.meta.url), 'utf8')

describe('Stats mixed-entry metric contract', () => {
  it('selects authoritative reps rows before timed rows without stale topW', () => {
    const entry = { target: { mode: 'time', sec: 60 }, topW: 200, sets: [
      { phase: 'work', mode: 'reps', w: 100, r: 5, done: true },
      { phase: 'work', mode: 'time', w: 200, sec: 60, done: true }
    ] }
    expect(metricModeForEntry(entry)).toBe('reps')
    expect(metricRowsForEntry(entry, metricModeForEntry(entry))).toEqual([entry.sets[0]])
    expect(bestWeightForEntry(entry)).toBe(100)
  })

  it('renders one clickable muscle exercise list rather than a duplicate non-clickable copy', () => {
    expect((source.match(/muscleExercises\.length \? muscleExercises\.map\(row =>/g) || []).length).toBe(1)
    expect(source).toContain('{...tappable(() => onExercise && onExercise(row.id))}')
  })

  it('uses the shared metric mode and row helpers rather than entryMode as a chart gate', () => {
    expect(source).toContain('metricModeForEntry')
    expect(source).toContain('metricRowsForEntry')
    expect(source).toContain('bestWeightForEntry')
    expect(source).not.toContain('const loggedMode = entryMode(en)')
    expect(source).not.toContain('(en.topW || 0)')
  })

  it('stacks the Stats exercise selector value without changing shared SelectRow defaults', () => {
    expect(source).toContain("onChange={setExId} stackedValue")
    expect(uiSource).toContain('sheetTitle, stackedValue = false')
    expect(uiSource).toContain("className={stackedValue ? 'lrow-stack-value' : ''}")
    expect(cssSource).toContain('.lrow.lrow-stack-value .lrow-m{grid-column:1;grid-row:1}')
    expect(cssSource).toContain('.lrow.lrow-stack-value .lrow-v{grid-column:1;grid-row:2;width:100%;max-width:none;text-align:left}')
    expect(cssSource).toContain('flex:0 1 auto;max-width:55%;min-width:0;')
    expect(cssSource).toContain('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')
  })
})

describe('Profile navigation contract', () => {
  it('merges Stats and Social into one persistent Profile destination', () => {
    expect(tabBarSource).toContain('k="profile"')
    expect(tabBarSource).not.toContain('k="stats"')
    expect(tabBarSource).not.toContain('k="social"')
    expect(appSource).toContain('<Route path="/profile" element={<Profile />} />')
    expect(appSource).not.toContain('<Route path="/stats"')
    expect(appSource).not.toContain('<Route path="/social"')
  })

  it('keeps the identity header mounted while switching embedded content', () => {
    expect(profileSource).toContain("new URLSearchParams(loc.search).get('view')")
    expect(profileSource).toContain("view === 'stats' ? <Stats embedded /> : <Social embedded />")
    expect(source).toContain('export default function Stats({ embedded = false })')
    expect(socialSource).toContain('export default function Social({ embedded = false })')
  })

  it('gives the segmented profile sections tab semantics', () => {
    expect(profileSource).toContain('tablist ariaLabel={t(\'Profile sections\')}')
    expect(uiSource).toContain("role={tablist ? 'tablist' : undefined}")
    expect(uiSource).toContain("role={tablist ? 'tab' : undefined}")
    expect(uiSource).toContain('aria-selected={tablist ? o.value === value : undefined}')
  })
})


describe('Social interactions', () => {
  let root, host
  const h = React.createElement
  const overview = () => ({
    friends: [{ id: 'bob', name: 'Bob', lastWorkout: null, weekStreak: 1, thisWeek: 2, recordCount: 1 }],
    incoming: [], outgoing: [], plans: [], suggestions: [{ id: 'eve', name: 'Eve' }], blocks: []
  })
  function Sheets() {
    const sheets = useUI(s => s.sheets)
    return sheets.map(sheet => h('div', { role: 'dialog', key: sheet.id }, sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  }
  async function mount(profile = false) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(h(MemoryRouter, { initialEntries: [profile ? '/profile/friends/bob' : '/profile'] },
      h(Routes, null, h(Route, { path: profile ? '/profile/friends/:id' : '/profile', element: h(profile ? SocialProfile : Social) })), h(Sheets))))
  }
  const button = name => [...host.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name)
  const click = async element => { expect(element).toBeTruthy(); await act(async () => element.click()) }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    api.mockReset().mockResolvedValue(overview())
    useUI.setState({ sheets: [], socialCount: 0 })
    useStore.setState({ user: { id: 'alice', name: 'Alice', shareBodyWeight: false }, ready: false,
      S: { ...structuredClone(DEF), routines: [
        { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, note: 'Personal note' }] },
        { id: 'r2', name: 'Legs', ex: [{ id: '0025', sets: 3, reps: 8 }] }
      ], week: { 1: ['r1', 'r2'], 2: ['r2'] } } })
  })
  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    host?.remove(); root = null
    useUI.setState({ sheets: [] })
    vi.restoreAllMocks()
  })

  it('keeps loaded friends after a refresh error and provides a working retry', async () => {
    await mount()
    api.mockRejectedValueOnce(new Error('Network unavailable'))
    await click(button('Refresh'))
    expect(host.textContent).toContain('Bob')
    expect(host.querySelector('[role="alert"]').textContent).toContain('Network unavailable')
    await click(button('Try again'))
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('Bob')
  })

  it('shows privacy before a request and keeps request errors inside the people sheet', async () => {
    await mount()
    await click(button('Add friend'))
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('Share body weight with friends: Off')
    expect(dialog.textContent).toContain('training stats, plans and personal records')
    api.mockRejectedValueOnce(new Error('Request failed'))
    await click(button('Add'))
    expect(dialog.querySelector('[role="alert"]').textContent).toBe('Request failed')
    expect(button('Add').disabled).toBe(false)
  })

  it('previews a selected plan without notes before sending it', async () => {
    await mount()
    await click(button('Actions for Bob'))
    await click([...host.querySelectorAll('.menu-item')].find(e => e.textContent.includes('Share my plan')))
    const checkboxes = host.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(4)
    expect(checkboxes[3].checked).toBe(false)
    await click(checkboxes[1])
    await click(button('Preview'))
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain('Push')
    expect(dialog.textContent).not.toContain('Legs')
    expect(dialog.textContent).not.toContain('Personal note')
    api.mockRejectedValueOnce(new Error('Share failed'))
    await click(button('Share plan'))
    expect(dialog.querySelector('[role="alert"]').textContent).toBe('Share failed')
    await click(button('Share plan'))
    const call = api.mock.calls.find(([path]) => path === '/api/social/plan')
    const body = JSON.parse(call[1].body)
    expect(body.includeNotes).toBe(false)
    expect(body.plan.routines.map(r => r.id)).toEqual(['r1'])
    expect(body.plan.week).toEqual({ 1: ['r1'] })
    expect(body.plan.routines[0].ex[0].note).toBeUndefined()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('does not offer another import when a shared snapshot is still in the inbox', async () => {
    const data = overview()
    data.plans = [{ id: 'snapshot', from: { id: 'bob', name: 'Bob' }, name: 'Plan', created: '2026-09-13' }]
    api.mockResolvedValue(data)
    useStore.setState({ S: { ...useStore.getState().S, importedSocialPlans: ['snapshot'] } })
    await mount()
    expect(button('Already imported').disabled).toBe(true)
    expect(button('Dismiss').disabled).toBe(false)
  })

  it('persists the import receipt before dismissal and blocks a retry when dismissal fails', async () => {
    const data = overview()
    data.plans = [{ id: 'snapshot', from: { id: 'bob', name: 'Bob' }, name: 'Plan', created: '2026-09-13' }]
    api.mockImplementation(async path => {
      if (path === '/api/social/plan/dismiss') throw new Error('Offline')
      if (path.startsWith('/api/social/plan?')) return { plan: { opengym_plan: 1, name: 'Shared plan',
        routines: [{ id: 'new', name: 'Received', ex: [{ id: '0025', sets: 3, reps: 5 }] }], week: {}, customEx: [] } }
      return data
    })
    await mount()
    await click(button('Review plan'))
    await click(button('Add to my plan'))
    expect(useStore.getState().S.routines).toHaveLength(3)
    expect(useStore.getState().S.importedSocialPlans).toEqual(['snapshot'])
    expect(button('Already imported').disabled).toBe(true)
    expect(api.mock.calls.some(([path]) => path === '/api/social/plan/dismiss')).toBe(true)
    await click(button('Refresh'))
    expect(button('Already imported').disabled).toBe(true)
    expect(useStore.getState().S.routines).toHaveLength(3)
  })

  it('refreshes an open friend profile and clears it when access is revoked', async () => {
    const profile = { id: 'bob', name: 'Bob', workouts: 1, thisMonth: 1, weekStreak: 1,
      unit: 'kg', bodyWeightShared: true, bodyWeight: { value: 80, date: '2026-09-13' },
      plan: { routines: [], week: {}, customExercises: [] }, recordCount: 1,
      records: [{ exerciseId: '0025', metric: 'weight', value: 100, reps: 5, date: '2026-09-13' }] }
    api.mockResolvedValue(profile)
    await mount(true)
    expect(host.textContent).toContain('100 kg × 5 reps')
    api.mockResolvedValue({ ...profile, bodyWeightShared: false, bodyWeight: null })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(host.textContent).toContain('Private')
    expect(host.textContent).not.toContain('80 kg')
    api.mockRejectedValueOnce(Object.assign(new Error('Friend profile not found'), { status: 404 }))
    await click(button('Refresh'))
    expect(host.textContent).not.toContain('100 kg')
    expect(button('Try again')).toBeTruthy()
  })
})
