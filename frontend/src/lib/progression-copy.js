import { POLICY_NAME } from './progression.js'

/**
 * Presentation-only view of a progression result. The engine remains the source of truth for
 * both the outcome and its explanation; this helper only makes the policy behind that result
 * explicit in the workout guidance.
 */
export function progressionGuidance(plan) {
  // A running programme's target (lib/programmes.js) explains itself, whatever the policy.
  if (plan?.kind === 'programme' && plan.why) return { policyLabel: 'Programme', why: plan.why, prog: plan.prog || null }
  if (!plan?.why || plan.kind === 'off' || plan.policy === 'off') return null
  const policyLabel = POLICY_NAME[plan.policy]
  if (!policyLabel) return null
  return { policyLabel, why: plan.why }
}
