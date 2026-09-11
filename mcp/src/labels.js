// Formatting glue between lib helpers (which speak {0}/{1} templates) and the JSON returned
// to the LLM.
import { MUSCLE_NAME, MUSCLES } from '../../frontend/src/lib/muscles.js'
import { modeOf, fmtSec, setLabel } from '../../frontend/src/lib/history.js'
import { POLICY_NAME, waveOf } from '../../frontend/src/lib/progression.js'
import { fmtDate, fmtNum, fmtDur } from '../../frontend/src/lib/format.js'

// Apply {0},{1},… substitutions to the template strings the lib returns.
export function fmt(template, args) {
  let v = template
  for (let i = 0; i < (args || []).length; i++) v = v.replaceAll('{' + i + '}', String(args[i]))
  return v
}

export { setLabel }

export function exLine(cfg, unit) {
  // A wave has no fixed sets/reps/weight of its own — those vary stage to stage — so it
  // reports its training max and stage count instead, same as the printed PDF plan does
  // (frontend/src/lib/plan-share.js's scheme()).
  if (cfg.prog === 'wave') return `${waveOf(cfg).length}-stage wave · ${fmtNum(cfg.trainingMax || 0)} ${unit} training max`
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  const load = cfg.weight ? ' · ' + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`
  return `${n} × ${cfg.reps}${load}`
}

export function muscleName(slug) {
  return MUSCLE_NAME[slug] || slug
}

export function policyName(policy) {
  return POLICY_NAME[policy] || policy
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
