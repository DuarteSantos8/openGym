// Load arithmetic for the prescription engine. Every value stays at full precision until the
// final kg/lb number, which is rounded exactly once. Percent values are
// percentage points: 65 means 65 %, never 0.65.

// Six decimals absorbs float noise (0.3 / 0.1 = 2.9999999999999996) without touching any real
// plate increment.
const clean = v => Number(v.toFixed(6))

/** Snap a kg/lb value onto the rule's rounding: a step with nearest/up/down, or an allowed list. */
export function roundLoad(value, rounding) {
  if (rounding.mode === 'allowed_values') {
    return rounding.allowedValues.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best))
  }
  const snap = { nearest: Math.round, up: Math.ceil, down: Math.floor }[rounding.mode]
  return clean(snap(clean(value / rounding.step)) * rounding.step)
}

/** Unrounded kg/lb value of an expression, or null when it cannot resolve (empty, or no 1RM). */
export function resolveExpression(expression, snapshot1RM) {
  if (expression?.mode === 'absolute') return expression.value
  if (expression?.mode === 'percent_1rm') return snapshot1RM ? snapshot1RM.value * expression.percent / 100 : null
  return null
}

/**
 * Resolve, round once, then cap. The cap is the already-rounded target and applies only to
 * automated suggestions — a logged actual is never capped. On an assistance machine the load is
 * the help you are given, so the target is a floor: no less help than it (issue #232).
 */
export function resolveLoad(expression, { snapshot1RM = null, rounding, cap = null, assisted = false }) {
  const raw = resolveExpression(expression, snapshot1RM)
  if (raw == null) return null
  const value = roundLoad(raw, rounding)
  const unit = expression.mode === 'absolute' ? expression.unit : snapshot1RM.unit
  const beyond = cap != null && (assisted ? value < cap : value > cap)
  return { value: beyond ? cap : value, unit }
}

/**
 * One automated increment, returned as a new expression. percentage_points moves the stored
 * percent; the other four move an absolute value. A missing basis (no 1RM, no target) holds.
 * On an assistance machine progress is less help, so the step runs the other way — down to no
 * help at all, never below.
 */
export function applyIncrement(expression, increment, { snapshot1RM = null, resolvedTarget = null, assisted = false } = {}) {
  const step = assisted ? -increment.value : increment.value
  const floor = v => (assisted ? Math.max(0, v) : v)
  if (increment.type === 'percentage_points') return { ...expression, percent: clean(floor(expression.percent + step)) }
  const current = expression.value
  const next = {
    absolute: () => current + step,
    current_load_percent: () => current * (1 + step / 100),
    snapshot_1rm_percent: () => (snapshot1RM ? current + snapshot1RM.value * step / 100 : current),
    target_load_percent: () => (resolvedTarget != null ? current + resolvedTarget * step / 100 : current)
  }[increment.type]()
  return { ...expression, value: clean(floor(next)) }
}
