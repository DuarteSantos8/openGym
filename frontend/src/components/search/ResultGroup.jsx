import { m } from 'motion/react'
import { dateLocale, t } from '../../lib/i18n.js'
import { LIST_CONTAINER, LIST_ITEM } from '../../lib/motion.js'
import { Button } from '../ui.jsx'
import OptionButton from './OptionButton.jsx'
import ResultRow, { rowId } from './ResultRow.jsx'

// One group of results (ui-search.md §7): a group of the results listbox named by its real h2,
// with its count, its rows in an inset card stepping in 30 ms apart, and "Show all N" under the
// card when there are more than it shows (an option too, so the arrow keys reach it). `status`
// replaces the rows of a slow source (a skeleton, a note) in the same place.
export default function ResultGroup({ id, group, title, rows, total = rows.length, onOpen, onShowAll, status }) {
  return (
    <section className="sr-sect" role="group" aria-labelledby={id + '-t'}>
      <div className="sr-sect-h">
        <h2 id={id + '-t'} className="sr-sect-t">{title}</h2>
        {total > 0 && <span className="sr-sect-n" aria-hidden="true">{total.toLocaleString(dateLocale())}</span>}
      </div>
      <div className="sr-card">
        {status || <m.div variants={LIST_CONTAINER} initial="hidden" animate="show">
          {rows.map(r => <m.div key={r.key} variants={LIST_ITEM}><ResultRow r={r} onOpen={onOpen} /></m.div>)}
        </m.div>}
      </div>
      {onShowAll && total > rows.length && <div className="sr-more">
        <OptionButton as={Button} type="button" size="sm" variant="plain" id={rowId('more:' + group)} onClick={onShowAll}>
          {t('Show all {0}', total.toLocaleString(dateLocale()))}
        </OptionButton>
      </div>}
    </section>
  )
}
