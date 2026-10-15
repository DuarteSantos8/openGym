// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { api } from './lib/api.js'
import { buildProgrammeBundle } from './lib/programme-share.js'
import AdminProgrammes from './views/AdminProgrammes.jsx'
import SharedProgrammes from './components/SharedProgrammes.jsx'

vi.mock('./lib/api.js', () => ({ api: vi.fn(), beacon: vi.fn(), appBase: () => '/' }))
vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const definition = { id: 'source', name: 'Strength', progression: 'off', weeks: [{ mode: 'normal', days: [{ weekday: 1, sessions: [{ routineSnapshot: { id: 'a', name: 'Session', ex: [{ id: '0025', sets: 3, reps: 5, weight: 20 }] } }] }] }] }
let host, root, catalogue, bundle, fail, imported
const render = element => act(() => root.render(element))
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))
const click = async label => { await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === label).click()); await settle() }
beforeEach(() => {
  localStorage.clear(); imported = vi.fn(); fail = false
  useStore.setState({ S: { ...structuredClone(DEF), programmeMode: false, programmes: { definitions: [definition], cycles: [] }, workouts: [{ id: 'keep' }] }, user: { id: 'owner', admin: true }, ready: false })
  useUI.setState({ sheets: [] })
  bundle = buildProgrammeBundle(definition)
  catalogue = { revision: 0, programmes: [] }
  api.mockReset(); api.mockImplementation(async (path, init) => {
    if (fail) throw new Error('offline')
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body); bundle = body.bundle
      catalogue = { revision: catalogue.revision + 1, programmes: [{ id: 'shared', sourceId: body.sourceId, name: bundle.programme.name, weeks: 1 }] }
      return { ok: true }
    }
    if (init?.method === 'DELETE') { catalogue = { revision: catalogue.revision + 1, programmes: [] }; return { ok: true } }
    if (path.includes('?id=')) return { bundle }
    return structuredClone(catalogue)
  })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll(); vi.restoreAllMocks() })

it('admin publishes a sanitized snapshot, updates it and unshares it', async () => {
  render(<AdminProgrammes />); await settle()
  expect(host.textContent).toContain('including future accounts')
  const select = host.querySelector('select')
  act(() => { select.value = 'source'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await click('Share with everyone')
  const posted = JSON.parse(api.mock.calls.find(([, init]) => init?.method === 'POST')[1].body)
  expect(posted.revision).toBe(0); expect(posted.bundle).not.toHaveProperty('workouts')
  expect(host.textContent).toContain('Update shared copy')
  await click('Update shared copy'); expect(catalogue.programmes).toHaveLength(1)
  await click('Unshare'); expect(catalogue.programmes).toHaveLength(0)
  expect(useStore.getState().S.workouts).toEqual([{ id: 'keep' }])
})

it('new account can find and import a shared programme with mode off, preserving its plan and history', async () => {
  catalogue.programmes = [{ id: 'shared', name: 'Strength', weeks: 1 }]
  useStore.setState({ user: { id: 'new' }, S: { ...structuredClone(DEF), programmeMode: false, unit: 'lb', workouts: [{ id: 'keep' }], week: { 2: ['existing'] } } })
  render(<SharedProgrammes onImported={imported} />); await settle()
  await click('Import')
  const sheet = useUI.getState().sheets.at(-1)
  render(sheet.render(() => {}))
  await click('Add to my plan')
  const state = useStore.getState().S
  expect(state.programmeMode).toBe(true); expect(state.programmes.definitions).toHaveLength(1)
  expect(state.programmes.cycles).toHaveLength(0); expect(state.workouts).toEqual([{ id: 'keep' }]); expect(state.week).toEqual({ 2: ['existing'] })
  expect(state.routines[0].ex[0].weight).toBe(44)
  expect(imported).toHaveBeenCalledOnce()
})

it('does not import into a different account after the sheet opens', async () => {
  catalogue.programmes = [{ id: 'shared', name: 'Strength', weeks: 1 }]
  render(<SharedProgrammes />); await settle(); await click('Import')
  const sheet = useUI.getState().sheets.at(-1)
  useStore.setState({ user: { id: 'different' } })
  render(sheet.render(() => {})); await click('Add to my plan')
  expect(useStore.getState().S.programmes.definitions).toHaveLength(1)
  expect(useStore.getState().S.programmeMode).toBe(false)
})

it('retries offline reads and hides the library for guests or an empty server', async () => {
  fail = true; render(<SharedProgrammes />); await settle()
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  fail = false; await click('Try again'); expect(host.textContent).toBe('')
  act(() => useStore.setState({ user: null })); api.mockClear(); await settle()
  expect(host.textContent).toBe(''); expect(api).not.toHaveBeenCalled()
})
