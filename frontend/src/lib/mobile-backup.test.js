import { beforeEach, describe, expect, it, vi } from 'vitest'

const { files } = vi.hoisted(() => ({ files: new Map() }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' }, Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }) => { if (!files.has(path)) throw new Error('missing'); return { data: files.get(path) } },
    writeFile: async ({ path, data }) => { files.set(path, data) }
  }
}))

import { NATIVE_BACKUP_FILE, nativeBackupOnce } from './mobile.js'

beforeEach(() => files.clear())

describe('nativeBackupOnce', () => {
  it('writes the exact text once, and never replaces it', async () => {
    await nativeBackupOnce('{"routines":[]}')
    expect(files.get(NATIVE_BACKUP_FILE)).toBe('{"routines":[]}')
    await nativeBackupOnce('{"routines":[],"later":1}')
    expect(files.get(NATIVE_BACKUP_FILE)).toBe('{"routines":[]}')
  })

  it('fails closed on an existing copy that is not v1, or a write that does not read back', async () => {
    files.set(NATIVE_BACKUP_FILE, '{"engineSchemaVersion":2}')
    await expect(nativeBackupOnce('{}')).rejects.toThrow('native-backup-not-v1')
    files.clear()
    const { Filesystem } = await import('@capacitor/filesystem')
    const write = Filesystem.writeFile
    Filesystem.writeFile = async ({ path, data }) => { files.set(path, data.slice(1)) }
    try { await expect(nativeBackupOnce('{"routines":[]}')).rejects.toThrow('native-backup-mismatch') }
    finally { Filesystem.writeFile = write }
  })
})
