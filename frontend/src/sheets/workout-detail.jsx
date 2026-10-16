import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { BRAND } from '../brand.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, isoOf, DAYS, weekOrder, weekStartOf, weekDayOffset, MONTHS_LONG } from '../lib/format.js'
import { effectiveRoutineIds, workoutDay, workoutVolume, setsDone, sessionSections, setLabel, NOTE_MAX } from '../lib/history.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { nav, closeThenNav } from '../lib/nav.js'
import { Thumb } from '../components/Media.jsx'
import WorkoutMediaSection, { workoutMediaCount } from '../components/WorkoutMedia.jsx'
import { workoutMediaOf } from '../lib/media-refs.js'
import Stepper from '../components/Stepper.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Switch, Row } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { MOBILE, shareExportBlob } from '../lib/mobile.js'
import { speedUnitOf } from '../lib/speed.js'
import { isWarmupRow, hasCompletedWork } from '../lib/workout-model.js'
import { saveSessionAsRoutine } from '../lib/session-routines.js'
import { useSheetKeyboard, tappable } from '../lib/use-sheet-keyboard.js'
import { workoutFit, fitFileName } from '../lib/fit-export.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { moveWorkout, sameWorkout, startTimeOf, durationMinOf, setWorkoutDuration, MAX_DURATION_MIN, endsInFuture } from '../lib/workout-date.js'
import { editCompletedSession } from '../lib/session-edit.js'
import { stampWorkout } from '../lib/sync-merge.js'
import { workoutText } from '../lib/workout-text.js'
import { workoutCardModel, layoutWorkoutCard, drawWorkoutCard, viewAspect, CARD_FONT } from '../lib/workout-card.js'
import { copyText } from '../lib/clipboard.js'
import { pinState } from '../lib/queue.js'
import { workoutLabel } from '../lib/training-day.js'
import { DAY_NOTE_LABEL, DAY_NOTE_ICON, dayNoteOf, dayNoteLine } from '../lib/day-notes.js'
import { S, update, ui, toast } from './shared.js'
import { confirmSheet } from './confirm-menu.jsx'
import { exerciseHistorySheet } from './exercise.jsx'
import { repeatWorkout } from './workout-flow.jsx'
import { dayOverrideSheet, dayNoteSheet } from './plan.jsx'

