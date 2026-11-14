// @vitest-environment happy-dom
// The colour and icon sheet: twelve named swatches, the glyph groups, and nothing written until Done.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => {
  const state = { S: null, sheets: [] }
  state.store = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = sel => (sel ? sel(m.store()) : m.store())
  useStore.getState = m.store
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const ui = { openSheet: render => { m.sheets.push(render) } }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})

import { routineLookSheet } from './RoutineLook.jsx'
import { ROUTINE_COLORS } from '../lib/routine-colors.js'

let host, root, close
const click = el => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const byLabel = l => host.querySelector(`[aria-label="${l}"]`)
const byText = txt => [...host.querySelectorAll('button')].find(b => b.textContent === txt)

beforeEach(async () => {
  m.S = { routines: [{ id: 'r1', name: 'Lower A', emoji: 'figureStrength', color: 'blue', ex: [] }] }
  m.sheets = []
  close = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  routineLookSheet('r1')
  await act(async () => { root.render(m.sheets[0](close)) })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('RoutineLook', () => {
  it('shows one named swatch per colour, the current one pressed', () => {
    const sw = host.querySelectorAll('[data-swatch]')
    expect(sw.length).toBe(ROUTINE_COLORS.length)
    expect(byLabel('Blue').getAttribute('aria-pressed')).toBe('true')
    expect(byLabel('Orange').getAttribute('aria-pressed')).toBe('false')
  })

  it('writes the colour on Done and the line under the swatches names it', async () => {
    await click(byLabel('Orange'))
    expect(host.querySelector('[data-colour-name]').textContent).toBe('Orange')
    expect(m.S.routines[0].color).toBe('blue')
    await click(byText('Done'))
    expect(m.S.routines[0].color).toBe('orange')
    expect(close).toHaveBeenCalled()
  })

  it('writes the glyph on Done', async () => {
    await click(byLabel('splitPush'))
    await click(byText('Done'))
    expect(m.S.routines[0].emoji).toBe('splitPush')
  })

  it('writes nothing on Cancel', async () => {
    await click(byLabel('Orange'))
    await click(byLabel('splitPush'))
    await click(byText('Cancel'))
    expect(m.S.routines[0]).toMatchObject({ color: 'blue', emoji: 'figureStrength' })
    expect(close).toHaveBeenCalled()
  })
})
