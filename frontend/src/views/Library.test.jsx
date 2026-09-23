// @vitest-environment happy-dom
// Favourites (issue #6): the Library floats starred exercises to the top of the current
// result list — after the search and body-part filters, without reordering the rest.
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Library from './Library.jsx'
import { EXDB } from '../lib/exercises.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({ exerciseDetailSheet: vi.fn(), addToRoutineSheet: vi.fn(), customExSheet: vi.fn() }))

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Library />))
  return host
}
const names = host => [...host.querySelectorAll('.item .tt')].map(el => el.textContent).slice(1)   // drop "Create your own"
const cssSource = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

beforeEach(() => {
  mocks.S = { unit: 'kg', lang: 'en', routines: [], workouts: [], customEx: [], exWeights: {}, equipProfiles: [], activeEquipId: null, equipFilterOn: false }
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Library favourites', () => {
  it('puts favourites first, marked with a star, and leaves the rest in catalogue order', () => {
    const plain = names(render())
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    const fav = [plain[6], plain[2]]
    mocks.S.favEx = fav.map(n => EXDB.find(e => e.n === n).id)
    const host = render()
    const shown = names(host)
    expect(shown.slice(0, 2)).toEqual(plain.filter(n => fav.includes(n)))
    expect(shown.slice(2)).toEqual(plain.filter(n => !fav.includes(n)))
    const rows = [...host.querySelectorAll('.item')].slice(1)
    expect(rows[0].querySelector('.fav-star')).not.toBeNull()
    expect(rows[2].querySelector('.fav-star')).toBeNull()
  })

  // The Library is the one page whose header puts a text button beside the title, so it leaves the
  // title the least room of anywhere in the app — 95px for Polish, 125px for Russian on a 320px
  // screen. The button must stay reachable (it is flex:none, the title block shrinks), but a title
  // squeezed that far must not come apart: at 34px "Упражнения" broke into three lines, so the
  // title drops a step on phone widths and breaks a word only as a last resort.
  it('keeps the header button reachable without shredding the title', () => {
    expect(cssSource).toContain('.hdr>div{min-width:0}')
    expect(cssSource).toContain('.hdr>.btn{flex:none}')
    expect(cssSource).toMatch(/@media \(max-width:420px\)\{\.hdr h1\{font-size:30px\}\}/)
    const h1 = cssSource.match(/^\.hdr h1\{([^}]*)\}/m)
    expect(h1?.[1]).toContain('overflow-wrap:break-word')
    expect(h1[1]).not.toContain('overflow-wrap:anywhere')
    expect(h1[1]).not.toContain('hyphens:auto')
  })

  it('keeps a favourite on top inside a body-part filter, but never pulls one in from elsewhere', () => {
    const chest = EXDB.filter(e => e.bp === 'chest')
    const legs = EXDB.find(e => e.bp !== 'chest')
    mocks.S.favEx = [chest[4].id, legs.id]
    const host = render()
    const chip = [...host.querySelectorAll('.chips .chip')].find(b => b.textContent === 'chest')
    act(() => chip.click())
    const shown = names(host)
    expect(shown[0]).toBe(chest[4].n)
    expect(shown).not.toContain(legs.n)
  })
})
