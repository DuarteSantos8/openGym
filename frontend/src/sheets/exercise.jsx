import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXIDX, BODYPARTS, isCardio, allExercises, smOf, exOr, isAssisted, isCustomEx } from '../lib/exercises.js'
import { ALL_EQUIPMENT } from '../lib/equipment.js'
import { fmtDate, fmtNum, exerciseNameText, fmtVol, uid, exCount } from '../lib/format.js'
import { lastEntryFor, bestWeightFor, setLabel, cleanupSg, modeOf } from '../lib/history.js'
import { t, tn, instrFor, instrTranslated, descFor, exerciseNameFor, exerciseNameClass, getLang, useLang } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import Media from '../components/Media.jsx'
import CustomMediaField from '../components/CustomMediaField.jsx'
import { mediaOf, normalizeMediaRef, cleanUrl } from '../lib/media-refs.js'
import { syncMedia } from '../lib/media-sync.js'
import LineChart from '../components/LineChart.jsx'
import Stepper from '../components/Stepper.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, MultiSelectRow } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { exerciseMuscleSnapshot, MUSCLES, MUSCLE_NAME, muscleWeightsOf, normalizeMuscleGroups, hasExplicitMuscleMetadata, inMuscleOrder } from '../lib/muscles.js'
import { estimate1RM, best1RM, REP_CAP, formulaOf, FORMULA_NAMES } from '../lib/onerm.js'
import { exerciseHistory } from '../lib/exercise-history.js'
import { isBellEx, dbLoadFor, withDbLoad, currentDbLoad } from '../lib/dumbbells.js'
import { speedUnitOf } from '../lib/speed.js'
import { useSheetKeyboard, tappable } from '../lib/use-sheet-keyboard.js'
import { isFav, toggleFav } from '../lib/favourites.js'
import { S, update, ui, toast } from './shared.js'
import { confirmSheet } from './confirm-menu.jsx'
import { exConfigSheet } from './exercise-config.jsx'
import { BarWeightEditor, DbLoadPicker } from './equipment.jsx'

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const [w, setW] = useState(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r, formulaOf(st))
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '–' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps. Beyond that it’s basically guesswork.', REP_CAP)
      : formulaOf(st) === 'weighted'
        ? t('A blend of seven formulas: calculated from one set, not a tested max.')
        : t('{0} formula: calculated from one set, not a tested max.', FORMULA_NAMES[formulaOf(st)])}</div>
  </>
}

// A muscle the catalogue credits with nothing (a bench press's biceps, #359) is not one it trains,
// so it is not shown as a tag either; "By muscle" already leaves the exercise out.
export const trainedBy = ex => { const weights = muscleWeightsOf(ex); return slug => weights[slug] !== 0 }
// The detail page's tags: body part, main muscles, equipment, then up to three helpers. A word
// says once what it says: the body part "Chest" and the main muscle "Chest" of a bench press
// were two tags (QA 10-06), and a helper never repeats a main muscle.
export function detailTags(ex) {
  const seen = new Set()
  const out = []
  const add = (label, extra) => {
    const k = String(label || '').trim().toLocaleLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    out.push({ key: out.length, label, ...extra })
    return true
  }
  add(t(ex.bp), { acc: true })
  if (ex.bp === 'cardio') add(t(MUSCLE_NAME['cardiovascular system']), { icon: 'figureStrength' })
  else for (const s of (ex.primaries?.length ? ex.primaries : (ex.tg ? [ex.tg] : [])).filter(trainedBy(ex))) add(t(MUSCLE_NAME[s] || s), { icon: 'figureStrength' })
  add(t(ex.eq), { icon: 'kettlebell' })
  let helpers = 0
  for (const s of (ex.secondaries?.length ? ex.secondaries : smOf(ex)).filter(trainedBy(ex))) {
    if (helpers >= 3) break
    if (add(t(MUSCLE_NAME[s] || s))) helpers++
  }
  return out
}

