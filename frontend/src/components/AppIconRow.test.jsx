// @vitest-environment happy-dom
// Settings → Look & Home → App icon: the home-screen icons the phone can switch to, the one in use
// ringed, and a switch through the AppIcon plugin. iPhone only in 1.4.3: on Android (no plugin until
// 1.4.4), in a browser, or where the phone says it cannot switch icons, the row is not there at all.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ICON_VARIANTS } from '../lib/app-icon-variants.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ state: { supported: true, name: 'default' }, later: false, fail: false, calls: [], asked: 0, toast: null }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: m.toast }) } }))
// Like the real proxy: `then` is a native call that never settles (lib/app-icon.js keeps it in an object).
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => new Proxy({}, {
    get: (_, prop) => {
      if (prop === 'then') return () => new Promise(() => {})
      if (prop === 'getIcon') return async () => { m.asked++; return { ...m.state } }
      if (prop === 'setIcon') return async arg => {
        m.calls.push(arg)
        if (m.fail) throw new Error('refused')
        m.state = { ...m.state, name: arg.name }
        return { name: arg.name, later: m.later }
      }
      return undefined
    },
  }),
}))

const { default: AppIconRow } = await import('./AppIconRow.jsx')
const { _resetAppIconForTests } = await import('../lib/app-icon.js')
const { searchSettings } = await import('../views/settings-pages.js')

let host, root
beforeEach(() => {
  Object.assign(m, { state: { supported: true, name: 'default' }, later: false, fail: false, calls: [], asked: 0, toast: vi.fn() })
  globalThis.Capacitor = { getPlatform: () => 'ios' }
  _resetAppIconForTests()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete globalThis.Capacitor })

const mount = async () => { await act(async () => { root.render(<AppIconRow />) }) }
const buttons = () => [...host.querySelectorAll('.app-icon')]
const chosen = () => buttons().filter(b => b.classList.contains('on')).map(b => b.getAttribute('aria-label'))
const tap = async label => { await act(async () => { buttons().find(b => b.getAttribute('aria-label') === label).click() }) }

describe('App icon row', () => {
  it('shows every icon with its preview and rings the one on the home screen', async () => {
    m.state.name = 'mono'
    await mount()
    expect(host.querySelector('.lrow-t').textContent).toBe('App icon')
    expect(buttons().map(b => b.getAttribute('aria-label'))).toEqual(APP_ICON_VARIANTS.map(v => v.name))
    expect(buttons().map(b => b.querySelector('img').getAttribute('src'))).toEqual(APP_ICON_VARIANTS.map(v => `app-icons/${v.id}.png`))
    expect(chosen()).toEqual(['Mono'])
    expect(host.querySelector('.lrow-v').textContent).toBe('Mono')
  })

  it('switches on iOS, where the system alert is all the confirmation there is', async () => {
    await mount()
    await tap('Pink')
    expect(m.calls).toEqual([{ name: 'pink' }])
    expect(chosen()).toEqual(['Pink'])
    expect(m.toast).not.toHaveBeenCalled()
  })

  it('offers the Halloween icon last, all year', async () => {
    await mount()
    expect(buttons().at(-1).getAttribute('aria-label')).toBe('Halloween')
    await tap('Halloween')
    expect(m.calls).toEqual([{ name: 'halloween' }])
    expect(chosen()).toEqual(['Halloween'])
  })

  it('a tap on the icon in use asks the phone nothing', async () => {
    await mount()
    await tap('Original')
    expect(m.calls).toEqual([])
  })

  it('keeps the old ring and says so when the phone refuses', async () => {
    m.fail = true
    await mount()
    await tap('Light')
    expect(chosen()).toEqual(['Original'])
    expect(m.toast).toHaveBeenCalledWith('The icon could not be changed.')
  })

  it('is not there where the phone cannot switch icons', async () => {
    m.state.supported = false
    await mount()
    expect(host.innerHTML).toBe('')
  })

  it('is not there on Android in 1.4.3, and the phone is not even asked', async () => {
    globalThis.Capacitor = { getPlatform: () => 'android' }
    await mount()
    expect(host.innerHTML).toBe('')
    expect(m.asked).toBe(0)
  })

  it('is not there in a browser', async () => {
    delete globalThis.Capacitor
    await mount()
    expect(host.innerHTML).toBe('')
    expect(m.calls).toEqual([])
  })

  it('the settings search offers it only where the row can show', () => {
    const tr = s => s
    const ctx = { user: null, mobile: true, android: true, demo: false }
    expect(searchSettings('app icon', { ...ctx, appIcons: true }, tr).map(h => h.title)).toEqual(['App icon'])
    expect(searchSettings('app icon', { ...ctx, mobile: false, appIcons: false }, tr)).toEqual([])
  })
})
