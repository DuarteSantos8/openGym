// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { createProgrammeDefinition } from './lib/programmes.js'
import { buildProgrammeBundle, parseProgramme } from './lib/programme-share.js'
import { ProgrammeImport, ProgrammeShare, exportProgrammeFile, importProgrammeFile } from './programme-sheets.jsx'

vi.mock('./lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => structuredClone(value)
let root, host, definition, initial, captured
const close = vi.fn()
const imported = vi.fn()
const routine = { id: 'author-routine', name: 'Strength A', ex: [{ id: '0025', sets: 3, reps: 5, weight: 20 }] }

beforeEach(() => {
  localStorage.clear()
  initial = { ...clone(DEF), programmeMode: true, routines: [clone(routine)], week: { 2: [routine.id] },
    workouts: [{ id: 'kept-workout', marker: 'keep' }], bodyweight: [{ date: '2026-01-01', w: 80 }] }
  definition = createProgrammeDefinition({ name: 'Two-week builder', progression: 'linear', weeks: [
    { mode: 'normal', days: [{ weekday: 1, sessions: [{ routineId: routine.id }] }] },
    { mode: 'rest', days: [{ weekday: 1, sessions: [{ routineId: routine.id }] }] },
  ] }, initial)
  initial.programmes = { definitions: [definition], cycles: [{ id: 'kept-cycle', status: 'active', marker: 'keep' }] }
  useStore.setState({ S: clone(initial), user: null, ready: false })
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  close.mockClear(); imported.mockClear(); captured = null
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.getState().closeAll()
  vi.restoreAllMocks()
  localStorage.clear()
})
const render = component => act(() => root.render(component))
const click = label => act(() => [...host.querySelectorAll('button')].find(button => button.textContent === label).click())

it('shows what a shared file contains before export', () => {
  render(<ProgrammeShare definition={definition} close={close} />)
  expect(host.textContent).toContain('Weeks, routines and exercise notes only. No workout history or weigh-ins.')
  expect(host.textContent).toContain('Export programme file')
  click('Cancel')
  expect(close).toHaveBeenCalledOnce()
  expect(useStore.getState().S).toEqual(initial)
})

it('exports the selected reusable programme as a downloadable JSON file', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { captured = blob; return 'blob:programme' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    expect(this.download).toMatch(/^opengym-programme-\d{4}-\d{2}-\d{2}\.json$/)
  })
  await exportProgrammeFile(definition)
  expect(create).toHaveBeenCalledOnce()
  const payload = JSON.parse(await captured.text())
  expect(payload.opengym_programme).toBe(1)
  expect(payload.programme.name).toBe(definition.name)
  expect(payload.programme.weeks).toHaveLength(2)
  expect(payload).not.toHaveProperty('cycles')
  expect(payload).not.toHaveProperty('workouts')
  expect(useStore.getState().S).toEqual(initial)
})

it('does not import before confirmation or when cancelled', () => {
  const bundle = parseProgramme(buildProgrammeBundle(definition, { unit: 'kg' }))
  render(<ProgrammeImport bundle={bundle} close={close} onImported={imported} />)
  expect(host.textContent).toContain('2 weeks')
  expect(host.textContent).toContain('Choose your own start date.')
  expect(useStore.getState().S).toEqual(initial)
  click('Cancel')
  expect(useStore.getState().S).toEqual(initial)
  expect(imported).not.toHaveBeenCalled()
})

it('confirmation adds an independent programme without replacing the week, cycles or history', () => {
  const bundle = parseProgramme(buildProgrammeBundle(definition, { unit: 'kg' }))
  render(<ProgrammeImport bundle={bundle} close={close} onImported={imported} />)
  click('Add to my plan')
  const next = useStore.getState().S
  expect(next.programmes.definitions).toHaveLength(2)
  expect(next.programmes.definitions[1].id).not.toBe(definition.id)
  expect(next.programmes.cycles).toEqual(initial.programmes.cycles)
  expect(next.week).toEqual(initial.week)
  expect(next.workouts).toEqual(initial.workouts)
  expect(next.bodyweight).toEqual(initial.bodyweight)
  expect(imported).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('the file reader rejects an ordinary plan file without opening a programme import or changing data', async () => {
  importProgrammeFile(new File(['{"opengym_plan":1}'], 'weekly-plan.json', { type: 'application/json' }))
  await vi.waitFor(() => expect(useUI.getState().toastMsg).toContain('this isn’t an openGym programme file'))
  expect(useUI.getState().sheets).toHaveLength(0)
  expect(useStore.getState().S).toEqual(initial)
})

it('the file reader previews a valid programme and leaves data unchanged until confirmation', async () => {
  const json = JSON.stringify(buildProgrammeBundle(definition, { unit: 'kg' }))
  importProgrammeFile(new File([json], 'programme.json', { type: 'application/json' }), imported)
  await vi.waitFor(() => expect(useUI.getState().sheets).toHaveLength(1))
  const sheet = useUI.getState().sheets[0]
  render(sheet.render(close))
  expect(host.textContent).toContain('Import “Two-week builder”')
  expect(useStore.getState().S).toEqual(initial)
  click('Add to my plan')
  expect(imported).toHaveBeenCalledOnce()
  expect(useStore.getState().S.programmes.definitions).toHaveLength(2)
})