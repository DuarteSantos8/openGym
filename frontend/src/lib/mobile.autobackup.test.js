// Auto-backup on the phone (#161): the copies go into Documents/openGym/, and each write keeps
// the newest fourteen there. Nothing outside that folder, and nothing but the app's own dated
// backups inside it, is ever deleted.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { todayISO } from './format.js'

const h = vi.hoisted(() => ({ files: new Map(), refuseWrite: false, refuseList: false, stuck: new Set(), deleted: [], foreign: new Set() }))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: async ({ path, directory, data }) => {
      if (h.refuseWrite) throw new Error('No space left on device')
      // Scoped storage: a file another install wrote cannot be written over.
      if (h.foreign.has(path)) throw new Error(`/storage/emulated/0/Documents/${path}: open failed: EACCES (Permission denied)`)
      h.files.set(directory + '/' + path, data)
      return { uri: 'file://' + path }
    },
    readdir: async ({ path, directory }) => {
      if (h.refuseList) throw new Error('Permission denied')
      const prefix = directory + '/' + (path ? path + '/' : '')
      const names = new Map()
      for (const k of h.files.keys()) {
        if (!k.startsWith(prefix)) continue
        const rest = k.slice(prefix.length)
        const [first, ...more] = rest.split('/')
        names.set(first, more.length ? 'directory' : 'file')
      }
      return { files: [...names].map(([name, type]) => ({ name, type, size: 1, uri: 'file://' + name })) }
    },
    deleteFile: async ({ path, directory }) => {
      if (h.stuck.has(path)) throw new Error('EBUSY')
      h.deleted.push(path)
      h.files.delete(directory + '/' + path)
    },
  },
}))

const { writeAutoBackup, AUTO_BACKUP_DIR, AUTO_BACKUP_KEEP } = await import('./mobile.js')

