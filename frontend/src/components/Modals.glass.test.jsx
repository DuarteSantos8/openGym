import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modals, { afterScrollRestore, scrollRestorePending } from './Modals.jsx'

const mocks = vi.hoisted(() => {
  const listeners = new Set()
  const state = {
    sheets: [],
    closeSheet(id) {
      state.sheets = state.sheets.filter(sheet => sheet.id !== id)
      listeners.forEach(listener => listener())
    },
  }
  return {
    state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSheets(sheets) {
      state.sheets = sheets
      listeners.forEach(listener => listener())
    },
  }
})

vi.mock('../store/useUI.js', async () => {
  const React = await import('react')
  const useUI = (selector = state => state) => React.useSyncExternalStore(
    mocks.subscribe,
    () => selector(mocks.state),
    () => selector(mocks.state),
  )
  useUI.getState = () => mocks.state
  return { useUI }
})

let dom
let root

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="app"></div><div id="tabbar"></div><div id="host"></div></body></html>')
  dom = parsed.window
  dom.scrollTo = vi.fn()
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://opengym.test/#/home' } })
  Object.defineProperty(globalThis, 'history', { configurable: true, value: { pushState: vi.fn(), go: vi.fn() } })
  document.documentElement.dataset.platform = 'ios'
  root = createRoot(document.getElementById('host'))
}

const form = () => React.createElement('div', null,
  React.createElement('h3', null, 'Rename'), React.createElement('input', { defaultValue: 'Push day' }),
  React.createElement('button', { className: 'btn ghost dim' }, 'Cancel'))
const open = async (render, extra = {}) => {
  await act(async () => { mocks.setSheets([{ id: 's1', locked: false, kind: 'sheet', render, ...extra }]) })
}
const type = async value => {
  const input = document.querySelector('.sheet input')
  await act(async () => { input.dispatchEvent(new dom.Event('focusin', { bubbles: true })) })
  input.value = value
}

beforeEach(async () => {
  mocks.state.sheets = []
  installDom()
  await act(async () => { root.render(React.createElement(Modals)) })
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  root = null
  dom = null
  vi.restoreAllMocks()
})

describe('iPhone sheets (Liquid Glass G4)', () => {
  it('names the sheet from its title and makes everything behind it inert', async () => {
    await open(form)
    const el = document.querySelector('.sheet')
    expect(el.getAttribute('aria-labelledby')).toBe(el.querySelector('h3').id)
    expect(el.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById('app').inert).toBe(true)
    expect(document.getElementById('tabbar').inert).toBe(true)
    await act(async () => { mocks.setSheets([]) })
    expect(document.getElementById('app').inert).toBe(false)
  })

  it('closes from the dim when nothing was typed', async () => {
    await open(form)
    await act(async () => { document.querySelector('.mback').click() })
    expect(mocks.state.sheets).toEqual([])
  })

  it('closes on Esc when nothing was typed', async () => {
    await open(form)
    await act(async () => { const e = new dom.Event('keydown'); e.key = 'Escape'; window.dispatchEvent(e) })
    expect(mocks.state.sheets).toEqual([])
  })

  it('keeps a sheet with an edit open against the dim and Esc; only its own button closes it', async () => {
    await open(form)
    await type('Pull day')
    await act(async () => { document.querySelector('.mback').click() })
    expect(mocks.state.sheets).toHaveLength(1)
    await act(async () => { { const e = new dom.Event('keydown'); e.key = 'Escape'; window.dispatchEvent(e) } })
    expect(mocks.state.sheets).toHaveLength(1)
    await act(async () => { mocks.state.closeSheet('s1') })
    expect(mocks.state.sheets).toEqual([])
  })

  it('a sheet with no Cancel closes from the dim even after typing', async () => {
    await open(() => React.createElement('div', null, React.createElement('h3', null, 'Note'), React.createElement('input', { defaultValue: '' })))
    await type('abc')
    await act(async () => { document.querySelector('.mback').click() })
    expect(mocks.state.sheets).toEqual([])
  })

  it('an untitled surface still takes focus', async () => {
    await open(() => React.createElement('div', null, React.createElement('button', null, 'One')))
    expect(document.querySelector('.sheet').tabIndex).toBe(-1)   // linkedom has no activeElement
  })

  it('does not treat a search box as an edit', async () => {
    await open(() => React.createElement('div', null, React.createElement('h3', null, 'Pick'),
      React.createElement('div', { className: 'picker-search' }, React.createElement('input', { defaultValue: '' }))))
    await type('squat')
    await act(async () => { document.querySelector('.mback').click() })
    expect(mocks.state.sheets).toEqual([])
  })

  it('a locked sheet stays shut to the dim', async () => {
    await open(form, { locked: true })
    await act(async () => { document.querySelector('.mback').click() })
    expect(mocks.state.sheets).toHaveLength(1)
  })
})
