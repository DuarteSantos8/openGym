// @vitest-environment happy-dom
// Restoring from the Archive screen (motion moment 4, restore): the row leaves, the rest close up;
// data first. Reduce Motion: the row fades in place, no transform anywhere.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import RoutineArchive from './RoutineArchive.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', async orig => ({ ...(await orig()), menuSheet: vi.fn(), confirmSheet: vi.fn() }))

const routine = (id, name) => ({ id, name, ex: [{ id: '0025' }], archived: true })
let host, root, calls
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls = []
  Element.prototype.animate = function (frames, opts) { calls.push({ el: this, frames, opts }); return {} }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S, routines: [routine('a', 'One'), routine('b', 'Two')], routineFolders: [], week: {}, dayPlan: {} }, user: null }))
  act(() => root.render(<RoutineArchive />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.className = ''; delete Element.prototype.animate })

const btn = () => host.querySelector('[data-flip-key="a"] .arch-restore')

describe('Archive restore motion', () => {
  it('rows carry flip keys and a restore leaves as a ghost without a slide', async () => {
    expect(host.querySelector('[data-flip-key="b"]')).not.toBeNull()
    await act(async () => { btn().click(); await Promise.resolve() })
    expect(useStore.getState().S.routines[0].archived).toBeFalsy()
    const out = calls.find(c => c.opts.duration === 100)
    expect(out.frames[1].transform).toBe('translateX(0px)')
  })

  it('html.reduce-motion: the row fades in place, no transform', async () => {
    document.documentElement.classList.add('reduce-motion')
    await act(async () => { btn().click(); await Promise.resolve() })
    expect(calls.every(c => !JSON.stringify(c.frames).includes('transform'))).toBe(true)
    expect(calls[0].opts).toMatchObject({ duration: 120, easing: 'linear' })
    for (const el of host.querySelectorAll('[data-flip-key]')) expect(el.style.transition).toBe('')
  })
})
