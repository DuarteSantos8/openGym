// What an admin downloads of someone's training: the workouts they chose (or all of them) as the
// spreadsheet the app's own "Export as CSV" writes, or as JSON. The owner reaches every profile, a
// teacher their own students (the server decides who sees what; this only shapes the file). Pure
// apart from saveText, so the files are pinned by admin-export.test.js.
import { csvText, workoutRows, WORKOUT_COLUMNS } from './export-csv.js'
import { MOBILE, shareExport } from './mobile.js'

const day = ms => new Date(ms).toISOString().slice(0, 10)
export const fileSlug = s => String(s || 'user').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'user'

// The drill-down document (GET /api/admin/user) as the state the exporter reads.
const stateOf = (d, ids) => {
  const want = ids ? new Set(ids.map(String)) : null
  return {
    unit: d.unit === 'lb' ? 'lb' : 'kg',
    customEx: Array.isArray(d.customEx) ? d.customEx : [],
    workouts: (Array.isArray(d.workouts) ? d.workouts : []).filter(w => w && Array.isArray(w.entries) && (!want || want.has(String(w.id))))
  }
}

/** One profile's workouts (all of them when `ids` is null) as { name, mime, text }. */
export function workoutExport(d, ids, format = 'csv', now = Date.now()) {
  const S = stateOf(d, ids)
  const base = `workouts-${fileSlug(d.user?.name)}-${day(now)}`
  if (format === 'json') {
    const workouts = S.workouts.map(({ media, ...w }) => w)
    return { name: base + '.json', mime: 'application/json', text: JSON.stringify({ exported: new Date(now).toISOString(), user: { id: d.user?.id, name: d.user?.name }, unit: S.unit, workouts }, null, 2) }
  }
  return { name: base + '.csv', mime: 'text/csv;charset=utf-8', text: csvText(WORKOUT_COLUMNS, workoutRows(S)) }
}

/** Every profile's workouts in one file (the owner's): CSV with a leading `user` column, or JSON. */
export function everyoneExport(docs, format = 'csv', now = Date.now()) {
  const base = `workouts-everyone-${day(now)}`
  if (format === 'json') {
    const users = docs.map(d => ({ id: d.user?.id, name: d.user?.name, unit: d.unit === 'lb' ? 'lb' : 'kg', workouts: stateOf(d).workouts.map(({ media, ...w }) => w) }))
    return { name: base + '.json', mime: 'application/json', text: JSON.stringify({ exported: new Date(now).toISOString(), users }, null, 2) }
  }
  const rows = docs.flatMap(d => workoutRows(stateOf(d)).map(r => [d.user?.name || '', ...r]))
  return { name: base + '.csv', mime: 'text/csv;charset=utf-8', text: csvText(['user', ...WORKOUT_COLUMNS], rows) }
}

/** Save a text file: the share sheet on the phone, a download on the web. */
export async function saveText({ text, name, mime }) {
  if (MOBILE) { await shareExport(text, name); return }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: mime }))
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}
