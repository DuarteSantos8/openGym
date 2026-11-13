// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useUI } from '../store/useUI.js'
import { openProgressCompare } from './ProgressPhotos.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const photo = (d, n) => ({ d, key: 'k' + n, m: { kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', width: 3, height: 4 } })

describe('before/after compare in a right-to-left language', () => {
  let root, host
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    document.documentElement.removeAttribute('dir')
    useUI.getState().closeAll()
  })

  it('keeps the stage left-to-right so the handle follows the finger and "before" sits on the before photo', () => {
    document.documentElement.setAttribute('dir', 'rtl')
    openProgressCompare(photo('2026-01-01', 1), photo('2026-03-01', 2))
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
    const stage = host.querySelector('.pcmp-stage')
    expect(stage).not.toBeNull()
    expect(stage.getAttribute('dir')).toBe('ltr')
  })
})

describe('comparing more than two (#950)', () => {
  let root, host
  afterEach(() => { act(() => root?.unmount()); host?.remove(); useUI.getState().closeAll() })
  const mount = () => {
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
  }
  it('takes up to nine, oldest first, with no slider choice past two', () => {
    const list = Array.from({ length: 11 }, (_, i) => photo('2026-0' + (9 - (i % 9)) + '-01', i + 1))
    openProgressCompare(list)
    mount()
    expect(host.textContent).not.toContain('Slider')
    expect(host.querySelector('[aria-label="Share as image"]')).not.toBeNull()
  })
  it('two photos offer the slider and side by side', () => {
    openProgressCompare(photo('2026-03-01', 2), photo('2026-01-01', 1))
    mount()
    expect(host.textContent).toContain('Slider')
    expect(host.textContent).toContain('Side by side')
    expect(host.textContent).toContain('59 days apart')
  })
  it('one photo opens nothing', () => {
    const before = useUI.getState().sheets.length
    openProgressCompare([photo('2026-03-01', 2)])
    expect(useUI.getState().sheets.length).toBe(before)
  })
})
