import { t } from './i18n.js'
import { POLICY_NAME } from './prescription/vocabulary.js'

const FIELD = { sets: 'sets', reps: 'reps', load: 'weight', durationSeconds: 'time', rir: 'effort' }

/** Plain language for one audit finding — a warning, never an error. */
export function findingText(f) {
  if (f.code === 'below_range') return t('{0} below plan', t(FIELD[f.field]))
  if (f.code === 'above_range') return t('{0} above plan', t(FIELD[f.field]))
  if (f.code === 'above_cap') return t('Above the target cap')
  if (f.code === 'missing_reference') return t('Entered without a 1RM')
  return t('Progression completed')
}

/**
 * What the workout card says about the numbers it opened at: the policy that decided them and
 * its reason (progression-why.js). A running programme supplies its own explanation.
 */
export function progressionGuidance(plan) {
  if (plan?.kind === 'programme' && plan.why) return { policyLabel: 'Programme', why: plan.why, prog: plan.prog || null }
  // A deload week of your own (lib/deload-cycle.js) says so, whatever the policy.
  if (plan?.kind === 'deloadweek' && plan.why) return { policyLabel: 'Deload week', why: plan.why, prog: plan.prog || null }
  if (!plan?.why || plan.kind === 'off' || plan.policy === 'off') return null
  const policyLabel = POLICY_NAME[plan.policy]
  return policyLabel ? { policyLabel, why: plan.why } : null
}
