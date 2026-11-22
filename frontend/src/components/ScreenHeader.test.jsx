// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ScreenHeader from './ScreenHeader.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const show = async (platform, props) => {
  if (platform) document.documentElement.dataset.platform = platform
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(<ScreenHeader title="History" sub="3 workouts" left={<button className="iconbtn">back</button>} right={<button className="iconbtn">more</button>} {...props} />) })
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete document.documentElement.dataset.platform })

describe('ScreenHeader', () => {
  it('is the old large-title row off the iPhone', async () => {
    await show(null)
    expect(host.querySelector('.gh, .nav, .edge')).toBeNull()
    expect(host.querySelector('.hdr > button + div[style] > h1')?.textContent).toBe('History')
  })

  it('on the iPhone: buttons in the nav row, one h1, the small title hidden from VoiceOver', async () => {
    await show('ios')
    expect([...host.querySelectorAll('.nav button')].map(b => b.textContent)).toEqual(['back', 'more'])
    expect(host.querySelectorAll('h1')).toHaveLength(1)
    expect(host.querySelector('.inl').getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelectorAll('.edge[aria-hidden="true"], .edge-b[aria-hidden="true"]')).toHaveLength(2)
    expect(host.querySelector('.gh').classList.contains('hard')).toBe(false)
  })

  it('wide keeps the Library buttons in the content, under the title', async () => {
    await show('ios', { wide: true, hard: true, left: null })
    expect(host.querySelector('.nav button')).toBeNull()
    expect(host.querySelector('.gh').classList.contains('hard')).toBe(true)
    expect(host.querySelector('.hdr').nextElementSibling.textContent).toBe('more')
  })
})

// CodeRabbit on #1058: the page an edge swipe back shows underneath (App.jsx) may have a header when
// the page on top has none (Plan under a routine's editor); the editor must not move down by it.
describe('header room on the iPhone', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  it('comes from the page on top, and the page underneath brings its own', () => {
    expect(css).not.toMatch(/#app:has\(\.gh/)
    expect(css).toContain(':root[data-platform="ios"] #app:has(> .page:not(.under) .gh){padding-top:var(--ebr)}')
    expect(css).toContain(':root[data-platform="ios"] #app > .page.under:has(.gh){padding-top:var(--ebr)}')
  })
})
