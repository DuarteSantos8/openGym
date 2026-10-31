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

/**
 * The shape (height over width) every photo of a side-by-side comparison is shown in, so that they
 * all have the same height: the median of theirs, which shows most of them whole. `items` are
 * { w, h } sizes; ones with no size are left out, and with none at all it is 4:3 portrait.
 */
export function cellRatio(items) {
  const r = (items || []).filter(i => i && i.w > 0 && i.h > 0).map(i => i.h / i.w).sort((a, b) => a - b)
  if (!r.length) return 4 / 3
  const mid = r.length >> 1
  return r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2
}

/**
 * How a photo of iw × ih fills a box of cw × ch (like object-fit: cover), shifted by the pan
 * position (px, py, each 0 to 1, 0.5 being centred; like object-position as a fraction). Gives the
 * part of the photo that shows, { sx, sy, sw, sh }, and how many box pixels the photo overflows it by on
 * each side, which is how far it can be dragged.
 */
export function coverCrop(iw, ih, cw, ch, px = 0.5, py = 0.5) {
  if (!(iw > 0 && ih > 0 && cw > 0 && ch > 0)) return { sx: 0, sy: 0, sw: Math.max(iw || 0, 0), sh: Math.max(ih || 0, 0), overflowX: 0, overflowY: 0 }
  const k = Math.max(cw / iw, ch / ih)
  const sw = cw / k, sh = ch / k
  const c = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.5))
  return { sx: (iw - sw) * c(px), sy: (ih - sh) * c(py), sw, sh, overflowX: Math.max(0, iw * k - cw), overflowY: Math.max(0, ih * k - ch) }
}

/**
 * The pan position after the finger moved (dx, dy) pixels: the photo goes where the finger goes, so the
 * position moves the other way, by that much of what can be dragged. An axis with nothing to drag stays put.
 */
export function dragPan(pos, dx, dy, overflowX, overflowY) {
  const c = v => Math.min(1, Math.max(0, v))
  return {
    x: overflowX > 0 ? c(pos.x - dx / overflowX) : pos.x,
    y: overflowY > 0 ? c(pos.y - dy / overflowY) : pos.y,
  }
}

/** The pan position a photo starts at: its middle. */
export const CENTRED = { x: 0.5, y: 0.5 }

