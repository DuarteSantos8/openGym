// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanFolder, foldersOf, groupRoutines, isArchive, folderOpen, setFolderOpen } from './routine-folders.js'

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