/* ============================ workout detail ============================ */
// Correcting when a saved session happened: typed in from another app, or logged on the wrong
// day. Only its place in history moves — the sets, the volume and the notes are the record, and
// the session keeps the length it had. The PR badges of the exercises it trained are worked out
// again, because "this was a record" is a claim about the sessions before it.
function WorkoutDateEdit({ w, onDone, close }) {
  const [date, setDate] = useState(w.d)
  const [time, setTime] = useState(startTimeOf(w))
  const today = todayISO()
  const save = () => {
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    // Nothing to do, and nothing to push: a no-op save and a workout deleted from another
    // sheet both just close.
    if (date === w.d && time === startTimeOf(w)) { close(); return }
    if (!(S().workouts || []).some(x => sameWorkout(x, w))) { close(); return }
    // It keeps its length, so the end it would have is what has to be in the past.
    if (endsInFuture(date, time, durationMinOf(w))) { toast(t('That’s still in the future. Try an earlier start.')); return }
    update(s => {
      const next = moveWorkout(s.workouts, w, date, time)
      if (next) s.workouts = next
    })
    close()
    onDone && onDone()
    toast(t('Workout moved'))
  }
  return <>
    <h3>{t('Change date & time')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('The session keeps its length. Personal records are worked out again from the new order.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={e => setDate(e.target.value)} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={e => setTime(e.target.value)} /></Row>
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const workoutDateSheet = (w, onDone) => ui().openSheet(close => <WorkoutDateEdit w={w} onDone={onDone} close={close} />)

// Correcting how long a saved session ran — mostly the workout nobody ended until they got home
// (Discord). The start stays, the end follows it; the sets, the order of history and the badges
// do not depend on the length and are left alone.
function WorkoutDurationEdit({ w, onDone, close }) {
  const [dur, setDur] = useState(durationMinOf(w))
  // A cleared field reads as 0, and saving that made the session one minute long without a word
  // (QA 1.3.9): it is refused with the reason under the field, and the saved length stays.
  const durInvalid = !(dur >= 1)
  const durTooLong = dur > MAX_DURATION_MIN
  const save = () => {
    if (durInvalid) { toast(t('Enter how long it took (at least 1 minute).')); return }
    if (durTooLong) { toast(t('That’s more than a day. Keep it to 24 hours or less.')); return }
    let changed = false
    update(s => {
      const next = setWorkoutDuration(s.workouts, w, dur)   // at least a minute, however the field was left
      if (next) { s.workouts = next; changed = true }
    })
    close()
    if (!changed) return
    onDone && onDone()
    toast(t('Duration changed'))
  }
  return <>
    <h3>{t('Change duration')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Forgot to finish on time? Set how long the session really took. It keeps its start time and its sets.')}</div>
    {/* min 0, not 1: the stepper would put a cleared field back to 1 as it lost focus to Save. */}
    {/* No max either: one would cut a typo down to a day on blur and save that without a word. */}
    <Stepper label={t('Duration')} unit={t('min')} value={dur} step={5} min={0} decimal={false} invalid={durInvalid || durTooLong} onChange={v => setDur(Math.round(v))} />
    {durInvalid && <div className="small" style={{ color: 'var(--red-ink)', marginTop: 6 }}>{t('Enter how long it took (at least 1 minute).')}</div>}
    {durTooLong && <div className="small" style={{ color: 'var(--red-ink)', marginTop: 6 }}>{t('That’s more than a day. Keep it to 24 hours or less.')}</div>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const workoutDurationSheet = (w, onDone) => ui().openSheet(close => <WorkoutDurationEdit w={w} onDone={onDone} close={close} />)

function WorkoutDetail({ w, close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  // The session note is editable here rather than only at the finish sheet: what you want to
  // record about a session is often clearer once you have looked at what you actually did.
  const [note, setNote] = useState(w.note || '')
  // A note written here is an edit of the saved workout, stamped for the sync to keep it over an
  // older copy of the same workout (stampWorkout) — and only when it changed, since a stamp
  // outranks what another device wrote since.
  const saveNote = () => update(s => {
    const rec = s.workouts.find(x => sameWorkout(x, w))
    if (!rec) return
    const text = note.trim().slice(0, NOTE_MAX)
    if (text === (rec.note || '')) return
    if (text) rec.note = text; else delete rec.note
    stampWorkout(rec)
  })
  // onBlur alone loses the note: Escape, the Android back gesture and swipe-to-dismiss all
  // close the sheet without ever moving focus out of the textarea. Flush on unmount too. The
  // ref is what makes that work — a cleanup closes over the note from its own render, which
  // is the empty string this started with.
  const latest = useRef(note)
  latest.current = note
  const initial = useRef(w.note || '')
  useEffect(() => () => {
    const text = latest.current.trim().slice(0, NOTE_MAX)
    if (text === initial.current) return
    update(s => {
      const rec = s.workouts.find(x => sameWorkout(x, w))
      if (!rec || text === (rec.note || '')) return   // deleted from this very sheet, or already saved
      if (text) rec.note = text; else delete rec.note
      stampWorkout(rec)
    })
  }, [])
  const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))
  // Tapping an exercise opens its history (Discord 'Improvement ideas'): from one session to the
  // curve it sits on, which is the question a past workout raises most often.
  const entryRow = (e, i) => {
    const ex = EXIDX[e.id]
    return <div key={i} className="row wd-ex" style={{ alignItems: 'flex-start' }} {...tappable(() => exerciseHistorySheet(e.id))}>
      {ex && <Thumb ex={ex} />}
      <div className="grow"><div className={`tt ${exerciseNameClass(ex)}`} style={{ fontWeight: 600 }}>{nameOf(e)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
        <div className="ss">{e.sets.filter(hasCompletedWork).map(s => setLabel(e.id, s, e.target, speedUnitOf(st))).join('  ·  ') || t('no sets')}</div>
        {e.note && <div className="small dim" style={{ marginTop: 3 }}>
          {e.notePin && <Icon name="pin" style={{ fontSize: 12, marginInlineEnd: 4, verticalAlign: '-1px', color: 'var(--yellow-ink)' }} />}{e.note}
        </div>}</div>
      <Icon name="chevronRight" className="chev" style={{ alignSelf: 'center' }} />
    </div>
  }
  // Exercises done as a superset stay together under a "Superset" label and one bar, the way the
  // routine editor shows them (Discord: "supersets aren't shown at all"). Adjacent entries with
  // the same tag, as in the workout itself; a workout finished before the tag was kept has none.
  const entryRows = units => units.map(unit => {
    if (unit.length < 2) return entryRow(w.entries[unit[0]], unit[0])
    return <div key={'ss' + unit[0]} className="wd-ss">
      <div className="ss-label"><Icon name="link" />{t('Superset')}</div>
      {unit.map(i => entryRow(w.entries[i], i))}
    </div>
  })
  // Copied with the note as it stands in the box, which may not be saved yet.
  const copyAsText = async () => {
    const rec = { ...(st.workouts.find(x => sameWorkout(x, w)) || w), note: note.trim() }
    toast(await copyText(workoutText(rec, { unit: st.unit, nameOf, speedUnit: speedUnitOf(st) })) ? t('Copied') : t('Could not copy'))
  }
  // A Garmin .fit activity (#447) of the saved record, for Garmin Connect's Import Data.
  const exportFit = () => {
    const rec = st.workouts.find(x => sameWorkout(x, w)) || w
    let bytes
    try { bytes = workoutFit(rec, { unit: st.unit, version: __APP_VERSION__ }) }
    catch (e) { toast(t('Could not create the file')); return }
    saveFitFile(new Blob([bytes], { type: 'application/vnd.ant.fit' }), fitFileName(rec))
  }
  const shareAsImage = () => {
    const rec = st.workouts.find(x => sameWorkout(x, w)) || w
    ui().openSheet(c2 => <ShareWorkoutImage w={rec} nameOf={nameOf} close={c2} />)
  }
  // A combined session's entries carry a `rid`; group them into per-routine sections in merge
  // order, with each section's supersets paired inside it (sessionSections, which "Copy as text"
  // reads the workout through too). A legacy single-routine workout (one routineIds, or no rid
  // anywhere) renders flat.
  const groups = sessionSections(w.entries)
  const grouped = groups.length > 1 || (groups[0] && groups[0].rid && (w.routineIds || []).length > 1)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {grouped ? groups.map(g => {
      const r = g.rid ? st.routines.find(x => x.id === g.rid) : null
      const items = g.items.map(i => w.entries[i])
      const setN = items.reduce((n, e) => n + e.sets.filter(s => s.done && !isWarmupRow(s)).length, 0)
      const vol = workoutVolume({ entries: items })
      return <div key={g.rid || '__none'}>
        <div className="row between" style={{ margin: '2px 0 8px', paddingBottom: 6, borderBottom: '1px solid var(--sep)' }}>
          <div className="row" style={{ gap: 7, fontWeight: 600 }}>
            {r && <Icon name={glyphOf(r.emoji)} />}{r ? r.name : t('Freestyle')}
          </div>
          <div className="small dim">{t('{0} sets', setN)} · {fmtVol(vol, st.unit)}</div>
        </div>
        {entryRows(g.units)}
      </div>
    }) : entryRows(groups[0]?.units || [])}
    {/* Progress photos and form-check videos: added and removed right here, on the saved record. */}
    <WorkoutMediaSection w={w} />
    <div className="small muted" style={{ margin: '4px 0 6px' }}>{t('Session note')}</div>
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} onBlur={saveNote} />
    <div style={{ height: 14 }} />
    {st.active && <p className="small muted">{t('Finish the current workout first.')}</p>}
    {/* The editor starts from the record as it is, so a note typed here goes in first — the same
        flush the date row does, and the unmount hook then has nothing left to write over it. */}
    <Button icon="pencil" disabled={!!st.active} onClick={() => {
      saveNote()
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      try { update(state => { editCompletedSession(state, w) }); closeThenNav(close, '/train/workout') }
      catch (error) { toast(t(error.message)) }
    }}>{t('Edit workout')}</Button>
    <div style={{ height: 8 }} />
    {/* The same exercises again, today, as a new session (#58): the rows read what was logged
        in this workout. The record itself stays as it is. */}
    <Button icon="reset" disabled={!!st.active} style={{ marginBottom: 8 }} onClick={() => {
      saveNote()
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      repeatWorkout(w, close)
    }}>{t('Repeat today')}</Button>
    {/* The note lives in a textarea that only writes on blur, and moving the workout re-keys a
        legacy record — so flush it first and stop the unmount hook writing it a second time. */}
    <Button icon="calendar" style={{ marginBottom: 8 }} onClick={() => {
      saveNote()
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      workoutDateSheet(w, close)
    }}>{t('Change date & time')}</Button>
    <Button icon="stopwatch" style={{ marginBottom: 8 }} onClick={() => {
      saveNote()
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      workoutDurationSheet(w, close)
    }}>{t('Change duration')}</Button>
    <Button icon="plus" onClick={() => confirmSheet({
      title: t('Save as routine?'),
      message: t('Create an independent routine from these exercise targets. Your workout history is kept.'),
      confirmText: t('Save'),
      onConfirm: () => {
        let id
        try { update(s => { id = saveSessionAsRoutine(s, w, w.name) }) }
        catch (e) { toast(t(e.message)); return }
        close()
        nav('/train/routines/' + id)
      }
    })}>{t('Save as routine')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="copy" onClick={copyAsText}>{t('Copy as text')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="share" onClick={shareAsImage}>{t('Share as image')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="download" onClick={exportFit}>{t('Export as .fit file')}</Button>
    <div style={{ height: 10 }} />
    {/* Matched the way the edits above are, not by id: a workout from before ids has none, and
        filtering on `x.id !== undefined` took every other one of them with it. */}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.') + mediaGoesToo(S().workouts.find(x => sameWorkout(x, w))), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => !sameWorkout(x, w)) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
// "Share as image" (#453): the card lib/workout-card.js lays out, painted in the theme and accent
// the app is showing right now, previewed before it goes anywhere. The muscle map is the finish
// summary's, for this one session; whether the card carries it is remembered with the profile.
function ShareWorkoutImage({ w, nameOf, close }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const withMap = st.shareMap !== false
  const model = useMemo(() => workoutCardModel(w, { unit: st.unit, nameOf }), [w, st.unit])
  // The last picture stays up while the next one is drawn, so the toggle never blanks the sheet.
  const [img, setImg] = useState(null)
  const [busy, setBusy] = useState(false)
  const shown = useRef(null)
  useEffect(() => {
    let alive = true
    workoutCardImage(model, { map: withMap, body: st.body })
      .then(blob => {
        if (!alive) return
        if (!blob) { setImg(prev => ({ ...prev, failed: true })); return }
        if (shown.current) URL.revokeObjectURL(shown.current)
        shown.current = URL.createObjectURL(blob)
        setImg({ blob, url: shown.current })
      })
      .catch(() => { if (alive) setImg(prev => ({ ...prev, failed: true })) })
    return () => { alive = false }
  }, [model, withMap, st.body])
  useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current) }, [])
  const name = 'gains-workout-' + (workoutDay(w) || todayISO()) + '.png'
  const share = async () => {
    setBusy(true)
    await shareImage(img.blob, name, w.name || BRAND.name)
    setBusy(false)
    close()
  }
  return <>
    <h3>{t('Share workout')}</h3>
    <div className="share-card">
      {img?.url
        ? <img src={img.url} alt={t('Preview of the image to share')} />
        : img?.failed ? <div className="share-card-ph small muted">{t('Could not create the image')}</div>
          : <div className="share-card-ph" aria-hidden="true" />}
    </div>
    {model.levels && <div className="sect-b" style={{ marginBottom: 12 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Muscle map')} subtitle={t('Show which muscles this workout trained.')}>
        <Switch checked={withMap} aria-label={t('Muscle map')} onChange={v => update(s => { s.shareMap = v })} />
      </Row>
    </div>}
    <Button variant="primary" icon="share" disabled={!img?.blob || busy} onClick={share}>{t('Share')}</Button>
  </>
}
async function workoutCardImage(model, { map, body }) {
  const root = getComputedStyle(document.documentElement)
  const css = (name, fallback) => root.getPropertyValue(name).trim() || fallback
  const colors = { bg: css('--bg', '#000'), surface: css('--surface', '#1c1c1e'), tile: css('--surface-2', '#2c2c2e'), label: css('--label', '#fff'), label2: css('--label-2', '#999'), acc: css('--acc', '#30d158') }
  // The body geometry is ~90 KB and lazy everywhere else too (components/BodyMap.jsx).
  const geometry = map && model.levels ? (await import('../lib/body-paths.js')).default : null
  const shape = geometry && (geometry[body] || geometry.male)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const measure = (text, weight, size) => { ctx.font = `${weight} ${size}px ${CARD_FONT}`; return ctx.measureText(text).width }
  const layout = layoutWorkoutCard(model, { measure, rtl: document.documentElement.dir === 'rtl', map: shape ? { aspect: viewAspect(shape.front) } : null })
  canvas.width = layout.width
  canvas.height = layout.height
  drawWorkoutCard(ctx, layout, colors, shape ? { body: shape, levels: model.levels } : null)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}
// The .fit file goes out the way a backup does: the share sheet in the phone app (Files, Drive,
// Garmin Connect itself), a download in the browser.
async function saveFitFile(blob, name) {
  if (MOBILE) { try { await shareExportBlob(blob, name) } catch (e) { /* share sheet dismissed */ } return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  toast(t('Saved. Garmin Connect can take it from here.'))
}
// The phone app goes through the OS share sheet the way a backup does; a browser that can share
// files (most phones) opens its own; anything else saves the picture as a download.
async function shareImage(blob, name, title) {
  if (MOBILE) { try { await shareExportBlob(blob, name) } catch (e) { /* share sheet dismissed */ } return }
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }) } catch (e) { /* dismissed */ }
    return
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  toast(t('Image saved'))
}
// The sentence a workout's Delete adds when its photos and videos go with it — every file the
// record lists, shown or not. Empty when it has none.
export function mediaGoesToo(rec) {
  const n = workoutMediaOf(rec, Infinity).length
  return n ? ' ' + tn('Its photo or video is deleted with it.', 'Its {0} photos or videos are deleted with it.', n) : ''
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
// `onPick(iso)`: Home's date navigator. Every day is then a date to go to, and the days with food
// logged in NutriTrace are marked beside the trained ones (the one calendar for both). Days to
// come are dimmed there; `onFuture(iso)` makes them tappable and hands them over instead (Home
// and Training: "change this day" for a day ahead, the picked date untouched).
function Calendar({ start, close, onPick, onFuture }) {
  const st = useStore(s => s.S)
  const logged = useNutrition(s => s.logged)
  const [cur, setCur] = useState(() => {
    const d = !start ? new Date() : typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(start + 'T12:00:00') : new Date(start)
    d.setDate(1)
    return d
  })
  const y = cur.getFullYear(), mo = cur.getMonth()
  // The shown month only (NutriTrace has no range read: one request per day not cached yet),
  // never past today; another month or closing the sheet cancels what is still loading.
  useEffect(() => {
    if (!onPick || !nutritionAvailable(useStore.getState().user)) return undefined
    const ctl = new AbortController()
    useNutrition.getState().loadLogged(isoOf(new Date(y, mo, 1)), isoOf(new Date(y, mo + 1, 0)), { signal: ctl.signal })
    return () => ctl.abort()
  }, [onPick, y, mo])
  const byDay = {}
  st.workouts.forEach(w => {
    const day = workoutDay(w)
    if (day) (byDay[day] = byDay[day] || []).push(w)
  })
  // Which column the 1st sits in, and therefore how many blanks come before it.
  const ws = weekStartOf(st)
  const startOffset = weekDayOffset(new Date(y, mo, 1).getDay(), ws)
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => workoutDay(w)?.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    // A fulfilled pin (a coach session pinned here and since done) reads as no override, as it does everywhere else.
    const ws = byDay[iso], planned = effectiveRoutineIds(st, iso).length > 0, ovr = st.dayPlan[iso] !== undefined && pinState(st, st.dayPlan[iso]) !== 'done'
    // A day off with a note on it (#261) shows the note's dot instead of the plan's, and its
    // note as the tooltip; tapping it opens the day sheet, where the note is.
    const note = !ws && dayNoteOf(st, iso)
    const dotCls = ws ? 'done' : note ? 'noted' : ovr && planned ? 'ovr' : planned ? 'plan' : ''
    const ate = !!onPick && logged.days.has(iso)
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (note ? ' noted' : '') + (ate ? ' logged' : '') + (iso === todayISO() ? ' today' : '')}
      title={note ? dayNoteLine(note, t) : undefined} disabled={!!onPick && !onFuture && iso > todayISO()} onClick={() => {
      if (onPick) { close(); if (onFuture && iso > todayISO()) onFuture(iso); else onPick(iso); return }
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet(c2 => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label={t('Previous month')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label={t('Next month')}><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${tn('{0} workout', '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{weekOrder(ws).map(d => <div key={d} className="cal-h">{t(DAYS[d])}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
      {Object.keys(st.dayNotes || {}).some(k => k.startsWith(y + '-' + String(mo + 1).padStart(2, '0')) && dayNoteOf(st, k)) &&
        <span><i style={{ background: 'var(--indigo)' }} />{t('Day note')}</span>}
      {onPick && <span><i className="cal-logged-key" />{t('Food logged')}</span>}
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{onPick ? t('Tap a day to see it') : t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = (start, { onPick, onFuture } = {}) => ui().openSheet(close => <Calendar start={start} close={close} onPick={onPick} onFuture={onFuture} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  const mediaN = workoutMediaCount(w)
  return <div className="item" {...tappable(onClick)}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{workoutLabel(w)}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), tn('{0} set', '{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div></div>
    {mediaN > 0 && <span className="wrow-media" title={tn('{0} photo or video', '{0} photos or videos', mediaN)} aria-label={tn('{0} photo or video', '{0} photos or videos', mediaN)}><Icon name="image" />{mediaN}</span>}
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* a day off with a note (#261), as History lists it between the workouts */
export function DayNoteRow({ iso, note }) {
  return <div className="item day-note-row" {...tappable(() => dayNoteSheet(iso))}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19, background: 'var(--surface-3)' }}><Icon name={note.tag ? DAY_NOTE_ICON[note.tag] : 'note'} /></span>
    <div className="grow"><div className="tt">{note.tag ? t(DAY_NOTE_LABEL[note.tag]) : t('Day note')}</div>
      <div className="ss">{[fmtDate(iso, true), note.text].filter(Boolean).join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}
