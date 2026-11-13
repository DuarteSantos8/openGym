// A logged exercise's standing against its own frozen prescription, read straight off the audit
// saved with it — a later plan edit can never rewrite the explanation.
import { t } from '../lib/i18n.js'
import { sessionOutcome } from '../lib/programmes.js'

export function badgeFor(exposure) {
  const audit = exposure?.audit
  if (!audit) return null
  if (audit.some(f => f.code !== 'completed_track')) return 'out-of-plan'
  return audit.length ? 'completed' : 'on-plan'
}

export const auditFields = exposure =>
  [...new Set((exposure?.audit || []).filter(f => f.code !== 'completed_track').map(f => f.field))]

/** What a programme made of a logged exercise (spec 14: the verdict apart from where it went), or null. */
export function programmeLine(S, exposure) {
  const o = sessionOutcome(S, exposure?.programme)
  if (!o) return null
  if (o.role === 'extra') return t('Extra session, not counted')
  if (o.role === 'maintenance') return t('Kept steady (goal reached)')
  if (o.action === 'achieve') return t('Goal reached')
  if (o.action === 'repeat') return o.rounds ? t('Repeating round {0}', o.week) : t('Repeating week {0}', o.week)
  if (o.action === 'advance' && o.missed) return o.rounds ? t('Target missed; moved on to round {0} as you chose', o.week + 1) : t('Target missed; moved on to week {0} as you chose', o.week + 1)
  return null
}
