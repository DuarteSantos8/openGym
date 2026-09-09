// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Library from './Library.jsx'
import RoutineEdit from './RoutineEdit.jsx'
import Workout from './Workout.jsx'
import { exerciseDetailSheet, exercisePicker } from '../sheets.jsx'
import Modals from '../components/Modals.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { registerCustom } from '../lib/exercises.js'

const assetObjectUrl = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', () => ({
  assetObjectUrl,
  api: vi.fn(() => Promise.resolve({})),
  setRemoteAuth: vi.fn(),
  uploadAsset: vi.fn()
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container
let root

const custom = {
  id: 'private-render-exercise', n: 'Private render exercise', bp: 'chest', tg: 'chest', eq: 'custom', custom: true,
  media: { id: 'private-render-asset', mime: 'image/png', size: 128, sha256: 'asset-sha256' }
}

function stateFixture() {
  const S = JSON.parse(JSON.stringify(DEF))
  S.customEx = [custom]
  S.routines = [{ id: 'private-routine', name: 'Private routine', ex: [{ id: custom.id, sets: 1, reps: 5, weight: 1 }] }]
  S.workouts = []
  S.active = {
    id: 'private-active', name: 'Private workout', start: Date.now(), cur: 0,
    entries: [{ id: custom.id, target: { mode: 'reps', reps: 5, weight: 1 }, sets: [{ w: 1, r: 5, done: false }] }]
  }
  return S
}

function mount(element) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(element))
}

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

function unmount() {
  if (root) act(() => root.unmount())
  root = null
  container?.remove()
  container = null
  useUI.setState({ sheets: [] })
}

beforeEach(() => {
  localStorage.clear()
  assetObjectUrl.mockReset().mockImplementation(id => Promise.resolve(`blob:${id}`))
  const S = stateFixture()
  useStore.setState({ S, user: null, ready: true, persistenceError: null })
  registerCustom(S.customEx)
  useUI.setState({ sheets: [] })
})

afterEach(() => { unmount(); vi.restoreAllMocks() })

describe('private custom image rendering', () => {
  it('loads the same authenticated object URL in library, picker, routine editor, and workout views', async () => {
    mount(<MemoryRouter initialEntries={['/library']}><Routes><Route path="/library" element={<Library />} /></Routes></MemoryRouter>)
    await settle()
    expect(container.querySelector('img.thumb[src="blob:private-render-asset"]')).toBeTruthy()
    unmount()

    const picker = exercisePicker(() => {})
    mount(<Modals />)
    await settle()
    expect(container.querySelector('img.thumb[src="blob:private-render-asset"]')).toBeTruthy()
    unmount()

    mount(<MemoryRouter initialEntries={['/plan/r/private-routine']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>)
    await settle()
    expect(container.querySelector('img.thumb[src="blob:private-render-asset"]')).toBeTruthy()
    unmount()

    mount(<MemoryRouter initialEntries={['/workout']}><Routes><Route path="/workout" element={<Workout />} /></Routes></MemoryRouter>)
    await settle()
    expect(container.querySelector('.exmedia img[src="blob:private-render-asset"]')).toBeTruthy()
    unmount()

    // Exercise detail is a sheet rather than a route. Render its registered sheet body directly
    // so the assertion still exercises the real component and Media hook, not a test double.
    const detail = exerciseDetailSheet(custom)
    mount(<MemoryRouter><>{useUI.getState().sheets.find(sheet => sheet.id === detail.id)?.render(() => {})}</></MemoryRouter>)
    await settle()
    expect(container.querySelector('.exmedia img[src="blob:private-render-asset"]')).toBeTruthy()
    expect(assetObjectUrl).toHaveBeenCalledWith('private-render-asset')
    process.stdout.write('gate4_private_asset_views_library=true\n')
    process.stdout.write('gate4_private_asset_views_picker=true\n')
    process.stdout.write('gate4_private_asset_views_routine=true\n')
    process.stdout.write('gate4_private_asset_views_workout=true\n')
    process.stdout.write('gate4_private_asset_views_detail=true\n')
    process.stdout.write('gate4_private_asset_views_all=true\n')
  })
})
