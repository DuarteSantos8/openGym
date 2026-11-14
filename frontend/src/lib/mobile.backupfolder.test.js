// Auto-backup into a folder the person chose (#161, Android and iPhone): the copy goes there through the
// local BackupFolder plugin and the dated copies are pruned there; a folder that stops taking
// them sends the copy to Documents/openGym after all and leaves a note for Settings. With no
// folder chosen nothing changes. The choice lives in a private file, never in the synced state.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { todayISO } from './format.js'

const h = vi.hoisted(() => ({ dir: [], listed: [], files: new Map(), plugin: null, calls: [], picked: null, held: true, refuse: false }))

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
    readdir: async () => ({ files: h.dir }),
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
      list: call('list', () => ({ files: h.listed })),
      read: call('read', ({ name }) => ({ data: 'from-folder:' + name })),
      release: call('release', () => undefined),
    }
  },
}))

const mobile = await import('./mobile.js')
const { listFolderBackups, readFolderBackup, writeAutoBackup, chooseBackupFolder, resetBackupFolder, backupFolder, onBackupFolderChange, BACKUP_FOLDER_FILE, AUTO_BACKUP_KEEP, _resetBackupFolder } = mobile

const today = 'opengym-backup-' + todayISO() + '.json'
const saved = () => JSON.parse(h.files.get('DATA/' + BACKUP_FOLDER_FILE) || 'null')
const methods = () => h.calls.map(c => c[0])
const SYNC = 'content://com.android.externalstorage.documents/tree/primary%3ASync'

beforeEach(() => {
  h.files.clear(); h.calls.length = 0
  h.dir = []; h.listed = []
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

// The iPhone's BackupFolder plugin (ios/App/App/BackupFolderPlugin.swift) answers with a
// "bookmark:<id>" instead of a content:// address and takes the same five calls: mobile.js
// has no per-platform branch, so the same flow, and the same fall back, must hold.
describe('on iPhone (a bookmark address from Files)', () => {
  const ICLOUD = 'bookmark:6F1C2E0A-5B7D-4C1E-9A44-0D2B7E3F8A11'
  beforeEach(() => { h.picked = { uri: ICLOUD, label: 'openGym backups' } })

  it('keeps the choice, writes and prunes through the plugin', async () => {
    expect(await chooseBackupFolder()).toEqual({ uri: ICLOUD, label: 'openGym backups' })
    h.calls.length = 0
    await writeAutoBackup({ n: 5 })
    expect(methods()).toEqual(['check', 'write', 'prune'])
    expect(h.calls.find(c => c[0] === 'write')[1]).toMatchObject({ uri: ICLOUD, name: today })
    expect([...h.files.keys()].some(k => k.startsWith('DOCUMENTS/'))).toBe(false)
  })

  it('a folder iCloud or the provider took away: the copy goes to Documents/openGym and the bookmark is given back', async () => {
    await chooseBackupFolder()
    h.calls.length = 0
    h.refuse = true
    await writeAutoBackup({ n: 6 })
    expect(JSON.parse(h.files.get('DOCUMENTS/openGym/' + today))).toEqual({ n: 6 })
    expect(saved()).toEqual({ lost: true, lostLabel: 'openGym backups' })
    expect(h.calls.filter(c => c[0] === 'release').map(c => c[1].uri)).toEqual([ICLOUD])
  })
})

describe('restoring from the folder', () => {
  const f = (name, type = 'file') => ({ name, type, size: 5 })
  it('with no folder chosen: the dated copies in Documents/openGym, newest first, nothing else', async () => {
    h.dir = [f('opengym-backup-2026-01-02.json'), f('notes.txt'), f('opengym-backup-2026-03-04.json'), f('opengym-backup-2026-05-06.json', 'directory')]
    expect(await listFolderBackups()).toEqual([{ name: 'opengym-backup-2026-03-04.json', size: 5 }, { name: 'opengym-backup-2026-01-02.json', size: 5 }])
    h.files.set('DOCUMENTS/openGym/opengym-backup-2026-01-02.json', '{"a":1}')
    expect(await readFolderBackup('opengym-backup-2026-01-02.json')).toBe('{"a":1}')
    expect(methods()).toEqual([])
  })

  it('a same-day "-2" copy is newer than the plain one', async () => {
    h.dir = [f('opengym-backup-2026-11-05.json'), f('opengym-backup-2026-11-05-2.json'), f('opengym-backup-2026-11-04.json')]
    expect((await listFolderBackups()).map(b => b.name)).toEqual(['opengym-backup-2026-11-05-2.json', 'opengym-backup-2026-11-05.json', 'opengym-backup-2026-11-04.json'])
  })

  it('a chosen folder is listed and read through the plugin', async () => {
    h.picked = { uri: SYNC, label: 'Sync' }
    await chooseBackupFolder()
    h.listed = [f('opengym-backup-2026-02-02.json'), f('opengym-backup-2026-01-01.json'), f('x.json')]
    // The plugin already filters and sorts; the app's own rule is applied again on this side.
    expect((await listFolderBackups()).map(b => b.name)).toEqual(['opengym-backup-2026-02-02.json', 'opengym-backup-2026-01-01.json'])
    expect(await readFolderBackup('opengym-backup-2026-02-02.json')).toBe('from-folder:opengym-backup-2026-02-02.json')
    expect(h.calls.filter(c => c[0] === 'read')[0][1]).toEqual({ uri: SYNC, name: 'opengym-backup-2026-02-02.json' })
  })

  it('a lost folder reads Documents/openGym, where its copies went', async () => {
    h.picked = { uri: SYNC, label: 'Sync' }
    await chooseBackupFolder()
    h.held = false
    await writeAutoBackup({ n: 1 })
    h.calls.length = 0
    h.dir = [f('opengym-backup-2026-01-02.json')]
    expect((await listFolderBackups()).length).toBe(1)
    expect(methods()).toEqual([])
  })

  it('refuses a name that is not a plain dated backup', async () => {
    await expect(readFolderBackup('../secret.json')).rejects.toThrow('not a backup file name')
    await expect(readFolderBackup('opengym-backup-2026-01-02.json/../../x')).rejects.toThrow()
  })
})
