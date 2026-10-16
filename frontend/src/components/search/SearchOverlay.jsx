import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from 'motion/react'
import { t, tn } from '../../lib/i18n.js'
import {
  CONTENT_ENTER_DELAY, CONTENT_EXIT, CONTENT_SPRING, LIST_CONTAINER, LIST_ITEM, REDUCED, SURFACE_EXIT, SURFACE_SPRING, contentSwapVariants, skeletonSwapVariants,
} from '../../lib/motion.js'
import { SEARCH_OVERLAY_ID, closeSearch, rememberScroll, setActive, setGroup, setOverlayKeys, setQuery, useSearch, visit } from '../../lib/search/session.js'
import { GROUP_LIMIT, groupCount, groupTitle, listAll, searchLocal, summaryOf } from '../../lib/search/results.js'
import { nearest } from '../../lib/search/match.js'
import { settingTitles } from '../../lib/search/settings-source.js'
import { addRecent } from '../../lib/search/recents.js'
import { syncDiaryIndex } from '../../lib/nutrition/diary-index.js'
import { useNutrition } from '../../lib/nutrition/store.js'
import { customExSheet, weighInsSheet } from '../../sheets.jsx'
import { Kbd } from '../blocks.jsx'
import { foodEditSheet } from '../FoodEditSheet.jsx'
import BeforeTyping from './BeforeTyping.jsx'
import BestMatch from './BestMatch.jsx'
import NoResults from './NoResults.jsx'
import ResultGroup from './ResultGroup.jsx'
import ResultList from './ResultList.jsx'
import ResultRow from './ResultRow.jsx'
import ScopeToken from './ScopeToken.jsx'
import { SkeletonRows, SourceNote } from './SourceStatus.jsx'
import SummaryLine from './SummaryLine.jsx'
import { openResult } from './open-result.js'
import { useOnlineResults } from './use-online-results.js'
import { useReducedMotionPref } from './use-reduced-motion.js'
import { useSearchData } from './use-search-data.js'

// The term the lists are keyed on: 250 ms without typing (bearmenu's debounce). Between settles
// the rows update in place, keyed by type and id; at a settle the stagger plays again.
function useSettled(value, ms) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (value === settled) return undefined
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, settled, ms])
  return settled
}

const PAGE = 60

// The overlay (fitness-eval ux-search.md, ui-search.md): a results surface under the header,
// whose pill stays the only input and keeps the focus. The pill is a combobox and what it pops up
// is the results listbox (ResultList) in here: its groups, its options, the one the arrow keys
// are on as the pill's aria-activedescendant (§6). On a phone it fills the screen below the
// header; at 1000px and up it is a 680px panel over the dimmed page, with a footer naming the
// keys. It opens and closes with bearmenu's springs.
export default function SearchOverlay() {
  const open = useSearch(s => s.open)
  const reduced = useReducedMotionPref()
  const surface = reduced
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: REDUCED }, exit: { opacity: 0, transition: REDUCED } }
    : { hidden: { opacity: 0 }, visible: { opacity: 1, transition: SURFACE_SPRING }, exit: { opacity: 0, transition: SURFACE_EXIT } }
  const content = reduced
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: REDUCED }, exit: { opacity: 0, transition: REDUCED } }
    : { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { ...CONTENT_SPRING, delay: CONTENT_ENTER_DELAY } }, exit: { opacity: 0, y: 8, transition: CONTENT_EXIT } }
  return <LazyMotion features={domAnimation}>
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <AnimatePresence>
        {open && <m.div key="search" className="search-ov" id={SEARCH_OVERLAY_ID}
          variants={surface} initial="hidden" animate="visible" exit="exit">
          {/* Desktop: the dimmed page closes it; out of the tab order, Escape is the key for it. */}
          <button type="button" className="search-scrim" tabIndex={-1} aria-label={t('Close search')} onClick={closeSearch} />
          <m.div className="search-panel" variants={content} initial="hidden" animate="visible" exit="exit">
            <OverlayBody />
          </m.div>
        </m.div>}
      </AnimatePresence>
    </MotionConfig>
  </LazyMotion>
}

