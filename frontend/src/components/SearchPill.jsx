import { lazy, Suspense, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { BRAND } from '../brand.js'
import { oneOf } from '../lib/ui-kit.js'
import { usePlaceholderFit } from '../lib/text-fit.js'
import Icon from './Icon.jsx'
import { Kbd } from './blocks.jsx'

// The magnifier's animation loads with the search chunk; until then the glyph stands still.
const MotionMagnifier = lazy(() => import('./search/header-motion.jsx').then(m => ({ default: m.MotionMagnifier })))

// What the pill says on each tab: a long placeholder naming what it finds there, and a short one
// for a field too narrow for it (ui-search §1). Home searches everything.
const PLACEHOLDERS = {
  home: () => [t('Search {0}', BRAND.name), t('Search {0}', BRAND.name)],
  train: () => [t('Exercises, routines, workouts'), t('Search training')],
  food: () => [t('Foods, meals, days'), t('Search food')],
  progress: () => [t('Charts, exercises, workouts'), t('Search progress')],
}
export const SCOPES = Object.keys(PLACEHOLDERS)

// The shortcut a desktop keyboard opens search with (bearmenu use-search-shortcut).
const isMac = () => {
  try { return /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '') } catch { return false }
}

// The global search's field, always in a tab root's header and always the real input: there is no
// icon that turns into a field. The whole pill is its label, so a tap on the magnifier or the
// padding focuses the input. Focusing it asks the search overlay to open (`onOpen`) and the focus
// stays here while it is open: a combobox (`expanded`, `controls` naming the results listbox,
// `activeDescendant` the option the arrow keys are on). With no overlay (`onOpen` left out) it is a plain field and claims
// no combobox, popup or expansion.
// `value` / `onChange(text)` (left out, the input keeps its own text); the clear button (and
// Escape) empties it and keeps the focus. Escape on an empty field is `onEscape`'s, every other
// key `onKeys`'s (the overlay's arrows, Enter, Home and End). `placeholder` replaces the tab's
// (a scoped search says what it is scoped to). `onScan` adds the barcode button while expanded.
export default function SearchPill({ scope = 'home', value, onChange, onOpen, expanded = false, controls, activeDescendant, placeholder: scoped, onEscape, onKeys, onScan, inputRef, shortcut = false }) {
  oneOf('SearchPill', 'scope', scope, SCOPES)
  const own = useRef(null)
  const input = inputRef || own
  const [long, short] = scoped ? [scoped, scoped] : PLACEHOLDERS[scope]()
  const placeholder = usePlaceholderFit(input, long, short)
  // Bumped on the press, not on the open, so the magnifier answers the finger (§10.4).
  const [replay, setReplay] = useState(0)
  const clear = () => { onChange?.(''); input.current?.focus() }
  const onKeyDown = e => {
    if (e.key === 'Escape') {
      if (value) { e.preventDefault(); e.stopPropagation(); clear(); return }
      if (onEscape) { e.preventDefault(); e.stopPropagation(); onEscape(); return }
    }
    onKeys?.(e)
  }
  const glyph = <Icon name="magnifier" className="spill-g" />
  const hint = shortcut && !expanded && !value
  return (
    <label className="spill" role="search" onPointerDown={onOpen ? () => setReplay(n => n + 1) : undefined}>
      {onOpen ? <Suspense fallback={glyph}><MotionMagnifier active={expanded} replayToken={replay} className="spill-g" /></Suspense> : glyph}
      <input ref={input} className="spill-i" type="text" inputMode="search"
        role={onOpen ? 'combobox' : undefined} aria-label={scoped || long}
        aria-haspopup={onOpen ? 'listbox' : undefined} aria-expanded={onOpen ? expanded : undefined}
        aria-controls={onOpen && expanded ? controls : undefined}
        aria-activedescendant={onOpen && expanded && activeDescendant ? activeDescendant : undefined}
        aria-autocomplete={onOpen ? 'list' : undefined}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search"
        placeholder={placeholder} value={value}
        onChange={e => onChange?.(e.target.value)}
        onFocus={onOpen}
        onKeyDown={onKeyDown} />
      {hint && <span className="spill-kbd" aria-hidden="true"><Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></span>}
      {!!value && (
        <button type="button" className="spill-clear" onClick={clear} aria-label={t('Clear search')}>
          <span className="spill-x"><Icon name="xmark" /></span>
        </button>
      )}
      {expanded && onScan && (
        <button type="button" className="spill-scan" onClick={onScan} aria-label={t('Scan barcode')}>
          <Icon name="scanBarcode" />
        </button>
      )}
    </label>
  )
}
