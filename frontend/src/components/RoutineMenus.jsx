// The routine "…" menu, the folder "…" menu, Move to folder and the folder name sheet
// (docs/dev/ROUTINE_FOLDERS.md). Anything that takes something away asks first when it must, then
// offers an Undo that puts back only what it took (lib/routine-archive.js undoSnapshot).
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DAYN, fmtDate, routineCount } from '../lib/format.js'
import { nav } from '../lib/nav.js'
import { copyRoutine, deleteRoutine } from '../lib/routines.js'
import { toggleFavRoutine, isFavRoutine } from '../lib/routine-favs.js'
import {
  cleanFolder, currentFolder, folderList, folderOf, isLive, moveToFolder, removeFolder, setCurrent,
} from '../lib/routine-folders.js'
import { archiveFolder, archiveRoutines, deleteFolderWithRoutines, putBackEntry, scheduledDays, undoSnapshot } from '../lib/routine-archive.js'
import { markUndone, undoMarks } from '../lib/sync-merge.js'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { startOrPreview } from './StartSheets.jsx'
import { routineLookSheet } from './RoutineLook.jsx'
import { deleteRoutineWithUndo, newRoutine } from '../views/Plan.jsx'
import { folderNameSheet } from './RoutineFolder.jsx'

const UNDO_MS = 8000
const same = (a, b) => cleanFolder(a).toLowerCase() === cleanFolder(b).toLowerCase()
const S = () => useStore.getState().S
const update = fn => useStore.getState().update(fn)

/** Runs `change(s)` and offers an Undo. `change` returns a snapshot for undoSnapshot, or
 *  `{ undo(s) }` of its own. The Undo marks what it put back, so another device's later edit wins. */
export function withUndo(message, change) {
  const before = S()
  let snap
  update(s => { snap = change(s) })
  const marks = undoMarks(before, S())
  useUI.getState().toast(message, { action: t('Undo'), ms: UNDO_MS, onAction: () => {
    let ok = false
    update(s => { ok = snap.undo ? snap.undo(s) : undoSnapshot(s, snap); if (ok) markUndone(s, marks) })
    // False when a sync brought it back first.
    if (!ok) useUI.getState().toast(t('It’s already back.'))
  } })
}

// Where a routine is scheduled, in words: weekdays, rescheduled dates, the loop.
const whenText = id => {
  const d = scheduledDays(S(), id)
  return [...d.week.slice().sort((a, b) => a - b).map(n => t(DAYN[n])), ...d.dayPlan.map(iso => fmtDate(iso)), ...(d.loop ? [t('the loop')] : [])].join(', ')
}
const isScheduled = id => { const d = scheduledDays(S(), id); return d.week.length + d.dayPlan.length > 0 || d.loop }

export function archiveRoutineWithUndo(r) {
  const go = () => withUndo(t('“{0}” archived.', r.name), s => archiveRoutines(s, [r.id]))
  if (!isScheduled(r.id)) return go()
  confirmSheet({ title: t('Archive'), message: t('{0} is on {1}. Archive takes it off the schedule.', r.name, whenText(r.id)), confirmText: t('Archive'), onConfirm: go })
}

export function archiveFolderWithUndo(name) {
  const go = () => withUndo(t('“{0}” archived.', name), s => archiveFolder(s, name))
  if (!S().routines.some(r => isLive(r) && same(folderOf(r), name) && isScheduled(r.id))) return go()
  confirmSheet({ title: t('Archive'), message: t('{0} has routines on your schedule. Archive takes them off the schedule.', name), confirmText: t('Archive'), onConfirm: go })
}

function removeFolderWithUndo(name) {
  const entry = (S().routineFolders || []).map((e, at) => ({ ...e, at })).find(e => same(e.name, name))
  const ids = S().routines.filter(r => same(folderOf(r), name)).map(r => r.id)
  withUndo(t('“{0}” removed. Its routines are loose now.', name), s => {
    removeFolder(s, name)
    return { undo: s2 => {
      let did = false
      for (const r of s2.routines) if (ids.includes(r.id) && !folderOf(r)) { r.folder = name; did = true }
      if (entry && putBackEntry(s2, entry)) did = true
      return did
    } }
  })
}

function deleteFolderConfirm(name) {
  const n = S().routines.filter(r => isLive(r) && same(folderOf(r), name)).length
  confirmSheet({
    title: t('Delete folder and routines'), danger: true, confirmText: t('Delete'),
    message: t('Delete {0} and its {1}? Your past workouts stay in History.', name, routineCount(n)),
    onConfirm: () => withUndo(t('“{0}” and its routines gone.', name), s => deleteFolderWithRoutines(s, name)),
  })
}

