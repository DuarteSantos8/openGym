// @vitest-environment happy-dom
// The Skills screen catches up with the whole log on mount (withEarned): a skill already had whose
// newer session moves its stamp up is saved too, without a toast; a skill newly had gets one.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Skills from './Skills.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { withSkill } from '../lib/skill-tree.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const PULL_UP = '0652'
const T10 = Date.parse('2026-10-10T12:00:00'), T40 = Date.parse('2026-11-09T12:00:00')
const session = (d, end) => ({ id: 'w' + d, d, start: end - 3600e3, end, entries: [{ id: PULL_UP, sets: Array.from({ length: 3 }, () => ({ done: true, r: 7 })) }] })

let root, container
function mount(over) {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), ...over }, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Skills /></MemoryRouter>))
}
let toast
beforeEach(() => { toast = vi.spyOn(useUI.getState(), 'toast') })
afterEach(() => { toast.mockRestore(); act(() => root.unmount()); container.remove() })

describe('Skills on mount', () => {
  it('saves a newer session’s stamp on a skill already had, its day kept, with no toast', () => {
    const had = withSkill({}, 'pull-up', T10, '2026-10-10')
    mount({ workouts: [session('2026-10-10', T10), session('2026-11-09', T40)], skills: had })
    const skills = useStore.getState().S.skills
    // the day kept; the stamp moved up past the newer session (the store then gives a saved change
    // its own time, lib/sync-merge.js), so a take-back made before that session cannot win the merge
    for (const id of Object.keys(had)) {
      expect(skills[id].at).toBe('2026-10-10')
      expect(skills[id]._ts).toBeGreaterThanOrEqual(T40)
    }
    expect(toast).not.toHaveBeenCalled()
  })
  it('names a skill newly had in a toast', () => {
    mount({ workouts: [session('2026-10-10', T10)], skills: {} })
    expect(useStore.getState().S.skills['pull-up'].at).toBe('2026-10-10')
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
