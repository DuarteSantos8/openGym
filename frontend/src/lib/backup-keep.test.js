import { describe, it, expect } from 'vitest'
import { AUTO_BACKUP_KEEP, AUTO_BACKUP_KEEP_CHOICES, autoBackupKeepOf } from './backup-keep.js'

describe('autoBackupKeepOf', () => {
  it('keeps fourteen when nothing was picked', () => {
    expect(AUTO_BACKUP_KEEP).toBe(14)
    for (const S of [undefined, null, {}, { autoBackupKeep: null }]) expect(autoBackupKeepOf(S)).toBe(14)
  })

  it('keeps the picked count when it is one of the choices', () => {
    for (const n of AUTO_BACKUP_KEEP_CHOICES) expect(autoBackupKeepOf({ autoBackupKeep: n })).toBe(n)
  })

  it('falls back to fourteen for anything else a backup or another build may carry', () => {
    for (const v of [0, 1, -5, 7.5, 1000, '5', true]) expect(autoBackupKeepOf({ autoBackupKeep: v })).toBe(14)
  })
})
