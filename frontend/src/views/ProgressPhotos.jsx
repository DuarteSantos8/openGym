// Every progress photo across every logged workout, in one place, newest first — a quick way to
// add one to today, and a before/after comparison between any two.
//
// WorkoutMedia.jsx already lets a photo or video be attached to a finished workout — that is
// still the only place one is stored (addWorkoutMedia, a saved workout's own `media` list) and
// where one is removed. What this view adds is a shortcut for the common case (today's workout
// is already logged) straight onto the record WorkoutMedia.jsx would have written to anyway, plus
// lining every still up chronologically and a slider to compare two dates directly. Nothing new
// to store, sync or back up — one more way to reach and to look at data the media system already
// keeps, private to the account the same way everything else there is (DATA_DIR/uploads/<uid>/,
// api/media.js).
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { workoutMediaOf, WORKOUT_MEDIA_MAX } from '../lib/media-refs.js'
import { addWorkoutMedia } from '../lib/workout-media.js'
import { syncMedia } from '../lib/media-sync.js'
import { useMediaPicker } from '../components/CustomMediaField.jsx'
import { CustomThumb, MediaView, useMediaUrl } from '../components/CustomMedia.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const toast = m => useUI.getState().toast(m)

/** Today's own logged workout, the latest one if there is more than one — where "Add photo"
 *  attaches to, same as opening that workout and using WorkoutMedia.jsx there directly. */
export function todaysWorkout(S) {
  const today = (S.workouts || []).filter(w => w.d === todayISO())
  if (!today.length) return null
  return today.reduce((a, b) => (b.start || 0) > (a.start || 0) ? b : a)
}

/**
 * Every still photo (no video — the comparison wants two stills, not two clips) across every
 * logged workout, newest first. Each entry carries the date and the workout it came from, so the
 * grid and the comparator can both say when a photo was taken without re-deriving it.
 */
export function progressPhotosOf(S) {
  const out = []
  for (const w of (S && S.workouts) || []) {
    for (const m of workoutMediaOf(w)) {
      if (m.kind === 'video') continue
      // `key`: the same file can sit on two workouts (one hash), and each is its own photo here.
      out.push({ key: (w.id || w.start || w.d) + ':' + m.hash, d: w.d, start: w.start || 0, w, m })
    }
  }
  out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.start - a.start))
  return out
}

/** Runs an already-sorted progressPhotosOf() list into { d, items }[] groups of the same date. */
export function groupByDate(photos) {
  const out = []
  for (const p of photos) {
    const last = out[out.length - 1]
    if (last && last.d === p.d) last.items.push(p)
    else out.push({ d: p.d, items: [p] })
  }
  return out
}

/** Whole days between two ISO dates, always ≥ 0 regardless of which comes first. */
export function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')
  return Math.abs(Math.round(ms / 86400000))
}

function openPhotoView(p) {
  useUI.getState().openSheet(close => (
    <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photo')}>
      <div className="mviewer-bar">
        <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
        <span className="mviewer-count">{fmtDate(p.d, true, true)}</span>
        <span style={{ width: 36 }} />
      </div>
      <div className="mviewer-stage"><MediaView m={p.m} cls="exmedia viewer" /></div>
    </div>
  ), { kind: 'viewer' })
}

/** The before/after slider between two progress photos `a` (earlier) and `b` (later). */
function ProgressCompare({ a, b, close }) {
  const before = useMediaUrl(a.m)
  const after = useMediaUrl(b.m)
  const [pct, setPct] = useState(50)
  const stageRef = useRef(null)
  const dragging = useRef(false)

  const setFromClientX = x => {
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    setPct(Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)))
  }
  const onPointerDown = e => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setFromClientX(e.clientX) }
  const onPointerMove = e => { if (dragging.current) setFromClientX(e.clientX) }
  const endDrag = () => { dragging.current = false }

  const days = daysBetween(a.d, b.d)

  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Compare photos')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{days > 0 ? tn('{0} day apart', '{0} days apart', days) : t('Same day')}</span>
      <span style={{ width: 36 }} />
    </div>
    {/* A photo has no reading direction: before stays on the left and the finger drives the
        handle the same way in Arabic, so the stage is ltr like DurationWheel's wheel. */}
    <div className="pp-compare" dir="ltr" ref={stageRef} data-swipe-ignore
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {after.url && <img className="pp-img" src={after.url} alt="" draggable={false} />}
      {before.url && <img className="pp-img" src={before.url} alt="" draggable={false}
        style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }} />}
      <div className="pp-handle" style={{ insetInlineStart: pct + '%' }}><div className="pp-grip" /></div>
      <div className="pp-label pp-label-before">{fmtDate(a.d, true)}</div>
      <div className="pp-label pp-label-after">{fmtDate(b.d, true)}</div>
    </div>
  </div>
}

