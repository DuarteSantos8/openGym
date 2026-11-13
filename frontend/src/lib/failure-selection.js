// Which of an exercise's sets are planned to failure. An occurrence says it two ways: the flag
// `lastToFailure: true` ("Last set to failure", v1.4.0) and `failureSets`, which names more than
// the last set — 'all', or the 1-based numbers of the sets to take there. They never ride together:
// the sheet writes the flag for "last" and `failureSets` for everything else, and a plan that
// says neither plans none. Reading is tolerant: data from an import is cleaned, never thrown at.
// No i18n here: history.js imports this, and mcp/ imports history.js under plain Node.
import { MAX_ROWS, planPhase } from './prescription/index.js'

/** The plan's selection: 'all', 'last', or the ascending set numbers (an empty list is none). */
export function failureSetsOf(cfg) {
  const value = cfg?.failureSets ?? (cfg?.lastToFailure === true ? 'last' : [])
  if (value === 'all' || value === 'last') return value
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(n => Number.isInteger(n) && n >= 1 && n <= MAX_ROWS))].sort((a, b) => a - b)
}

/** True when the plan takes at least one set to failure. */
export const hasFailurePlan = cfg => {
  const selection = failureSetsOf(cfg)
  return typeof selection === 'string' || selection.length > 0
}

/** Is set `index` (0-based) of `count` planned to failure? "Last" follows the count as it is. */
export function failureSetSelected(cfg, index, count) {
  if (index < 0 || index >= count) return false
  const selection = failureSetsOf(cfg)
  return selection === 'all' || (selection === 'last' ? index === count - 1 : selection.includes(index + 1))
}

/** "+" when every one of `count` sets goes to failure, "(+)" when only some do, "" when none. */
export function failureSuffix(cfg, count) {
  const marks = Array.from({ length: count }, (_, i) => failureSetSelected(cfg, i, count))
  return marks.some(Boolean) ? (marks.every(Boolean) ? '+' : '(+)') : ''
}

/** How many sets the rule's first phase plans: its fewest and its most. */
export function failureSetRange(rule) {
  const phase = planPhase(rule)
  return phase.groups.reduce((total, group) => {
    const count = group.count === 'parameters' ? phase.parameters.sets : group.count
    return { min: total.min + count.min, max: total.max + count.max }
  }, { min: 0, max: 0 })
}

/** The fields an occurrence stores for a selection: the flag for "last", `failureSets` for the rest. */
export function failureFieldsOf(selection, count = MAX_ROWS) {
  if (selection === 'last') return { lastToFailure: true }
  if (selection === 'all') return { failureSets: 'all' }
  const sets = (selection || []).filter(n => n <= count)
  return sets.length ? { failureSets: sets } : {}
}
