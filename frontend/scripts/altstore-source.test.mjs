/* altstore-source.mjs: the source AltStore reads for the iPhone app. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { altstoreSource, BUNDLE_ID, entitlementsOf, fillUrl, KEEP, MIN_OS, privacyOf } from './altstore-source.mjs'

const v = (version, extra = {}) => ({ version, buildVersion: '140', date: '2026-10-10', downloadURL: `https://x/${version}/openGym-${version}.ipa`, size: 1234, sha256: 'ab'.repeat(32), ...extra })

describe('altstoreSource', () => {
  it('lists the app with this version, where it is, its size and checksum', () => {
    const s = altstoreSource({ version: v('1.4.0'), privacy: { NSCameraUsageDescription: 'scan' }, entitlements: ['com.apple.developer.healthkit'] })
    expect(s.apps).toHaveLength(1)
    const app = s.apps[0]
    expect(app.bundleIdentifier).toBe(BUNDLE_ID)
    expect(app.versions).toEqual([{ version: '1.4.0', buildVersion: '140', date: '2026-10-10', localizedDescription: 'openGym 1.4.0', downloadURL: 'https://x/1.4.0/openGym-1.4.0.ipa', size: 1234, sha256: 'ab'.repeat(32), minOSVersion: MIN_OS }])
    expect(app.appPermissions).toEqual({ entitlements: ['com.apple.developer.healthkit'], privacy: { NSCameraUsageDescription: 'scan' } })
  })
  it('keeps earlier versions behind the new one, replacing a rebuild of the same number', () => {
    const first = altstoreSource({ version: v('1.3.0') })
    const second = altstoreSource({ version: v('1.4.0'), previous: first })
    const again = altstoreSource({ version: v('1.4.0', { size: 999 }), previous: second })
    expect(again.apps[0].versions.map(x => [x.version, x.size])).toEqual([['1.4.0', 999], ['1.3.0', 1234]])
  })
  it(`keeps at most ${KEEP}`, () => {
    let s = null
    for (let i = 0; i < KEEP + 3; i++) s = altstoreSource({ version: v(`1.${i}.0`), previous: s })
    expect(s.apps[0].versions).toHaveLength(KEEP)
    expect(s.apps[0].versions[0].version).toBe(`1.${KEEP + 2}.0`)
  })
  it('refuses a version without a download', () => {
    expect(() => altstoreSource({ version: { version: '1.0.0' } })).toThrow()
  })
})

describe('reading the app', () => {
  it('takes every privacy text from the real Info.plist', () => {
    const p = privacyOf(readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8'))
    expect(Object.keys(p).sort()).toEqual(['NSCameraUsageDescription', 'NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription', 'NSMicrophoneUsageDescription'])
  })
  it('takes the HealthKit entitlement from the real entitlements file', () => {
    expect(entitlementsOf(readFileSync(new URL('../ios/App/App/App.healthkit.entitlements', import.meta.url), 'utf8'))).toEqual(['com.apple.developer.healthkit'])
  })
  it('unescapes XML in a privacy text', () => {
    expect(privacyOf('<key>NSCameraUsageDescription</key><string>A &amp; B</string>')).toEqual({ NSCameraUsageDescription: 'A & B' })
  })
})

describe('fillUrl', () => {
  it('puts in the version and the file name', () => {
    expect(fillUrl('https://h/opengym-ios/%v/%f', '1.4.0', 'openGym-1.4.0.ipa')).toBe('https://h/opengym-ios/1.4.0/openGym-1.4.0.ipa')
  })
})
