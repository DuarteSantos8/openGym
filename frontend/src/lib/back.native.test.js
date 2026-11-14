// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initBackButton } from './back.js'

const { App, ui, remove } = vi.hoisted(() => ({
  App: { addListener: vi.fn(), exitApp: vi.fn() },
  ui: { sheets: [], closeSheet: vi.fn(), toast: vi.fn() },
  remove: vi.fn(),
}))
vi.mock('@capacitor/app', () => ({ App }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ui } }))

let back
beforeEach(() => {
  vi.clearAllMocks()
  App.addListener.mockResolvedValue({ remove })
  back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})
afterEach(() => {
  back.mockRestore()
  history.replaceState(null, '', '/')
})

describe('the native back listener', () => {
  it('reads the current hash route without its query and checks the current navigation key', async () => {
    history.replaceState({ key: 'stats-1' }, '', '#/stats?range=month')
    const stop = await initBackButton()
    expect(App.addListener.mock.calls[0][0]).toBe('backButton')
    const handler = App.addListener.mock.calls[0][1]
    expect(handler({ canGoBack: true })).toBe('arm-exit')
    // Router replacements change the key even if navigation returned to the same URL.
    history.replaceState({ key: 'stats-2' }, '', '#/stats?range=month')
    expect(handler({ canGoBack: true })).toBe('arm-exit')
    expect(App.exitApp).not.toHaveBeenCalled()
    expect(handler({ canGoBack: true })).toBe('exit')
    expect(App.exitApp).toHaveBeenCalledOnce()
    expect(back).not.toHaveBeenCalled()
    await stop()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('keeps native Back navigating history on a detail page', async () => {
    history.replaceState({ key: 'detail' }, '', '#/plan/r/one')
    const stop = await initBackButton()
    const handler = App.addListener.mock.calls[0][1]
    expect(handler({ canGoBack: true })).toBe('history')
    expect(back).toHaveBeenCalledOnce()
    expect(ui.toast).not.toHaveBeenCalled()
    expect(App.exitApp).not.toHaveBeenCalled()
    await stop()
  })
})
