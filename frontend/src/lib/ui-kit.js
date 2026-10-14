// Shared by the UI kit's primitives (components/layout.jsx, blocks.jsx, sheet-layout.jsx).

export const cx = (...parts) => parts.filter(Boolean).join(' ')

// The space scale's steps: 1…10 = 2, 4, 6, 8, 10, 12, 14, 16, 18, 22px, with 2.5 = 5px. Gaps may
// also be 0. A step is its own class suffix: gap={2.5} → g-2.5 (`.g-2\.5` in ui-kit.css).
export const STEPS = [1, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10]
export const GAPS = [0, ...STEPS]

// A prop value the kit has no class for would render nothing and say nothing: in development it
// throws instead. Production renders what it was given.
export function oneOf(component, prop, value, allowed) {
  if (import.meta.env.DEV && value != null && !allowed.includes(value)) {
    throw new Error(`${component}: ${prop}=${JSON.stringify(value)} is not one of ${allowed.map(a => JSON.stringify(a)).join(', ')}`)
  }
  return value
}
