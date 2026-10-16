import { t } from '../../lib/i18n.js'
import { EmptyState } from '../blocks.jsx'
import ResultList from './ResultList.jsx'
import ResultRow from './ResultRow.jsx'

// Nothing matched (ux-search.md §1): say so, then the ways on, as the options of the listbox in
// one card: the nearest thing that was meant, making the food or exercise that was looked for,
// asking Open Food Facts. `actions` are { key, title, glyph, run } and only the ones that apply
// are passed.
export default function NoResults({ query, actions }) {
  return <>
    <EmptyState icon="magnifier" title={t('Nothing matches “{0}”', query.trim())} className="sr-empty" />
    <ResultList>
      {actions.length > 0 && <div className="sr-card">
        {actions.map(a => <ResultRow key={a.key} r={{ type: 'action', key: a.key, title: a.title, subtitle: a.subtitle, media: { kind: 'glyph', glyph: a.glyph } }} onOpen={a.run} />)}
      </div>}
    </ResultList>
  </>
}
