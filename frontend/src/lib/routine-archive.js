// Archive for routines and folders (docs/dev/ROUTINE_FOLDERS.md). The routines are the one source
// of truth: r.archived === true, written only when on. An archived routine is taken off the week,
// the per-date reschedules and the loop; the live queue keeps its id (readers skip it). Every
// action that takes something away returns a snapshot, and undoSnapshot puts back only that.
// These work on a state draft `s`, like routine-folders.js.
import { cleanFolder, folderOf, isArchive, isLive } from './routine-folders.js'
import { deleteRoutine, restoreRoutine, routineSnapshot, putBack } from './routines.js'

const same = (a, b) => cleanFolder(a).toLowerCase() === cleanFolder(b).toLowerCase()
const seqOf = s => (Array.isArray(s.rotation?.sequence) ? s.rotation.sequence : [])

/** Where a routine is scheduled: weekdays (numbers), rescheduled dates, and whether the loop has it. */
export function scheduledDays(S, id) {
  return {
    week: Object.keys(S.week || {}).filter(d => [].concat(S.week[d]).includes(id)).map(Number),
    dayPlan: Object.keys(S.dayPlan || {}).filter(iso => S.dayPlan[iso] === id),
    loop: seqOf(S).includes(id),
  }
}

/** Archives the live routines among `ids`; the snapshot is what it took off the schedule. */
export function archiveRoutines(s, ids) {
  const snap = { archived: [], seq: [], deleted: [], entry: null }
  const hit = (s.routines || []).filter(r => ids.includes(r.id) && isLive(r))
  const seq = seqOf(s)
  seq.forEach((id, i) => { if (hit.some(r => r.id === id)) snap.seq.push([i, id]) })
  for (const r of hit) {
    const week = {}
    for (const d of Object.keys(s.week || {})) {
      const list = [].concat(s.week[d])
      const at = list.indexOf(r.id)
      if (at < 0) continue
      week[d] = at
      const next = list.filter(x => x !== r.id)
      if (next.length) s.week[d] = next; else delete s.week[d]
    }
    const dayPlan = {}
    for (const iso of Object.keys(s.dayPlan || {})) if (s.dayPlan[iso] === r.id) { dayPlan[iso] = r.id; delete s.dayPlan[iso] }
    r.archived = true
    snap.archived.push({ id: r.id, week, dayPlan })
  }
  if (snap.seq.length) {
    s.rotation = { ...s.rotation, sequence: seq.filter(id => !hit.some(r => r.id === id)) }
    // `at` indexes the sequence: it moves back by the entries removed before it, to name the same segment.
    const at = s.rotation.at
    if (Number.isInteger(at)) { s.rotation.at = at - snap.seq.filter(([i]) => i < at).length; snap.at = [at, s.rotation.at] }
  }
  return snap
}

/** An entry for a folder missing from an existing list goes at the end. */
function ensureEntry(s, name) {
  if (Array.isArray(s.routineFolders) && !s.routineFolders.some(e => same(e.name, name))) s.routineFolders = [...s.routineFolders, { name }]
}

export function restoreRoutines(s, ids) {
  for (const r of s.routines || []) {
    if (!ids.includes(r.id) || r.archived !== true) continue
    delete r.archived
    if (folderOf(r)) ensureEntry(s, folderOf(r))
  }
}

/** Takes the folder's list entry (and so its current mark) out, noting where it stood. */
function takeEntry(s, name) {
  const list = s.routineFolders || []
  const at = list.findIndex(e => same(e.name, name))
  if (at < 0) return null
  const entry = { ...list[at], at }
  s.routineFolders = list.filter((_, i) => i !== at)
  return entry
}

export function archiveFolder(s, name) {
  const snap = archiveRoutines(s, (s.routines || []).filter(r => same(folderOf(r), name)).map(r => r.id))
  snap.entry = takeEntry(s, name)
  return snap
}

