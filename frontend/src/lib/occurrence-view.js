// What a routine slot says about itself in a list: the targets line under its name and the chips
// beside it. Display only — nothing here decides what you lift; that stays in lib/prescription.
import { planOptions, planPhase, isTemplateRule } from './prescription/index.js'
import { fmtNum } from './format.js'
import { t } from './i18n.js'

const span = x => (x.min === x.max ? `${x.min}` : `${x.min}–${x.max}`)

/** "3 × 8–12 @ 60 kg": the slot's sets, reps (or seconds) and starting load. */
export function occurrenceTargets(occ) {
  const r = occ?.rule
  if (!r) return t('Needs setup')
  const p = planPhase(r).parameters
  const upTo = v => (p.loadTo ? `–${fmtNum(v(p.loadTo))}` : '')
  const load = p.load.mode === 'absolute' ? ` @ ${fmtNum(p.load.value)}${upTo(l => l.value)} ${p.load.unit}`
    : p.load.mode === 'percent_1rm' ? ` @ ${fmtNum(p.load.percent)}${upTo(l => l.percent)}% 1RM` : ''
  return `${span(p.sets)} × ${p.durationSeconds ? span(p.durationSeconds) + 's' : span(p.reps)}${load}`
}

/** The sets the slot plans at least: what the routine's "N sets" adds up. */
export const plannedSets = occ => (occ?.rule ? planPhase(occ.rule).parameters.sets.min : 0)

/**
 * The few words that tell two slots of the same exercise apart: the progression first, then
 * what was switched on. `preset` is the progression's name (the caller owns its label table);
 * `effort` is the profile's scale ('rir' | 'rpe' | 'none'), and a target RIR only shows while the
 * profile rates effort at all, as in the rule editor.
 */
export function occurrenceChips(occ, { preset, effort = 'none' } = {}) {
  if (!occ?.rule) return []
  const chips = [occ.mode === 'cardio' ? t('Cardio') : preset]
  if (occ.side) chips.push(t('Per side'))
  if (occ.warmup && occ.warmup.mode !== 'off') chips.push(t('Warm-ups'))
  if (occ.intensifier?.type === 'dropset') chips.push(t('Drop-set'))
  else if (occ.intensifier?.type === 'restpause') chips.push(t('Rest-pause'))
  if (occ.lastToFailure) chips.push(t('Taken to failure'))
  if (occ.backoff) chips.push(t('Back-off sets'))
  const template = isTemplateRule(occ.rule)
  const rir = effort !== 'none' && occ.mode !== 'cardio' && template ? planOptions(occ.rule).rir : null
  if (rir) chips.push(`RIR ${span(rir)}`)
  if (!template) chips.push(t('Imported'))
  return chips.filter(Boolean)
}
