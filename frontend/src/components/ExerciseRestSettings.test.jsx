// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exerciseRestSettingsSheet } from './ExerciseRestSettings.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindUI } from './ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let original, host, root, sheet
beforeEach(() => {
  bindUI(useUI)
  original = useStore.getState()
  const S = structuredClone(original.S)
  S.restSec = 90
  S.active = { id: 'a', entries: [{ id: 'squat', target: { workRestSec: 120 }, sets: [
    { phase: 'warmup', done: false, restSec: 10 }, { phase: 'warmup', done: false },
    { phase: 'work', done: false },
  ] }] }
  useStore.setState({ S, update: mutate => {
    const next = structuredClone(useStore.getState().S)
    mutate(next); useStore.setState({ S: next })
  } })
  useUI.setState({ sheets: [] })
  exerciseRestSettingsSheet(0)
  sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  act(() => root.render(sheet.render(vi.fn())))
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  useStore.setState(original); useUI.setState({ sheets: [] })
})
const save = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
const entry = () => useStore.getState().S.active.entries[0]
const choose = (title, option) => {
  act(() => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title).click())
  const picker = useUI.getState().sheets.at(-1)
  const div = document.createElement('div'), r = createRoot(div)
  act(() => r.render(picker.render(vi.fn())))
  act(() => [...div.querySelectorAll('button')].find(b => b.textContent.includes(option)).click())
  act(() => r.unmount())
}

it('keeps edits local until Save and distinguishes Off from Default', () => {
  choose('Warm-up', 'Off')
  choose('Work sets', 'Off')
  choose('Warm-up · Set 1', 'Default')
  expect(entry().target.warmupRestSec).toBeUndefined()
  expect(entry().sets[0].restSec).toBe(10)
  save()
  expect(entry().target).toMatchObject({ warmupRestSec: 0, workRestSec: 0 })
  expect(entry().sets[0]).not.toHaveProperty('restSec')
  // Session state round-trips without dropping the distinction between zero and absence.
  expect(JSON.parse(JSON.stringify(entry())).target.workRestSec).toBe(0)
})

it.each(['reorder', 'insert', 'new workout'])('does not save into a stale %s', kind => {
  choose('Work sets', 'Off')
  useStore.getState().update(s => {
    if (kind === 'new workout') s.active.id = 'b'
    else if (kind === 'insert') s.active.entries[0].sets.unshift({ phase: 'warmup' })
    else s.active.entries[0].sets.reverse()
  })
  save()
  expect(entry().target.workRestSec).toBe(120)
})

it('closing without saving leaves the session alone', () => {
  choose('Work sets', 'Off')
  expect(entry().target.workRestSec).toBe(120)
})