function ExerciseDetail({ ex, close }) {
  useLang() // the description and steps arrive in their own chunk the first time a sheet asks
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id, currentDbLoad(st, ex.id))
  const fav = isFav(st, ex.id)
  const flipFav = () => {
    let on = false
    update(s => { on = toggleFav(s, ex.id) })
    toast(on ? t('Added to favourites') : t('Removed from favourites'))
  }
  return <>
    <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
      <h3 className={'exdetail-name ' + exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
      <button className={'iconbtn fav-btn' + (fav ? ' on' : '')} aria-pressed={fav}
        aria-label={fav ? t('Remove from favourites') : t('Add to favourites')} onClick={flipFav}>
        <Icon name={fav ? 'starFill' : 'star'} />
      </button>
    </div>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      {detailTags(ex).map(tg => <span key={tg.key} className={'tag' + (tg.acc ? ' acc' : '')}>{tg.icon && <Icon name={tg.icon} />}{tg.label}</span>)}
    </div>
    {descFor(ex) && <div className="exnote">{descFor(ex)}</div>}
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow-ink)' }} />{t('Best:')} <b className="accent" style={{ whiteSpace: 'nowrap' }}>{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target, speedUnitOf(st))).join(', ')}` : ''}</div>}
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>
    {last && <Button icon="history" style={{ marginTop: 4 }} onClick={() => exerciseHistorySheet(ex.id)}>{t('History')}</Button>}
    {isCustomEx(ex) && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div>}
    {modeOf({ id: ex.id }) === 'reps' && <>
      <h4 className="sec">{t('Plate loading')}</h4>
      <BarWeightEditor ex={ex} extra={t('You still log the total weight. This only feeds the plate line under each set.')} />
    </>}
    {/* The exercise's own default meaning of its weight (S.dbLoad), stamped like the loading
        above. A routine can still pick its own on the exercise's settings. */}
    {isBellEx(ex) && <>
      <h4 className="sec">{t('Weight means')}</h4>
      <DbLoadPicker ex={ex} value={dbLoadFor(st, ex.id)}
        onChange={v => update(s => { s.dbLoad = withDbLoad(s.dbLoad, ex.id, v) })} />
    </>}
    {/* No one-rep max on an assistance machine: the load is the help you were given, so the
        calculator would answer "your 1RM is 23 kg" about a number that gets smaller as you get
        stronger (issue #232). Cardio has none for the same kind of reason. */}
    {!isCardio(ex) && !isAssisted(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{getLang() !== 'en' && !instrTranslated(ex) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
    {/* The catalogue is community-edited (catalogue/README.md): a wrong muscle, a clumsy step or a
        missing translation is one tap from an issue that already names the exercise. */}
    {!isCustomEx(ex) && !ex.missing && <a className="small dim exfix-link" target="_blank" rel="noopener"
      href={'https://github.com/DuarteSantos8/openGym/issues/new?template=exercise.yml&exercise=' + encodeURIComponent(ex.id + ', ' + ex.n)}>
      <Icon name="pencil" /> {t('Suggest a fix for this exercise')}</a>}
  </>
}
export const exerciseDetailSheet = ex => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} />)

