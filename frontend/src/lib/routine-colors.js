// The colour a routine's tile can take. Absent or unknown = the accent tile, as before.
export const ROUTINE_COLORS = ['blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'mint', 'teal', 'brown', 'grey']

export const colorOf = (r) => (ROUTINE_COLORS.includes(r?.color) ? r.color : null)

// Style for a .lrow-i tile: the colour and the ink measured for it (index.css --on-<colour>).
export const tileStyle = (r) => {
  const c = colorOf(r)
  return c ? { '--tint': `var(--${c})`, '--on-tint': `var(--on-${c})` } : undefined
}

// A colour for a new routine: the first one its neighbours do not use, else the least used.
export function nextColor(neighbours) {
  const used = new Map(ROUTINE_COLORS.map((c) => [c, 0]))
  for (const r of neighbours) { const c = colorOf(r); if (c) used.set(c, used.get(c) + 1) }
  return ROUTINE_COLORS.reduce((best, c) => (used.get(c) < used.get(best) ? c : best))
}
