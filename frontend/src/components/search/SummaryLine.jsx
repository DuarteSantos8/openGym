import { Fragment } from 'react'
import { dateLocale, t } from '../../lib/i18n.js'
import { groupCount } from '../../lib/search/results.js'

// "1 page · 4 exercises · 2 workouts · 9 foods" (ui-search.md §5): the kinds below in the first
// line, the largest count in the accent. Tapping one scopes the search to it.
export default function SummaryLine({ entries, onScope }) {
  if (!entries.length) return null
  return (
    <nav className="sr-summary" aria-label={t('Results by kind')}>
      {entries.map((e, i) => {
        const text = groupCount(e.group, e.count)
        const n = e.count.toLocaleString(dateLocale())
        const at = text.indexOf(String(e.count))
        const noun = at >= 0 ? (text.slice(0, at) + text.slice(at + String(e.count).length)).trim() : text
        return <Fragment key={e.group}>
          {i > 0 && <span className="sr-dot" aria-hidden="true" />}
          <button type="button" className="sr-sum" onClick={() => onScope(e.group)} aria-label={t('{0}, show only these', text)}>
            <span className={'sr-n' + (e.emphasized ? ' acc' : '')}>{n}</span><span className="sr-noun">{noun}</span>
          </button>
        </Fragment>
      })}
    </nav>
  )
}
