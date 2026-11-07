// Pages off a tab put the round back button beside a 34 px title, and the title sits the same
// 12 px from it on every one of them (#704, #764). Every such page now draws that row through
// ScreenHeader (G3), so this reads the one place that keeps it.
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

it('ScreenHeader keeps the title 12 px from a back button', () => {
  const src = readFileSync(fileURLToPath(new URL('../components/ScreenHeader.jsx', import.meta.url)), 'utf8')
  expect(src).toMatch(/\{ flex: 1, marginInlineStart: 12 \}/)
})
