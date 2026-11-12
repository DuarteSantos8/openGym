// Every sideways strip shares one rule in index.css (overflow-y:hidden, both pan axes): a strip
// that scrolls sideways must never become a vertical scroller too, or a vertical swipe on it drags
// it down with the finger instead of scrolling the page (1.4.5 TestFlight 67, the live widget's
// moments; the chip rows in 60df0cf0 before that). A new overflow-x:auto rule fails here until it
// joins the shared list, so the bug cannot come back one page at a time.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = p => fileURLToPath(new URL(p, import.meta.url))
const rules = css => {
  const out = []
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(flat))) out.push({ sel: m[1].trim(), body: m[2] })
  return out
}
const FILES = ['./index.css', './coach.css', './admin.css']
const all = FILES.flatMap(f => rules(readFileSync(here(f), 'utf8')).map(r => ({ ...r, file: f })))
const shared = all.find(r => /overflow-y:\s*hidden/.test(r.body) && /touch-action:\s*pan-x pan-y/.test(r.body))
const sharedSel = shared ? shared.sel.split(',').map(s => s.trim()) : []
// Scroll areas that are not strips of chips or cards (a wide table, a code block) may scroll both ways.
const NOT_A_STRIP = new Set([])

describe('sideways strips', () => {
  it('have one shared rule', () => {
    expect(shared, 'the shared strip rule in index.css').toBeTruthy()
    expect(shared.body).toMatch(/overscroll-behavior-x:\s*contain/)
    expect(shared.body).not.toMatch(/touch-action:\s*pan-x\s*[;}]?$/m)
  })

  it('every overflow-x:auto strip is in it', () => {
    const strips = all.filter(r => /overflow-x:\s*(auto|scroll)/.test(r.body) && !/overflow-y:\s*(auto|scroll)/.test(r.body))
      .flatMap(r => r.sel.split(',').map(s => s.trim()))
      .filter(s => !s.startsWith('@') && !NOT_A_STRIP.has(s))
    expect(strips.length).toBeGreaterThan(8)
    const missing = strips.filter(s => !sharedSel.includes(s))
    expect(missing).toEqual([])
  })

  it('no strip claims only the horizontal axis (a vertical swipe on it must scroll the page)', () => {
    const panX = all.filter(r => /touch-action:\s*pan-x\s*(;|$)/.test(r.body.trim() + ';'))
      .flatMap(r => r.sel.split(',').map(s => s.trim()))
      .filter(s => sharedSel.some(x => s.includes(x)))
    expect(panX).toEqual([])
  })

  // The moments under the live widget preview were a strip of chips; since the settings rework
  // (1.4.5) they are three segments that fit, so nothing of that page scrolls sideways.
  it('the live widget page has no sideways strip left', () => {
    expect(sharedSel).not.toContain('.gl-samples')
    expect(sharedSel).toContain('.chips')
  })
})
