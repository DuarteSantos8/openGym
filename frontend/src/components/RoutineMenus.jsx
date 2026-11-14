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
import { archiveFolder, archiveRoutines, deleteFolderWithRoutines, scheduledDays, undoSnapshot } from '../lib/routine-archive.js'
import { markUndone, undoMarks } from '../lib/sync-merge.js'
import { listMove } from '../lib/list-motion.js'
import { still } from '../lib/flip.js'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { startOrPreview } from './StartSheets.jsx'
import { routineLookSheet } from './RoutineLook.jsx'
import { deleteRoutineWithUndo, newRoutine } from '../views/Plan.jsx'
import { folderNameSheet } from './RoutineFolder.jsx'

const UNDO_MS = 8000
const SHEET_HOLD = 120, MOVE_HOLD = SHEET_HOLD + 160   // Move sheet: dismiss after the pick, the row leaves 160 ms after that starts
// The current plan's tile: round, in the accent, so it never reads as a routine's colour square.
const PIN = { borderRadius: '50%', background: 'var(--acc)', color: 'var(--on-acc)' }
const same = (a, b) => cleanFolder(a).toLowerCase() === cleanFolder(b).toLowerCase()
const S = () => useStore.getState().S
const update = fn => useStore.getState().update(fn)

// Archive: the row trails 16 px as it goes, and the Archive row's count ticks once it has left.
const ARCHIVE_MOTION = { slide: true, tick: { key: 'archive', at: 160 } }

/** Runs `change(s)` and offers an Undo. `change` returns a snapshot for undoSnapshot, or
 *  `{ undo(s) }` of its own. The Undo marks what it put back, so another device's later edit wins. */
export function withUndo(message, change, m = {}) {
  const before = S()
  let snap
  listMove(() => update(s => { snap = change(s) }), m)
  const marks = undoMarks(before, S())
  useUI.getState().toast(message, { action: t('Undo'), ms: UNDO_MS, onAction: () => {
    let ok = false
    // The row comes back after the rows below have started to open a gap for it.
    listMove(() => update(s => { ok = snap.undo ? snap.undo(s) : undoSnapshot(s, snap); if (ok) markUndone(s, marks) }),
      { delay: '0ms', enterDelay: 100, tick: m.tick && { ...m.tick, at: 160 } })
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
  const go = () => withUndo(t('“{0}” archived.', r.name), s => archiveRoutines(s, [r.id]), ARCHIVE_MOTION)
  if (!isScheduled(r.id)) return go()
  confirmSheet({ title: t('Archive'), message: t('{0} is on {1}. Archive takes it off the schedule.', r.name, whenText(r.id)), confirmText: t('Archive'), onConfirm: go })
}

/** Edit's Archive bar: one routine goes the routine menu's way; several ask first when any is on the schedule. */
export function archiveIdsWithUndo(ids) {
  const r = ids.length === 1 && S().routines.find(x => x.id === ids[0])
  if (r) return archiveRoutineWithUndo(r)
  const go = () => withUndo(t('{0} archived.', routineCount(ids.length)), s => archiveRoutines(s, ids), ARCHIVE_MOTION)
  if (!ids.some(isScheduled)) return go()
  confirmSheet({ title: t('Archive'), message: t('{0} are on your schedule. Archive takes them off the schedule.', routineCount(ids.length)), confirmText: t('Archive'), onConfirm: go })
}

export function archiveFolderWithUndo(name) {
  const go = () => withUndo(t('“{0}” archived.', name), s => archiveFolder(s, name), ARCHIVE_MOTION)
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
      if (entry && !(s2.routineFolders || []).some(e => same(e.name, name))) {
        const list = (s2.routineFolders || []).slice()
        list.splice(Math.min(entry.at, list.length), 0, entry.current ? { name: entry.name, current: true } : { name: entry.name })
        s2.routineFolders = list
        did = true
      }
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
      { icon: isFavRoutine(r) ? 'starFill' : 'star', iconStyle: isFavRoutine(r) ? { color: 'var(--acc-ink)' } : undefined, label: isFavRoutine(r) ? t('Remove from favourites') : t('Add to favourites'), onClick: () => update(s => { toggleFavRoutine(s, r.id) }) },
      { icon: 'palette', label: t('Colour and icon'), onClick: () => routineLookSheet(r.id) },
      { icon: 'copy', label: t('Duplicate'), onClick: () => duplicateRoutine(r) },
      { icon: 'folder', label: t('Move to folder'), onClick: () => moveSheet([r.id]) },
      { icon: 'archive', label: t('Archive'), onClick: () => archiveRoutineWithUndo(r) },
    ] }, { items: [
      { icon: 'trash', label: t('Delete'), danger: true, onClick: () => deleteRoutineWithUndo(r.id) },
    ] }],
  })
}

