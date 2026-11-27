import { useId } from 'react'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { plannedWeeklySets } from '../lib/weekly-sets.js'

const STATUS = { below: 'below range', in: 'in range', above: 'above range' }

export default function RoutineWeeklySets({ S }) {
  const sourceId = useId()
  const rows = plannedWeeklySets(S)
  const showSource = rows.some(row => row.target?.source === 'default')
  return <details className="card routine-weekly-sets">
    <summary><strong>{t('Weekly sets per muscle')}</strong></summary>
    <p className="small">{t('Recurring plan estimate. Warm-ups and date overrides are excluded.')}</p>
    {showSource && <p className="small" id={sourceId}>
      {t('Draft')}{' · '}
      <a href="https://rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth" target="_blank" rel="noreferrer">{t('Default ranges adapted from RP Strength volume landmarks.')}</a>
    </p>}
    {rows.length ? <ul>
      {rows.map(({ slug, sets, target, status }) => <li key={slug}>
        <strong>{t(MUSCLE_NAME[slug])}</strong>{' · '}<bdi>{fmtNum(sets)}</bdi>
        {target && <div className="small" aria-describedby={target.source === 'default' ? sourceId : undefined}>
          {t('Target')}{': '}<bdi>{fmtNum(target.range[0])}–{fmtNum(target.range[1])}</bdi>{' · '}
          <span className={status}>{t(STATUS[status])}</span>
          {target.source === 'personal' && <> · {t('Personal target')}</>}
        </div>}
      </li>)}
    </ul> : <p>{t('No working sets in the recurring plan.')}</p>}
  </details>
}
