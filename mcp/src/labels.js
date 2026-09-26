// Formatting glue between lib helpers (which speak {0}/{1} templates) and the JSON returned
// to the LLM.
import { MUSCLE_NAME, MUSCLES } from '../../frontend/src/lib/muscles.js'
import { setLabel } from '../../frontend/src/lib/history.js'
import { fmtDate, fmtNum, fmtDur } from '../../frontend/src/lib/format.js'

// Apply {0},{1},… substitutions to the template strings the lib returns.
export function fmt(template, args) {
  let v = template
  for (let i = 0; i < (args || []).length; i++) v = v.replaceAll('{' + i + '}', String(args[i]))
  return v
}

export { setLabel }

export function muscleName(slug) {
  return MUSCLE_NAME[slug] || slug
}

export function friendlyDate(iso) {
  if (!iso) return null
  return fmtDate(iso)
}

export function friendlyDuration(ms) {
  return ms ? fmtDur(ms) : null
}

export function ratio(done, total) {
  return `${done}/${total}`
}

export function muscleOrder() { return MUSCLES.slice() }

// Human label per PlanRule preset id (api/engine/rules.js PRESETS). Add a new
// preset's id here rather than inlining a name at a call site.
export const PRESET_LABEL = {
  manual: 'No automatic progression',
  autoregulated: 'Autoregulated (RIR/RPE)',
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  triple: 'Triple progression',
  duration: 'Duration',
  hold_seconds: 'Timed hold progression',
  bodyweight_ladder: 'Bodyweight ladder',
  pyramid: 'Pyramid',
  reverse_pyramid: 'Reverse pyramid',
  five_three_one: '5/3/1'
}
export const presetLabel = id => PRESET_LABEL[id] || id || null

// Human label per set role — what kind of set a prescribed/logged row is, for a coach reading get_workout/preview_session set-by-set.
export const SET_ROLE_LABEL = {
  warmup: 'Warm-up', work: 'Work set', top: 'Top set', anchor: 'Anchor set',
  backoff: 'Back-off set', activation: 'Activation set', recovery: 'Recovery set', cooldown: 'Cool-down set'
}
export const setRoleLabel = role => SET_ROLE_LABEL[role] || role || null

/** "3 × 5 · 60 kg", "3-5 × 8-12 · 70% 1RM", "3 × 8-12 · 60-80 kg", "3 × 30-60 s" — a plan rule in one line. */
export function ruleSummary(rule) {
  const p = rule.parameters
  const span = r => (r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`)
  const upTo = v => (p.loadTo ? `-${fmtNum(v(p.loadTo))}` : '')
  const load = p.load.mode === 'absolute' ? ` · ${fmtNum(p.load.value)}${upTo(l => l.value)} ${p.load.unit}`
    : p.load.mode === 'percent_1rm' ? ` · ${fmtNum(p.load.percent)}${upTo(l => l.percent)}% 1RM` : ''
  return `${span(p.sets)} × ${p.durationSeconds ? span(p.durationSeconds) + ' s' : span(p.reps)}${load}`
}
