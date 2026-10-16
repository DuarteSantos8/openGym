import { cx } from '../../lib/ui-kit.js'
import { useSearch } from '../../lib/search/session.js'

// One option of the results listbox that is not a result row: a Recent entry's ×, "Show all N",
// Retry (fitness-eval ux-search.md §6). Like a row it is a button with
// role=option, out of the tab order: the focus stays in the pill, the arrow keys make it the
// active option (`sr-on`, aria-selected) and Enter clicks it. `id` must be unique in the list.
// `as`: a kit primitive that renders the button itself (Chip), given these props.
export default function OptionButton({ id, as: As, className, children, ...rest }) {
  const active = useSearch(s => s.active === id)
  const props = { role: 'option', id, 'aria-selected': active, tabIndex: -1, 'data-search-row': '', className: cx(className, active && 'sr-on'), ...rest }
  return As ? <As {...props}>{children}</As> : <button type="button" {...props}>{children}</button>
}
