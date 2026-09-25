import { t } from './i18n.js'

const FIELD = { sets: 'sets', reps: 'reps', load: 'weight', durationSeconds: 'time', rir: 'effort' }

/** Plain language for one audit finding — a warning, never an error. */
export function findingText(f) {
  if (f.code === 'below_range') return t('{0} below plan', t(FIELD[f.field]))
  if (f.code === 'above_range') return t('{0} above plan', t(FIELD[f.field]))
  if (f.code === 'above_cap') return t('Above the target cap')
  if (f.code === 'missing_reference') return t('Entered without a 1RM')
  return t('Progression completed')
}
