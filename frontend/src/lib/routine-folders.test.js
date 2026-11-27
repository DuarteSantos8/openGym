// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanFolder, foldersOf, groupRoutines, isArchive, folderOpen, setFolderOpen, activeRoutines, inArchive, printableRoutines } from './routine-folders.js'

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
  it('keeps archived routines out of the active list', () => {
    const list = [r('a'), r('b', 'Archive'), r('c', 'archive'), r('d', 'Block 2')]
    expect(activeRoutines(list).map(x => x.id)).toEqual(['a', 'd'])
    expect(inArchive(list[1])).toBe(true)
    expect(inArchive(list[3])).toBe(false)
    expect(activeRoutines(null)).toEqual([])
  })
  it('picks the routines a printout takes by folder', () => {
    const list = [r('a'), r('b', 'Archive'), r('c', 'Block 2'), r('d', 'block 2')]
    expect(printableRoutines(list).map(x => x.id)).toEqual(['a', 'c', 'd'])
    expect(printableRoutines(list, ['archive']).map(x => x.id)).toEqual(['a', 'b'])
    expect(printableRoutines(list, ['archive', 'block 2']).map(x => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(printableRoutines(list, []).map(x => x.id)).toEqual(['a'])
  })
  it('folds the archive by default and remembers what was left open', () => {
    expect(isArchive('archive')).toBe(true)
    expect(folderOpen('Archive', {})).toBe(false)
    expect(folderOpen('Push', {})).toBe(true)
    setFolderOpen('Archive', true)
    expect(folderOpen('Archive')).toBe(true)
    setFolderOpen('Push', false)
    expect(folderOpen('push')).toBe(false)
  })
})
