import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { EXDB, allExercises, searchExercises, similarExercises } from '../lib/exercises.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum, exCount } from '../lib/format.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import ExerciseViewToggle from '../components/ExerciseViewToggle.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useAutoMore } from '../lib/use-auto-more.js'
import { isFav, sortFavouritesFirst, sortYoursFirst, usageOf } from '../lib/favourites.js'
import { EQUIP_GROUPS, MUSCLE_GROUPS, matchesEquip, matchesMuscles } from '../lib/exercise-filters.js'
import { equipLabel, openEquipFilter, openMuscleFilter } from '../components/FilterSheets.jsx'

export default function Library() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  // The filters are picked in sheets (components/FilterSheets.jsx), one or several of each: muscle
  // ids (lib/exercise-filters.js) and equipment group ids.
  const [mus, setMus] = useState([])
  const [eqs, setEqs] = useState([])
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  const [shown, setShown] = useState(40)
  const moreRef = useAutoMore(() => setShown(s => s + 40))
  const profile = activeProfile(S)
  // Your own exercises, counted the way the list below shows them (allExercises puts every
  // custom entry in front of the catalogue; deleting one removes it from customEx outright).
  const ownCount = (S.customEx || []).filter(c => c && c.id).length
  // Searched on every render, as it always was: aliases, custom names and the language all feed it.
  const searched = searchExercises(allExercises(S), q)
  const avail = e => !profile || showAll || exAvailable(S, e)
  // What a choice of muscles and equipment would leave, with the search and the equipment profile on.
  const leaving = (muscles, equipment) => searched.filter(e => avail(e) && matchesMuscles(e, muscles) && matchesEquip(e, equipment))
  const narrowedList = leaving(mus, eqs)
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order;
  // while searching, the exercises you have logged or planned follow right after them.
  const usage = useMemo(() => (q.trim() ? usageOf(S) : null), [q, S.routines, S.workouts])
  const f = usage ? sortYoursFirst(narrowedList, S, usage) : sortFavouritesFirst(narrowedList, S)
  // A live count at the end of the search field while a search or filter narrows the list
  // (idea and first version: GitLab !31) — how many are left, before scrolling to find out.
  const narrowed = !!(q.trim() || mus.length || eqs.length)
  // Close but not exact (a typo too many, most of the words, a similar name), under the results
  // once they are all on screen, so a search almost never ends on "No match".
  // Worked out a beat behind the typing (useDeferredValue): the list itself never waits for it.
  const qLate = useDeferredValue(q)
  const similar = q.trim() && qLate === q && f.length <= shown
    ? similarExercises(allExercises(S).filter(e => avail(e) && matchesMuscles(e, mus) && matchesEquip(e, eqs)), q, f, f.length ? 12 : 30)
    : []
  const muscleName = id => t(id === 'cardio' ? 'cardio' : MUSCLE_NAME[id])
  const equipName = equipLabel
  // "Chest", or "Chest +2" once several are picked.
  const filterLabel = (ids, none, nameOf) => (!ids.length ? none : ids.length === 1 ? nameOf(ids[0]) : nameOf(ids[0]) + ' +' + (ids.length - 1))
  const apply = (setter, v) => { setter(v); setShown(40) }
  const openMuscles = () => openMuscleFilter({
    selected: mus, body: S.body,
    counts: Object.fromEntries(MUSCLE_GROUPS.flatMap(g => g.ids).map(id => [id, leaving([id], eqs).length])),
    count: sel => leaving(sel, eqs).length,
    onApply: v => apply(setMus, v),
  })
  const openEquip = () => openEquipFilter({
    selected: eqs,
    counts: Object.fromEntries(EQUIP_GROUPS.map(g => [g.id, leaving(mus, [g.id]).length])),
    count: sel => leaving(mus, sel).length,
    onApply: v => apply(setEqs, v),
  })
  const row = e => {
    const best = bestWeightFor(S, e.id)
    return <div key={e.id} className="item" {...tappable(() => exerciseDetailSheet(e))}>
      <Thumb ex={e} />
      <div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</div><div className="ss capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</div></div>
      {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
      <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}>{t('Plan')}</Button>
    </div>
  }

  return <>
    <div className="hdr lib-hdr"><div><h1>{t('Exercises')}</h1></div>
      <Button size="sm" variant="tinted" icon="figureStrength" onClick={() => nav('/muscles')}>{t('By muscle')}</Button>
      <div className="sub lib-count">{ownCount
        ? tn('{1} animated exercises + 1 of your own', '{1} animated exercises + {0} of your own', ownCount, EXDB.length)
        : t('{0} exercises with animations', EXDB.length)}</div>
    </div>
    <div className="search-row" style={{ marginBottom: 10 }}><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} />
      {narrowed && <span className="search-count" role="status" aria-label={exCount(f.length)}>{fmtNum(f.length)}</span>}
      {q && <button className="clear" onClick={() => { setQ(''); setShown(40) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}</div>
      <ExerciseViewToggle /></div>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setShowAll(v => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    <div className="lib-filters">
      <button type="button" className={'chip nocap fs-btn' + (mus.length ? ' on' : '')} aria-haspopup="dialog" onClick={openMuscles}>
        <span>{filterLabel(mus, t('Muscle group'), muscleName)}</span><Icon name="chevronDown" />
      </button>
      <button type="button" className={'chip nocap fs-btn' + (eqs.length ? ' on' : '')} aria-haspopup="dialog" onClick={openEquip}>
        <span>{filterLabel(eqs, t('Equipment'), equipName)}</span><Icon name="chevronDown" />
      </button>
      {(mus.length > 0 || eqs.length > 0) && <button type="button" className="plan-textbtn" onClick={() => { setMus([]); setEqs([]); setShown(40) }}>{t('Clear filters')}</button>}
    </div>
    <div className={'list' + (S.exerciseView === 'cards' ? ' ex-grid' : '')}>
      <div className="item ex-new" {...tappable(() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="plusCircle" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, and a photo or video if you like')}</div></div><Icon name="plus" className="chev" />
      </div>
      {f.slice(0, shown).map(row)}
      {f.length === 0 && !similar.length && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
      {similar.length > 0 && <h4 className="sec similar-label">{f.length ? t('Similar exercises') : t('No exact match. These come close:')}</h4>}
      {similar.map(row)}
    </div>
    {f.length > shown && <><div style={{ height: 10 }} /><Button ref={moreRef} onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
  </>
}

