// @vitest-environment happy-dom
// A logged rating is the −/value/+ group in effortCell (issue #1266). The step buttons are named
// "Set 1: RIR: Decrease" / "Increase", and the same words translated ("Verringern" / "Erhöhen"),
// so a rule keyed to the bare English aria-label matches nothing: the buttons stay 32px and the
// trailing plus is clipped by overflow:hidden. happy-dom applies neither media queries nor the
// cascade, so — like superset-side-effort.test.js — this reads the selectors out of index.css
// and matches them against a logged cell.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Every rule that sizes or hides the effort −/+. The logged value is a `<button class="val">`
// too, so a selector that also matches it would give the number the step width or hide it.
const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
  .map(m => ({ selector: m[1].trim(), body: m[2] }))
  .filter(r => r.selector.includes('effcell-stp>button') && /(?:^|;)\s*(?:min-width|width|flex|display)\s*:/.test(r.body))

// Ancestors a superset L/R row actually has, so the narrow-screen and superset copies match too.
const cell = (decrease, increase) => `
  <div class="wl-unit"><div class="ss-card"><div class="setrow side eff3">
    <div class="stp effcell-stp">
      <button aria-label="${decrease}"></button>
      <button class="val">2</button>
      <button aria-label="${increase}"></button>
    </div>
  </div></div></div>`

describe('a logged effort cell shows both step buttons', () => {
  it('the −/+ rules hit the step buttons in English and German and spare the value', () => {
    document.body.innerHTML = cell('Set 1: RIR: Decrease', 'Set 1: RIR: Increase')
      + cell('Set 1: RIR: Verringern', 'Set 1: RIR: Erhöhen')
    const steps = [...document.querySelectorAll('.stp.effcell-stp')].flatMap(c =>
      [...c.children].filter(el => el.tagName === 'BUTTON' && !el.classList.contains('val')))
    expect(steps.map(b => b.getAttribute('aria-label'))).toEqual([
      'Set 1: RIR: Decrease', 'Set 1: RIR: Increase',
      'Set 1: RIR: Verringern', 'Set 1: RIR: Erhöhen',
    ])
    expect(rules.length).toBeGreaterThan(0)
    for (const { selector } of rules) {
      const matched = [...document.querySelectorAll(selector)]
      expect(matched.filter(el => steps.includes(el)), selector).toHaveLength(steps.length)
      expect(matched.filter(el => el.classList.contains('val')), selector).toHaveLength(0)
    }
  })
})
