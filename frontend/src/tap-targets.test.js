// P7 (1.4.5 UX round): the guest line's × was a 26 px target and the links under About 15 px
// tall. Small controls keep their painted size and get an invisible ::before that brings the
// target to about 44 px, the way .iconbtn and .chip always had it. Measured in a real browser by
// the QA rig's probe (elementFromPoint around each control); this file keeps the rules in place.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rulesFor = sel => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].split(',').map(s => s.trim()).includes(sel)).map(m => m[2])
const px = (sel, prop) => { const m = rulesFor(sel).join(';').match(new RegExp('(?:^|;)\\s*' + prop + ':(\\d+)px')); return m ? Number(m[1]) : null }
// the last inset a ::before of `sel` gets: [vertical, horizontal] growth in px per side
const grow = sel => {
  const all = rulesFor(sel + '::before').map(r => r.match(/inset:(-?\d+)px(?: (-?\d+)(?:px)?)?/)).filter(Boolean)
  const m = all.at(-1)
  return m ? [-Number(m[1]), -(m[2] === undefined ? Number(m[1]) : Number(m[2]))] : null
}

describe('tap targets of small controls', () => {
  it('the guest line’s × is still painted 26 px and taps like 44', () => {
    expect(px('.conn-x', 'width')).toBe(26)
    expect(px('.conn-x', 'height')).toBe(26)
    const [v, h] = grow('.conn-x')
    expect(26 + 2 * v).toBeGreaterThanOrEqual(44)
    expect(26 + 2 * h).toBeGreaterThanOrEqual(44)
  })
  it('the links under About get a 44 px tall target without growing the text', () => {
    const [v] = grow('.sp-version a')
    // one line of small text is at least 15 px tall
    expect(15 + 2 * v).toBeGreaterThanOrEqual(43)
    expect(rulesFor('.sp-version a').join(';')).not.toMatch(/padding|font-size|line-height|display/)
  })
  it('the words of an About link lie above its neighbours’ targets', () => {
    expect(rulesFor('.sp-version').join(';')).toMatch(/z-index:0/)
    expect(rulesFor('.sp-version a>span').join(';')).toMatch(/position:relative;z-index:1/)
    const jsx = readFileSync(fileURLToPath(new URL('./views/Settings.jsx', import.meta.url)), 'utf8')
    const block = jsx.slice(jsx.indexOf('sp-version'), jsx.indexOf('sp-version') + 1200)
    const links = block.match(/<a [^>]*>(.*?)<\/a>/g) || []
    expect(links.length).toBe(3)
    for (const a of links) expect(a).toMatch(/><span>.*<\/span><\/a>$/)
  })
  it.each([
    ['.btn.sm', 35], ['button.conn', 34], ['.sp-back', 34], ['.sw', 31], ['.bw-rate', 32], ['.weekly-volume-toggle', 22], ['.slevel-about', 18],
  ])('%s (painted about %i px tall) reaches 44 px', (sel, painted) => {
    const g = grow(sel)
    expect(g, sel + ' has a hit area').toBeTruthy()
    expect(painted + 2 * g[0]).toBeGreaterThanOrEqual(44)
    expect(rulesFor(sel).join(';')).toMatch(/position:relative/)
  })
  it('a switch and a small button only grow up and down, so a neighbour beside them keeps its edge', () => {
    for (const sel of ['.sw', '.btn.sm', 'button.conn', '.sp-back']) expect(Math.abs(grow(sel)[1]), sel).toBe(0)
  })
  it('the hit areas paint nothing', () => {
    for (const sel of ['.conn-x', '.btn.sm', '.sw', '.sp-version a']) {
      for (const r of rulesFor(sel + '::before')) expect(r, sel).not.toMatch(/background|border|box-shadow|outline/)
    }
  })
})
