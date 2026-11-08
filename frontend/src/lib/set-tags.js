// A colour tag on one set (TestFlight 11-08: "be able to colour code each exercise set"): the
// lifter's own code, whatever it means to them (a grip, a machine, "felt off", a top set). It
// rides on the set row as `tag`, one of SET_TAGS' ids, an optional field: a set without it is
// what it always was, and an app from before this ignores it. On a per-side set the row, not a
// side. It syncs with the workout, shows in the set row and History, and goes into the CSV
// export (`set_color`). Never colour alone: every tag has a shape and a name too, so it reads
// without colour vision and to a screen reader.
import { t } from './i18n-core.js'

export const SET_TAGS = [
  { id: 'red', color: '#ff453a', shape: '●' },
  { id: 'orange', color: '#ff9f0a', shape: '▲' },
  { id: 'yellow', color: '#ffd60a', shape: '■' },
  { id: 'green', color: '#30d158', shape: '◆' },
  { id: 'blue', color: '#0a84ff', shape: '★' },
  { id: 'purple', color: '#bf5af2', shape: '♥' },
]
const BY_ID = new Map(SET_TAGS.map(x => [x.id, x]))

/** The tag's name in the app's language. */
export function setTagName(id) {
  switch (id) {
    case 'red': return t('Red')
    case 'orange': return t('Orange')
    case 'yellow': return t('Yellow')
    case 'green': return t('Green')
    case 'blue': return t('Blue')
    case 'purple': return t('Purple')
    default: return ''
  }
}

/** The set's tag ({ id, color, shape }), or null for a plain set or one it does not know. */
export const setTagOf = s => (s && typeof s.tag === 'string' && BY_ID.get(s.tag)) || null

/** `row` with tag `id`, or without one for null, '' or an id that is not a tag. Never mutates. */
export function withSetTag(row, id) {
  const { tag: _old, ...rest } = row || {}
  return BY_ID.has(id) ? { ...rest, tag: id } : rest
}

/** The CSV cell: the tag's id ("blue"), blank without one. */
export const setTagCell = s => setTagOf(s)?.id || ''
