// @vitest-environment happy-dom
import { t } from './i18n-core.js'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  cleanFolder, foldersOf, groupRoutines, isArchive,
  isLive, activeRoutines, folderList, currentFolder, setCurrent, createFolder, renameFolder, removeFolder, moveToFolder, reorderFolders,
} from './routine-folders.js'

const r = (id, folder) => ({ id, name: id, ex: [], ...(folder !== undefined ? { folder } : {}) })

describe('routine folders', () => {
  beforeEach(() => { try { localStorage.clear() } catch (e) { /* none */ } })
  it('cleans a typed name', () => {
    expect(cleanFolder('  March   to April ')).toBe('March to April')
    expect(cleanFolder('a'.repeat(80))).toHaveLength(40)
    expect(cleanFolder(null)).toBe('')
  })
  it('lists loose routines first, then each folder in list order, names matched without case', () => {
    const list = [r('a', 'Block 2'), r('b'), r('c', 'Archive'), r('d', 'block 2'), r('e', '  ')]
    const g = groupRoutines(list)
    expect(g.map(x => x.folder)).toEqual(['', 'Block 2', 'Archive'])
    expect(g[0].routines.map(x => x.id)).toEqual(['b', 'e'])
    expect(g[1].routines.map(x => x.id)).toEqual(['a', 'd'])
    expect(foldersOf(list)).toEqual(['Block 2', 'Archive'])
  })
  it('knows the reserved Archive name', () => expect(isArchive('archive')).toBe(true))

  describe('the synced folder list', () => {
    const draft = () => ({
      routineFolders: [{ name: 'A', current: true }, { name: 'B' }],
      routines: [r('1', 'A'), r('2', 'C'), r('3', ' c '), { ...r('4', 'D'), archived: true }, r('5')],
    })
    it('lists entries in order, then unlisted folders of live routines; archived-only ones stay out', () => {
      const f = folderList(draft())
      expect(f.map(x => x.name)).toEqual(['A', 'B', 'C'])
      expect(f.map(x => [x.live, x.archived])).toEqual([[1, 0], [0, 0], [2, 0]])
      expect(f[0].current).toBe(true)
      expect(currentFolder(draft())).toBe('A')
      expect(currentFolder({ routines: [] })).toBe(null)
    })
    it('counts archived routines of a listed folder', () => {
      const s = { routineFolders: [{ name: 'D' }], routines: [{ ...r('4', 'D'), archived: true }] }
      expect(folderList(s)).toEqual([{ name: 'D', current: false, live: 0, archived: 1 }])
    })
    it('counts an archived routine of a visible folder whichever side of its live sibling it sits', () => {
      const old = { ...r('4', 'X'), archived: true }
      for (const routines of [[old, r('5', 'X')], [r('5', 'X'), old]]) {
        expect(folderList({ routines })).toEqual([{ name: 'X', current: false, live: 1, archived: 1 }])
      }
    })
    it('knows live routines', () => {
      expect(isLive(r('a'))).toBe(true)
      expect(isLive({ archived: true })).toBe(false)
      expect(isLive(null)).toBe(false)
      expect(activeRoutines(draft()).map(x => x.id)).toEqual(['1', '2', '3', '5'])
    })
    it('keeps one current', () => {
      const s = draft()
      setCurrent(s, 'B'); setCurrent(s, 'B')
      expect(s.routineFolders.filter(x => x.current).map(x => x.name)).toEqual(['B'])
      setCurrent(s, null)
      expect(currentFolder(s)).toBe(null)
    })
    it('makes a folder current that only routines name, listing it', () => {
      const s = draft()
      setCurrent(s, 'C')
      expect(s.routineFolders).toEqual([{ name: 'A' }, { name: 'B' }, { name: 'C', current: true }])
    })
    it('creates, refusing empty, reserved and taken names', () => {
      const s = draft()
      expect(createFolder(s, ' New  one ')).toEqual({ ok: true, name: 'New one' })
      expect(s.routineFolders.at(-1)).toEqual({ name: 'New one' })
      expect(createFolder(s, '  ')).toEqual({ ok: false, reason: 'empty' })
      expect(createFolder(s, 'archive')).toEqual({ ok: false, reason: 'reserved' })
      expect(createFolder(s, t('Archive'))).toEqual({ ok: false, reason: 'reserved' })
      expect(createFolder(s, 'a')).toEqual({ ok: false, reason: 'taken', name: 'A' })
      expect(createFolder(s, 'c')).toEqual({ ok: false, reason: 'taken', name: 'C' })
    })
    it('renames on every routine and the entry, keeps current, refuses a taken name', () => {
      const s = { routineFolders: [{ name: 'A', current: true }, { name: 'B' }], routines: [r('1', 'A'), { ...r('2', 'a'), archived: true }] }
      expect(renameFolder(s, 'A', 'B')).toEqual({ ok: false, reason: 'taken' })
      expect(s.routines.map(x => x.folder)).toEqual(['A', 'a'])
      expect(renameFolder(s, 'A', 'Z')).toEqual({ ok: true })
      expect(s.routines.map(x => x.folder)).toEqual(['Z', 'Z'])
      expect(currentFolder(s)).toBe('Z')
      expect(renameFolder(s, 'Z', 'archive').reason).toBe('reserved')
      expect(renameFolder(s, 'Z', ' ').reason).toBe('empty')
      expect(renameFolder(s, 'Z', 'z')).toEqual({ ok: true })
    })
    it('removes a folder and frees its routines', () => {
      const s = draft()
      expect(removeFolder(s, 'c').ids).toEqual(['2', '3'])
      expect(s.routines.filter(x => 'folder' in x).map(x => x.id)).toEqual(['1', '4'])
      expect(removeFolder(s, 'B').ids).toEqual([])
      expect(s.routineFolders.map(x => x.name)).toEqual(['A'])
    })
    it('moves routines, creating the entry, and loose with an empty name', () => {
      const s = draft()
      moveToFolder(s, ['5', '1'], 'New')
      expect(s.routines.filter(x => x.folder === 'New').map(x => x.id)).toEqual(['1', '5'])
      expect(s.routineFolders.map(x => x.name)).toEqual(['A', 'B', 'New'])
      moveToFolder(s, ['1'], 'b')
      expect(s.routines[0].folder).toBe('B')
      expect(s.routineFolders).toHaveLength(3)
      moveToFolder(s, ['1'], '')
      expect('folder' in s.routines[0]).toBe(false)
    })
    it('reorders the listed folders, listing the implied ones first', () => {
      const s = draft()
      reorderFolders(s, 2, 0)
      expect(s.routineFolders.map(x => x.name)).toEqual(['C', 'A', 'B'])
      expect(s.routineFolders[1].current).toBe(true)
    })
  })
})
