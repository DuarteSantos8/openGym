import { lazy, Suspense, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { cx } from '../lib/ui-kit.js'
import { tabOf } from '../lib/tab-route.js'
import { useScrolledBy } from '../lib/use-scrolled-by.js'
import { useStore } from '../store/useStore.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { SEARCH_LIST_ID, closeSearch, openSearch, overlayKey, registerPill, setQuery, takeFocusOnMount, useSearch } from '../lib/search/session.js'
import AvatarButton from './AvatarButton.jsx'
import { foodPickerSheet } from './FoodPickerSheet.jsx'
import SearchPill from './SearchPill.jsx'
import { scanSheet } from './ScanSheet.jsx'

// The context button's exit and return load with the search chunk; until then it just goes.
const ContextSlot = lazy(() => import('./search/header-motion.jsx').then(m => ({ default: m.ContextSlot })))

// What the pill says while the search is scoped to one group (ui-search.md §5).
const SCOPED = {
  pages: () => t('Search pages'), settings: () => t('Search settings'), exercises: () => t('Search exercises'),
  routines: () => t('Search routines'), workouts: () => t('Search workouts'), foods: () => t('Search your foods'), days: () => t('Search days'),
}

const desktopKeys = () => { try { return !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches } catch { return false } }

// The barcode button scans to where the + sheet's Scan logs (PlusSheet.jsx): the date every tab
// shares and the meal, as they are at the tap, with "Search foods" going on to the picker.
function scanToSelection() {
  const settings = useNutrition.getState().settings.data
  const { date, meal } = useDiarySelection.getState().target(settings)
  const names = mealLabels(settings)
  const slot = meal < names.length ? meal : 0
  scanSheet({ date, meal: slot, mealName: names[slot], onSearch: foodPickerSheet })
}

// The header of a tab's root (Home, Training, Nutrition, Progress), the bearmenu mobile header:
// one pinned row of the search pill, the tab's one context button where it has one (`action`),
// and the avatar. It carries no visible title, since the tab bar already names the tab; `title`
// is the page's name for a screen reader, its h1. The pill's placeholder is the tab's, read from
// the address rather than chosen by the page. A hairline fades in under it once the page scrolls.
// The pill is the global search's input (lib/search/session.js): focusing it opens the overlay,
// the avatar becomes its close button and the context button steps aside while it is open. The
// query shows only while the overlay does: a tab root a search visit opened on top of it (a Page
// result) has an empty pill, not the query of the overlay waiting underneath.
export default function RootHeader({ title, action }) {
  const { pathname } = useLocation()
  const scrolled = useScrolledBy(4)
  const tab = tabOf(pathname) || 'home'
  const open = useSearch(s => s.open)
  const query = useSearch(s => s.query)
  const group = useSearch(s => s.group)
  const active = useSearch(s => s.active)
  const nutrition = nutritionAvailable(useStore(s => s.user))
  const input = useRef(null)
  useEffect(() => {
    registerPill(input.current)
    if (takeFocusOnMount()) input.current?.focus()
    return () => registerPill(null)
  }, [])
  const close = () => { closeSearch(); input.current?.blur() }
  return (
    <div className={cx('tab-hdr', (scrolled || open) && 'scrolled')}>
      <h1 className="sr-only">{title}</h1>
      <div className="tab-hdr-row">
        <SearchPill scope={tab} value={open ? query : ''} onChange={setQuery} onOpen={() => openSearch(tab)} expanded={open}
          controls={SEARCH_LIST_ID} activeDescendant={active} inputRef={input} shortcut={desktopKeys()}
          placeholder={open && group ? SCOPED[group]?.() : undefined}
          onEscape={close} onKeys={overlayKey} onScan={nutrition ? scanToSelection : undefined} />
        {action && <Suspense fallback={!open && <div className="hdr-slot"><div className="hdr-slot-in">{action}</div></div>}>
          <ContextSlot show={!open}>{action}</ContextSlot>
        </Suspense>}
        <AvatarButton mode={open ? 'close' : 'profile'} onClose={close} />
      </div>
    </div>
  )
}
