// Favourite exercises (issue #6): a personal shortlist that floats to the top of the picker,
// the Library and the muscle explorer so building a routine takes fewer scrolls.
//
// Stored as a flat id list in synced state (S.favEx) — catalogue or custom ids alike. It is
// personal, so it stays out of shared plan bundles (lib/plan-share.js) on purpose. Profiles
// written before the field existed simply have no list, hence every reader tolerates undefined.

export const favIds = S => (Array.isArray(S?.favEx) ? S.favEx : [])

export const isFav = (S, id) => favIds(S).includes(id)

/** Flip one exercise in a state draft. Returns true when it is a favourite afterwards. */
export function toggleFav(s, id) {
  const list = favIds(s)
  const on = !list.includes(id)
  s.favEx = on ? [...list, id] : list.filter(x => x !== id)
  return on
}

/**
 * Favourites first, everything else after — both halves keep the order they came in, so a
 * list that is already sorted by name (or by usage) stays that way within each half.
 */
export function sortFavouritesFirst(list, S) {
  const fav = favIds(S)
  if (!fav.length) return list
  const set = new Set(fav)
  return [...list.filter(e => set.has(e.id)), ...list.filter(e => !set.has(e.id))]
}
