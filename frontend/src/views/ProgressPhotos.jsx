// Every progress photo in one place, newest first: adding them, for today or an earlier day,
// several at once; removing one; and a before/after comparison between any two.
//
// A photo for a day with a logged workout goes onto that workout (addWorkoutMedia, the saved
// workout's own `media` list, the same place WorkoutMedia.jsx writes). One for a day without a
// workout, or past a workout's cap, is filed under the day instead (#557, lib/day-photos.js
// `dayPhotos`), where the server keeps those (media.days) or there is no server. The date is
// suggested by the photo's own EXIF date where it has one, else the day picked in the sheet.
// Both kinds are private to the account like every other photo (DATA_DIR/uploads/<uid>/,
// api/media.js).
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { workoutMediaOf } from '../lib/media-refs.js'
import { removeWorkoutMedia, restoreWorkoutMedia } from '../lib/workout-media.js'
import { dayPhotosOf, removeDayPhoto, restoreDayPhoto, serverTakesDayPhotos, fileProgressPhoto } from '../lib/day-photos.js'
import { exifDateOfFile } from '../lib/exif-date.js'
import { sameWorkout } from '../lib/workout-date.js'
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
  // And the ones filed under a day (#557), after a day's workout photos.
  for (const p of dayPhotosOf(S)) out.push({ key: 'day:' + p.hash, d: p.d, start: 0, w: null, day: true, m: p.m })
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

// A photo full size, with a way to remove it (#558): it comes off the workout it belongs to,
// exactly as the workout's own photo viewer takes it off (lib/workout-media.js), and the file is
// left to the media clean-up like there. An Undo puts it back where it was.
export function PhotoView({ p, close }) {
  const [asking, setAsking] = useState(false)
  const remove = () => {
    const st = useStore.getState()
    if (p.day) {
      const entry = st.S.dayPhotos?.[p.m.hash]
      let removed = false
      st.update(s => { removed = removeDayPhoto(s, p.m.hash) })
      close()
      if (removed) useUI.getState().toast(t('Photo removed'), {
        action: t('Undo'),
        onAction: () => useStore.getState().update(s => { restoreDayPhoto(s, p.m.hash, entry) }),
      })
      return
    }
    const rec = (st.S.workouts || []).find(w => w && sameWorkout(w, p.w)) || p.w
    const at = Array.isArray(rec?.media) ? rec.media.findIndex(x => x && x.hash === p.m.hash) : -1
    const ref = at >= 0 ? rec.media[at] : p.m
    let removed = false
    st.update(s => { removed = removeWorkoutMedia(s, p.w, p.m.hash) })
    close()
    if (!removed) return
    useUI.getState().toast(t('Photo removed'), {
      action: t('Undo'),
      onAction: () => useStore.getState().update(s => { restoreWorkoutMedia(s, p.w, ref, at) }),
    })
  }
  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photo')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="mviewer-count">{fmtDate(p.d, true, true)}</span>
      <button type="button" className="iconbtn" aria-label={t('Remove')} onClick={() => setAsking(a => !a)}><Icon name="trash" /></button>
    </div>
    <div className="mviewer-stage"><MediaView m={p.m} cls="exmedia viewer" /></div>
    {asking && <div className="mviewer-ask">
      <div className="mviewer-ask-t">{t('Remove this photo or video?')}</div>
      <div className="mviewer-ask-b">
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
        <Button variant="danger" size="sm" onClick={remove}>{t('Remove')}</Button>
      </div>
    </div>}
  </div>
}

