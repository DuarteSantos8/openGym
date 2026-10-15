import { useDeferredValue, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXIDX, BODYPARTS, allExercises, equipmentOf, byCategory, searchExercises, similarExercises } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { fmtNum, exCount } from '../lib/format.js'
import { buildSets, defaultConfig, modeOf, applyIntensifierPlan } from '../lib/history.js'
import { dropGrid } from '../lib/plates.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import ExerciseViewToggle from '../components/ExerciseViewToggle.jsx'
import { sameMuscleFirst, swapMuscleOf } from '../lib/similar-exercises.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { dbLoadFor, withMeaning, historyAs, ownedWeightsFor } from '../lib/dumbbells.js'
import { defaultIncrement, weightIncrement } from '../lib/progression.js'
import { swapActiveExercise } from '../lib/active-exercise-swap.js'
import { useSheetKeyboard, useRevealActiveChip, tappable } from '../lib/use-sheet-keyboard.js'
import { useAutoMore } from '../lib/use-auto-more.js'
import { isFav, sortFavouritesFirst, sortYoursFirst } from '../lib/favourites.js'
import { buildPlannedEntry, builtOutOfProgression } from '../lib/session-start.js'
import { sessionHistory } from '../lib/backfill.js'
import { S, update, ui } from './shared.js'
import { confirmSheet } from './confirm-menu.jsx'
import { exConfigSheet } from './exercise-config.jsx'
import { customExSheet } from './exercise.jsx'

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach(w => w.entries.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
// The swap pickers' own scope (#473): exercises sharing the swapped exercise's target muscle.
const SAME = '≈'
function ExercisePicker({ onPick, title, close, like }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  // What a swap is away from: the picker opens on what trains the same muscle, if anything you
  // can use does, and "All" is one tap back to everything.
  const likeEx = like ? (EXIDX[like] || allExercises(st).find(e => e.id === like) || null) : null
  // A muscle nothing else trains gets no chip at all rather than one that lists nothing.
  const likeTg = swapMuscleOf(likeEx) && sameMuscleFirst(allExercises(st), likeEx).length ? swapMuscleOf(likeEx) : ''
  const [bp, setBp] = useState(() => {
    if (!likeTg) return ''
    const prof = activeProfile(st)
    return sameMuscleFirst(allExercises(st), likeEx).some(e => !prof || exAvailable(st, e)) ? SAME : ''
  })                                        // '' = all, '★' = chosen, '☆' = favourites, '≈' = same muscle, else a body part
  const [eq, setEq] = useState('')          // '' = any equipment
  const [cat, setCat] = useState('')        // '' = any type
  const [showAll, setShowAll] = useState(false)
  const [shown, setShown] = useState(50)
  const [byMuscle, setByMuscle] = useState(false)
  const searchRef = useRef(null)
  const bpStrip = useRef(null), eqStrip = useRef(null), catStrip = useRef(null)
  const onSearchFocus = useSheetKeyboard(searchRef)
  const moreRef = useAutoMore(() => setShown(s => s + 50))
  const all = allExercises(st)
  const profile = activeProfile(st)
  const inScope = e => bp === '★' ? usage[e.id] : bp === '☆' ? isFav(st, e.id) : (!bp || e.bp === bp)
  let inPart = searchExercises(bp === SAME ? sameMuscleFirst(all, likeEx) : all.filter(inScope), q)
  if (bp === '★') inPart = [...inPart].sort((a, b) => (usage[b.id] - usage[a.id]) || exerciseNameFor(a).localeCompare(exerciseNameFor(b)))
  // The Library's Type row (issue #521), with its fallback: a type the search or muscle group
  // narrowed away is ignored for this view, not forgotten.
  const { opts: catOpts, on: catOn, list: base } = byCategory(inPart, cat)
  const eqFiltered = (profile && !showAll) ? base.filter(e => exAvailable(st, e)) : base
  const eqOpts = equipmentOf(eqFiltered)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
  // On the same-muscle list the equipment order wins: what is on the same kit comes first,
  // favourites leading within each half.
  // While searching, what you have logged or planned follows right after them.
  const narrowedList = eqOn ? eqFiltered.filter(e => e.eq === eqOn) : eqFiltered
  const ranked = q.trim() ? sortYoursFirst(narrowedList, st, usage) : sortFavouritesFirst(narrowedList, st)
  const f = bp === SAME ? sameMuscleFirst(ranked, likeEx) : ranked
  const chosenCount = Object.keys(usage).length
  const favCount = (st.favEx || []).length
  const special = bp === '★' || bp === '☆'
  // The Library's live result count (GitLab !31), for the same reason: how many are left.
  const narrowed = !!(q.trim() || bp || eqOn || catOn)
  useRevealActiveChip(bpStrip, bp)
  useRevealActiveChip(eqStrip, eqOn)
  useRevealActiveChip(catStrip, catOn)
  // Close but not exact (a typo too many, most of the words, a similar name), listed under the
  // results once you have scrolled to their end, so a search almost never ends on nothing.
  // Worked out a beat behind the typing (useDeferredValue): the list itself never waits for it.
  const qLate = useDeferredValue(q)
  const similar = q.trim() && qLate === q && !special && f.length <= shown
    ? similarExercises((profile && !showAll ? all.filter(e => exAvailable(st, e)) : all).filter(e => bp === SAME || !bp || e.bp === bp), q, f, f.length ? 12 : 30)
    : []
  const pickRow = e => <div key={e.id} className="item" {...tappable(() => onPick(e))}>
        <Thumb ex={e} /><div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(st, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</div><div className="ss capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</div></div>
        {/* Accent tag = already in a routine/log ("Chosen"); the yellow star by the name = favourite. */}
        {usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}
        {/* A "+" glyph reads as "add this now" — it used to just open the same detail sheet as
            tapping the row, so it added nothing until you'd scrolled past the sets/reps config
            and found the real button. Now it does what it looks like: adds with the default
            config right away. Tapping the row itself still opens the detail/config sheet, for
            when you want to set sets/reps before adding. */}
        <button className="iconbtn chev" aria-label={t('Add “{0}”', exerciseNameFor(e))} style={{ padding: 8, margin: -8 }}
          onClick={ev => { ev.stopPropagation(); onPick(e, true) }}><Icon name="plus" /></button>
      </div>
  if (byMuscle) return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{title || t('Add exercise')}</h3>
      <Button size="sm" variant="ghost" onClick={() => setByMuscle(false)}>{t('All')}</Button>
    </div>
    <MuscleExplorer onPick={onPick} />
  </>

  return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{title || t('Add exercise')}</h3>
      <Button size="sm" variant="tinted" icon="figureStrength" onClick={() => setByMuscle(true)}>{t('By muscle')}</Button>
    </div>
    {/* .picker-search is what index.css keys the keyboard-aware sheet layout on: the sheet
        lifts above the keys and the search stays put while the list scrolls under it. */}
    <div className="picker-search"><div className="search-row"><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input ref={searchRef} className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onFocus={onSearchFocus} onChange={e => { setQ(e.target.value); setShown(50) }} />
      {narrowed && <span className="search-count" role="status" aria-label={exCount(f.length)}>{fmtNum(f.length)}</span>}
      {q && <button className="clear" onClick={() => { setQ(''); setShown(50) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}</div>
      <ExerciseViewToggle /></div></div>
    {profile && <div className="small dim row" style={{ margin: '8px 0 2px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setShowAll(v => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    {/* Changing muscle group keeps the equipment filter: if it still has exercises under the new
        group the filter stays applied, and if not the eqOn fallback above drops it for this view
        without forgetting the choice (issue #71). The favourites/chosen chips still clear it —
        those are cross-body-part views where a stale equipment filter would be confusing. */}
    <div className="chips" ref={bpStrip} style={{ margin: eqOpts.length > 1 || catOpts.length > 1 ? '10px 0 6px' : '10px 0' }}>
      {likeTg && <button className={'chip nocap' + (bp === SAME ? ' on' : '')} onClick={() => { setBp(SAME); setShown(50) }}><Icon name="figureStrength" style={{ fontSize: 12, display: 'inline-block', marginInlineEnd: 4, verticalAlign: '-1px' }} />{t('Same muscle: {0}', t(MUSCLE_NAME[likeTg] || likeTg))}</button>}
      {favCount > 0 && <button className={'chip' + (bp === '☆' ? ' on' : '')} onClick={() => { setBp('☆'); setEq(''); setShown(50) }}><Icon name="starFill" className="fav-star" />{t('Favourites')} ({favCount})</button>}
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(50) }}><Icon name="starFill" style={{ fontSize: 12, display: 'inline-block', marginInlineEnd: 4, verticalAlign: '-1px' }} />{t('Chosen')} ({chosenCount})</button>}
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(50) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(50) }}>{t(b)}</button>)}
    </div>
    {catOpts.length > 1 && <div className="chips" ref={catStrip} style={{ marginBottom: eqOpts.length > 1 ? 6 : 10 }}>
      <button className={'chip nocap' + (!catOn ? ' on' : '')} onClick={() => { setCat(''); setShown(50) }}>{t('Any type')}</button>
      {catOpts.map(x => <button key={x} className={'chip' + (catOn === x ? ' on' : '')} onClick={() => { setCat(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    {eqOpts.length > 1 && <div className="chips" ref={eqStrip} style={{ marginBottom: 10 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(50) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    <div className={'list' + (st.exerciseView === 'cards' ? ' ex-grid' : '')}>
      {!special && <div className="item ex-new" {...tappable(() => customExSheet(null, ex => onPick(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="plusCircle" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, and a photo or video if you like')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(pickRow)}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing picked yet. Add some exercises and they’ll show up here.')}</div>}
      {f.length === 0 && bp === '☆' && <div className="empty">{t('No favourites yet. Tap the star on an exercise to add one.')}</div>}
      {similar.length > 0 && <h4 className="sec similar-label">{f.length ? t('Similar exercises') : t('No exact match. These come close:')}</h4>}
      {similar.map(pickRow)}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button ref={moreRef} onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
  </>
}
// `title` names what the pick is for when it is not an add — the routine editor's Replace (#110).
// `like` is the exercise a swap or a replace is away from: the picker then opens on the ones that
// train the same muscle, same equipment first (#473).
export const exercisePicker = (onPick, { title, like } = {}) => ui().openSheet(close => <ExercisePicker onPick={onPick} title={title} like={like} close={close} />)

/** Start a safe swap for one exact active-workout occurrence. */
export function swapActiveWorkoutExercise(index) {
  const active = S().active
  if (!active?.entries?.[index]) return

  // The "+" on a picker row commits with the default config, exactly as it does in the add
  // flows; tapping the row still opens the config sheet first.
  // Worded for the session, not the routine: a swap changes today's workout only.
  const picker = exercisePicker((ex, quick) => quick ? swapTo(ex, defaultConfig(ex.id)) : exConfigSheet(ex, null, cfg => swapTo(ex, cfg), null, null, null, null, t('Use in this workout')), { title: t('Swap exercise'), like: active.entries[index].id })
  function swapTo(ex, cfg) {
    // The picker is a chooser here, not a stack you keep adding from: one swap, then back to
    // the workout. (The add flow deliberately leaves it open.)
    picker.close()
    const full = { ...cfg, id: ex.id }
    const st = S()
    const current = st.active?.entries?.[index]
    if (!current) return
    // A swap is an in-place substitution — routine identity is unchanged, so the replacement
    // keeps the slot's own `rid` and reads its prescription from that routine (not a
    // session-wide one). A slot with no `rid` is freestyle.
    const slotRoutine = current.rid ? st.routines.find(r => r.id === current.rid) : null
    const freestyle = !slotRoutine
    // Same rows the add flow builds: last time's loads and, in a planned session, the
    // prescription — swapping barbell for dumbbell bench must not start you at an empty bar.
    // Built from what came before the session's day when it is logged into the past (sessionHistory).
    const step = modeOf(full) === 'reps' ? weightIncrement(full, st.unit) : defaultIncrement(ex.id, st.unit)
    const past = sessionHistory(st)
    // A freestyle swap logs dumbbell weights the way the exercise means them now, and starts
    // from last time read in that meaning (lib/dumbbells.js), as a planned one does.
    const built = freestyle
      ? { target: withMeaning(st, cfg, ex.id), plan: null, sets: applyIntensifierPlan(buildSets(historyAs(past, ex.id, dbLoadFor(st, full)), full, { step: (modeOf(full) === 'reps' && ownedWeightsFor(st, full)) || step, preferLast: true }), full, dropGrid(st, full)) }
      : buildPlannedEntry(past, full, slotRoutine, { noProg: builtOutOfProgression(current, slotRoutine) })
    const replacement = {
      id: ex.id,
      ...built,
      ...(current.rid ? { rid: current.rid } : {}),
      // A slot kept out of progression stays out once swapped. Replaced in place the entry keeps
      // it anyway; inserted beside logged sets, the replacement would otherwise count as a
      // regular session of the new exercise. Only a deload or rehab slot is built without a
      // prescription (above): one kept out by hand keeps the marker and its Undo on the card,
      // and an Undo must leave numbers that are right to count.
      ...(current.noProg === true ? { noProg: true } : {}),
    }

    const apply = options => {
      // A timed callback closes over entry/set indexes. Invalidate it, and the current rest,
      // before the selected occurrence can be replaced or a new entry shifts those indexes.
      ui().stopWork()
      ui().stopRest()
      update(state => { swapActiveExercise(state.active, index, replacement, options) }, true)
    }
    const logged = (current.sets || []).some(set => set.done === true)
    if (!logged) { apply(); return }

    if (current.sg) {
      ui().openSheet(close => <>
        <h3>{t('Swap exercise?')}</h3>
        <div className="muted small" style={{ marginBottom: 12 }}>
          {t('Logged sets stay with the original exercise. Choose where the replacement belongs.')}
        </div>
        <Button variant="primary" onClick={() => { close(); apply({ loggedConfirmed: true, groupDisposition: 'keep' }) }}>
          {t('Keep replacement in this group')}
        </Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" onClick={() => { close(); apply({ loggedConfirmed: true, groupDisposition: 'detach' }) }}>
          {t('Insert after this group')}
        </Button>
      </>)
      return
    }

    confirmSheet({
      title: t('Swap exercise?'),
      message: t('Logged sets stay with the original exercise. The replacement will be inserted afterward.'),
      confirmText: t('Continue'),
      onConfirm: () => apply({ loggedConfirmed: true })
    })
  }
}
