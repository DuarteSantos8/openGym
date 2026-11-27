// scripts/ci/release-assets-check.mjs: the Wear OS APK got a name that says watch only in 1.4.6
// (#1359). The new name counts as the old one, and it is never taken for a phone's Standard APK.
import { describe, expect, it } from 'vitest'
import { problems, OTHER } from '../../../scripts/ci/release-assets-check.mjs'

const HEX = 'a'.repeat(64)
const release = (tag, names) => ({
  tag_name: tag,
  assets: names.flatMap(n => [{ name: n, size: 2_000_000 }, { name: `${n}.sha256`, size: 90 }]).concat({ name: 'SHA256SUMS', size: 400 }),
})
const texts = r => Object.fromEntries([
  ...r.assets.filter(a => a.name.endsWith('.sha256')).map(a => [a.name, `${HEX}  ${a.name.replace(/\.sha256$/, '')}`]),
  ['SHA256SUMS', r.assets.filter(a => a.name.endsWith('.apk')).map(a => `${HEX}  ${a.name}`).join('\n')],
])
const phones = v => [`openGym-${v}.apk`, `openGym-Plus-${v}.apk`, `openGym-HD-${v}.apk`]

describe('the Wear OS APK renamed to watch only', () => {
  it('is not missing when the last release had the old name', () => {
    const prev = release('v1.4.5', [...phones('1.4.5'), 'openGym-Wear-1.4.5.apk'])
    const next = release('v1.4.6', [...phones('1.4.6'), 'openGym-WearOS-watch-only-1.4.6.apk'])
    expect(problems(next, texts(next), prev)).toEqual([])
  })
  it('a release without it is still caught', () => {
    const prev = release('v1.4.5', [...phones('1.4.5'), 'openGym-Wear-1.4.5.apk'])
    const next = release('v1.4.6', phones('1.4.6'))
    expect(problems(next, texts(next), prev).join(' ')).toMatch(/openGym-WearOS-watch-only-1\.4\.6\.apk is missing/)
  })
  it('is never a phone kind', () => {
    expect(OTHER.test('openGym-WearOS-watch-only-1.4.6.apk')).toBe(true)
    expect(OTHER.test('openGym-Wear-1.4.5.apk')).toBe(true)
    expect(OTHER.test('openGym-1.4.6.apk')).toBe(false)
  })
})
