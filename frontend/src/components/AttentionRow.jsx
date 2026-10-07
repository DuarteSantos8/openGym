import { t } from '../lib/i18n.js'

// One flagged exercise: its name, the evidence behind the flag, a suggested alternative,
// and the kind tag. Shared by Home's Strength card and Stats' weekly review so the two
// screens never word the same signal differently. `altNames` are pre-resolved alternative
// exercise names and may be empty.
export default function AttentionRow({ a, altNames }) {
  return <div className="mrow" style={{ alignItems: 'flex-start' }}>
    <span className="nm" style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
      <span style={{ display: 'block' }}>{a.name}</span>
      <span className="small dim" style={{ display: 'block', fontWeight: 400 }}>
        {a.kind === 'stalling' ? t('Missed the target {0} sessions running.', a.stalls)
          : a.kind === 'skipped' ? t('No completed sets in the last {0} days, across {1} workouts.', a.days, a.workouts)
          : t('Needs {0} — not in the active equipment profile.', a.eq)}
        {altNames.length > 0 ? ' ' + t('Try: {0}.', altNames.join(', ')) : ''}
      </span>
    </span>
    <span className="v" style={{ color: 'var(--orange)' }}>{a.kind === 'stalling' ? t('Stalled') : a.kind === 'skipped' ? t('Skipped') : t('Equipment')}</span>
  </div>
}
