// A logged exercise's standing against its own frozen prescription, read straight off the audit
// saved with it — a later plan edit can never rewrite the explanation.
export function badgeFor(exposure) {
  const audit = exposure?.audit
  if (!audit) return null
  if (audit.some(f => f.code !== 'completed_track')) return 'out-of-plan'
  return audit.length ? 'completed' : 'on-plan'
}

export const auditFields = exposure =>
  [...new Set((exposure?.audit || []).filter(f => f.code !== 'completed_track').map(f => f.field))]
