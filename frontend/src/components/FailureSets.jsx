// Which sets of an exercise are planned to failure: none, the last one, all of them, or the set
// numbers picked one by one. Controlled — `value` is what lib/failure-selection.js reads
// ('last' | 'all' | the set numbers) and onChange hands back the same shapes. A set past the plan's
// fewest only exists once the progression adds it, so its number carries a "?".
import { Segmented } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { failureSetRange, failureSetSelected, failureSetsOf } from '../lib/failure-selection.js'

// A program the editor cannot read plans no sets it can number.
const rangeOf = rule => { try { return failureSetRange(rule) } catch { return { min: 0, max: 0 } } }

export default function FailureSets({ rule, value, onChange }) {
  const { min, max } = rangeOf(rule)
  if (max < 1) return null
  const selection = failureSetsOf({ failureSets: value })
  const mode = typeof selection === 'string' ? selection : selection.length ? 'custom' : 'none'
  const picked = Array.from({ length: max }, (_, i) => i + 1).filter(n => failureSetSelected({ failureSets: selection }, n - 1, max))
  const toggle = n => onChange(picked.includes(n) ? picked.filter(x => x !== n) : [...picked, n].sort((a, b) => a - b))
  return <section className="fs" data-section="failure">
    <h4 className="sec">{t('Sets to failure')}</h4>
    <div className="small dim" style={{ marginBottom: 10 }}>{t('Do the planned reps or time, then go on to failure in the selected sets.')}</div>
    {/* "custom" is none of the three: the pill stays out of the way until one is pressed. */}
    <Segmented className={mode === 'custom' ? 'no-sel' : ''} value={mode} onChange={v => onChange(v === 'none' ? [] : v)}
      options={[{ value: 'none', label: t('None') }, { value: 'last', label: t('Last') }, { value: 'all', label: t('All') }]} />
    <div className="fs-sets" role="group" aria-label={t('Sets to failure')}>
      {Array.from({ length: max }, (_, i) => <button key={i} type="button" aria-pressed={picked.includes(i + 1)} aria-label={t('Set {0}', i + 1)} onClick={() => toggle(i + 1)}>
        {i + 1}{i >= min && <span aria-hidden="true">?</span>}
      </button>)}
    </div>
    <div className="small dim">
      {t('Tap set numbers to combine them. “+” marks every set as taken to failure, “(+)” at least one.')}
      {min !== max && ' ' + t('Sets marked ? are optional. “Last” follows the number of sets planned.')}
    </div>
  </section>
}
