import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { BODYPARTS, allExercises, equipmentOf, searchExercises } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum, exCount } from '../lib/format.js'
import { MUSCLES, MUSCLE_NAME, musclesOf } from '../lib/muscles.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import BodyMap from './BodyMap.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import ExerciseViewToggle from './ExerciseViewToggle.jsx'
import { Button } from './ui.jsx'
import { Card, Chip, ChipRow, EmptyState, SectionTitle, Tag } from './blocks.jsx'
import { Inline, Spacer } from './layout.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useAutoMore } from '../lib/use-auto-more.js'
import { isFav, sortFavouritesFirst } from '../lib/favourites.js'

// One explorer for the Library and every catalogue picker. Supplying `onPick` turns
// a result into a selection; without it the explorer behaves like the normal Library.
export default function MuscleExplorer({ onPick, onDetail, onPlan }) {
  const S = useStore(s => s.S)
  const [selected, setSelected] = useState(null)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [shown, setShown] = useState(40)
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  const moreRef = useAutoMore(() => setShown(s => s + 40))
  // Same rule as the Library and the picker: the active equipment profile narrows the catalogue
  // (and the per-muscle counts) unless the user asks for everything.
  const profile = activeProfile(S)
  const catalog = useMemo(() => {
    const all = allExercises(S)
    return (profile && !showAll) ? all.filter(e => exAvailable(S, e)) : all
  }, [S.customEx, S.equipFilterOn, S.activeEquipId, S.equipProfiles, showAll])
  const counts = useMemo(() => Object.fromEntries(MUSCLES.map(m => [m,
    catalog.filter(e => musclesOf(e)[m]).length
  ])), [catalog])
  const pick = muscle => { setSelected(muscle === selected ? null : muscle); setEq(''); setShown(40) }
  const targeted = selected ? catalog.filter(e => musclesOf(e)[selected]) : []
  const base = searchExercises(targeted.filter(e => !bp || e.bp === bp), q)
  const eqOpts = equipmentOf(base)
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
  const exercises = sortFavouritesFirst(eqOn ? base.filter(e => e.eq === eqOn) : base, S)
  const choose = ex => onPick ? onPick(ex) : onDetail(ex)
  // The live count and the × of the Library's search (#338): the count while a search or a
  // filter narrows the muscle's list, the × while there is text.
  const narrowed = !!(q.trim() || bp || eqOn)

  return <>
    {profile && <Inline gap={3} className="small dim" style={{ margin: '-4px 2px 10px' }}>
      <Icon name="kettlebell" className="fs-footnote" />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <Chip nocap className="fs-caption" style={{ marginInlineStart: 'auto', padding: '3px 10px' }} onClick={() => { setShowAll(v => !v); setEq(''); setShown(40) }}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </Chip>
    </Inline>}
    <Card>
      <BodyMap className="tappable" body={S.body} selected={selected} onMuscle={pick} />
      <ChipRow className="mt-5">
        {MUSCLES.map(m => <Chip key={m} on={selected === m}
          aria-pressed={selected === m} onClick={() => pick(m)}>
          {t(MUSCLE_NAME[m])} <span className="dim">{counts[m]}</span>
        </Chip>)}
      </ChipRow>
    </Card>

    {!selected && onPick && <EmptyState icon="figureStrength">{t('Choose a muscle to see exercises that train it.')}</EmptyState>}

    {selected && <>
      <Inline justify="between" className="mt-1 mb-5">
        <SectionTitle className="m-0">{t('Exercises for {0}', t(MUSCLE_NAME[selected]))}</SectionTitle>
        <Button size="sm" variant="ghost" onClick={() => pick(selected)}>{t('Clear selection')}</Button>
      </Inline>
      <div className="search-row mb-5"><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} />
        {narrowed && <span className="search-count" role="status" aria-label={exCount(exercises.length)}>{fmtNum(exercises.length)}</span>}
        {q && <button className="clear" onClick={() => { setQ(''); setShown(40) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}
      </div><ExerciseViewToggle /></div>
      {/* Changing body part keeps the equipment filter (issue #71, same rule as Library): the
          eqOn fallback above drops it only for this view if the new body part has nothing under
          it, without forgetting the choice. "All" clears it, since it spans every body part. */}
      <ChipRow className={eqOpts.length > 1 ? 'mb-4' : 'mb-6'}>
        <Chip nocap on={!bp} onClick={() => { setBp(''); setEq(''); setShown(40) }}>{t('All')}</Chip>
        {BODYPARTS.map(b => <Chip key={b} on={bp === b} onClick={() => { setBp(b); setShown(40) }}>{t(b)}</Chip>)}
      </ChipRow>
      {eqOpts.length > 1 && <ChipRow className="mb-6">
        <Chip nocap on={!eqOn} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</Chip>
        {eqOpts.map(x => <Chip key={x} on={eqOn === x} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</Chip>)}
      </ChipRow>}
      <div className={'list' + (S.exerciseView === 'cards' ? ' ex-grid' : '')}>
        {exercises.slice(0, shown).map(e => {
          const best = bestWeightFor(S, e.id)
          const primary = musclesOf(e)[selected] === 1
          return <div key={e.id} className="item" {...tappable(() => choose(e))}>
            <Thumb ex={e} />
            <div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</div><div className="ss">{t(primary ? 'Primary target' : 'Also trains')} · <span className="capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</span></div></div>
            {onPick ? <Icon name="plus" className="chev" /> : <>
              {best > 0 && <Tag tone="acc">{fmtNum(best)}</Tag>}
              <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); onPlan(e) }}>{t('Plan')}</Button>
            </>}
          </div>
        })}
        {exercises.length === 0 && <EmptyState icon="magnifier">{t('No match')}</EmptyState>}
      </div>
      {exercises.length > shown && <><Spacer size={5} /><Button ref={moreRef} onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
    </>}
  </>
}