function openPhotoView(p) {
  useUI.getState().openSheet(close => <PhotoView p={p} close={close} />, { kind: 'viewer' })
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

// How many photos one pick takes: each is read and re-encoded on the device, one after another.
const MAX_AT_ONCE = 20

/* The day the picked photos go under. One photo: its own EXIF date, or today, either changeable.
   Several: each with an EXIF date goes on that day, the rest on the day picked here. */
export function AddPhotosSheet({ items, close, save }) {
  const today = todayISO()
  const one = items.length === 1
  const own = items.filter(i => i.exif).length
  const [date, setDate] = useState((one && items[0].exif) || today)
  const [busy, setBusy] = useState(false)
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today
  const go = async () => {
    if (!ok || busy) return
    setBusy(true)
    try { await save(items, date) } finally { setBusy(false); close() }
  }
  return <>
    <h3>{tn('Add {0} photo', 'Add {0} photos', items.length)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {one
        ? (items[0].exif ? t('The photo says it was taken on {0}. Change the day if it was another one.', fmtDate(items[0].exif, true, true)) : t('Which day is this photo from?'))
        : own === items.length ? t('Each photo goes on the day it was taken.')
          : own ? tn('{0} photo knows its day and goes there. The others go on the day below.', '{0} photos know their day and go there. The others go on the day below.', own)
            : t('They all go on the day below.')}
    </div>
    {(one || own < items.length) && <label className="measure-date" style={{ display: 'block', marginBottom: 14 }}>
      <span className="small">{t('Date')}</span>
      <input className="field" type="date" value={date} max={today} onChange={e => setDate(e.target.value)} />
    </label>}
    <Button variant="primary" disabled={!ok || busy} onClick={go}>{busy ? t('Loading…') : t('Add')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </>
}

export default function ProgressPhotos() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const photos = useMemo(() => progressPhotosOf(S), [S.workouts, S.dayPhotos])
  const groups = useMemo(() => groupByDate(photos), [photos])
  const [comparing, setComparing] = useState(false)
  const [picked, setPicked] = useState([])   // up to 2 photo keys, in tap order
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
  // Several photos at once (#557), each filed under the day it was taken where its EXIF says so,
  // else under the day picked in the sheet (today unless changed); see fileProgressPhoto.
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const canDay = serverTakesDayPhotos(user, config)
  const onFiles = async ev => {
    const files = [...(ev.target.files || [])].slice(0, MAX_AT_ONCE)
    ev.target.value = ''
    if (!files.length) return
    const today = todayISO()
    const items = await Promise.all(files.map(async file => {
      const d = await exifDateOfFile(file)
      return { file, exif: d && d <= today ? d : null }
    }))
    useUI.getState().openSheet(close => <AddPhotosSheet items={items} close={close} save={save} />)
  }
  const save = async (items, picked) => {
    const n = { added: 0, noRoom: 0 }
    for (const it of items) {
      const got = await pick(it.file)
      if (!got) continue
      const d = items.length > 1 ? (it.exif || picked) : picked
      let res
      update(s => { res = fileProgressPhoto(s, d, got, { canDay }) })
      if (res === 'workout' || res === 'day') n.added++
      else if (res === 'no-room') n.noRoom++
    }
    if (n.added) { toast(tn('{0} photo added', '{0} photos added', n.added)); syncMedia({ force: true }) }
    if (n.noRoom) toast(t('Your server keeps photos only on days with a workout. An update lets it keep them for any day.'))
  }

  return <>
    <div className="hdr"><button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Progress photos')}</h1>
        <div className="sub">{tn('{0} photo', '{0} photos', photos.length)}</div></div>
      {photos.length >= 2 && (comparing
        ? <Button size="sm" variant="ghost" onClick={cancelCompare}>{t('Cancel')}</Button>
        : <Button size="sm" variant="tinted" onClick={() => setComparing(true)}>{t('Compare')}</Button>)}
    </div>

    {!comparing && showAdd && <div className="row" style={{ marginBottom: 16 }}>
      <Button icon={busy ? 'image' : 'camera'} disabled={!canAdd || busy} onClick={() => fileRef.current?.click()}>
        {busy ? t('Loading…') : t('Add photos')}
      </Button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
    </div>}

    {comparing && <div className="small dim" style={{ margin: '0 0 12px' }}>
      {picked.length < 2 ? t('Pick two photos to compare.') : t('Ready! Open the comparison.')}
    </div>}

    {!photos.length
      ? <div className="empty"><div className="ico"><Icon name="image" /></div>
          {t('No progress photos yet. Add one for today or any day before.')}
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
