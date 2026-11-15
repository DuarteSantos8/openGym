import { expect, test } from 'vitest'
import { createEntry } from './entry.js'
test('creation rejects invalid atomic source metadata instead of silently dropping it', () => {
  expect(() => createEntry({ label: 'food', day: '2026-11-14', meal: 'snack' }, { sourceSnapshot: { raw: 'untrusted' } })).toThrow()
})
