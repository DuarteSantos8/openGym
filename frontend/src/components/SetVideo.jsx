// Your own form video of one set (lib/set-videos.js): filming it, playing it beside the set, and
// "Your form videos" of an exercise with two dates side by side.
//
// Filming is the file input every phone already knows: capture="environment" opens the camera
// straight into video (the WebView hands it to the system camera on Android and iOS), the other
// button the phone's videos. A picked file goes through the same ingest as a workout's photo
// (useMediaPicker: sniffed by its bytes, metadata scrubbed, held to the size and length caps,
// a poster made) and lands in the local store as pending. Nothing is transcoded: the camera's own
// file is kept as it is, so the caps are the only bound (docs/MEDIA.md says why).
//
// Playback follows a form check: muted, looping, inline, with the browser's controls, a 0.5x
// switch to see the bottom of a squat, and full screen on a tap. Files show from the local store
// only, fetched there first when signed in (useMediaUrl); a video kept on the phone that filmed
// it is never asked for anywhere else.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtClip } from '../lib/media-refs.js'
import { limitsFrom } from '../lib/media-limits.js'
import { setLabel } from '../lib/history.js'
import { speedUnitOf } from '../lib/speed.js'
import { exOr } from '../lib/exercises.js'
import { fmtDate, exerciseNameText } from '../lib/format.js'
import {
  attachSetVideo, detachSetVideo, removeSavedSetVideo, filmsLocally, filmSecCap, formVideosFor,
  defaultComparePair, toggleCompare, WORKOUT_SET_VIDEOS_MAX
} from '../lib/set-videos.js'
import { useMediaPicker } from './CustomMediaField.jsx'
import { useMediaUrl, CustomThumb } from './CustomMedia.jsx'
import { Button, Row, Switch } from './ui.jsx'
import Icon from './Icon.jsx'

const toast = m => useUI.getState().toast(m)
const openSheet = (render, opts) => useUI.getState().openSheet(render, opts)

// iOS plays a video inline and unasked only when it is muted from the start, and React writes
// `muted` too late for that check (see CustomMedia.jsx), so the attribute goes on by hand.
const mute = el => {
  if (!el) return
  el.muted = true
  el.defaultMuted = true
  el.setAttribute('muted', '')
}

/* ------------------------------------------------------------------ filming ------------- */

/**
 * The sheet "Film this set" opens: record or pick a video for set `at` ({ entry, set }) of the
 * session in progress. The one place that says where the videos go and that they stay private.
 */
export function filmSetSheet(at, title) {
  openSheet(close => <FilmSetSheet at={at} title={title} close={close} />)
}

function FilmSetSheet({ at, title, close }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const update = useStore(s => s.update)
  const { pick, busy, warning, note, storable } = useMediaPicker()
  const cam = useRef(null)
  const lib = useRef(null)
  const sec = filmSecCap(limitsFrom(config))
  const local = filmsLocally(S, user, config)
  // The switch only means something where the videos would otherwise go up.
  const serverKeeps = !!user && !!config?.media?.sets
  const serverLacks = !!user && !!config && !config.media?.sets
  // A set video is kept here even where the server takes none (filmsLocally marks it), so only
  // a browser that cannot keep a file at all stops it.
  const canAdd = storable && !busy

  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''   // picking the same file again still fires onChange
    if (!file) return
    const got = await pick(file)
    if (!got) return
    if (got.kind !== 'video') { toast(t('That’s a photo. Pick a video for a set.')); return }
    let res
    update(s => { res = attachSetVideo(s, at, got, { local: filmsLocally(s, user, config) }) })
    if (res === 'added' || res === 'replaced') { toast(t('Video saved with this set')); close() }
    else if (res === 'full') toast(t('Up to {0} set videos per workout.', WORKOUT_SET_VIDEOS_MAX))
    else { toast(t('That set is gone.')); close() }
  }

  return <div className="fv-sheet">
    <h3 style={{ marginBottom: 4 }}>{title}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Film from the side with your whole body in the frame. Up to {0} seconds.', sec)}</div>
    <div className="fv-film">
      <Button variant="primary" icon={busy ? undefined : 'camera'} disabled={!canAdd} onClick={() => cam.current?.click()}>
        {busy ? t('Loading…') : t('Record a video')}
      </Button>
      <Button icon="image" disabled={!canAdd} onClick={() => lib.current?.click()}>{t('Choose from your videos')}</Button>
    </div>
    <input ref={cam} type="file" accept="video/*" capture="environment" hidden onChange={onFile} />
    <input ref={lib} type="file" accept="video/*" hidden onChange={onFile} />
    {serverKeeps && <div className="card" style={{ padding: 0, margin: '12px 0 0' }}>
      <Row icon="phoneScreen" iconTint="var(--teal)" title={t('Keep videos on this phone only')}
        subtitle={local ? t('New set videos are not uploaded to your server.') : t('Set videos go to your server like your photos.')}>
        <Switch aria-label={t('Keep videos on this phone only')} checked={local}
          onChange={v => update(s => { if (v) s.formVideoLocal = true; else delete s.formVideoLocal })} />
      </Row>
    </div>}
    {serverLacks && <div className="small dim fv-note">{t('Your server doesn’t keep set videos, so this one stays on this phone.')}</div>}
    {warning && <div className="small dim fv-note">{warning}</div>}
    {note && !serverLacks && <div className="small dim fv-note">{note}</div>}
    <div className="small dim fv-note fv-private"><Icon name="lock" /><span>{t('Only for you. Your videos never go to the Coach, MCP, share cards, Wrapped or PDFs.')}</span></div>
  </div>
}

