import { describe, it, expect, beforeEach, vi } from 'vitest'

// --- Mocks (factories must be self-contained — no external refs) ---

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(),
    minimizeApp: vi.fn()
  }
}))

// Sheets state lives outside the factory so tests can mutate it,
// but the factory itself returns a function that reads from it.
const _sheets = { value: [] }
const _closeSheet = vi.fn(id => { _sheets.value = _sheets.value.filter(s => s.id !== id) })

vi.mock('../store/useUI.js', () => ({
  useUI: {
    getState: () => ({
      get sheets() { return _sheets.value },
      closeSheet: _closeSheet
    })
  }
}))

// --- Import the real handler under test ---

import { handleBack } from './useBackButton.js'
import { App } from '@capacitor/app'

// --- Tests ---

describe('handleBack – Android back gesture', () => {
  beforeEach(() => {
    _sheets.value = []
    _closeSheet.mockClear()
    App.minimizeApp.mockClear()
  })

  it('closes the topmost unlocked sheet when sheets are open', () => {
    _sheets.value = [
      { id: 'a', locked: false },
      { id: 'b', locked: false }
    ]

    handleBack({ canGoBack: true })
    expect(_closeSheet).toHaveBeenCalledWith('b')
  })

  it('skips locked sheets and closes the next unlocked one', () => {
    _sheets.value = [
      { id: 'a', locked: false },
      { id: 'b', locked: true }
    ]

    handleBack({ canGoBack: true })
    expect(_closeSheet).toHaveBeenCalledWith('a')
  })

  it('does nothing destructive when all sheets are locked', () => {
    _sheets.value = [
      { id: 'a', locked: true },
      { id: 'b', locked: true }
    ]

    handleBack({ canGoBack: true })
    expect(_closeSheet).not.toHaveBeenCalled()
    expect(App.minimizeApp).not.toHaveBeenCalled()
  })

  it('navigates back when canGoBack is true and no sheets are open', () => {
    const back = vi.fn()
    vi.stubGlobal('window', { history: { back } })

    handleBack({ canGoBack: true })
    expect(back).toHaveBeenCalledOnce()

    vi.unstubAllGlobals()
  })

  it('minimizes the app when canGoBack is false and no sheets are open', () => {
    handleBack({ canGoBack: false })
    expect(App.minimizeApp).toHaveBeenCalledOnce()
  })

  it('does not navigate or minimize when a sheet was closed instead', () => {
    const back = vi.fn()
    vi.stubGlobal('window', { history: { back } })

    _sheets.value = [{ id: 'x', locked: false }]

    handleBack({ canGoBack: true })
    expect(back).not.toHaveBeenCalled()
    expect(App.minimizeApp).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
