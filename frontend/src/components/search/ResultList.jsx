import { t } from '../../lib/i18n.js'
import { SEARCH_LIST_ID } from '../../lib/search/session.js'

// The results listbox the pill controls (fitness-eval ux-search.md §6): the one element every
// option of the overlay sits in, directly or in a group named by its heading. Whatever is not an
// option (the summary line, the scope token, the help line, "nothing matches") stays outside it.
// Exactly one is on screen at a time, whichever view the overlay shows.
export default function ResultList({ children }) {
  return <div role="listbox" id={SEARCH_LIST_ID} aria-label={t('Search results')} className="sr-list">{children}</div>
}
