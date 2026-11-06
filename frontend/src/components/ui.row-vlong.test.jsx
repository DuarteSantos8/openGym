// @vitest-environment happy-dom
// QA2 1.4.5: in German, Settings → Training → "Pause vor der nächsten Übung" with "Wie die
// Arbeitssätze" beside it left the title a column a word wide at 390 px. A worded value on a row
// with a subtitle is marked .lrow-vlong, which index.css moves under the text on a phone.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Row, VALUE_BESIDE_MAX } from './ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const cls = el => { act(() => root.render(el)); return host.querySelector('.lrow').className }

describe('a long worded value goes under a row’s text on a phone', () => {
  it('marks only rows with an icon, a subtitle and a long worded value', () => {
    expect(cls(<Row icon="timer" title="Pause vor der nächsten Übung" subtitle="Nach dem letzten Satz" value="Wie die Arbeitssätze" />)).toContain('lrow-vlong')
    expect(cls(<Row icon="timer" title="Pause vor der nächsten Übung" subtitle="Nach dem letzten Satz" value="2:00" />)).not.toContain('lrow-vlong')
    expect(cls(<Row icon="timer" title="Sprache" value="Bahasa Indonesia" />)).not.toContain('lrow-vlong')
    expect(cls(<Row title="x" subtitle="y" value="Wie die Arbeitssätze" />)).not.toContain('lrow-vlong')
    expect('Like the work sets'.length).toBeGreaterThan(VALUE_BESIDE_MAX)
  })
  it('index.css stacks it under the text up to phone width', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const block = css.slice(css.indexOf('@media (max-width:430px){\n  .lrow.lrow-vlong'))
    expect(block).toMatch(/\.lrow\.lrow-vlong>\.lrow-v\{grid-column:2;grid-row:2;max-width:none/)
  })
})
