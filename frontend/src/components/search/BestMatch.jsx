import { t } from '../../lib/i18n.js'
import { fmtDate } from '../../lib/format.js'
import { TAB_TITLE } from '../../lib/search/pages.js'
import { useSearch } from '../../lib/search/session.js'
import Icon from '../Icon.jsx'
import Highlight from './Highlight.jsx'
import ResultMedia from './ResultMedia.jsx'
import { rowId, useTrailing } from './ResultRow.jsx'

const TYPE = {
  page: () => t('Page'), setting: () => t('Setting'), exercise: () => t('Exercise'), routine: () => t('Routine'), workout: () => t('Workout'),
  food: () => t('Food item'), meal: () => t('Saved meal'), recipe: () => t('Recipe'), day: () => t('Day'),
}

// Where the best match opens, named on the card.
function destination(r) {
  switch (r.type) {
    case 'page': return r.off ? t('Profile › Features') : t(TAB_TITLE[r.tab]) + ' › ' + r.title
    case 'setting': return r.subtitle
    case 'exercise': return t('Exercise details')
    case 'routine': return t('Edit routine')
    case 'workout': return t('Workout details')
    case 'day': return t('Nutrition · {0}', fmtDate(r.date, true))
    default: return t('Food details')
  }
}

// The one result that clearly wins (ui-search.md §6): larger, its type above it and where it
// opens below, one button for the whole card.
export default function BestMatch({ r, onOpen }) {
  const active = useSearch(s => s.active === rowId(r.key))
  const trailing = useTrailing(r)
  const dest = destination(r)
  return (
    <button type="button" role="option" aria-selected={active} id={rowId(r.key)} data-search-row="" className={'sr-best' + (active ? ' on' : '')} onClick={() => onOpen(r)} tabIndex={-1}
      aria-label={t('Best match, {0}, opens {1}', [r.title, r.subtitle].filter(Boolean).join(', '), dest)}>
      <ResultMedia media={r.media} size="lg" />
      <span className="sr-best-t">
        <span className="sr-eyebrow">{TYPE[r.type]?.() || ''}</span>
        <span className="sr-best-title"><Highlight text={r.title} ranges={r.ranges} /></span>
        {r.subtitle && <span className="sr-sub">{r.subtitle}</span>}
        <span className="sr-dest">{dest}<Icon name="chevronRight" /></span>
      </span>
      {trailing && <span className="sr-trail sr-best-v"><span className="sr-v">{trailing.value}</span>{trailing.unit && <span className="sr-u">{trailing.unit}</span>}</span>}
    </button>
  )
}
