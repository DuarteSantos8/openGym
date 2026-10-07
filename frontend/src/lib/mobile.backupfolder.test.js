// Auto-backup into a folder the person chose (#161, Android): the copy goes there through the
// local BackupFolder plugin and the dated copies are pruned there; a folder that stops taking
// them sends the copy to Documents/openGym after all and leaves a note for Settings. With no
// folder chosen nothing changes. The choice lives in a private file, never in the synced state.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { todayISO } from './format.js'

const h = vi.hoisted(() => ({ files: new Map(), plugin: null, calls: [], picked: null, held: true, refuse: false }))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: async ({ path, directory, data }) => { h.files.set(directory + '/' + path, data); return { uri: 'file://' + path } },
    readFile: async ({ path, directory }) => {
      const k = directory + '/' + path
      if (!h.files.has(k)) throw new Error('File does not exist')
      return { data: h.files.get(k) }
    },
    readdir: async () => ({ files: [] }),
    deleteFile: async () => {},
  },
}))
vi.mock('@capacitor/core', () => ({
  registerPlugin: name => {
    expect(name).toBe('BackupFolder')
    const call = (method, fn) => async arg => { h.calls.push([method, arg]); return fn(arg) }
    return {
      pick: call('pick', () => h.picked || {}),
      check: call('check', () => ({ ok: h.held })),
      write: call('write', () => { if (h.refuse) throw new Error('could not write to the backup folder'); return { ok: true } }),
      prune: call('prune', () => ({ deleted: 0 })),
      release: call('release', () => undefined),
    }
  },
}))

const mobile = await import('./mobile.js')
const { writeAutoBackup, chooseBackupFolder, resetBackupFolder, backupFolder, onBackupFolderChange, BACKUP_FOLDER_FILE, AUTO_BACKUP_KEEP, _resetBackupFolder } = mobile

const today = 'opengym-backup-' + todayISO() + '.json'
const saved = () => JSON.parse(h.files.get('DATA/' + BACKUP_FOLDER_FILE) || 'null')
const methods = () => h.calls.map(c => c[0])
const SYNC = 'content://com.android.externalstorage.documents/tree/primary%3ASync'

beforeEach(() => {
  h.files.clear(); h.calls.length = 0
  h.picked = null; h.held = true; h.refuse = false
  _resetBackupFolder()
})

describe('with no folder chosen', () => {
  it('writes to Documents/openGym exactly as before and never asks the plugin to write', async () => {
    await writeAutoBackup({ n: 1 })
    expect(JSON.parse(h.files.get('DOCUMENTS/openGym/' + today))).toEqual({ n: 1 })
    expect(methods()).toEqual([])
    expect(await backupFolder()).toEqual({})
  })
})

describe('choosing a folder', () => {
  it('keeps the choice in a private file on this phone', async () => {
    h.picked = { uri: SYNC, label: 'Sync' }
    expect(await chooseBackupFolder()).toEqual({ uri: SYNC, label: 'Sync' })
    expect(saved()).toEqual({ uri: SYNC, label: 'Sync' })
    _resetBackupFolder()
    expect(await backupFolder()).toEqual({ uri: SYNC, label: 'Sync' })
  })

  it('a cancelled picker changes nothing', async () => {
    h.picked = { uri: SYNC, label: 'Sync' }
    await chooseBackupFolder()
    h.picked = {}
    expect(await chooseBackupFolder()).toBeNull()
    expect(saved()).toEqual({ uri: SYNC, label: 'Sync' })
  })

  it('a new folder gives the old one back; the default gives up the chosen one', async () => {
    h.picked = { uri: SYNC, label: 'Sync' }
    await chooseBackupFolder()
    h.picked = { uri: SYNC + 'Two', label: 'Two' }
    await chooseBackupFolder()
    expect(h.calls.filter(c => c[0] === 'release').map(c => c[1].uri)).toEqual([SYNC])
    await resetBackupFolder()
    expect(h.calls.filter(c => c[0] === 'release').map(c => c[1].uri)).toEqual([SYNC, SYNC + 'Two'])
    expect(saved()).toEqual({})
  })
})

describe('writing into the chosen folder', () => {
  beforeEach(async () => {
    h.picked = { uri: SYNC, label: 'Sync' }
    await chooseBackupFolder()
    h.calls.length = 0
  })

  it('writes today\'s copy there and prunes there to the same fourteen, nothing in Documents', async () => {
    await writeAutoBackup({ n: 2 })
    expect(methods()).toEqual(['check', 'write', 'prune'])
    const write = h.calls.find(c => c[0] === 'write')[1]
    expect(write).toMatchObject({ uri: SYNC, name: today })
    expect(JSON.parse(write.data)).toEqual({ n: 2 })
    const prune = h.calls.find(c => c[0] === 'prune')[1]
    expect(prune).toMatchObject({ uri: SYNC, keep: AUTO_BACKUP_KEEP, written: today })
    // The same names the Documents prune keeps to, and nothing else.
    const re = new RegExp(prune.pattern)
    expect(re.test('opengym-backup-2026-01-02.json')).toBe(true)
    expect(re.test('opengym-backup-2026-01-02-2.json')).toBe(true)
    expect(re.test('notes.txt')).toBe(false)
    expect([...h.files.keys()].some(k => k.startsWith('DOCUMENTS/'))).toBe(false)
  })

  it('a folder whose permission is gone: the copy goes to Documents/openGym and Settings hears', async () => {
    const heard = []
    onBackupFolderChange(s => heard.push(s))
    h.held = false
    await writeAutoBackup({ n: 3 })
    expect(JSON.parse(h.files.get('DOCUMENTS/openGym/' + today))).toEqual({ n: 3 })
    expect(methods()).not.toContain('write')
    expect(saved()).toEqual({ lost: true, lostLabel: 'Sync' })
    expect(heard).toEqual([{ lost: true, lostLabel: 'Sync' }])
  })

  it('a write that fails falls back the same way, and the next copy goes straight to Documents', async () => {
    h.refuse = true
    await writeAutoBackup({ n: 4 })
    expect(JSON.parse(h.files.get('DOCUMENTS/openGym/' + today))).toEqual({ n: 4 })
    expect(methods()).not.toContain('prune')
    expect(saved()).toMatchObject({ lost: true })
    h.calls.length = 0
    await writeAutoBackup({ n: 5 })
    expect(methods()).toEqual([])
    expect(JSON.parse(h.files.get('DOCUMENTS/openGym/' + today))).toEqual({ n: 5 })
  })

  it('"Use default folder" puts the warning away', async () => {
    h.held = false
    await writeAutoBackup({})
    expect((await backupFolder()).lost).toBe(true)
    await resetBackupFolder()
    expect(await backupFolder()).toEqual({})
  })
})
