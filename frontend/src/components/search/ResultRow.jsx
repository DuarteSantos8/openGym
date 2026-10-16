import { t } from '../../lib/i18n.js'
import { useUnits } from '../../lib/nutrition/use-units.js'
import { useSearch } from '../../lib/search/session.js'
import Icon from '../Icon.jsx'
import { Tag } from '../blocks.jsx'
import Highlight from './Highlight.jsx'
import ResultMedia from './ResultMedia.jsx'

/** The DOM id of a result's row, for the pill's aria-activedescendant. */
export const rowId = key => 'sr-' + String(key).replace(/[^\w-]/g, '_')

/** What a row's trailing column says, for its text and its accessible name. */
export function useTrailing(r) {
  const units = useUnits()
  if (r.value == null || r.value === '') return null
  if (r.unit === 'kcal') return { value: units.energyValue(r.value), unit: r.per100 ? t('{0} / 100 g', units.energyUnit) : units.energyUnit }
  return { value: r.value, unit: r.unit || null }
}

// One search result: one option of the results listbox (a button with role=option, out of the
// tab order, aria-selected while the arrow keys are on it), over the whole row with no control
// inside it, 64px, the media
// slot, the title over the subtitle with the matched words in bold, and what trails it: a value
// ("420" over "kcal", "80 kg × 5" over "3 d ago"), a setting's current value, the "Off" label of a
// feature that is off, or a page's chevron (ui-search.md §7, §8). `reason` (a suggestion) leads
// the subtitle. `active`: the row the arrow keys are on. `trail` false: nothing trails (a Recent
// row, whose × sits there instead).
// `standalone`: the row outside the results listbox (a food picker's online row): a plain button in
// the tab order, with no option role.
export default function ResultRow({ r, onOpen, trail = true, standalone = false }) {
  const active = useSearch(s => s.active === rowId(r.key))
  const value = useTrailing(r)
  const trailing = trail ? value : null
  const isSetting = r.type === 'setting'
  const subtitle = r.reason ? [r.reason, r.subtitle].filter(Boolean).join(' · ') : r.subtitle
  const label = [
    r.fav ? t('Favourite') : null, r.title, subtitle,
    r.off ? t('feature off, opens Features') : null,
    trailing ? [trailing.value, trailing.unit].filter(Boolean).join(' ') : null,
  ].filter(Boolean).join(', ')
  return (
    <button type="button" {...(standalone ? {} : { role: 'option', 'aria-selected': active, 'data-search-row': '', tabIndex: -1 })} id={rowId(r.key)}
      className={'sr-row' + (active ? ' on' : '') + (r.off ? ' off' : '')} onClick={() => onOpen(r)} aria-label={label}>
      <ResultMedia media={r.media} />
      <span className="sr-text">
        <span className="sr-title">{r.fav && <Icon name="starFill" className="sr-fav" />}<Highlight text={r.title} ranges={r.ranges} /></span>
        {subtitle && <span className="sr-sub">{r.reason && <span className="sr-reason">{r.reason} · </span>}<Highlight text={r.subtitle || ''} ranges={r.subRanges} /></span>}
      </span>
      {!trail ? null : r.off ? <Tag tone="dim" nocap>{t('Off')}</Tag>
        : isSetting ? (trailing && <span className="sr-setval">{trailing.value}</span>)
        : trailing ? <span className="sr-trail"><span className="sr-v">{trailing.value}</span>{trailing.unit && <span className="sr-u">{trailing.unit}</span>}</span>
        : r.type === 'page' ? <Icon name="chevronRight" className="sr-chev" /> : null}
    </button>
  )
}
