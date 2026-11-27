// Folders for routines (Q11, Discord "Allow routine grouping into folders", D#858): one optional
// name on the routine, `folder`, and Plan lists them under it in a section that folds away.
// "Archive" (in English or the reader's language) starts folded, for last block's routines, and
// its routines stay out of the schedule and rotation pickers, the printed plan and the MCP tools.
// No new model: a routine without the key is in no folder, and an older app keeps the key as it
// keeps any other it does not know. Which folders are open is this device's own (localStorage).
import { t } from './i18n-core.js'

export const FOLDER_MAX = 40

/** A typed folder name as it is stored: trimmed, single spaces, at most FOLDER_MAX; '' for none. */
export function cleanFolder(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, FOLDER_MAX)
}

export const folderOf = r => cleanFolder(r?.folder)

/** The folders in use, in the order Plan lists them (where their first routine sits). */
export function foldersOf(routines) {
  const seen = []
  for (const r of routines || []) { const f = folderOf(r); if (f && !seen.some(x => x.toLowerCase() === f.toLowerCase())) seen.push(f) }
  return seen
}

/**
 * The list cut into sections: the routines in no folder first, as one section with `folder: ''`,
 * then each folder with its routines, in the order of S.routines (so reordering in Edit still
 * decides). Folder names match without case: "Push" and "push" are one folder.
 */
export function groupRoutines(routines) {
  const loose = []
  const groups = new Map()
  for (const r of routines || []) {
    const f = folderOf(r)
    if (!f) { loose.push(r); continue }
    const key = f.toLowerCase()
    if (!groups.has(key)) groups.set(key, { folder: f, routines: [] })
    groups.get(key).routines.push(r)
  }
  return [{ folder: '', routines: loose }, ...groups.values()]
}

/** Whether a folder is the archive, which starts folded. */
export const isArchive = name => {
  const n = cleanFolder(name).toLowerCase()
  return !!n && (n === 'archive' || n === String(t('Archive')).toLowerCase())
}

/** Whether a routine sits in the archive folder. */
export const inArchive = r => isArchive(folderOf(r))

/**
 * The routines that are in play: everything but the archive. The archive is for routines you are
 * done with, so they stay out of the schedule and rotation pickers, the printed plan and the MCP
 * tools. They are still in S.routines, and Plan's Routines tab still lists them.
 */
export const activeRoutines = routines => (routines || []).filter(r => !inArchive(r))

/** A folder's key for matching: lower case, as groupRoutines matches names. */
export const folderKey = name => cleanFolder(name).toLowerCase()

/**
 * The routines a printout takes. `folders` is the lower-case names of the folders to include
 * (routines in no folder always are); null is the default, every folder but the archive.
 */
export function printableRoutines(routines, folders = null) {
  if (!folders) return activeRoutines(routines)
  const on = folders instanceof Set ? folders : new Set(folders)
  return (routines || []).filter(r => !folderOf(r) || on.has(folderKey(folderOf(r))))
}

const KEY = 'og_plan_folders'
function readOpen() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch (e) { return {} }
}
/** Whether a folder shows its routines on this device: as last left, else open (the archive folded). */
export function folderOpen(name, saved = readOpen()) {
  const k = cleanFolder(name).toLowerCase()
  return typeof saved[k] === 'boolean' ? saved[k] : !isArchive(name)
}
export function setFolderOpen(name, open) {
  const saved = readOpen()
  saved[cleanFolder(name).toLowerCase()] = !!open
  try { localStorage.setItem(KEY, JSON.stringify(saved)) } catch (e) { /* not remembered then */ }
}