/** A copy right below the original, named the way "Copy routine" names one, with an Undo. */
export function duplicateRoutine(r) {
  const copy = copyRoutine(r, t('Copy'))
  update(s => {
    const at = s.routines.findIndex(x => x.id === r.id)
    s.routines.splice(at < 0 ? s.routines.length : at + 1, 0, copy)
  })
  useUI.getState().toast(t('Copied as “{0}”.', copy.name), { action: t('Undo'), onAction: () => {
    update(s => { if (s.routines.some(x => x.id === copy.id)) deleteRoutine(s, copy.id) })
  } })
  return copy
}

export function routineMenu(r) {
  menuSheet({
    title: r.name,
    sections: [{ items: [
      { icon: 'play', label: t('Start workout'), onClick: () => (S().active ? nav('/workout') : startOrPreview([r.id])) },
      { icon: 'pencil', label: t('Edit routine'), onClick: () => nav('/plan/r/' + r.id) },
      { icon: isFavRoutine(r) ? 'starFill' : 'star', label: isFavRoutine(r) ? t('Remove from favourites') : t('Add to favourites'), onClick: () => update(s => { toggleFavRoutine(s, r.id) }) },
      { icon: 'palette', label: t('Colour and icon'), onClick: () => routineLookSheet(r.id) },
      { icon: 'copy', label: t('Duplicate'), onClick: () => duplicateRoutine(r) },
      { icon: 'folder', label: t('Move to folder'), onClick: () => moveSheet([r.id]) },
      { icon: 'download', label: t('Archive'), onClick: () => archiveRoutineWithUndo(r) },
    ] }, { items: [
      { icon: 'trash', label: t('Delete'), danger: true, onClick: () => deleteRoutineWithUndo(r.id) },
    ] }],
  })
}

export function folderMenu(name) {
  const current = same(currentFolder(S()), name)
  menuSheet({
    title: name,
    sections: [{ items: [
      { icon: 'mapPin', label: current ? t('Not the current plan') : t('Make current plan'), onClick: () => update(s => setCurrent(s, current ? null : name)) },
      { icon: 'pencil', label: t('Rename'), onClick: () => folderNameSheet({ mode: 'rename', name }) },
      { icon: 'plus', label: t('New routine here'), onClick: () => newRoutine(update, nav, name) },
      { icon: 'download', label: t('Archive folder and routines'), onClick: () => archiveFolderWithUndo(name) },
    ] }, { items: [
      { icon: 'folder', label: t('Remove folder'), onClick: () => removeFolderWithUndo(name) },
      { icon: 'trash', label: t('Delete folder and routines'), danger: true, onClick: () => deleteFolderConfirm(name) },
    ] }],
  })
}

/** Moves routines to the end of a folder ('' for loose, at the end of the list). */
function moveIds(ids, name) {
  update(s => {
    moveToFolder(s, ids, name)
    s.routines = [...s.routines.filter(r => !ids.includes(r.id)), ...s.routines.filter(r => ids.includes(r.id))]
  })
}

export function moveSheet(ids) {
  const picked = S().routines.filter(r => ids.includes(r.id))
  const where = picked.length && picked.every(r => same(folderOf(r), folderOf(picked[0]))) ? folderOf(picked[0]) : null
  const cur = currentFolder(S())
  const folders = folderList(S())
  const item = f => ({
    icon: same(f.name, cur) ? 'mapPin' : 'folder', label: f.name,
    sub: same(f.name, cur) ? t('Current plan') + ' · ' + routineCount(f.live) : routineCount(f.live),
    on: where != null && same(f.name, where), onClick: () => moveIds(ids, f.name),
  })
  menuSheet({
    title: picked.length === 1 ? t('Move {0}', picked[0].name) : t('Move to folder'),
    items: [
      ...folders.filter(f => same(f.name, cur)).map(item),
      ...folders.filter(f => !same(f.name, cur)).map(item),
      { icon: 'list', label: t('No folder'), sub: t('Loose, at the end of the list'), on: where === '', onClick: () => moveIds(ids, '') },
      { icon: 'plus', label: t('New folder'), accent: true, onClick: () => folderNameSheet({ mode: 'new', onDone: n => moveIds(ids, n) }) },
    ],
  })
}
