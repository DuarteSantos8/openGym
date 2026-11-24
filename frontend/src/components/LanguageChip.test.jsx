// @vitest-environment happy-dom
// #1037: the first screen names the language on screen and one tap picks another, for this device.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const m = vi.hoisted(() => ({ sheets: [], setLang: null }))
vi.mock('../store/useStore.js', () => {
  const st = { S: { lang: 'en', langAuto: true } }
  const useStore = sel => (sel ? sel(st) : st)
  useStore.getState = () => st
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const ui = { openSheet: render => { m.sheets.push(render); return { close: vi.fn() } }, toast: vi.fn() }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})
vi.mock('../lib/i18n.js', async orig => {
  const real = await orig()
  return { ...real, setLang: (...a) => m.setLang(...a) }
})
import LanguageChip, { languageOptions } from './LanguageChip.jsx'
import { bindUI } from './ui.jsx'
import { useUI } from '../store/useUI.js'

bindUI(useUI)

let host, root
beforeEach(() => { localStorage.clear(); m.sheets = []; m.setLang = vi.fn(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Language on the first screen', () => {
  it('shows the language on screen and keeps a pick for this device', async () => {
    await act(async () => { root.render(<LanguageChip />) })
    const chip = host.querySelector('.lang-chip')
    expect(chip.textContent).toBe('English')
    expect(chip.getAttribute('aria-label')).toBe('Language: English')
    await act(async () => { chip.click() })
    expect(m.sheets).toHaveLength(1)
    const sheet = document.createElement('div')
    const r2 = createRoot(sheet)
    await act(async () => { r2.render(<>{m.sheets[0](vi.fn())}</>) })
    const de = [...sheet.querySelectorAll('button, [role="option"], .item, .lrow')].find(b => b.textContent.startsWith('Deutsch'))
    expect(de).toBeTruthy()
    await act(async () => { de.click() })
    expect(localStorage.getItem('gym_lang_pick')).toBe('de')
    expect(m.setLang).toHaveBeenCalledWith('de', true, false)
    act(() => r2.unmount())
  })
  it('offers the same list as Settings', () => {
    expect(languageOptions().map(o => o.value)).toContain('pt-BR')
  })
})
