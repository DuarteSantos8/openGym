// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { _setLangState } from './i18n-core.js'
import { stampDeletions } from './sync-merge.js'
import { folderList, currentFolder, setCurrent } from './routine-folders.js'
import { segmentAt, sequenceOf } from './rotation.js'
import {
  scheduledDays, archiveRoutines, restoreRoutines, archiveFolder, restoreFolder,
  deleteFolderWithRoutines, deleteArchived, undoSnapshot, migrateArchiveFolder,
} from './routine-archive.js'

const r = (id, folder, extra) => ({ id, name: id, ex: [], ...(folder ? { folder } : {}), ...extra })
const state = () => ({
  routines: [r('a', 'Block'), r('b', 'Block'), r('c')],
  routineFolders: [{ name: 'Block', current: true }, { name: 'Other' }],
  week: { 1: ['a', 'b'], 3: ['a'] },
  dayPlan: { '2026-11-16': 'a', '2026-11-17': 'c' },
  rotation: { sequence: ['b', 'a', 'rest', 'a'] },
  queue: { ids: ['a', 'b'] },
})

describe('routine archive', () => {
  afterEach(() => _setLangState('en', {}, null, null))

  it('says where a routine is scheduled', () => {
    expect(scheduledDays(state(), 'a')).toEqual({ week: [1, 3], dayPlan: ['2026-11-16'], loop: true })
    expect(scheduledDays(state(), 'c')).toEqual({ week: [], dayPlan: ['2026-11-17'], loop: false })
  })

  it('archives off the week, reschedules and loop, keeps the queue id, and undo puts it all back', () => {
    const s = state()
    const before = structuredClone(s)
    const snap = archiveRoutines(s, ['a'])
    expect(s.routines[0].archived).toBe(true)
    expect(s.routines[0].folder).toBe('Block')
    expect(s.week).toEqual({ 1: ['b'] })
    expect(s.dayPlan).toEqual({ '2026-11-17': 'c' })
    expect(s.rotation.sequence).toEqual(['b', 'rest'])
    expect(s.queue.ids).toEqual(['a', 'b'])
    expect(undoSnapshot(s, snap)).toBe(true)
    expect(s).toEqual(before)
    expect(undoSnapshot(s, snap)).toBe(false)
  })

  it('archives only live routines and snapshots nothing for the rest', () => {
    const s = state()
    s.routines[2].archived = true
    expect(undoSnapshot(s, archiveRoutines(s, ['c']))).toBe(false)
  })

  it('restores routines and re-adds a missing folder entry at the end', () => {
    const s = state()
    s.routines[0].archived = true
    s.routineFolders = [{ name: 'Other' }]
    restoreRoutines(s, ['a'])
    expect('archived' in s.routines[0]).toBe(false)
    expect(s.routineFolders).toEqual([{ name: 'Other' }, { name: 'Block' }])
  })

  it('archives a folder: entry and current mark go, routines are archived; restore brings it back last', () => {
    const s = state()
    const snap = archiveFolder(s, 'block')
    expect(s.routines.map(x => !!x.archived)).toEqual([true, true, false])
    expect(s.routineFolders).toEqual([{ name: 'Other' }])
    expect(s.rotation.sequence).toEqual(['rest'])
    restoreFolder(s, 'Block')
    expect(s.routines.some(x => x.archived)).toBe(false)
    expect(s.routineFolders).toEqual([{ name: 'Other' }, { name: 'Block' }])
    archiveFolder(s, 'Block')
    expect(undoSnapshot(s, snap)).toBe(true)
    expect(s.routineFolders[0]).toEqual({ name: 'Block', current: true })
    expect(s.routines.some(x => x.archived)).toBe(false)
  })

  it('deletes only the archived routines among the ids, and undo puts them back archived', () => {
    const s = state()
    archiveRoutines(s, ['a'])
    const prev = structuredClone(s)
    const snap = deleteArchived(s, ['a', 'b'])
    expect(s.routines.map(x => x.id)).toEqual(['b', 'c'])
    expect(undoSnapshot(s, snap)).toBe(true)
    expect(s.routines).toEqual(prev.routines)
  })

  it('deleting a folder leaves its archived routines alone', () => {
    const s = state()
    s.routines.push(r('z', 'Block', { archived: true }))
    deleteFolderWithRoutines(s, 'Block')
    expect(s.routines.map(x => x.id)).toEqual(['c', 'z'])
    expect(s.routines[1].folder).toBe('Block')
  })

  it('deletes a folder with its routines, writes tombstones, and undo restores them', () => {
    const s = state()
    const prev = structuredClone(s)
    const snap = deleteFolderWithRoutines(s, 'Block')
    expect(s.routines.map(x => x.id)).toEqual(['c'])
    expect(s.week).toEqual({})
    expect(folderList(s).map(f => f.name)).toEqual(['Other'])
    stampDeletions(prev, s)
    expect(Object.keys(s.deleted.routines).sort()).toEqual(['a', 'b'])
    expect(undoSnapshot(s, snap)).toBe(true)
    expect(s.routines.map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(s.routineFolders).toEqual(prev.routineFolders)
    expect(s.week).toEqual(prev.week)
  })

  describe('undo is the inverse of a batch archive', () => {
    it('keeps weekday order when a folder archive is undone', () => {
      const s = state()
      const snap = archiveFolder(s, 'Block')
      expect(s.week).toEqual({})
      undoSnapshot(s, snap)
      expect(s.week).toEqual({ 1: ['a', 'b'], 3: ['a'] })
    })
    it('keeps weekday order for routines archived one after the other in one batch', () => {
      const s = { routines: [r('a'), r('b'), r('c')], week: { 1: ['a', 'b', 'c'] } }
      const snap = archiveRoutines(s, ['a', 'c', 'b'])
      undoSnapshot(s, snap)
      expect(s.week[1]).toEqual(['a', 'b', 'c'])
    })
    it('restores a current mark only when no other folder holds it now', () => {
      const s = state()
      const snap = archiveFolder(s, 'Block')
      setCurrent(s, 'Other')
      undoSnapshot(s, snap)
      expect(s.routineFolders.filter(e => e.current).map(e => e.name)).toEqual(['Other'])
      expect(s.routineFolders.map(e => e.name)).toEqual(['Block', 'Other'])
      const t = state()
      const snap2 = archiveFolder(t, 'Block')
      undoSnapshot(t, snap2)
      expect(currentFolder(t)).toBe('Block')
    })
    it('keeps the loop cursor on the running segment, and gives it back on undo', () => {
      const s = { routines: [r('a'), r('b'), r('c'), r('d')], rotation: { id: 'x', sequence: ['a', 'rest', 'b', 'rest', 'c', 'rest', 'd'], at: 4 } }
      const snap = archiveRoutines(s, ['a'])
      expect(segmentAt(sequenceOf(s), s.rotation.at).ids).toEqual(['c'])
      expect(s.rotation.at).toBe(3)
      undoSnapshot(s, snap)
      expect(s.rotation).toMatchObject({ sequence: ['a', 'rest', 'b', 'rest', 'c', 'rest', 'd'], at: 4 })
    })
    it('a cursor that moved on since the archive keeps its segment on undo', () => {
      const s = { routines: [r('a'), r('b'), r('c'), r('d')], rotation: { id: 'x', sequence: ['a', 'b', 'rest', 'c', 'rest', 'd'], at: 3 } }
      const snap = archiveRoutines(s, ['a', 'b'])
      expect(segmentAt(sequenceOf(s), s.rotation.at).ids).toEqual(['c'])
      s.rotation.at = 3   // c done: on to d
      expect(segmentAt(sequenceOf(s), s.rotation.at).ids).toEqual(['d'])
      undoSnapshot(s, snap)
      expect(s.rotation.sequence).toEqual(['a', 'b', 'rest', 'c', 'rest', 'd'])
      expect(segmentAt(sequenceOf(s), s.rotation.at).ids).toEqual(['d'])
    })
  })

  describe('the old Archive folder moves once', () => {
    it('archives English "Archive" and the device language name, not a foreign one', () => {
      _setLangState('de', { Archive: 'Archiv' }, null, null)
      const s = { routines: [r('a', 'Archive'), r('b', 'Archiv'), r('c', 'Push')] }
      expect(migrateArchiveFolder(s)).toBe(true)
      expect(s.routines.map(x => [!!x.archived, x.folder])).toEqual([[true, undefined], [true, undefined], [false, 'Push']])
      expect(s.archiveMoved).toBe(true)
    })
    it('takes a legacy archived routine off the schedule, so a later restore starts clean', () => {
      const s = {
        routines: [r('a', 'Archive'), r('b')],
        week: { 1: ['a', 'b'] }, dayPlan: { '2026-11-16': 'a' },
        rotation: { sequence: ['b', 'rest', 'a', 'rest', 'b'], at: 4 },
      }
      migrateArchiveFolder(s)
      expect(s.week).toEqual({ 1: ['b'] })
      expect(s.dayPlan).toEqual({})
      expect(s.rotation.sequence).toEqual(['b', 'rest', 'rest', 'b'])
      expect(s.rotation.at).toBe(3)
      restoreRoutines(s, ['a'])
      expect(s.week).toEqual({ 1: ['b'] })
    })
    it('takes an already archived arrival in Archive off the schedule too', () => {
      const s = { routines: [{ ...r('a', 'Archive'), archived: true }, r('b')], week: { 1: ['a', 'b'] }, dayPlan: { '2026-11-16': 'a' }, rotation: { sequence: ['a', 'rest', 'b'] } }
      expect(migrateArchiveFolder(s)).toBe(true)
      expect(s.week).toEqual({ 1: ['b'] })
      expect(s.dayPlan).toEqual({})
      expect(s.rotation.sequence).toEqual(['rest', 'b'])
      expect(s.routines[0]).toMatchObject({ archived: true })
      expect(s.routines[0].folder).toBeUndefined()
    })
    it('leaves "Archiv" alone under en', () => {
      const s = { routines: [r('a', 'Archiv')] }
      migrateArchiveFolder(s)
      expect(s.routines[0]).toEqual(r('a', 'Archiv'))
    })
    it('changes nothing when no routine is left in Archive, and moves a late arrival on the next run', () => {
      const s = { routines: [r('a', 'Archive')] }
      expect(migrateArchiveFolder(s)).toBe(true)
      const copy = structuredClone(s)
      expect(migrateArchiveFolder(s)).toBe(false)
      expect(s).toEqual(copy)
      s.routines.push(r('b', 'Archive'))
      expect(migrateArchiveFolder(s)).toBe(true)
      expect(s.routines.map(x => [!!x.archived, x.folder])).toEqual([[true, undefined], [true, undefined]])
    })
  })
})
