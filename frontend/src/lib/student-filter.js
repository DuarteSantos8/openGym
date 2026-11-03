// The Admin user list, narrowed the way a teacher looks for someone: by name or e-mail, by what
// they are doing (training now, gone quiet), or by whose student they are. Pure, so the rules
// are pinned by student-filter.test.js rather than by clicking.

const DAY = 86400000
export const INACTIVE_DAYS = 7

// Accent- and case-insensitive: "joao" finds "João".
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Whole days since the last sync, or null when the person never synced.
export const quietDays = (u, now = Date.now()) => u.lastSync ? Math.floor((now - u.lastSync) / DAY) : null

// A disabled profile is not "gone quiet": it was switched off on purpose.
const isQuiet = (u, now) => !u.disabled && (u.lastSync ? now - u.lastSync >= INACTIVE_DAYS * DAY : true)

const FILTERS = {
  all: () => true,
  live: u => !!u.live,
  quiet: (u, _me, now) => isQuiet(u, now),
  mine: (u, me) => !!me && u.teacher === me && u.id !== me,
  disabled: u => !!u.disabled
}

export const FILTER_IDS = Object.keys(FILTERS)

// How many rows each filter would show, for the chip labels.
export const filterCounts = (users, me, now = Date.now()) =>
  Object.fromEntries(FILTER_IDS.map(id => [id, users.filter(u => FILTERS[id](u, me, now)).length]))

const SORTS = {
  // Newest sync first, people who never synced last.
  recent: (a, b) => (b.lastSync || 0) - (a.lastSync || 0),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
  // Who has been away longest first: the teacher's to-do list. Never synced counts as longest.
  quiet: (a, b) => (a.lastSync || 0) - (b.lastSync || 0)
}
export const SORT_IDS = Object.keys(SORTS)

export function filterStudents(users, { query = '', filter = 'all', sort = 'recent', me = null, now = Date.now() } = {}) {
  const q = fold(query).trim()
  const keep = FILTERS[filter] || FILTERS.all
  return users
    .filter(u => keep(u, me, now) && (!q || fold(u.name).includes(q) || fold(u.email).includes(q)))
    .sort(SORTS[sort] || SORTS.recent)
}