export function folderMenu(name, onRenamed) {
  const current = same(currentFolder(S()), name)
  menuSheet({
    title: name,
    sections: [{ items: [
      { icon: 'pushpin', iconStyle: PIN, label: current ? t('Not the current plan') : t('Make current plan'),
        onClick: () => listMove(() => update(s => setCurrent(s, current ? null : name)), { dur: '320ms', delay: '0ms', land: current ? undefined : 'f' + name }) },
      { icon: 'pencil', label: t('Rename'), onClick: () => folderNameSheet({ mode: 'rename', name, onDone: onRenamed }) },
      { icon: 'plus', label: t('New routine here'), onClick: () => newRoutine(update, nav, name) },
      { icon: 'archive', label: t('Archive folder and routines'), onClick: () => archiveFolderWithUndo(name) },
      { icon: 'folderOff', label: t('Remove folder, keep routines'), onClick: () => removeFolderWithUndo(name) },
    ] }, { items: [
      { icon: 'trash', label: t('Delete folder and routines'), danger: true, onClick: () => deleteFolderConfirm(name) },
    ] }],
  })
}

/** Moves routines to the end of a folder ('' for loose, at the end of the list). */
function moveIds(ids, name) {
  // The sheet leaves 120 ms after the pick, then the row goes (160 ms after the dismiss starts), then the target's count ticks.
  const hold = still() ? 0 : MOVE_HOLD
  listMove(() => update(s => {
    moveToFolder(s, ids, name)
    s.routines = [...s.routines.filter(r => !ids.includes(r.id)), ...s.routines.filter(r => ids.includes(r.id))]
  }), { hold, tick: name ? { key: 'f' + name, at: hold + 100 } : undefined })
}

export function moveSheet(ids) {
  const picked = S().routines.filter(r => ids.includes(r.id))
  const where = picked.length && picked.every(r => same(folderOf(r), folderOf(picked[0]))) ? folderOf(picked[0]) : null
  const cur = currentFolder(S())
  const folders = folderList(S())
  const item = f => {
    const here = where != null && same(f.name, where), now = same(f.name, cur)
    return {
      icon: now ? 'pushpin' : 'folder', iconStyle: now ? PIN : undefined, label: f.name,
      sub: [now && t('Current plan'), here ? t('Here now') : !now && routineCount(f.live)].filter(Boolean).join(' · ') || routineCount(f.live),
      on: here, closeAfter: SHEET_HOLD, onClick: () => moveIds(ids, f.name),
    }
  }
  menuSheet({
    title: t('Move {0}', picked.length === 1 ? picked[0].name : routineCount(picked.length)), cancel: true,
    sections: [{ items: [
      ...folders.filter(f => same(f.name, cur)).map(item),
      ...folders.filter(f => !same(f.name, cur)).map(item),
      { icon: 'folderOff', label: t('No folder'), sub: t('Takes it out of its folder'), on: where === '', closeAfter: SHEET_HOLD, onClick: () => moveIds(ids, '') },
      { icon: 'plus', iconStyle: { background: 'var(--acc-soft)', color: 'var(--acc-ink)' }, labelStyle: { color: 'var(--acc-ink)' }, label: t('New folder'),
        onClick: () => folderNameSheet({ mode: 'new', onDone: n => moveIds(ids, n) }) },
    ] }],
  })
}
