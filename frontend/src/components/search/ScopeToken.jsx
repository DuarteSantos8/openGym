import { dateLocale, t, tn } from '../../lib/i18n.js'
import { groupTitle } from '../../lib/search/results.js'
import Icon from '../Icon.jsx'
import { Chip } from '../blocks.jsx'

// While the search is scoped to one group, its token in the summary line's place: the group and
// its count, × to go back to every group (ui-search.md §5). Backspace in an empty pill does too.
export default function ScopeToken({ group, count, onClear }) {
  const n = count.toLocaleString(dateLocale())
  return (
    <div className="sr-scope">
      <Chip on nocap className="sr-token" onClick={onClear} aria-label={t('Scoped to {0}, remove scope', groupTitle(group).toLowerCase())}>
        {groupTitle(group)} <span className="dim">{n}</span><Icon name="xmark" />
      </Chip>
      <span className="sr-scope-n">{tn('{0} result', '{0} results', count).replace(String(count), n)}</span>
    </div>
  )
}