/** Opens the before/after slider between two progressPhotosOf() entries, in date order either way. */
export function openProgressCompare(x, y) {
  const [a, b] = x.d <= y.d ? [x, y] : [y, x]
  useUI.getState().openSheet(close => <ProgressCompare a={a} b={b} close={close} />, { kind: 'viewer' })
}

export default function ProgressPhotos() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const photos = useMemo(() => progressPhotosOf(S), [S.workouts])
  const groups = useMemo(() => groupByDate(photos), [photos])
  const [comparing, setComparing] = useState(false)
  const [picked, setPicked] = useState([])   // up to 2 photo keys, in tap order
  const today = todaysWorkout(S)
  const { pick, busy, canAdd, showAdd } = useMediaPicker()
  const fileRef = useRef(null)

  const toggle = p => setPicked(cur => {
    if (cur.includes(p.key)) return cur.filter(k => k !== p.key)
    return cur.length >= 2 ? [cur[1], p.key] : [...cur, p.key]
  })
  const cancelCompare = () => { setComparing(false); setPicked([]) }
  const runCompare = () => {
    if (picked.length !== 2) return
    const [ha, hb] = picked
    const a = photos.find(p => p.key === ha)
    const b = photos.find(p => p.key === hb)
    cancelCompare()
    if (a && b) openProgressCompare(a, b)
  }
  // Attaches straight onto today's already-logged workout — the file picker offers the camera
  // on a phone the same way WorkoutMedia.jsx's does, since it is the very same input.
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file || !today) return
    if (workoutMediaOf(today).length >= WORKOUT_MEDIA_MAX) { toast(t('Up to {0} photos or videos per workout.', WORKOUT_MEDIA_MAX)); return }
    const got = await pick(file)
    if (!got) return
    let res
    update(s => { res = addWorkoutMedia(s, today, got) })
    if (res === 'added') { toast(t('Photo added')); syncMedia({ force: true }) }
    else if (res === 'full') toast(t('Up to {0} photos or videos per workout.', WORKOUT_MEDIA_MAX))
    else if (res === 'gone') toast(t('Workout deleted'))
  }

  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Progress photos')}</h1>
        <div className="sub">{tn('{0} photo', '{0} photos', photos.length)}</div></div>
      {photos.length >= 2 && (comparing
        ? <Button size="sm" variant="ghost" onClick={cancelCompare}>{t('Cancel')}</Button>
        : <Button size="sm" variant="tinted" onClick={() => setComparing(true)}>{t('Compare')}</Button>)}
    </div>

    {!comparing && showAdd && <div className="row" style={{ marginBottom: 16 }}>
      {today
        ? <Button icon={busy ? 'image' : 'camera'} disabled={!canAdd} onClick={() => fileRef.current?.click()}>
            {busy ? t('Loading…') : t('Add a photo to today')}
          </Button>
        : <Button icon="dumbbell" onClick={() => nav('/workout')}>{t('Log today’s workout to add a photo')}</Button>}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
    </div>}

    {comparing && <div className="small dim" style={{ margin: '0 0 12px' }}>
      {picked.length < 2 ? t('Pick two photos to compare.') : t('Ready! Open the comparison.')}
    </div>}

    {!photos.length
      ? <div className="empty"><div className="ico"><Icon name="image" /></div>
          {t('No progress photos yet. The button above adds one to today, once today has a logged workout.')}
        </div>
      : groups.map(g => (
        <div key={g.d} style={{ marginBottom: 18 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{fmtDate(g.d, true, true)}</div>
          <div className="wmedia-grid">
            {g.items.map(p => {
              const selected = picked.includes(p.key)
              return (
                <button key={p.key} type="button" data-swipe-ignore
                  className={'wmedia-item' + (selected ? ' pp-selected' : '')}
                  aria-label={fmtDate(p.d, true)}
                  onClick={() => (comparing ? toggle(p) : openPhotoView(p))}>
                  <CustomThumb ex={{ custom: true, media: p.m }} />
                  {selected && <span className="pp-check"><Icon name="check" /></span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}

    {comparing && picked.length === 2 && <div className="pp-cta">
      <Button variant="primary" onClick={runCompare}>{t('Compare')}</Button>
    </div>}
  </>
}
