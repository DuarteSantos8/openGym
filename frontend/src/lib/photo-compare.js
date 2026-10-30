// The rules behind comparing progress photos (#939): how many can be picked at once, which
// layouts suit how many, and the order they are shown in. Pure, so the screen only draws it.

/** The most photos one comparison takes: past five each one is too small to read in one row on a phone. */
export const MAX_COMPARE = 5

/**
 * Adds `key` to the picked keys, or takes it off if it is already there. With the list full, the
 * oldest pick makes room (the same rule the two-photo picker always had).
 */
export function toggleCompareKey(keys, key, max = MAX_COMPARE) {
  if (keys.includes(key)) return keys.filter(k => k !== key)
  return keys.length >= max ? [...keys.slice(keys.length - max + 1), key] : [...keys, key]
}

/** The picked photos in date order, earliest first, whichever order they were tapped in. */
export function orderForCompare(photos) {
  return [...photos].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)))
}

/**
 * The layouts that make sense for `n` photos. The slider puts one photo over another, so it is for
 * exactly two; side by side takes any number.
 */
export function modesFor(n) {
  return n === 2 ? ['side', 'slider'] : ['side']
}

/** The layout a comparison opens in. */
export function defaultMode(n) {
  return modesFor(n)[0]
}

/** A mode that still applies to `n` photos, else that count's default. */
export function validMode(mode, n) {
  return modesFor(n).includes(mode) ? mode : defaultMode(n)
}

/** Whole days from the earliest to the latest photo of the list (0 for one photo or none). */
export function spanDays(photos) {
  if (photos.length < 2) return 0
  const ds = photos.map(p => p.d).sort()
  const ms = new Date(ds[ds.length - 1] + 'T00:00:00') - new Date(ds[0] + 'T00:00:00')
  return Math.round(ms / 86400000)
}
