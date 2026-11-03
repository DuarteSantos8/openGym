import { describe, expect, test } from 'vitest'
import zh from '../locales/zh.js'
import zhTW from '../locales/zh-TW.js'
import ko from '../locales/ko.js'

// '{0} per side' is the plate-load hint: it says how much weight a side carries, with no unit in
// the source string. A translation that adds a rep counter turns 20 kg of plates into "20 reps"
// (issue #689). The separate '{0}/side' key does mean reps, so the two must not be merged.
describe('the plate-load hint is a weight, not a rep count', () => {
  test.each([
    ['zh', zh, /次/],
    ['zh-TW', zhTW, /[次下]/],
    ['ko', ko, /회/],
  ])('%s does not read the plate-load hint as reps', (_locale, pack, reps) => {
    expect(pack['{0} per side']).not.toMatch(reps)
  })
})
