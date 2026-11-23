// @vitest-environment happy-dom
// StrictMode (dev) runs cleanup and the effect again on a block that stays: that must leave no copy behind.
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import ExitFade from './ExitFade.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
afterEach(() => { act(() => root.unmount()); host.remove(); document.querySelectorAll('body > [inert]').forEach(n => n.remove()) })

describe('ExitFade in StrictMode', () => {
  it('mounting leaves no copy; a real unmount does', () => {
    Element.prototype.animate = function () { return {} }
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    const show = on => act(() => root.render(<StrictMode><div className="home">{on && <ExitFade className="x">hi</ExitFade>}</div></StrictMode>))
    show(true)
    expect(document.querySelectorAll('body > [inert]').length).toBe(0)
    show(false)
    expect(document.querySelectorAll('body > [inert]').length).toBe(1)
    delete Element.prototype.animate
  })
})