/* ------------------------------------------------------------------ playback ------------ */

// The stage takes the video's own shape (a phone films upright), between square-ish and 9:16, so
// it neither letterboxes an upright clip nor towers over the set rows for a landscape one.
const stageShape = m => {
  const r = m && m.width > 0 && m.height > 0 ? m.width / m.height : 3 / 4
  const k = Math.min(16 / 9, Math.max(9 / 16, r))
  return { aspectRatio: String(k), '--fv-r': k }
}

/**
 * One form video, playing: muted, looping, inline, with controls, 0.5x and full screen. `onRemove`
 * adds a Remove (asked once more), `onRefilm` a Film again. A video kept on another phone says so.
 */
export function FormVideoPlayer({ m, label = '', onRemove, onRefilm, compact = false }) {
  const elsewhere = m.local === true
  const main = useMediaUrl(m, { auto: !elsewhere })
  const poster = useMediaUrl(m.poster || null, { auto: !elsewhere })
  const ref = useRef(null)
  const [rate, setRate] = useState(1)
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate }, [rate, main.url])
  const full = () => {
    const v = ref.current
    if (!v) return
    // iOS has no Fullscreen API on a video element, only its own player.
    if (typeof v.requestFullscreen === 'function') v.requestFullscreen().catch(() => {})
    else if (typeof v.webkitEnterFullscreen === 'function') v.webkitEnterFullscreen()
  }
  const missing = !main.url && main.status !== 'loading'
  return <div className={'fv-player' + (compact ? ' compact' : '')}>
    <div className="fv-stage" style={stageShape(m)}>
      {main.url
        ? <video ref={el => { ref.current = el; mute(el); if (el) el.playbackRate = rate }} src={main.url} poster={poster.url || undefined}
            playsInline autoPlay loop controls muted preload="auto" aria-label={label || t('Form video')} />
        : poster.url ? <img src={poster.url} alt="" draggable={false} /> : <div className="fv-x"><Icon name="play" /></div>}
      {!main.url && <div className="fv-msg" onClick={() => { if (!elsewhere) main.load() }}>
        {elsewhere && missing ? t('On the phone that filmed it') : main.status === 'loading' ? t('Loading…') : main.status === 'offline' ? t('You’re offline. Try again once you’re back online.') : missing ? t('This video isn’t on this device') : null}
      </div>}
    </div>
    <div className="fv-bar">
      <div className="fv-speed" role="group" aria-label={t('Playback speed')}>
        {[0.5, 1].map(r => <button key={r} type="button" className={'chip' + (rate === r ? ' on' : '')} aria-pressed={rate === r} onClick={() => setRate(r)} dir="ltr">{r === 0.5 ? '0.5×' : '1×'}</button>)}
      </div>
      {m.dur != null && <span className="small dim" dir="ltr">{fmtClip(m.dur)}</span>}
      <span style={{ flex: 1 }} />
      {onRefilm && <button type="button" className="iconbtn" aria-label={t('Film again')} title={t('Film again')} onClick={onRefilm}><Icon name="camera" /></button>}
      {onRemove && <button type="button" className="iconbtn" aria-label={t('Remove video')} title={t('Remove video')} onClick={() => setAsking(a => !a)}><Icon name="trash" /></button>}
      <button type="button" className="iconbtn" aria-label={t('Full screen')} title={t('Full screen')} disabled={!main.url} onClick={full}><Icon name="expand" /></button>
    </div>
    {asking && <div className="fv-ask">
      <span>{t('Remove this video?')}</span>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
      <Button variant="danger" size="sm" onClick={() => { setAsking(false); onRemove() }}>{t('Remove')}</Button>
    </div>}
  </div>
}

