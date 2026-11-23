// @vitest-environment happy-dom
// iPhone Duo closed: the tab bar stands in the system's side column, below the clock.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ listener: null, bar: { side: null, top: 0 }, fail: false }))

const pluginProxy = () => new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'then') return () => new Promise(() => {})
    if (prop === 'addListener') return async (_event, fn) => { h.listener = fn }
    if (prop === 'get') return async () => {
      if (h.fail) throw new Error('"VerticalBar" plugin is not implemented on ios')
      return h.bar
    }
    return undefined
  },
})
vi.mock('@capacitor/core', () => ({ registerPlugin: () => pluginProxy() }))

beforeEach(() => {
  vi.resetModules()
  h.listener = null
  h.bar = { side: null, top: 0 }
  h.fail = false
  globalThis.Capacitor = { getPlatform: () => 'ios' }
  delete document.documentElement.dataset.vbar
  document.documentElement.style.removeProperty('--vbar-top')
})

const root = () => document.documentElement

describe('vertical bar', () => {
  it('puts the tabs in the column the phone reports, and back at the bottom when it goes', async () => {
    h.bar = { side: 'right', top: 174 }
    const { watchVerticalBar } = await import('./vertical-bar.js')
    await watchVerticalBar()
    expect(root().dataset.vbar).toBe('right')
    expect(root().style.getPropertyValue('--vbar-top')).toBe('174px')

    h.listener({ side: null, top: 0 })
    expect(root().dataset.vbar).toBeUndefined()
    expect(root().style.getPropertyValue('--vbar-top')).toBe('')
  })

  it('keeps the bottom bar for anything that is not a side', async () => {
    const { applyVerticalBar } = await import('./vertical-bar.js')
    applyVerticalBar({ side: 'top', top: 20 })
    expect(root().dataset.vbar).toBeUndefined()
    applyVerticalBar({ side: 'left', top: -3 })
    expect(root().style.getPropertyValue('--vbar-top')).toBe('0px')
  })

  it('leaves the bottom bar alone on Android and in an app without the plugin', async () => {
    globalThis.Capacitor = { getPlatform: () => 'android' }
    h.bar = { side: 'right', top: 174 }
    let { watchVerticalBar } = await import('./vertical-bar.js')
    await watchVerticalBar()
    expect(root().dataset.vbar).toBeUndefined()

    vi.resetModules()
    globalThis.Capacitor = { getPlatform: () => 'ios' }
    h.fail = true
    ;({ watchVerticalBar } = await import('./vertical-bar.js'))
    await expect(watchVerticalBar()).resolves.toBeUndefined()
    expect(root().dataset.vbar).toBeUndefined()
  })
})