function OverlayBody() {
  const query = useSearch(s => s.query)
  const group = useSearch(s => s.group)
  const tab = useSearch(s => s.tab)
  const scrollTop = useSearch(s => s.scrollTop)
  const data = useSearchData(true)
  const deferred = useDeferredValue(query)
  const settled = useSettled(query, 250)
  const spoken = useSettled(query, 900)
  const local = useMemo(() => searchLocal(deferred, data, tab), [deferred, data, tab])
  const hasQuery = query.trim().length > 0
  const ownCount = local.groups.foods.length + (local.best?.group === 'foods' ? 1 : 0)
  const online = useOnlineResults({ query: settled, words: local.words, tab, group, ownCount, nutrition: data.nutrition, open: true })
  const scroller = useRef(null)
  const [limit, setLimit] = useState(PAGE)

  // Back on the overlay: the scroll where it was left.
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = scrollTop }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLimit(PAGE) }, [group, settled])

  const open = useCallback(r => {
    setActive(null)
    openResult(r, { query })
  }, [query])
  const scope = g => { setGroup(g); if (scroller.current) scroller.current.scrollTop = 0 }

  // The groups as they render: the local ones, Online last, and a slow source's status in its place.
  const idx = data.index
  const daysStatus = !data.nutrition || local.groups.days.length ? null
    : !idx.complete && idx.status !== 'error' && !data.days.length ? <SkeletonRows />
    : idx.offline && !data.days.length ? <SourceNote kind="offline-days" place="days" />
    : idx.status === 'error' && !data.days.length ? <SourceNote kind="error" place="days" source={t('your diary')} onRetry={() => syncDiaryIndex({ force: true })} />
    : null
  const onlineStatus = online.status === 'loading' ? <SkeletonRows />
    : online.status === 'paused' ? <SourceNote kind="paused" place="online" seconds={online.seconds} source={t('Open Food Facts')} />
    : online.status === 'error' ? <SourceNote kind="error" place="online" source={t('Open Food Facts')} onRetry={online.retry} />
    : online.status === 'offline' ? <SourceNote kind="offline" place="online" />
    : online.status === 'tap' ? <ResultRow r={{ type: 'action', key: 'online-ask', title: t('Search Open Food Facts for “{0}”', settled.trim()), media: { kind: 'glyph', glyph: 'globe' } }} onOpen={online.ask} />
    : null
  const rowsOf = g => (g === 'online' ? online.rows : local.groups[g])
  const statusOf = g => (g === 'days' ? daysStatus : g === 'online' ? onlineStatus : null)
  const shown = local.order.filter(g => rowsOf(g).length || statusOf(g))
  const summary = summaryOf(local.groups, local.order, { online: online.rows.length, ...(local.best ? { [local.best.group]: 1 } : {}) })
  const total = summary.reduce((n, e) => n + e.count, 0)
  const pending = online.status === 'loading' || (!!daysStatus && !idx.complete)
  const noResults = hasQuery && deferred === query && total === 0 && !pending && online.status !== 'paused'

  // Scoped: one group, whole, in pages of 60 as it scrolls (5,600 exercises).
  const scopedRows = useMemo(() => {
    if (!group) return []
    if (!hasQuery) return listAll(group, data)
    const rows = rowsOf(group)
    return local.best?.group === group ? [local.best.result, ...rows] : rows
  }, [group, hasQuery, data, local, online.rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // One polite live region, spoken 900 ms after typing stops (ux §6).
  const message = !hasQuery ? '' : spoken !== query ? ''
    : noResults ? t('Nothing matches “{0}”', query.trim())
    : t('{0}: {1}', tn('{0} result', '{0} results', total), summary.map(e => groupCount(e.group, e.count)).join(', '))
    + (online.status === 'paused' ? '. ' + t('Open Food Facts paused') : online.status === 'error' ? '. ' + t('Couldn’t reach {0}', t('Open Food Facts')) : '')

  // The pill's keys: ↑ ↓ across every option of the listbox, from group to group, Home and End,
  // Enter activates the active option or keeps the query in Recent, Backspace in an empty pill
  // drops the scope.
  useEffect(() => {
    setOverlayKeys(e => {
      const rows = [...(scroller.current?.querySelectorAll('[role="listbox"] [role="option"]') || [])]
      const at = rows.findIndex(r => r.id === useSearch.getState().active)
      const go = i => {
        const el = rows[i]
        if (!el) return
        setActive(el.id)
        el.scrollIntoView?.({ block: 'nearest' })
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); go(at < 0 ? 0 : Math.min(rows.length - 1, at + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); if (at > 0) go(at - 1); else setActive(null); return }
      if (e.key === 'Home' && at >= 0) { e.preventDefault(); go(0); return }
      if (e.key === 'End' && at >= 0) { e.preventDefault(); go(rows.length - 1); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (at >= 0) { rows[at].click(); return }
        const q = useSearch.getState().query.trim()
        if (q) { addRecent({ kind: 'query', query: q }); e.currentTarget?.blur?.() }
        return
      }
      if (e.key === 'Backspace' && !useSearch.getState().query && useSearch.getState().group) { e.preventDefault(); setGroup(null) }
    })
    return () => setOverlayKeys(null)
  }, [])

  const onScroll = e => {
    const el = e.currentTarget
    rememberScroll(el.scrollTop)
    if (group && el.scrollTop + el.clientHeight > el.scrollHeight - 600 && limit < scopedRows.length) setLimit(l => l + PAGE)
  }
  // Scrolling the results hides the keyboard, and only that.
  const onTouchMove = () => { const a = document.activeElement; if (a?.classList?.contains('spill-i')) a.blur() }

  const chip = c => (c.target.kind === 'sheet' ? weighInsSheet() : visit(c.target.path))

  const actions = noResults ? noResultActions(query, data, online) : []

  let body
  if (group) {
    body = <>
      <AnimatePresence mode="wait" initial={false}>
        <m.div key={'scope-' + group} variants={contentSwapVariants} initial="hidden" animate="show" exit="exit">
          <ScopeToken group={group} count={scopedRows.length} onClear={() => scope(null)} />
        </m.div>
      </AnimatePresence>
      <ResultList>
        <div className="sr-card">
          <m.div key={group + '|' + settled} variants={LIST_CONTAINER} initial="hidden" animate="show">
            {scopedRows.slice(0, limit).map((r, i) => (i < 12
              ? <m.div key={r.key} variants={LIST_ITEM}><ResultRow r={r} onOpen={open} /></m.div>
              : <ResultRow key={r.key} r={r} onOpen={open} />))}
          </m.div>
        </div>
        {!scopedRows.length && statusOf(group)}
      </ResultList>
    </>
  } else if (!hasQuery) {
    body = <BeforeTyping data={data} tab={tab} onOpen={open} onChip={chip} onQuery={setQuery} />
  } else if (noResults) {
    body = <NoResults query={query} actions={actions} />
  } else {
    body = <m.div key={settled} variants={LIST_CONTAINER} initial="hidden" animate="show">
      <m.div variants={LIST_ITEM}><SummaryLine entries={summary} onScope={scope} /></m.div>
      <ResultList>
        {local.best && <m.div variants={LIST_ITEM}><BestMatch r={local.best.result} onOpen={open} /></m.div>}
        {shown.map(g => {
          const rows = rowsOf(g)
          const status = statusOf(g)
          return <AnimatePresence key={g} mode="wait" initial={false}>
            <m.div key={status ? 'status' : 'rows'} variants={skeletonSwapVariants} initial="hidden" animate="show" exit="exit">
              <ResultGroup id={'sr-g-' + g} group={g} title={groupTitle(g)} rows={rows.slice(0, GROUP_LIMIT)} total={rows.length}
                onOpen={open} onShowAll={() => scope(g)} status={rows.length ? null : status} />
            </m.div>
          </AnimatePresence>
        })}
      </ResultList>
    </m.div>
  }

  return <>
    <div className="sr-only" role="status" aria-live="polite">{message}</div>
    <div className="search-scroll" ref={scroller} onScroll={onScroll} onTouchMove={onTouchMove}>
      <div className="search-body">{body}</div>
    </div>
    <div className="search-foot" aria-hidden="true">
      <Kbd>esc</Kbd><span>{query ? t('to clear') : t('to close')}</span>
      <Kbd>↑</Kbd><Kbd>↓</Kbd><span>{t('to move')}</span>
      <Kbd>↵</Kbd><span>{t('to open')}</span>
    </div>
  </>
}

// The ways on from no results: the nearest name, a food or an exercise of that name, the web.
function noResultActions(query, data, online) {
  const q = query.trim()
  const out = []
  const candidates = [
    ...settingTitles(), ...(data.S.routines || []).map(r => r.name), ...(data.foods || []).map(f => f.name),
    ...data.exercises.slice(0, 2000).map(ex => data.nameOf(ex.id)),
  ].filter(Boolean)
  const near = nearest(q, candidates)
  if (near) out.push({ key: 'near', title: t('Did you mean “{0}”?', near), glyph: 'magnifier', run: () => setQuery(near) })
  if (data.nutrition) {
    out.push({ key: 'create-food', title: t('Create food “{0}”', q), glyph: 'apple', run: () => foodEditSheet({ food: { name: q }, settings: useNutrition.getState().settings.data }) })
  }
  out.push({ key: 'create-ex', title: t('Create exercise “{0}”', q), glyph: 'dumbbell', run: () => customExSheet(null, null, q) })
  if (online.status === 'tap') out.push({ key: 'online', title: t('Search Open Food Facts for “{0}”', q), glyph: 'globe', run: online.ask })
  return out
}