export function restoreFolder(s, name) {
  restoreRoutines(s, (s.routines || []).filter(r => same(folderOf(r), name)).map(r => r.id))
  ensureEntry(s, name)
}

/** Deletes the folder and all its routines the way deleteRoutine does, so tombstones follow. */
export function deleteFolderWithRoutines(s, name) {
  const snap = { archived: [], seq: [], deleted: [], entry: takeEntry(s, name) }
  for (const r of (s.routines || []).filter(x => isLive(x) && same(folderOf(x), name))) {
    snap.deleted.push(routineSnapshot(s, r.id))
    deleteRoutine(s, r.id)
  }
  return snap
}

/** Puts back only what the snapshot took. False when there was nothing left to restore. */
export function undoSnapshot(s, snap) {
  let did = false
  const back = new Set()
  // Backwards: each position was noted after the removals before it, so the inverse runs the other way.
  for (const a of [...(snap?.archived || [])].reverse()) {
    const r = (s.routines || []).find(x => x.id === a.id)
    if (!r || r.archived !== true) continue
    delete r.archived
    back.add(a.id)
    did = true
    for (const [d, at] of Object.entries(a.week)) {
      s.week = s.week || {}
      s.week[d] = putBack(s.week[d] == null ? [] : [].concat(s.week[d]), at, a.id)
    }
    for (const iso of Object.keys(a.dayPlan)) { s.dayPlan = s.dayPlan || {}; if (s.dayPlan[iso] == null) s.dayPlan[iso] = a.id }
  }
  if (snap?.seq?.length) {
    const seq = seqOf(s).slice()
    const was = s.rotation?.at
    let cur = was
    for (const [at, id] of snap.seq) {
      if (!back.has(id)) continue
      const p = Math.min(at, seq.length)
      seq.splice(p, 0, id)
      if (Number.isInteger(cur) && p <= cur) cur++   // a cursor that moved on keeps naming its segment
    }
    s.rotation = { ...s.rotation, sequence: seq }
    if (snap.at && was === snap.at[1] && snap.seq.every(([, id]) => back.has(id))) s.rotation.at = snap.at[0]
    else if (Number.isInteger(cur)) s.rotation.at = cur
  }
  for (const d of [...(snap?.deleted || [])].reverse()) if (restoreRoutine(s, d)) did = true
  if (snap?.entry && putBackEntry(s, snap.entry)) did = true
  return did
}

/** Puts a taken folder entry back where it stood. Its current mark comes back only if no folder holds it now. */
export function putBackEntry(s, e) {
  if ((s.routineFolders || []).some(x => same(x.name, e.name))) return false
  const list = (s.routineFolders || []).slice()
  list.splice(Math.min(e.at, list.length), 0, e.current && !list.some(x => x.current) ? { name: e.name, current: true } : { name: e.name })
  s.routineFolders = list
  return true
}

/** The old folder called Archive becomes the archive flag. Safe to run again: a routine an older app
 *  later puts in "Archive" (a reserved name) moves on arrival. True when it moved something. */
export function migrateArchiveFolder(s) {
  const old = (s.routines || []).filter(r => isArchive(r.folder))
  if (!old.length) return false
  // Off the schedule first, as an ordinary archive does: a later Restore must not reactivate old assignments.
  // One that synced in already archived still holds them, so it goes through the same path.
  for (const r of old) delete r.archived
  archiveRoutines(s, old.map(r => r.id))
  for (const r of old) { r.archived = true; delete r.folder }
  s.archiveMoved = true
  return true
}

/** Deletes the archived routines among `ids` for good (live ones stay); undoSnapshot restores them. */
export function deleteArchived(s, ids) {
  const snap = { archived: [], seq: [], deleted: [], entry: null }
  for (const r of (s.routines || []).filter(x => ids.includes(x.id) && x.archived === true)) {
    snap.deleted.push(routineSnapshot(s, r.id))
    deleteRoutine(s, r.id)
  }
  return snap
}
