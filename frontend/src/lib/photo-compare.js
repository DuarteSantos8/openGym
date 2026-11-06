// How a comparison of two to nine progress photos is laid out (#950), and the crop each photo gets.
// The same numbers drive the screen (CSS object-position) and the picture that is shared
// (lib/compare-image.js), so what is shared is what was on the screen. Pure.

export const COMPARE_MAX = 9

/** Whole days between two ISO dates, never negative. */
export function daysApart(a, b) {
  const ms = new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')
  return Number.isFinite(ms) ? Math.abs(Math.round(ms / 86400000)) : 0
}

/**
 * How many photos sit in each row: as few rows of at most three as it takes, as even as they can
 * be, the fuller rows first. 4 → [2, 2], 5 → [3, 2], 7 → [3, 2, 2].
 */
export function compareRows(n) {
  n = Math.max(0, Math.min(COMPARE_MAX, Math.floor(n) || 0))
  if (!n) return []
  const rows = Math.ceil(n / 3)
  const base = Math.floor(n / rows), extra = n % rows
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * The shape (width / height) every cell gets: the middle one of the photos' own shapes, so most
 * of them fit as they are and the odd one out is cropped. Held between 1:2 and 2:1; 3:4 when
 * nothing is known.
 */
export function cellAspect(photos) {
  const r = (photos || []).map(p => (p && p.width > 0 && p.height > 0 ? p.width / p.height : null)).filter(Boolean).sort((a, b) => a - b)
  if (!r.length) return 3 / 4
  const mid = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2
  return Math.max(0.5, Math.min(2, mid))
}

const clamp01 = v => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5)

/**
 * The part of a srcW x srcH photo that fills a cell of shape `aspect`, the way CSS object-fit:
 * cover with object-position `pos` ({ x, y } from 0 to 1, 0.5 the middle) shows it.
 */
export function coverCrop(srcW, srcH, aspect, pos = {}) {
  let sw = srcW, sh = srcH
  if (srcW / srcH > aspect) sw = srcH * aspect
  else sh = srcW / aspect
  return { sx: (srcW - sw) * clamp01(pos.x ?? 0.5), sy: (srcH - sh) * clamp01(pos.y ?? 0.5), sw, sh }
}

/**
 * A drag of (dx, dy) screen pixels over a cell of cellW x cellH: the new position, so the photo
 * follows the finger. Only the side that overflows the cell moves.
 */
export function panBy(pos, dx, dy, srcW, srcH, cellW, cellH) {
  const scale = Math.max(cellW / srcW, cellH / srcH)
  const overX = srcW * scale - cellW, overY = srcH * scale - cellH
  const x = clamp01(pos?.x ?? 0.5), y = clamp01(pos?.y ?? 0.5)
  return {
    x: overX > 0.5 ? clamp01(x - dx / overX) : 0.5,
    y: overY > 0.5 ? clamp01(y - dy / overY) : 0.5,
  }
}

/** Photos picked for a comparison, oldest first (the picker keeps tap order). */
export const byDate = list => [...(list || [])].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)))
