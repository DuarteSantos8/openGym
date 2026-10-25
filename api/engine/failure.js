import { MAX_ROWS, planPhase } from './rules.js'

export function failureSetRange(rule) {
  const phase = planPhase(rule)
  return phase.groups.reduce((total, group) => {
    const count = group.count === 'parameters' ? phase.parameters.sets : group.count
    return { min: total.min + count.min, max: total.max + count.max }
  }, { min: 0, max: 0 })
}

// Set numbers are one-based; symbolic choices follow a changing prescribed set count.
export function failureSetsOf(cfg = {}) {
  const value = cfg.failureSets ?? (cfg.lastToFailure === true ? 'last' : [])
  if (value === 'all' || value === 'last') return value
  if (!Array.isArray(value) || value.length > MAX_ROWS || value.some(n => !Number.isInteger(n) || n < 1 || n > MAX_ROWS)) throw new Error('invalid failure sets')
  return [...new Set(value)].sort((a, b) => a - b)
}

export function failureSetSelected(cfg, index, count) {
  if (index < 0 || index >= count) return false
  const selected = failureSetsOf(cfg)
  return selected === 'all' || (selected === 'last' ? index === count - 1 : selected.includes(index + 1))
}

export function failureSuffix(cfg, count) {
  const selected = Array.from({ length: count }, (_, i) => failureSetSelected(cfg, i, count))
  return selected.some(Boolean) ? selected.every(Boolean) ? '+' : '(+)' : ''
}
