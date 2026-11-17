// Every progress photo in one place, newest first: adding them, for today or an earlier day,
// several at once; removing one; and a before/after comparison between any two.
//
// A photo for a day with a logged workout goes onto that workout (addWorkoutMedia, the saved
// workout's own `media` list, the same place WorkoutMedia.jsx writes). One for a day without a
// workout, or past a workout's cap, is filed under the day instead (#557, lib/day-photos.js
// `dayPhotos`), where the server keeps those (media.days) or there is no server. Each picked
// photo gets its own day, suggested by its EXIF date, its file name or its file date
// (lib/photo-date.js), and the day can be changed later from the full-size view (#940). The
// in-app camera (#951) files its picture for today the same way. The gallery is one grid cut into
// months with an activity chart over it (#949); a comparison takes two to nine photos (#950).
//
// Both kinds are private to the account like every other photo (DATA_DIR/uploads/<uid>/,
// api/media.js). Nothing here shares them anywhere: a trainer sees them only through the member's
// own "photos" grant (api/permissions.js), the community library only when the person shares one
// themselves on a server that allows personal media (api/library/config.js), and the comparison
// picture only goes where the person sends it from the share sheet.
import { CheckinReminderRow } from '../components/CheckinReminder.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { workoutMediaOf } from '../lib/media-refs.js'
import { removeWorkoutMedia, restoreWorkoutMedia } from '../lib/workout-media.js'
import { dayPhotosOf, removeDayPhoto, restoreDayPhoto, serverTakesDayPhotos, fileProgressPhoto, moveProgressPhoto } from '../lib/day-photos.js'
import { photoDateOfFile } from '../lib/photo-date.js'
import { photoNudge, monthGroups, photoCounts } from '../lib/photo-gallery.js'
import { byDate, COMPARE_MAX } from '../lib/photo-compare.js'
import { dateLocale } from '../lib/i18n-core.js'
import { sameWorkout } from '../lib/workout-date.js'
import { syncMedia } from '../lib/media-sync.js'
import { useMediaPicker } from '../components/CustomMediaField.jsx'
import { CustomThumb, MediaView, useMediaUrl } from '../components/CustomMedia.jsx'
import { Button } from '../components/ui.jsx'
import DateField, { datePickerSheet } from '../components/DateField.jsx'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import Heatmap from '../components/Heatmap.jsx'
import PhotoCamera from '../components/PhotoCamera.jsx'
import PhotoCompare from '../components/PhotoCompare.jsx'

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
// left to the media clean-up like there. An Undo puts it back where it was. Its day can be
// changed too (#940): it moves by the rule a new photo goes by (lib/day-photos.js
// moveProgressPhoto), and the viewer closes, since the photo may now be another entry.
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
  const redate = () => datePickerSheet({
    value: p.d, max: todayISO(), label: t('Which day is this photo from?'),
    onPick: d => {
      const st = useStore.getState()
      const canDay = serverTakesDayPhotos(st.user, st.config)
      let res
      st.update(s => { res = moveProgressPhoto(s, p, d, { canDay }) })
      if (res === 'workout' || res === 'day') { close(); toast(t('Moved to {0}', fmtDate(d, true, true))) }
      else if (res === 'no-room') toast(t('Your server keeps photos only on days with a workout. An update lets it keep them for any day.'))
    },
  })
  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={t('Photo')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <button type="button" className="mviewer-count pp-redate" aria-label={t('Change the day')} onClick={redate}>
        {fmtDate(p.d, true, true)} <Icon name="pencil" />
      </button>
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

/** Opens the comparison of two to nine progressPhotosOf() entries, oldest first whatever the order given. */
export function openProgressCompare(...list) {
  const photos = byDate(list.flat().filter(Boolean)).slice(0, COMPARE_MAX)
  if (photos.length < 2) return
  useUI.getState().openSheet(close => <PhotoCompare photos={photos} close={close} toast={toast} />, { kind: 'viewer' })
}

// How many photos one pick takes: each is read and re-encoded on the device, one after another.
const MAX_AT_ONCE = 20
const ISO = /^\d{4}-\d{2}-\d{2}$/

function Preview({ file }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined
    let u = null
    try { u = URL.createObjectURL(file) } catch { return undefined }
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return <div className="pp-preview">{url ? <img src={url} alt="" /> : <Icon name="image" />}</div>
}

const sourceLine = it => it.source === 'photo' ? t('Date from the photo itself.')
  : it.source === 'name' ? t('Date from the file name.')
    : it.source === 'file' ? t('A guess from the file date. Worth a look.')
      : t('No date found. Which day was it?')

/* The picked photos, one at a time (#940): a preview, "2 of 5", and the photo's own day, found by
   lib/photo-date.js where it can be and changeable either way. Add files every photo under its
   own day; a photo still without one is shown instead of saving. */
export function AddPhotosSheet({ items, close, save }) {
  const today = todayISO()
  const [dates, setDates] = useState(() => items.map(i => i.d || ''))
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const n = items.length
  const okDay = d => ISO.test(d) && d <= today
  const it = items[at]
  const setDate = d => setDates(cur => cur.map((x, i) => (i === at ? d : x)))
  const go = async () => {
    if (busy) return
    const missing = dates.findIndex(d => !okDay(d))
    if (missing >= 0) { setAt(missing); return }
    setBusy(true)
    try { await save(items.map((x, i) => ({ ...x, d: dates[i] }))) } finally { setBusy(false); close() }
  }
  return <>
    <h3>{tn('Add {0} photo', 'Add {0} photos', n)}</h3>
    <Preview file={it.file} />
    {n > 1 && <div className="pp-step" dir="ltr">
      <button type="button" className="iconbtn" aria-label={t('Previous')} disabled={at === 0} onClick={() => setAt(a => a - 1)}><Icon name="chevronLeft" /></button>
      <span className="small" aria-live="polite">{t('{0} of {1}', at + 1, n)}</span>
      <button type="button" className="iconbtn" aria-label={t('Next')} disabled={at === n - 1} onClick={() => setAt(a => a + 1)}><Icon name="chevronRight" /></button>
    </div>}
    <label className="measure-date" style={{ display: 'block', margin: '12px 0 4px' }}>
      <span className="small">{t('Date')}</span>
      <DateField key={at} value={dates[at]} max={today} onChange={setDate} label={t('Date')} />
    </label>
    <div className={'small ' + (okDay(dates[at]) && it.source !== 'file' ? 'muted' : 'pp-warn')} style={{ marginBottom: 14 }}>
      {dates[at] && dates[at] !== (it.d || '') ? t('Your pick.') : sourceLine(it)}
    </div>
    <Button variant="primary" disabled={busy} onClick={go}>{busy ? t('Loading…') : t('Add')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </>
}

const monthTitle = month => {
  const d = new Date(month + '-15T12:00:00')
  if (Number.isNaN(d.getTime())) return month
  try { return new Intl.DateTimeFormat(dateLocale(), { month: 'long', year: 'numeric' }).format(d) } catch { return month }
}

function nudgeLine(nudge) {
  if (!nudge) return null
  if (nudge.kind === 'today') return t("Today's photo is in. Looking good.")
  if (nudge.kind === 'yesterday') return t('Last photo: yesterday.')
  return tn('Last photo: {0} day ago. Same spot, same light?', 'Last photo: {0} days ago. Same spot, same light?', nudge.days)
}

export default function ProgressPhotos() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const photos = useMemo(() => progressPhotosOf(S), [S.workouts, S.dayPhotos])
  const months = useMemo(() => monthGroups(photos), [photos])
  const counts = useMemo(() => photoCounts(photos), [photos])
  const [comparing, setComparing] = useState(false)
  const [picked, setPicked] = useState([])   // up to COMPARE_MAX photo keys, in tap order
  const { pick, busy, canAdd, showAdd } = useMediaPicker()
  const fileRef = useRef(null)
  const listRef = useRef(null)
  const today = todayISO()
  const nudge = photoNudge(photos, today)

  const toggle = p => setPicked(cur => {
    if (cur.includes(p.key)) return cur.filter(k => k !== p.key)
    if (cur.length >= COMPARE_MAX) { toast(t('Up to {0} photos at once.', COMPARE_MAX)); return cur }
    return [...cur, p.key]
  })
  const cancelCompare = () => { setComparing(false); setPicked([]) }
  const runCompare = () => {
    const list = picked.map(k => photos.find(p => p.key === k)).filter(Boolean)
    if (list.length < 2) return
    cancelCompare()
    openProgressCompare(list)
  }
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const canDay = serverTakesDayPhotos(user, config)
  // Several photos at once (#557), each with its own day (#940); see AddPhotosSheet.
  const onFiles = async ev => {
    const files = [...(ev.target.files || [])].slice(0, MAX_AT_ONCE)
    ev.target.value = ''
    if (!files.length) return
    const items = await Promise.all(files.map(async file => ({ file, ...(await photoDateOfFile(file, today)) })))
    useUI.getState().openSheet(close => <AddPhotosSheet items={items} close={close} save={save} />)
  }
  const save = async items => {
    const n = { added: 0, noRoom: 0 }
    for (const it of items) {
      const got = await pick(it.file)
      if (!got) continue
      let res
      update(s => { res = fileProgressPhoto(s, it.d, got, { canDay }) })
      if (res === 'workout' || res === 'day') n.added++
      else if (res === 'no-room') n.noRoom++
    }
    if (n.added) { toast(tn('{0} photo added', '{0} photos added', n.added)); syncMedia({ force: true }) }
    if (n.noRoom) toast(t('Your server keeps photos only on days with a workout. An update lets it keep them for any day.'))
  }
  const openCamera = () => useUI.getState().openSheet(close => <PhotoCamera photos={photos} close={close}
    onUse={file => save([{ file, d: todayISO() }])} />, { kind: 'viewer' })
  const jumpTo = iso => {
    const el = listRef.current?.querySelector(`[data-day="${iso}"]`)
    if (!el) return
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    el.classList.add('pp-flash')
    setTimeout(() => el.classList.remove('pp-flash'), 900)
  }

  const firstOfDay = new Set()
  return <>
    <ScreenHeader hard title={t('Progress photos')} sub={tn('{0} photo', '{0} photos', photos.length)}
      left={<button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>}
      right={photos.length >= 2 && (comparing
        ? <Button size="sm" variant="ghost" onClick={cancelCompare}>{t('Cancel')}</Button>
        : <Button size="sm" variant="tinted" onClick={() => setComparing(true)}>{t('Compare')}</Button>)} />

    {!comparing && showAdd && <div className="pp-actions">
      <Button variant="primary" icon="camera" disabled={!canAdd || busy} onClick={openCamera}>{t('Take photo')}</Button>
      <Button variant="tinted" icon="image" disabled={!canAdd || busy} onClick={() => fileRef.current?.click()}>
        {busy ? t('Loading…') : t('Add photos')}
      </Button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
    </div>}

    {!comparing && nudge && <div className={'pp-nudge' + (nudge.kind === 'today' ? ' done' : '')}>
      <Icon name={nudge.kind === 'today' ? 'checkCircle' : 'camera'} /><span>{nudgeLine(nudge)}</span>
    </div>}

    {/* A reminder for the next one (components/CheckinReminder.jsx), bundled with the measurements. */}
    {!comparing && <div className="sect-b" style={{ marginBottom: 14 }}><CheckinReminderRow /></div>}
    {comparing && <div className="small dim" style={{ margin: '0 0 12px' }}>
      {picked.length < 2 ? t('Pick two or more photos, up to {0}.', COMPARE_MAX) : tn('{0} photo picked.', '{0} photos picked.', picked.length)}
    </div>}

    {!comparing && photos.length > 0 && <div className="card pp-activity">
      <h2>{t('Photo days (last 12 months)')}</h2>
      <Heatmap S={S} counts={counts} onDay={jumpTo}
        legend={[t('Fewer'), t('More')]} countLabel={c => tn('{0} photo', '{0} photos', c)} />
    </div>}

    {!photos.length
      ? <div className="empty"><div className="ico"><Icon name="image" /></div>
          {t('No progress photos yet. Take one now, or add one for any day before.')}
        </div>
      : <div ref={listRef}>{months.map(g => (
        <section key={g.month} className="pp-month">
          <h4 className="sec">{monthTitle(g.month)}</h4>
          <div className="pp-grid">
            {g.items.map(p => {
              const at = picked.indexOf(p.key)
              const first = !firstOfDay.has(p.d)
              if (first) firstOfDay.add(p.d)
              return (
                <button key={p.key} type="button" data-swipe-ignore data-day={first ? p.d : undefined}
                  className={'wmedia-item pp-tile' + (at >= 0 ? ' pp-selected' : '')}
                  aria-label={fmtDate(p.d, true, true)} aria-pressed={comparing ? at >= 0 : undefined}
                  onClick={() => (comparing ? toggle(p) : openPhotoView(p))}>
                  <CustomThumb ex={{ custom: true, media: p.m }} />
                  <span className="pp-pill pp-tile-date">{fmtDate(p.d)}</span>
                  {at >= 0 && <span className="pp-check">{at + 1}</span>}
                </button>
              )
            })}
          </div>
        </section>
      ))}</div>}

    {comparing && picked.length >= 2 && <div className="pp-cta">
      <Button variant="primary" onClick={runCompare}>{tn('Compare {0} photo', 'Compare {0} photos', picked.length)}</Button>
    </div>}
  </>
}