/** The small badge under a set row with a video: its length, and a tap that opens or closes the
 *  player right there. */
export function SetVideoBadge({ m, open, onToggle }) {
  return <button type="button" className={'fv-badge' + (open ? ' on' : '')} aria-expanded={open} onClick={onToggle}>
    <Icon name="camera" />
    <span>{t('Form video')}</span>
    {m.dur != null && <span className="dim" dir="ltr">{fmtClip(m.dur)}</span>}
    <Icon name={open ? 'chevronUp' : 'chevronDown'} />
  </button>
}

/** The player under a set of the session in progress, with Film again and Remove. */
export function ActiveSetVideo({ m, at, label, refilmTitle }) {
  const update = useStore(s => s.update)
  return <div className="fv-inline">
    <FormVideoPlayer m={m} label={label} compact
      onRefilm={() => filmSetSheet(at, refilmTitle)}
      onRemove={() => update(s => { detachSetVideo(s, at, m.hash) })} />
  </div>
}

/* ------------------------------------------------------------------ an exercise's videos */

const itemLabel = (it, exId, st) => setLabel(exId, it.row, it.w?.entries?.[it.entry]?.target, speedUnitOf(st))

/** Opens the set video `v` (workoutSetVideos) of the saved workout `w`, from its photos and videos. */
export function openWorkoutSetVideo(w, v) {
  const row = w?.entries?.[v.entry]?.sets?.[v.set]
  if (!row) return
  openSavedVideo({ key: v.entry + ':' + v.set, wid: w.id ?? null, w, d: w.d || '', start: w.start || 0, entry: v.entry, set: v.set, row, m: v.m }, v.exId)
}

