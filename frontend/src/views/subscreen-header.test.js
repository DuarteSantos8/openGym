// Pages off a tab put the round back button beside a 34 px title, and the title sits the same
// 12 px from it on every one of them (#704, #764). Each page lays its header out inline, so this
// reads the source: the block right after the chevron is the title, at marginInlineStart 12,
// with no font size of its own.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PAGES = ['Admin', 'History', 'CheckIn', 'Measurements', 'CoachSetup', 'Muscles', 'ProgressPhotos', 'StructuralBalance']

const titleAfterBack = name => {
  const src = readFileSync(fileURLToPath(new URL(`./${name}.jsx`, import.meta.url)), 'utf8')
  const at = src.indexOf('<Icon name="chevronLeft" /></button>')
  expect(at, `${name} has a back chevron`).toBeGreaterThan(-1)
  return src.slice(at, src.indexOf('</h1>', at))
}

describe('the title beside a page back button', () => {
  for (const name of PAGES) {
    it(`${name}: 12 px from the button, at the shared title size`, () => {
      const head = titleAfterBack(name)
      expect(head).toMatch(/<div style=\{\{ flex: 1, marginInlineStart: 12 \}\}>/)
      expect(head).not.toMatch(/marginLeft/)
      expect(head).not.toMatch(/<h1 style=\{\{[^}]*fontSize/)
    })
  }
})
