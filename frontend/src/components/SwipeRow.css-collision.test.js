// The swipe panes of every set row, routine and list item are `.swpane.del` and `.swpane.cp`. The
// circuit player (1.4.5) named its full-screen root `.cp` with `position:fixed;inset:0;z-index:95`,
// and index.css is global: every Copy pane turned into a 32 px green strip pinned to the left edge
// of the screen, over the whole workout (seen in Chrome at 390 and 1280 px). The player's root is
// `.cp-screen` now; no stylesheet may give the pane modifiers a rule of their own.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const strip = f => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const sheets = () => {
  const src = resolve(process.cwd(), 'src')
  const out = [resolve(src, 'index.css'), resolve(src, 'coach.css')]
  for (const d of ['views', 'components']) for (const f of readdirSync(resolve(src, d))) if (f.endsWith('.css')) out.push(resolve(src, d, f))
  return out
}

describe('the swipe panes keep their class names to themselves', () => {
  it('no stylesheet has a bare .cp or .del rule', () => {
    for (const f of sheets()) {
      const css = strip(f)
      // A selector list entry that is exactly `.cp` or `.del` (not `.swpane.cp`, not `.cp-ring`).
      const bare = css.match(/(^|[{},])\s*\.(cp|del)\s*(?=[{,])/m)
      expect(bare, `${f} has a rule for a bare swipe-pane class`).toBeNull()
    }
  })
  it('the circuit player has its own root class', () => {
    expect(strip(resolve(process.cwd(), 'src/index.css'))).toMatch(/\.cp-screen\{position:fixed/)
    expect(readFileSync(resolve(process.cwd(), 'src/components/CircuitPlayer.jsx'), 'utf8')).toMatch(/className="cp-screen"/)
  })
})
