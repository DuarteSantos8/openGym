// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { exitCopy } from './exit-copy.js'

afterEach(() => { document.documentElement.className = ''; document.body.innerHTML = ''; delete Element.prototype.animate })
const mk = () => {
  document.body.innerHTML = '<div id="p"><div id="n"><b id="in">x</b></div></div>'
  return document.getElementById('n')
}

describe('exitCopy', () => {
  it('leaves an inert, id-free fixed copy in a layer on body that fades 100 ms ease-out and goes', () => {
    let a
    Element.prototype.animate = function (f, o) { a = { f, o }; return a }
    document.body.animate = Element.prototype.animate
    const n = mk()
    exitCopy(n)
    const g = document.querySelector('body > div:not(#p)')
    expect(g.getAttribute('aria-hidden')).toBe('true'); expect(g.inert).toBe(true)
    expect(g.querySelector('[id]')).toBeNull()
    expect(g.querySelector('b').textContent).toBe('x')
    expect(g.style.position).toBe('fixed'); expect(g.style.pointerEvents).toBe('none')
    expect(a.o).toMatchObject({ duration: 100, easing: 'ease-out' })
    a.onfinish(); expect(g.isConnected).toBe(false)
  })
  it('makes nothing under Reduce Motion', () => {
    Element.prototype.animate = () => ({})
    document.documentElement.classList.add('reduce-motion')
    exitCopy(mk())
    expect(document.querySelectorAll('body > div').length).toBe(1)
  })
})
