// Under reduced motion a press dims (opacity .6) instead of scaling (ui-redesign-components §1), in
// both ways motion is reduced: the OS setting and the app's html[data-motion=reduce].
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const css = readFileSync(join(resolve(process.cwd(), 'src'), 'tab-kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const MEDIA = '@media (prefers-reduced-motion: reduce){'
const mediaAt = css.indexOf(MEDIA)
const mediaBlock = css.slice(mediaAt + MEDIA.length, css.indexOf('\n}', mediaAt))
const rules = text => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))

// every rule outside a media block that scales on a press
const pressed = rules(css.slice(0, mediaAt)).filter(r => /:active/.test(r.selector) && /scale\(/.test(r.body))
  .flatMap(r => r.selector.split(',').map(s => s.trim()))

describe('tab-kit.css press states under reduced motion', () => {
  it('finds the scaling press states', () => {
    expect(pressed.length).toBeGreaterThan(0)
    expect(mediaAt).toBeGreaterThan(-1)
  })

  it('dims every scaling press under prefers-reduced-motion', () => {
    const inMedia = rules(mediaBlock)
    for (const sel of pressed) {
      const rule = inMedia.find(r => r.selector.split(',').map(s => s.trim()).includes(sel))
      expect(rule, sel).toBeDefined()
      expect(rule.body, sel).toMatch(/transform:none/)
      expect(rule.body, sel).toMatch(/opacity:\.6/)
    }
  })

  it('dims every scaling press under html[data-motion=reduce]', () => {
    const forced = rules(css.slice(css.indexOf('html[data-motion=reduce]')))
    for (const sel of pressed) {
      const rule = forced.find(r => r.selector.split(',').map(s => s.trim()).includes('html[data-motion=reduce] ' + sel))
      expect(rule, sel).toBeDefined()
      expect(rule.body, sel).toMatch(/transform:none/)
      expect(rule.body, sel).toMatch(/opacity:\.6/)
    }
  })
})