const day = n => { const d = new Date(2026, 0, 1); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const backup = d => 'opengym-backup-' + d + '.json'
const inFolder = () => [...h.files.keys()].filter(k => k.startsWith('DOCUMENTS/openGym/')).map(k => k.slice('DOCUMENTS/openGym/'.length)).sort()
const put = (path, data = '{}') => h.files.set('DOCUMENTS/' + path, data)

beforeEach(() => {
  h.files.clear(); h.deleted.length = 0; h.stuck.clear(); h.foreign.clear()
  h.refuseWrite = false; h.refuseList = false
})

describe('writeAutoBackup', () => {
  it('writes today\'s copy into Documents/openGym, not the Documents root', async () => {
    await writeAutoBackup({ workouts: [{ id: 'w1' }] })
    expect(AUTO_BACKUP_DIR).toBe('openGym')
    expect(JSON.parse(h.files.get('DOCUMENTS/openGym/' + backup(todayISO())))).toEqual({ workouts: [{ id: 'w1' }], opengym_backup: 2 })
    expect(h.files.has('DOCUMENTS/' + backup(todayISO()))).toBe(false)
  })

  it('keeps the newest fourteen in the folder, today\'s among them, and deletes only older dated backups', async () => {
    for (let i = 0; i < 20; i++) put('openGym/' + backup(day(i)))
    put('openGym/notes.txt'); put('openGym/opengym-backup-latest.json'); put('openGym/' + backup(day(0)).replace('.json', '.json.bak'))
    put('openGym/' + backup('2020-01-01') + '/inside.json')   // a directory that happens to carry the name
    await writeAutoBackup({})
    const dated = inFolder().filter(n => /^opengym-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    expect(AUTO_BACKUP_KEEP).toBe(14)
    expect(dated).toHaveLength(14)
    expect(dated).toContain(backup(todayISO()))
    // The thirteen newest of the old ones survive next to today's.
    expect(dated.filter(n => n !== backup(todayISO()))).toEqual([...Array(13)].map((_, i) => backup(day(19 - i))).sort())
    // Everything that is not an automatic backup is untouched.
    expect(inFolder()).toEqual(expect.arrayContaining(['notes.txt', 'opengym-backup-latest.json', backup(day(0)).replace('.json', '.json.bak')]))
    expect(h.files.has('DOCUMENTS/openGym/' + backup('2020-01-01') + '/inside.json')).toBe(true)
  })

  it('never touches the Documents root, where older versions wrote and where a manual export may sit', async () => {
    for (let i = 0; i < 30; i++) put(backup(day(i)))
    put('holiday.pdf')
    await writeAutoBackup({})
    expect(h.deleted).toEqual([])
    expect([...h.files.keys()].filter(k => /^DOCUMENTS\/[^/]+$/.test(k))).toHaveLength(31)
  })

  it('keeps the copy it just wrote even when a clock set back makes it the oldest', async () => {
    for (let i = 0; i < 20; i++) put('openGym/' + backup('2099-01-' + String(i + 1).padStart(2, '0')))
    await writeAutoBackup({})
    const left = inFolder()
    expect(left).toHaveLength(14)
    expect(left).toContain(backup(todayISO()))
  })

  it('a failed write deletes nothing, and a folder it cannot list or a stuck file stops nothing else', async () => {
    for (let i = 0; i < 20; i++) put('openGym/' + backup(day(i)))
    h.refuseWrite = true
    await writeAutoBackup({})
    expect(h.deleted).toEqual([])

    h.refuseWrite = false; h.refuseList = true
    await expect(writeAutoBackup({})).resolves.toBeUndefined()
    expect(h.files.has('DOCUMENTS/openGym/' + backup(todayISO()))).toBe(true)
    expect(h.deleted).toEqual([])

    h.refuseList = false
    h.stuck.add('openGym/' + backup(day(0)))
    await writeAutoBackup({})
    expect(inFolder()).toHaveLength(15)   // fourteen, plus the one that would not go
    expect(inFolder()).toContain(backup(day(0)))
  })
})

// A reinstall (or the test build beside the real app) left today's name owned by the other install,
// and every backup that day failed with EACCES and was dropped without a word (Android QA, v1.3.9).
describe('writeAutoBackup where today\'s name belongs to another install', () => {
  it('writes the copy under the day\'s second name, and again there on the next write', async () => {
    const other = 'openGym/' + backup(todayISO())
    put(other, '{"theirs":true}')
    h.foreign.add(other)
    await writeAutoBackup({ n: 1 })
    const second = 'DOCUMENTS/openGym/' + backup(todayISO()).replace('.json', '-2.json')
    expect(JSON.parse(h.files.get(second))).toEqual({ n: 1, opengym_backup: 2 })
    await writeAutoBackup({ n: 2 })
    expect(JSON.parse(h.files.get(second))).toEqual({ n: 2, opengym_backup: 2 })
    expect(JSON.parse(h.files.get('DOCUMENTS/' + other))).toEqual({ theirs: true })
  })

  it('counts the second names among the fourteen it keeps, and prunes them like any other', async () => {
    for (let i = 0; i < 20; i++) put('openGym/' + backup(day(i)).replace('.json', i % 2 ? '-2.json' : '.json'))
    await writeAutoBackup({})
    expect(inFolder()).toHaveLength(14)
    expect(inFolder()).toContain(backup(todayISO()))
    expect(inFolder()).not.toContain(backup(day(0)))
    expect(inFolder()).not.toContain(backup(day(1)).replace('.json', '-2.json'))
  })

  it('a disk that takes neither name still deletes nothing', async () => {
    for (let i = 0; i < 20; i++) put('openGym/' + backup(day(i)))
    h.refuseWrite = true
    await expect(writeAutoBackup({})).resolves.toBeUndefined()
    expect(h.deleted).toEqual([])
  })
})

// Settings writes the count out in its subtitle rather than importing it (its tests mock this
// module wholesale), so the two are pinned together here.
it('the Settings subtitle names the same number of copies the pruning keeps', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../views/Settings.jsx', import.meta.url), 'utf8')
  const m = src.match(/keeps the newest \{0\}[^']*', (\d+)\)/)
  expect(m && Number(m[1])).toBe(AUTO_BACKUP_KEEP)
})
