// Numbers as the watch shows them, the Wear OS app's rules (ui/Theme.kt fmt, clock).

/** 62.5 → "62.5", 60 → "60", 1.25 → "1.25". */
export function fmt (v) {
  if (v == null || !isFinite(v)) return '0'
  const r = Math.round(v * 100) / 100
  return r === Math.floor(r) ? String(r) : String(r).replace(/0+$/, '').replace(/\.$/, '')
}

/** 3125 s → "52:05", 4000 s → "1:06:40". */
export function clock (sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const two = n => (n < 10 ? '0' : '') + n
  return h > 0 ? h + ':' + two(m) + ':' + two(r) : m + ':' + two(r)
}

/** A volume total, short: 12480 → "12,480" is too wide for a watch, so "12.5k". */
export function short (v) {
  if (!v) return '0'
  if (v >= 10000) return fmt(Math.round(v / 100) / 10) + 'k'
  return fmt(Math.round(v))
}
