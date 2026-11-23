// Folders for routines (Q11, Discord "Allow routine grouping into folders", D#858): one optional
// name on the routine, `folder`, and Plan lists them under it in a section that folds away.
// "Archive" (in English or the reader's language) starts folded, for last block's routines.
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

// The synced folder list, S.routineFolders = [{ name, current? }]: the order, the current plan and
// the empty folders. Routines stay the one source of truth for what is in a folder and what is
// archived (r.archived === true). These work on a state draft `s`, like the store's set().
const same = (a, b) => cleanFolder(a).toLowerCase() === cleanFolder(b).toLowerCase()

/** A routine that trains, plans and syncs to a device: not archived. */
export const isLive = r => !!r && r.archived !== true
export const activeRoutines = S => (S?.routines || []).filter(isLive)

/** Listed folders in order, then folders only named on live routines; counts are routines. */
export function folderList(S) {
  const out = []
  const slot = name => {
    let f = out.find(x => same(x.name, name))
    if (!f) out.push(f = { name, current: false, live: 0, archived: 0 })
    return f
  }
  for (const e of S?.routineFolders || []) { const n = cleanFolder(e?.name); if (n && !out.some(x => same(x.name, n))) slot(n).current = !!e.current }
  for (const r of S?.routines || []) { const n = folderOf(r); if (n && isLive(r)) slot(n).live++ }
  // After the live ones, so an archived routine counts whichever side of its live sibling it sits.
  for (const r of S?.routines || []) { const n = folderOf(r); if (n && !isLive(r)) { const f = out.find(x => same(x.name, n)); if (f) f.archived++ } }
  return out
}
export const currentFolder = S => (S?.routineFolders || []).find(e => e?.current)?.name || null

/** A folder only named on routines gets its entry first, so the mark has somewhere to go. */
export function setCurrent(s, name) {
  if (name != null && !(s.routineFolders || []).some(e => same(e.name, name))) s.routineFolders = folderList(s).map(f => ({ name: f.name }))
  for (const e of s.routineFolders || []) { if (name != null && same(e.name, name)) e.current = true; else delete e.current }
}

/** The folder list as stored entries: folders only named on routines get theirs, in the order Plan shows. */
const entriesOf = s => folderList(s).map(f => (f.current ? { name: f.name, current: true } : { name: f.name }))

function nameProblem(s, name, except) {
  const n = cleanFolder(name)
  if (!n) return { reason: 'empty' }
  if (isArchive(n)) return { reason: 'reserved' }
  const hit = folderList(s).find(f => same(f.name, n) && !(except != null && same(f.name, except)))
  return hit ? { reason: 'taken', name: hit.name } : { n }
}

export function createFolder(s, name) {
  const { n, ...bad } = nameProblem(s, name)
  if (!n) return { ok: false, ...bad }
  s.routineFolders = [...entriesOf(s), { name: n }]
  return { ok: true, name: n }
}

export function renameFolder(s, from, to) {
  const { n, reason } = nameProblem(s, to, from)
  if (!n) return { ok: false, reason }
  for (const r of s.routines || []) if (same(folderOf(r), from)) r.folder = n
  for (const e of s.routineFolders || []) if (same(e.name, from)) e.name = n
  return { ok: true }
}

/** The routines of the folder become loose; the ids let the caller offer an Undo. */
export function removeFolder(s, name) {
  const ids = []
  for (const r of s.routines || []) if (same(folderOf(r), name)) { ids.push(r.id); delete r.folder }
  s.routineFolders = (s.routineFolders || []).filter(e => !same(e.name, name))
  return { ids }
}

/** '' makes them loose. A folder that is not listed yet gets its entry, after the ones already shown. */
export function moveToFolder(s, ids, name) {
  const n = cleanFolder(name)
  const known = n && folderList(s).find(f => same(f.name, n))?.name
  const list = n && !(s.routineFolders || []).some(e => same(e.name, n)) ? entriesOf(s) : null   // before the move names the folder on a routine
  for (const r of s.routines || []) {
    if (!ids.includes(r.id)) continue
    if (n) r.folder = known || n; else delete r.folder
  }
  if (list) s.routineFolders = list.some(e => same(e.name, n)) ? list : [...list, { name: n }]
}

/** Moves a folder in the list as Plan shows it; folders only named on routines get their entry. */
export function reorderFolders(s, from, to) {
  const list = entriesOf(s)
  if (!list[from] || to < 0 || to >= list.length) return
  list.splice(to, 0, ...list.splice(from, 1))
  s.routineFolders = list
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
