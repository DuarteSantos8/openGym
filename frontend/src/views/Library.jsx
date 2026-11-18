import { laddersSheet } from '../components/Ladders.jsx'
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXDB, BODYPARTS, allExercises, equipmentOf, byCategory, searchExercises, similarExercises, staplesFirst } from '../lib/exercises.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { NotHereButton } from '../components/MachinePicker.jsx'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum, exCount, exerciseNameText } from '../lib/format.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { said } from '../lib/a11y-name.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import ExerciseViewToggle from '../components/ExerciseViewToggle.jsx'
import GymHiddenLine from '../components/GymHiddenLine.jsx'
import { Button } from '../components/ui.jsx'
import { tappable, useRevealActiveChip } from '../lib/use-sheet-keyboard.js'
import { useAutoMore } from '../lib/use-auto-more.js'
import { isFav, sortYoursFirst, usageOf } from '../lib/favourites.js'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { libraryOn } from '../lib/shared-api.js'
import { isOn } from '../lib/modules.js'
import './Library.css'

export default function Library() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  // The server's community library (views/Community.jsx), where it has one.
  const community = useStore(s => libraryOn(s.config, s.user)) && isOn(S, 'community')
  // The shell can replace a lazy screen with its loaded component after a sheet closes. Keep this
  // transient disclosure in the UI store so that handoff cannot close it under the user's pointer.
  const moreOpen = useUI(s => !!s.libraryMoreOpen)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [cat, setCat] = useState('')
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  const [shown, setShown] = useState(40)
  // Ids picked with Select, in the order picked. Nothing is picked until the user picks: the Add
  // bar appears with the first one, so no tap can add an exercise nobody chose. Picks survive a
  // new search or filter, so "bench", Select, "row", Select, Add takes both.
  const [picked, setPicked] = useState([])
  const bpStrip = useRef(null)
  const moreRef = useAutoMore(() => setShown(s => s + 40))
  const profile = activeProfile(S)
  // Your own exercises, counted the way the list below shows them (allExercises puts every
  // custom entry in front of the catalogue; deleting one removes it from customEx outright).
  const ownCount = (S.customEx || []).filter(c => c && c.id).length
  const inPart = searchExercises(allExercises(S).filter(e => !bp || e.bp === bp), q)
  // Kind of exercise (strength, stretching, cardio...), the same fallback as equipment below: a
  // choice the search or body part has narrowed away is ignored for now, never a dead end.
  const { opts: catOpts, on: catOn, list: base } = byCategory(inPart, cat)
  const eqFiltered = (profile && !showAll) ? base.filter(e => exAvailable(S, e)) : base
  // What a search found that the gym leaves out, counted under the results.
  const gymHidden = q.trim() ? base.length - eqFiltered.length : 0
  const eqOpts = equipmentOf(eqFiltered)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order;
  // while searching, the exercises you have logged or planned follow right after them.
  const narrowedList = eqOn ? eqFiltered.filter(e => e.eq === eqOn) : eqFiltered
  // Not only while searching: with no query either, what you train comes first, so the list does
  // not open on the catalogue's alphabetical start ("1 2 Stick Drill").
  const usage = useMemo(() => usageOf(S), [S.routines, S.workouts])
  // Nothing trained or planned yet: the common lifts lead, after any favourites (release pass).
  const fresh = !q.trim() && !Object.keys(usage).length
  const f = sortYoursFirst(fresh ? staplesFirst(narrowedList) : narrowedList, S, usage)
  useRevealActiveChip(bpStrip, bp)
  // Type and equipment live in the Filters sheet (P7). It works out its own options from the same
  // search and body part, so a choice it offers is never a dead end either.
  const sheetOn = (catOn ? 1 : 0) + (eqOn ? 1 : 0)
  const filtersFor = (c, e) => {
    const by = byCategory(inPart, c)
    const pool = (profile && !showAll) ? by.list.filter(x => exAvailable(S, x)) : by.list
    const opts = equipmentOf(pool)
    return { catOpts: by.opts, catOn: by.on, eqOpts: opts, eqOn: opts.includes(e) ? e : '' }
  }
  const openFilters = () => useUI.getState().openSheet(close => <LibraryFilters close={close} cat={catOn} eq={eqOn} filtersFor={filtersFor}
    onChange={(c, e) => { setCat(c); setEq(e); setShown(40) }} />)
  // A live count at the end of the search field while a search or filter narrows the list
  // (idea and first version: GitLab !31) — how many are left, before scrolling to find out.
  const narrowed = !!(q.trim() || bp || eqOn || catOn)
  // Close but not exact (a typo too many, most of the words, a similar name), under the results
  // once they are all on screen, so a search almost never ends on "No match".
  // Worked out a beat behind the typing (useDeferredValue): the list itself never waits for it.
  const qLate = useDeferredValue(q)
  const similar = q.trim() && qLate === q && f.length <= shown
    ? similarExercises(allExercises(S).filter(e => (!bp || e.bp === bp) && (!profile || showAll || exAvailable(S, e))), q, f, f.length ? 12 : 30)
    : []
  const byId = useMemo(() => new Map(allExercises(S).map(e => [e.id, e])), [S])
  const selected = picked.map(id => byId.get(id)).filter(Boolean)
  const togglePick = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const addLabel = selected.length ? t('Add “{0}” to my plan', selected.map(e => said(exerciseNameText(e))).join(', ')) : t('Add to my plan')
  const row = e => {
    const best = bestWeightFor(S, e.id)
    const chosen = picked.includes(e.id)
    // The exercise name opens Details. A separate, visible Select control chooses what the one
    // primary action below adds; neither action overlaps or relies on a swipe/long-press.
    return <div key={e.id} className={'item tap-host iv-lib-row' + (chosen ? ' is-selected' : '')}>
      <Thumb ex={e} />
      <button type="button" className="grow item-open" aria-haspopup="dialog" onClick={() => exerciseDetailSheet(e)}><span className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</span><span className="ss capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</span></button>
      {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
      {profile && !showAll && <NotHereButton profile={profile} ex={e} showLabel />}
      <Button size="sm" variant={chosen ? 'tinted' : 'plain'} icon={chosen ? 'check' : undefined} className="iv-lib-select"
        aria-label={t('Select') + ': ' + said(exerciseNameText(e))} aria-pressed={chosen} onClick={() => togglePick(e.id)}>{t('Select')}</Button>
    </div>
  }

  return <div className="iv-library">
    {/* in season, a string of lights or a few bats along the header (components/Seasonal.jsx) */}
    <div className="hdr lib-hdr"><SeasonDeco spot="header-bats" /><div><h1>{t('Library')}</h1></div>
      <div className="sub lib-count">{ownCount
        ? tn('{1} animated exercises + 1 of your own', '{1} animated exercises + {0} of your own', ownCount, EXDB.length)
        : t('{0} exercises with animations', EXDB.length)}</div>
    </div>
    <details className="iv-lib-more" open={moreOpen} onToggle={e => useUI.setState({ libraryMoreOpen: e.currentTarget.open })}><summary>{t('More')}</summary><div className="iv-lib-more-actions">
      {community && <Button size="sm" variant="tinted" icon="globe" onClick={() => nav('/community')}>{t('Community')}</Button>}
      <Button size="sm" variant="tinted" icon="figureStrength" onClick={() => nav('/muscles')}>{t('By muscle')}</Button>
      <Button size="sm" variant="tinted" icon="stairs" onClick={laddersSheet} data-ladders>{t('Ladders')}</Button>
      <ExerciseViewToggle showLabel />
    </div></details>
    <label className="iv-lib-search-label" htmlFor="iv-library-search">{t('Search')}</label>
    <div className="search-row" data-tour="lib-search" style={{ marginBottom: 10 }}><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input id="iv-library-search" className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} />
      {narrowed && <span className="search-count" role="status" aria-label={exCount(f.length)}>{fmtNum(f.length)}</span>}
      {q && <button type="button" className="clear" onClick={() => { setQ(''); setShown(40) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}</div>
    </div>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 'var(--fs-footnote)' }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 'var(--fs-caption)' }} onClick={() => setShowAll(v => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    {/* One row of filters (redesign 1.4.5, P7), where there were three: Filters opens the sheet with
        the kind of exercise and the equipment, any choice made there sits beside it as a chip you
        can clear, then the body parts. Nothing is filled while nothing is chosen, and a chosen chip
        is a neutral fill, not the accent. Tapping the chosen body part again shows them all (the
        old "All" chip). Changing body part keeps the equipment filter (issue #71): the eqOn
        fallback above drops it only for the current view if the new body part has nothing under
        it, without forgetting the choice. */}
    <div className="chips lib-filters" data-tour="lib-filters" ref={bpStrip}>
      <button type="button" className={'chip nocap ichip lib-fbtn' + (sheetOn ? ' on' : '')} aria-haspopup="dialog" onClick={openFilters}>
        <Icon name="slider" />{t('Filters')}{sheetOn ? <span className="lib-fn">{sheetOn}</span> : null}
      </button>
      {catOn && <button type="button" className="chip on ichip" aria-label={t('Clear') + ': ' + t(catOn)} onClick={() => { setCat(''); setShown(40) }}>{t(catOn)}<Icon name="xmark" /></button>}
      {eqOn && <button type="button" className="chip on ichip" aria-label={t('Clear') + ': ' + t(eqOn)} onClick={() => { setEq(''); setShown(40) }}>{t(eqOn)}<Icon name="xmark" /></button>}
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on ichip' : '')} aria-pressed={bp === b}
        onClick={() => { setBp(bp === b ? '' : b); setShown(40) }}>{t(b)}{bp === b && <Icon name="xmark" />}</button>)}
    </div>
    <div className={'list' + (S.exerciseView === 'cards' ? ' ex-grid' : '')}>
      <div className="item ex-new" data-tour="lib-new" {...tappable(() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="plusCircle" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, and a photo or video if you like')}</div></div><Icon name="plus" className="chev" />
      </div>
      {f.slice(0, shown).map(row)}
      {f.length === 0 && !similar.length && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
      {f.length <= shown && <GymHiddenLine count={gymHidden} profile={profile} onShowAll={() => setShowAll(true)} />}
      {similar.length > 0 && <h4 className="sec similar-label">{f.length ? t('Similar exercises') : t('No exact match. These come close:')}</h4>}
      {similar.map(row)}
    </div>
    {f.length > shown && <><div style={{ height: 10 }} /><Button ref={moreRef} onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
    {selected.length > 0 && <div className="iv-lib-primary" role="region" aria-label={t('Add to my plan')}>
      <Button variant="primary" icon="plus" aria-label={addLabel}
        onClick={() => { addToRoutineSheet(selected.length === 1 ? selected[0] : selected); setPicked([]) }}>
        {t('Add to my plan')}{selected.length > 1 && <span className="iv-lib-count" aria-hidden="true">{fmtNum(selected.length)}</span>}</Button>
      <Button variant="plain" className="iv-lib-unpick" onClick={() => setPicked([])}>{t('Clear')}</Button>
    </div>}
  </div>
}


// The Library's Filters sheet (P7): the kind of exercise and the equipment, as wrapping chips. Every
// tap filters the list behind it at once; Done only closes.
function LibraryFilters({ close, cat, eq, filtersFor, onChange }) {
  const [c, setC] = useState(cat)
  const [e, setE] = useState(eq)
  const { catOpts, catOn, eqOpts, eqOn } = filtersFor(c, e)
  const set = (nc, ne) => { setC(nc); setE(ne); onChange(nc, ne) }
  return <div className="lib-fsheet">
    <h3>{t('Filters')}</h3>
    {catOpts.length > 1 && <>
      <h4 className="sec">{t('Exercise type')}</h4>
      <div className="chips wrap">
        <button type="button" className={'chip nocap' + (!catOn ? ' on' : '')} aria-pressed={!catOn} onClick={() => set('', e)}>{t('Any type')}</button>
        {catOpts.map(x => <button type="button" key={x} className={'chip' + (catOn === x ? ' on' : '')} aria-pressed={catOn === x} onClick={() => set(x, e)}>{t(x)}</button>)}
      </div>
    </>}
    {eqOpts.length > 1 && <>
      <h4 className="sec">{t('Equipment')}</h4>
      <div className="chips wrap">
        <button type="button" className={'chip nocap' + (!eqOn ? ' on' : '')} aria-pressed={!eqOn} onClick={() => set(c, '')}>{t('Any equipment')}</button>
        {eqOpts.map(x => <button type="button" key={x} className={'chip' + (eqOn === x ? ' on' : '')} aria-pressed={eqOn === x} onClick={() => set(c, x)}>{t(x)}</button>)}
      </div>
    </>}
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
    {(catOn || eqOn) && <Button variant="ghost" className="dim" style={{ marginTop: 6 }} onClick={() => set('', '')}>{t('Clear filters')}</Button>}
  </div>
}
