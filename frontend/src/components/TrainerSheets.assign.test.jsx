// @vitest-environment happy-dom
// The assign sheet sends a routine that is still live, even if a sync archived the first pick.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'

const assignRoutine = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('../lib/trainer-api.js', async orig => ({ ...(await orig()), assignRoutine }))

import { AssignSheet } from './TrainerSheets.jsx'

const ex = [{ id: '0025', sets: 3, reps: 5 }]
const members = [{ member: { id: 'm1', name: 'Ana' }, levels: { plans: 'apply' } }]
let root, host

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  assignRoutine.mockClear()
  useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'a', name: 'Upper A', ex }, { id: 'b', name: 'Upper B', ex }] } }))
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('assign sheet', () => {
  it('falls back to a live routine when the picked one is archived while the sheet is open', () => {
    act(() => root.render(<AssignSheet members={members} close={() => {}} />))
    act(() => useStore.setState(s => ({ S: { ...s.S, routines: s.S.routines.map(r => (r.id === 'a' ? { ...r, archived: true } : r)) } })))
    expect(host.textContent).toContain('Upper B')
    act(() => [...host.querySelectorAll('button')].find(b => /^Send to/.test(b.textContent)).click())
    expect(assignRoutine).toHaveBeenCalledWith(expect.objectContaining({ routineId: 'b' }))
  })
})
