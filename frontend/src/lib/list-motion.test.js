// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { listMove } from './list-motion.js'

// Rows stack 50 px apart in DOM order; every animate() call is recorded.
let calls
function setup(keys) {
  document.body.innerHTML = '<div id="r"></div>'
  const root = document.getElementById('r')
  for (const k of keys) { const el = document.createElement('div'); el.dataset.flipKey = k; el.innerHTML = `<span class="ss" id="x-${k}">${k}</span>`; root.appendChild(el) }
  place()
  return root
}
function place() {
  const root = document.getElementById('r')
  ;[...root.children].forEach((el, i) => {
    if (el.style.position !== 'fixed') el.getBoundingClientRect = () => ({ left: 0, top: i * 50, width: 300, height: 50 })
  })
}
const flush = () => new Promise(r => queueMicrotask(r))
const rowAt = k => document.querySelector(`#r > [data-flip-key="${k}"]`)

beforeEach(() => {
  calls = []
  Element.prototype.animate = function (frames, opts) { const a = { el: this, frames, opts }; calls.push(a); return a }
})
afterEach(() => { document.documentElement.className = ''; document.body.innerHTML = ''; vi.useRealTimers(); delete Element.prototype.animate })

describe('listMove', () => {
  it('writes the data at once, before any animation', () => {
    const root = setup(['a', 'b'])
    let ran = false
    listMove(() => { ran = true; rowAt('a').remove() })
    expect(ran).toBe(true)
    expect(root.children.length).toBe(1)
  })

  it('leave:false makes no ghost for the leaver but the rows below still close up', async () => {
    setup(['a', 'b', 'c'])
    listMove(() => { rowAt('a').remove(); place() }, { leave: false })
    await flush()
    expect(calls.length).toBe(0)
    expect(rowAt('b').style.transition).toMatch(/^transform /)
  })

  it('a leaver becomes an inert ghost that fades in 100 ms ease-out; followers FLIP with transform only', async () => {
    const root = setup(['a', 'b', 'c'])
    listMove(() => { rowAt('a').remove(); place() })
    await flush()
    const g = calls[0].el
    expect(g.getAttribute('aria-hidden')).toBe('true'); expect(g.inert).toBe(true)
    expect(g.hasAttribute('data-flip-key')).toBe(false); expect(g.querySelector('[id]')).toBeNull()
    expect(g.style.position).toBe('fixed'); expect(g.style.pointerEvents).toBe('none')
    expect(calls[0].opts).toMatchObject({ duration: 100, easing: 'ease-out' })
    expect(calls[0].frames[1].transform).toBe('translateX(0px)')
    expect(rowAt('b').style.transition).toMatch(/^transform /)
    calls[0].onfinish(); expect(document.body.contains(g)).toBe(false)
    expect(root.children.length).toBe(2)
  })

  it('archive trails 16 px (the other way in RTL)', async () => {
    setup(['a', 'b'])
    listMove(() => { rowAt('a').remove(); place() }, { slide: true })
    await flush()
    expect(calls[0].frames[1].transform).toBe('translateX(16px)')
    document.documentElement.dir = 'rtl'
    setup(['a', 'b'])
    listMove(() => { rowAt('a').remove(); place() }, { slide: true })
    await flush()
    expect(calls[1].frames[1].transform).toBe('translateX(-16px)')
    document.documentElement.dir = 'ltr'
  })

  it('an arriving row fades in after its delay while the rows below move from t=0', async () => {
    setup(['a', 'b'])
    listMove(() => { const el = document.createElement('div'); el.dataset.flipKey = 'n'; document.getElementById('r').insertBefore(el, rowAt('b')); place() }, { delay: '0ms', enterDelay: 100 })
    await flush()
    expect(calls[0].el.dataset.flipKey).toBe('n')
    expect(calls[0].opts).toMatchObject({ duration: 160, delay: 100, fill: 'backwards' })
    expect(rowAt('b').style.transition).toMatch(/^transform .* 0ms$/)
  })

  it('a held leaver (Move sheet) waits, and the followers wait with it', async () => {
    setup(['a', 'b'])
    listMove(() => { rowAt('a').remove(); place() }, { hold: 280 })
    await flush()
    expect(calls[0].opts.delay).toBe(280)
    expect(rowAt('b').style.transition).toMatch(/ 320ms$/)
  })

  it('ticks the count line of the target and lands the block', async () => {
    vi.useFakeTimers()
    setup(['a', 'b'])
    listMove(() => { rowAt('a').remove(); place() }, { tick: { key: 'b', at: 160 }, land: 'b' })
    await Promise.resolve()
    expect(rowAt('b').classList.contains('cur-land')).toBe(true)
    expect(rowAt('b').querySelector('.ss').classList.contains('drop-tick')).toBe(false)
    vi.advanceTimersByTime(160)
    expect(rowAt('b').querySelector('.ss').classList.contains('drop-tick')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(rowAt('b').classList.contains('cur-land')).toBe(false)
  })

  it('a folder name with quotes and a backslash still ticks and lands (no selector error)', async () => {
    vi.useFakeTimers()
    setup(['a', 'fBlock "A"\\'])
    listMove(() => { rowAt('a').remove(); place() }, { tick: { key: 'fBlock "A"\\', at: 0 }, land: 'fBlock "A"\\' })
    await Promise.resolve()
    vi.advanceTimersByTime(1)
    const b = [...document.querySelectorAll('[data-flip-key]')].find(e => e.dataset.flipKey === 'fBlock "A"\\')
    expect(b.classList.contains('cur-land')).toBe(true)
    expect(b.querySelector('.ss').classList.contains('drop-tick')).toBe(true)
  })

  it('Reduce Motion: the row fades in place, no slide, no FLIP, no tick or land', async () => {
    document.documentElement.classList.add('reduce-motion')
    const root = setup(['a', 'b', 'c'])
    listMove(() => { rowAt('a').remove(); place() }, { slide: true, hold: 280, tick: { key: 'b', at: 0 }, land: 'b' })
    await flush()
    const g = calls[0].el
    expect(g.style.position).not.toBe('fixed')
    expect(g.parentNode).toBe(root); expect(g.nextElementSibling.dataset.flipKey).toBe('b')   // holds its place until the fade ends
    expect(g.inert).toBe(true); expect(g.style.pointerEvents).toBe('none')
    expect(calls[0].opts).toMatchObject({ duration: 120, easing: 'linear' })
    expect(JSON.stringify(calls[0].frames)).not.toMatch(/transform/)
    expect(calls[0].opts.delay).toBeUndefined()
    expect(rowAt('b').style.transition).toBe('')
    expect(rowAt('b').classList.contains('cur-land')).toBe(false)
    calls[0].onfinish(); expect(root.children.length).toBe(2)
  })

  it('Reduce Motion: an arrival fades 120 ms linear, no delay', async () => {
    document.documentElement.classList.add('reduce-motion')
    setup(['a'])
    listMove(() => { const el = document.createElement('div'); el.dataset.flipKey = 'n'; document.getElementById('r').appendChild(el) }, { enterDelay: 100 })
    await flush()
    expect(calls[0].opts).toEqual({ duration: 120, easing: 'linear' })
  })

  it('the phone setting counts too', async () => {
    window.matchMedia = q => ({ matches: /reduce/.test(q) })
    setup(['a', 'b'])
    listMove(() => { rowAt('a').remove(); place() })
    await flush()
    expect(calls[0].el.style.position).not.toBe('fixed')
    delete window.matchMedia
  })
})

describe('Make current CSS', () => {
  const css = readFileSync('src/index.css', 'utf8')
  it('animates only an overlay and the pin, with both Reduce Motion forms', () => {
    expect(css).toContain('.plan-current.cur-land::before{content:\'\';position:absolute;inset:0;z-index:-1;background:var(--acc-soft);animation:cur-tint 200ms linear 120ms backwards}')
    expect(css).toContain('.plan-current.cur-land .plan-pin{animation:cur-pin 220ms var(--ease) 120ms backwards}')
    expect(css).toContain('.reduce-motion .plan-current.cur-land::before,.reduce-motion .plan-current.cur-land .plan-pin{animation:none}')
    expect(css).toContain('@media (prefers-reduced-motion:reduce){.plan-current.cur-land::before,.plan-current.cur-land .plan-pin{animation:none}}')
  })
})