/** One saved set video in a sheet of its own, with Remove. */
function openSavedVideo(it, exId) {
  openSheet(close => <SavedVideo it={it} exId={exId} close={close} />)
}
function SavedVideo({ it, exId, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  return <>
    <h3 style={{ marginBottom: 2 }}>{fmtDate(it.d, true, true)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{exerciseNameText(exOr(exId))} · {itemLabel(it, exId, S)}</div>
    <FormVideoPlayer m={it.m} label={fmtDate(it.d, true, true)}
      onRemove={() => { update(s => { removeSavedSetVideo(s, it.w, it.m.hash) }); close() }} />
  </>
}

/**
 * "Your form videos" of one exercise, newest first, in its history and its details: a tap plays
 * one, Compare puts two dates side by side (the newest and the oldest to start with). Nothing
 * while the exercise has none.
 */
export function FormVideosSection({ exId }) {
  const S = useStore(s => s.S)
  const items = useMemo(() => formVideosFor(S, exId), [S.workouts, exId])
  const [picking, setPicking] = useState(false)
  const [sel, setSel] = useState([])
  if (!items.length) return null
  const tap = it => (picking ? setSel(toggleCompare(sel, it.key, items)) : openSavedVideo(it, exId))
  return <div className="fv-section">
    <h4 className="sec">{t('Your form videos')}</h4>
    <div className="fv-strip">
      {items.map(it => <button key={it.key} type="button" data-swipe-ignore
        className={'fv-tile' + (picking && sel.includes(it.key) ? ' pp-selected' : '')}
        aria-pressed={picking ? sel.includes(it.key) : undefined}
        aria-label={fmtDate(it.d, true, true) + ', ' + itemLabel(it, exId, S)} onClick={() => tap(it)}>
        <span className="fv-thumb"><CustomThumb ex={{ custom: true, media: it.m }} /><span className="wmedia-kind"><Icon name="play" /></span></span>
        <span className="fv-date">{fmtDate(it.d)}</span>
        <span className="fv-set">{itemLabel(it, exId, S)}</span>
      </button>)}
    </div>
    {items.length >= 2 && (picking
      ? <div className="row fv-pick">
          <Button size="sm" variant="primary" icon="sides" disabled={sel.length !== 2}
            onClick={() => openCompare(sel.map(k => items.find(x => x.key === k)), exId)}>{t('Compare')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>{t('Cancel')}</Button>
          <span className="small dim">{t('Pick two dates')}</span>
        </div>
      : <Button size="sm" variant="tinted" icon="sides" style={{ marginTop: 8 }}
          onClick={() => { setPicking(true); setSel(defaultComparePair(items)) }}>{t('Compare two dates')}</Button>)}
  </div>
}

function openCompare(pair, exId) {
  if (pair.length !== 2 || pair.some(x => !x)) return
  openSheet(close => <CompareVideos pair={pair} exId={exId} close={close} />)
}

/**
 * Two dates side by side, newer first: both muted and looping, one set of controls for both —
 * restart together, 0.5x together, play and pause together — so the same moment of the lift
 * lines up.
 */
export function CompareVideos({ pair, exId }) {
  const S = useStore(s => s.S)
  const refs = [useRef(null), useRef(null)]
  const [rate, setRate] = useState(1)
  const [paused, setPaused] = useState(false)
  const each = fn => refs.forEach(r => { if (r.current) fn(r.current) })
  useEffect(() => { each(v => { v.playbackRate = rate }) }, [rate])
  const restart = () => each(v => { v.currentTime = 0; v.play()?.catch?.(() => {}) })
  const toggle = () => { const p = !paused; setPaused(p); each(v => { if (p) v.pause(); else v.play()?.catch?.(() => {}) }) }
  return <>
    <h3 style={{ marginBottom: 10 }}>{t('Compare two dates')}</h3>
    <div className="fv-compare">
      {pair.map((it, i) => <CompareSide key={it.key} it={it} vref={refs[i]} rate={rate} label={itemLabel(it, exId, S)} />)}
    </div>
    <div className="fv-bar" style={{ justifyContent: 'center' }}>
      <button type="button" className="iconbtn" aria-label={t('Restart both')} title={t('Restart both')} onClick={restart}><Icon name="reset" /></button>
      <button type="button" className="iconbtn" aria-label={paused ? t('Play both') : t('Pause both')} onClick={toggle}><Icon name={paused ? 'play' : 'pause'} /></button>
      <div className="fv-speed" role="group" aria-label={t('Playback speed')}>
        {[0.5, 1].map(r => <button key={r} type="button" className={'chip' + (rate === r ? ' on' : '')} aria-pressed={rate === r} onClick={() => setRate(r)} dir="ltr">{r === 0.5 ? '0.5×' : '1×'}</button>)}
      </div>
    </div>
  </>
}

function CompareSide({ it, vref, rate, label }) {
  const elsewhere = it.m.local === true
  const main = useMediaUrl(it.m, { auto: !elsewhere })
  const poster = useMediaUrl(it.m.poster || null, { auto: !elsewhere })
  return <figure className="fv-side">
    <div className="fv-stage" style={stageShape(it.m)}>
      {main.url
        ? <video ref={el => { vref.current = el; mute(el); if (el) el.playbackRate = rate }} src={main.url} poster={poster.url || undefined}
            playsInline autoPlay loop muted preload="auto" aria-label={label} />
        : poster.url ? <img src={poster.url} alt="" draggable={false} /> : <div className="fv-x"><Icon name="play" /></div>}
      {!main.url && <div className="fv-msg">{elsewhere ? t('On the phone that filmed it') : main.status === 'loading' ? t('Loading…') : t('This video isn’t on this device')}</div>}
    </div>
    <figcaption><b>{fmtDate(it.d, true, true)}</b><span className="dim">{label}</span></figcaption>
  </figure>
}