/* ============================ exercise history ============================ */
// What you did on this exercise before, reachable mid-workout (issue #43): the curve first,
// then the last sessions set by set, so the question "what did I do last month" is answered
// without leaving the workout for Stats. Derived once per log change — the sheet re-renders on
// every store tick while a session runs, and LineChart drops its hover whenever `points`
// changes identity, so a series rebuilt per render would lose the tooltip under your finger.
function ExerciseHistory({ exId }) {
  const st = useStore(s => s.S)
  const ex = exOr(exId)
  const h = useMemo(() => exerciseHistory(st, exId), [st.workouts, exId])
  const [curve, setCurve] = useState('top')
  const onE1 = curve === 'e1rm' && h.e1rmPoints.length > 0
  const unit = h.metric === 'weight' ? st.unit : h.metric === 'reps' ? t('reps') : h.metric === 'sec' ? 's' : t('min')
  const e1Best = useMemo(() => Math.max(0, ...h.e1rmPoints.map(p => p.y)), [h])
  if (!h.total) return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No sessions logged yet')}</div>
  </>
  const tail = s => [
    s.volume > 0 && t('Volume') + ' ' + fmtVol(s.volume, st.unit),
    s.e1rm != null && t('Est. 1RM') + ' ' + fmtNum(s.e1rm) + ' ' + st.unit,
  ].filter(Boolean).join(' · ')
  return <>
    <h3 className={exerciseNameClass(ex)} style={{ marginBottom: 2 }}>{exerciseNameFor(ex)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Exercise history')} · {tn('{0} session', '{0} sessions', h.total)}</div>
    {/* Only reps work with a load produces an estimate, so the toggle is absent for the rest. */}
    {h.e1rmPoints.length > 0 && h.metric === 'weight' && <Segmented className="seg-range" value={curve} onChange={setCurve}
      options={[{ value: 'top', label: t('Top set') }, { value: 'e1rm', label: t('Est. 1RM') }]} />}
    <div className="chart" style={{ marginTop: 8 }}>
      <LineChart points={onE1 ? h.e1rmPoints : h.points} h={140} unit={onE1 ? st.unit : unit} color="var(--blue)" />
    </div>
    <div className="small row" style={{ margin: '6px 0 4px', gap: 5 }}>
      <Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow-ink)' }} />
      {t('Best:')} <b className="accent">{fmtNum(onE1 ? e1Best : h.best)} {onE1 ? st.unit : unit}</b>
    </div>
    <h4 className="sec">{h.sessions.length < h.total ? t('Last {0} sessions', h.sessions.length) : t('Sessions')}</h4>
    <div className="list">
      {h.sessions.map(s => <div key={s.id} className="item" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tt">{fmtDate(s.d, true)} {s.pr && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{s.sets.map(x => setLabel(exId, x, s.target, speedUnitOf(st))).join('  ·  ')}</div>
          {tail(s) && <div className="small dim" style={{ marginTop: 3 }}>{tail(s)}</div>}
        </div>
        {s.value != null && s.value > 0 && <b className="accent nocap" style={{ whiteSpace: 'nowrap' }}>{fmtNum(s.value)} {unit}</b>}
      </div>)}
    </div>
  </>
}
export const exerciseHistorySheet = exId => ui().openSheet(close => <ExerciseHistory exId={exId} close={close} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', exerciseNameText(ex), r ? r.name : t('routine')))
      if (isNew && r) nav('/train/routines/' + r.id)
    }, null, isNew ? null : st.routines.find(x => x.id === rid))
  }
  return <>
    <h3 className={exerciseNameClass(ex)}>{t('Add “{0}”', exerciseNameFor(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine. Sets, reps and weight come next.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" {...tappable(() => pick(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" {...tappable(() => pick('_new'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="plusCircle" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)

/* ============================ custom exercises (issue #11) ============================ */
// Name + body part is all it takes — the exercise then behaves like any built-in one
// (planning, logging, PRs, stats). A photo, GIF or video of your own, and a link to a video or
// guide, are optional (components/CustomMediaField.jsx): the state keeps a small reference to the
// file, never the file itself, and the link is cleaned on save and again whenever it is opened.
function CustomExForm({ existing, prefill, onDone, close }) {
  const nameRef = useRef(null)
  const onNameFocus = useSheetKeyboard(nameRef)
  const [n, setN] = useState(existing ? existing.n : (prefill || ''))
  const [bp, setBp] = useState(existing ? existing.bp : '')
  const [eq, setEq] = useState(existing ? (existing.eq || '') : '')
  const storedEq = existing && typeof existing.eq === 'string' && existing.eq && !ALL_EQUIPMENT.includes(existing.eq) ? existing.eq : null
  const [desc, setDesc] = useState(existing ? (existing.desc || '') : '')
  const [media, setMedia] = useState(() => mediaOf(existing))
  // Whether this form changed the media at all. An edit that did not touch it writes back what the
  // exercise had, byte for byte: a ref from a newer version of the app (a codec or type this one
  // does not know) reads as nothing here, and re-normalizing it on a rename would delete it on
  // every device.
  const [mediaTouched, setMediaTouched] = useState(false)
  const [url, setUrl] = useState(existing && typeof existing.url === 'string' ? existing.url : '')
  const onMedia = patch => {
    if ('media' in patch) { setMedia(patch.media); setMediaTouched(true) }
    if ('url' in patch) setUrl(patch.url)
  }
  const [primaries, setPrimaries] = useState(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...existing.primaries]
    if (existing?.bp === 'cardio') return ['cardiovascular system']
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.length ? [norm[0]] : []
  })
  const [secondaries, setSecondaries] = useState(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...(existing.secondaries || [])]
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.slice(1)
  })
  // Every primary chip this sheet saw a tap on, in that order. `primaries` alone cannot say what the
  // user reached for first: an existing exercise seeds it in the map's order, because that is how the
  // muscles are stored. The taps are the only record of the user's own order, and they decide the
  // target when the one the exercise had is un-ticked.
  const [primaryTaps, setPrimaryTaps] = useState([])
  const togglePrimary = value => {
    setPrimaryTaps(current => [...current, value])
    setPrimaries(current => current.includes(value) ? current.filter(m => m !== value) : [...current, value])
  }
  const toggleSecondary = value => setSecondaries(current => current.includes(value) ? current.filter(m => m !== value) : [...current, value])
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    if (!eq) { toast(t('Pick equipment')); return }
    // An exercise kept under its own name is not a duplicate, even when the catalogue has one
    // spelled the same (an imported "trap bar deadlift"): only a new or changed name is checked.
    const renamed = !existing || name.toLowerCase() !== String(existing.n || '').trim().toLowerCase()
    const dup = renamed && allExercises(S()).find(e => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    const d = desc.trim().slice(0, 1000)
    // An empty field removes the link; anything else has to be a web address.
    const link = url.trim() ? cleanUrl(url) : null
    if (url.trim() && !link) { toast(t('That link is not a web address')); return }
    const keepMedia = !!existing && !mediaTouched
    const ref = keepMedia ? null : normalizeMediaRef(media)
    // Stored in the map's order, not the order the chips were tapped in — the tags on the exercise
    // used to shuffle with every edit.
    const prim = bp === 'cardio' ? ['cardiovascular system'] : inMuscleOrder(primaries)
    const sm = inMuscleOrder(secondaries.filter(m => !prim.includes(m)))
    const groups = [...prim, ...sm]
    // The one-word target (the library row, the picker, the Muscles view) is not the sorted list's
    // head — a hip thrust with Traps as an extra primary is not a Traps exercise. It is the primary
    // tapped first, and an edit keeps the exercise's target as long as that muscle is still a primary.
    // Once that muscle is gone the next answer is the first one tapped here that survived — a tap that
    // only turned a chip off says nothing and is skipped with it. The sorted list is the last resort,
    // for the user who drops the target and adds nothing in its place.
    const tg = (existing && prim.includes(existing.tg)) ? existing.tg : (primaryTaps.find(m => prim.includes(m)) || prim[0] || '')
    let id = existing && existing.id
    const extra = c => {
      if (!keepMedia) { if (ref) c.media = ref; else delete c.media }
      if (link) c.url = link; else delete c.url
    }
    if (existing) update(s => { const c = (s.customEx || []).find(x => x.id === id); if (c) {
      c.n = name; c.bp = bp; c.desc = d; c.tg = tg; c.sm = sm; c.muscleGroups = groups; c.primaries = prim; c.secondaries = sm; c.eq = eq
      extra(c)
    } })
    else {
      id = 'c' + uid()
      update(s => { const c = { id, n: name, bp, desc: d, tg, sm, muscleGroups: groups, primaries: prim, secondaries: sm, eq, custom: true }; extra(c); (s.customEx = s.customEx || []).push(c) })
    }
    // The file goes to the server now rather than after the state's own debounce: another device
    // that sees the reference first shows a tile until it arrives.
    if (ref) syncMedia({ force: true })
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(EXIDX[id])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part. It works just like any other exercise.')}</div>
    <input ref={nameRef} className="input" placeholder={t('Exercise name')} maxLength={80} value={n} onFocus={onNameFocus} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    <div className="chips" style={{ margin: '12px 0' }}>
      {ALL_EQUIPMENT.map(k => (<button key={k} className={'chip' + (eq === k ? ' on' : '')} onClick={() => setEq(k)}>{t(k)}</button>))}
      {/* An imported exercise can carry equipment the list does not have (`custom` from a CSV or
          Hevy import). It stays a chip of its own, picked, so Save does not stop on "Pick equipment". */}
      {storedEq && <button key={storedEq} className={'chip' + (eq === storedEq ? ' on' : '')} onClick={() => setEq(storedEq)}>{t(storedEq)}</button>}
    </div>
    {bp && <>
      {bp !== 'cardio' && <MultiSelectRow title={t('Primary muscle groups')} sheetTitle={t('Primary muscle groups')}
        values={primaries}
        options={MUSCLES.map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))}
        onToggle={togglePrimary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
      }
      <MultiSelectRow title={t('Additional muscle groups')} sheetTitle={t('Additional muscle groups')}
        values={secondaries}
        options={MUSCLES.filter(m => !primaries.includes(m)).map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))}
        onToggle={toggleSecondary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
    </>}
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} placeholder={t('Description (optional): setup, cues, anything you want to remember')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <CustomMediaField media={media} url={url} onChange={onMedia} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
export const customExSheet = (existing, onDone, prefill) => ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)

export function deleteCustomEx(ex, afterDelete) {
  if (S().active?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        // Keep display and muscle metadata in history before the custom catalogue row disappears.
        const snapshot = exerciseMuscleSnapshot(ex)
        s.workouts.forEach(w => w.entries.forEach(e => {
          if (e.id !== ex.id) return
          e.n = ex.n
          if (!e.muscleSnapshot || !Object.keys(e.muscleSnapshot).length) e.muscleSnapshot = snapshot
        }))
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => e.id !== ex.id); cleanupSg(r.ex) })
        delete s.exWeights[ex.id]
        s.favEx = (s.favEx || []).filter(id => id !== ex.id)
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}
