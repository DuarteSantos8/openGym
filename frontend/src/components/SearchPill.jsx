import { useRef } from 'react'
import { t } from '../lib/i18n.js'
import { BRAND } from '../brand.js'
import { oneOf } from '../lib/ui-kit.js'
import { usePlaceholderFit } from '../lib/text-fit.js'
import Icon from './Icon.jsx'

// What the pill says on each tab: a long placeholder naming what it finds there, and a short one
// for a field too narrow for it (ui-search §1). Home searches everything.
const PLACEHOLDERS = {
  home: () => [t('Search {0}', BRAND.name), t('Search {0}', BRAND.name)],
  train: () => [t('Exercises, routines, workouts'), t('Search training')],
  food: () => [t('Foods, meals, days'), t('Search food')],
  progress: () => [t('Charts, exercises, workouts'), t('Search progress')],
}
export const SCOPES = Object.keys(PLACEHOLDERS)

// The global search's field, always in a tab root's header and always the real input: there is no
// icon that turns into a field. The whole pill is its label, so a tap on the magnifier or the
// padding focuses the input. Focusing it asks the search overlay to open (`onOpen`) and the focus
// stays here while it is open (`expanded`, `controls` naming the overlay). With no overlay
// (`onOpen` left out) it is a plain field and claims no combobox, popup or expansion.
// `value` / `onChange(text)` (left out, the input keeps its own text); the clear button (and Escape) empties it and keeps the focus.
export default function SearchPill({ scope = 'home', value, onChange, onOpen, expanded = false, controls }) {
  oneOf('SearchPill', 'scope', scope, SCOPES)
  const input = useRef(null)
  const [long, short] = PLACEHOLDERS[scope]()
  const placeholder = usePlaceholderFit(input, long, short)
  const clear = () => { onChange?.(''); input.current?.focus() }
  return (
    <label className="spill" role="search">
      <Icon name="magnifier" className="spill-g" />
      <input ref={input} className="spill-i" type="text" inputMode="search"
        role={onOpen ? 'combobox' : undefined} aria-label={long}
        aria-haspopup={onOpen ? 'dialog' : undefined} aria-expanded={onOpen ? expanded : undefined}
        aria-controls={onOpen && expanded ? controls : undefined}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search"
        placeholder={placeholder} value={value}
        onChange={e => onChange?.(e.target.value)}
        onFocus={onOpen}
        onKeyDown={e => { if (e.key === 'Escape' && value) { e.preventDefault(); clear() } }} />
      {!!value && (
        <button type="button" className="spill-clear" onClick={clear} aria-label={t('Clear search')}>
          <span className="spill-x"><Icon name="xmark" /></span>
        </button>
      )}
    </label>
  )
}
