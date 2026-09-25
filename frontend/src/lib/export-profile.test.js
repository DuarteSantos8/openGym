import { describe, expect, it } from 'vitest'
import { buildProfileBackup, BACKUP_FMT } from './export-profile.js'
import { canonicalProfile } from './test-fixtures.js'

describe('buildProfileBackup', () => {
  it('stamps the backup format', () => {
    expect(buildProfileBackup(canonicalProfile()).opengym_backup).toBe(BACKUP_FMT)
  })

  it('keeps prescriptions, progression and 1RMs whole', () => {
    const S = canonicalProfile({ prescriptions: { p1: { id: 'p1' } }, progression: { occ1: { trackId: 'occ1' } }, oneRepMaxes: { '0025': [{ value: 100 }] } })
    const backup = buildProfileBackup(S)
    expect(backup.prescriptions).toEqual(S.prescriptions)
    expect(backup.progression).toEqual(S.progression)
    expect(backup.oneRepMaxes).toEqual(S.oneRepMaxes)
  })

  it('drops _rev', () => {
    const S = canonicalProfile()
    S._rev = 42
    expect(buildProfileBackup(S)._rev).toBeUndefined()
  })

  it('does not mutate the input profile', () => {
    const S = canonicalProfile()
    S._rev = 7
    const before = JSON.stringify(S)
    buildProfileBackup(S)
    expect(JSON.stringify(S)).toBe(before)
  })
})
