// The photo, GIF, video or link of a custom exercise, wherever an exercise's media shows: the
// detail sheet, the exercise config, the workout card, the picker, the library, a past workout,
// the routine editor and the muscle explorer. Media.jsx sends every custom exercise here, so no
// call site needed to change.
//
// Nothing here ever loads a file from a server URL. Every file is shown from the local media
// store (lib/media-store.js); when it is not there yet and this device is signed in to a server
// that stores media, it is fetched into the store first, checked against its sha256, and shown
// from there. That is what makes a paired phone work (an <img src> cannot carry its Bearer token)
// and what keeps a workout showing its pictures offline. Lists only ever load posters.
//
// Videos up to 15 s behave like the catalogue's GIFs: muted, looping, tap to pause — except in
// the workout's list layout (several cards at once must not run several decoders), under reduced
// motion, and while the file is not here on a connection that should not fetch it unasked; there
// the poster shows and a tap plays. Longer videos show their poster and play with sound and the
// browser's own controls on a tap.
//
// YouTube links mount a player only after a tap. Other links open without an opener or referrer.
// No link fetches a thumbnail or favicon in advance.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { clampView, pinchTo, dragTo } from '../lib/photo-zoom.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { nameIn } from '../lib/a11y-name.js'
import { exerciseNameText } from '../lib/format.js'
import { mediaOf, cleanUrl, linkKind } from '../lib/media-refs.js'
import { mediaStore } from '../lib/media-store.js'
import { fetchToStore, mayFetch } from '../lib/media-sync.js'
import { prefetchAllowed } from '../lib/media-prefetch.js'
import { LOOP_MAX_SEC } from '../lib/media-limits.js'
import Icon from './Icon.jsx'
import { youtubeId } from '../lib/youtube.js'
import YouTubeVideo from './YouTubeVideo.jsx'

/** Opens a link after a tap: sanitised again here, since plan files and backups can bring any
 *  string in, and in a new browsing context with no opener and no Referer. */
export function openExternal(url) {
  const u = cleanUrl(url)
  if (u) window.open(u, '_blank', 'noopener,noreferrer')
}

/**
 * A URL for one stored file ({ hash, mime, size } — a MediaRef or its poster), from the local
 * store, fetching it there first when it is missing and `auto` allows. { url, status, load }:
 * status 'ready' | 'loading' | 'idle' (not here, waiting for a tap) | 'missing' (nobody has it
 * for this device) | 'offline' | 'none' (no file given). load() fetches now, past the backoff —
 * a tap on a tile that failed.
 */
export function useMediaUrl(file, { auto = true } = {}) {
  const hash = file && typeof file.hash === 'string' ? file.hash : null
  const canFetch = useStore(s => !!(s.user && s.config?.media))
  const [state, setState] = useState({ url: null, status: hash ? 'loading' : 'none' })
  const [asked, setAsked] = useState(0)
  const [rev, setRev] = useState(0)
  const ready = state.status === 'ready'
  // A file that arrives some other way (the plan's prefetch, another card, the editor) shows up
  // without a tap; and one that failed for lack of a network is tried again when it returns.
  useEffect(() => {
    if (!hash || ready) return
    const bump = () => setRev(v => v + 1)
    const off = mediaStore.subscribe(bump)
    globalThis.addEventListener?.('online', bump)
    return () => { off(); globalThis.removeEventListener?.('online', bump) }
  }, [hash, ready])
  useEffect(() => {
    if (!hash) { setState({ url: null, status: 'none' }); return }
    let alive = true
    let held = false
    const show = url => {
      if (!alive) { mediaStore.release(hash); return }
      held = true
      setState({ url, status: 'ready' })
    }
    ;(async () => {
      const here = await mediaStore.url(hash).catch(() => null)
      if (here) return show(here)
      if (!alive) return
      if (!canFetch) return setState({ url: null, status: 'missing' })
      if (!auto && !asked) return setState({ url: null, status: 'idle' })
      if (!asked && !mayFetch(hash)) return setState({ url: null, status: 'missing' })
      setState(s => (s.status === 'loading' ? s : { url: null, status: 'loading' }))
      try { await fetchToStore(hash, file, { force: asked > 0 }) }
      catch (e) { if (alive) setState({ url: null, status: e?.code === 'offline' ? 'offline' : 'missing' }); return }
      const got = await mediaStore.url(hash).catch(() => null)
      if (got) show(got)
      else if (alive) setState({ url: null, status: 'missing' })
    })()
    return () => { alive = false; if (held) mediaStore.release(hash) }
    // `file` is described by its hash; the rest of it cannot change without the hash changing.
  }, [hash, auto, asked, canFetch, rev])
  return { ...state, load: () => setAsked(n => n + 1) }
}

const reducedMotion = () => {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/* ------------------------------------------------------------------ thumbnails ----------- */

// A still that will not load gets the same neutral tile as an exercise without media, like the
// catalogue's thumbs (#281). While a poster is on its way the tile shows too, so a row never jumps.
export function CustomThumb({ ex }) {
  const m = mediaOf(ex)
  const link = m ? null : cleanUrl(ex?.url)
  const poster = useMediaUrl(m?.poster || null)
  const [broken, setBroken] = useState(null)
  if (poster.url && broken !== poster.url) {
    return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={poster.url} alt="" onError={() => setBroken(poster.url)} />
  }
  const icon = m?.kind === 'video' || (link && linkKind(link) === 'video') ? 'play' : link ? 'link' : 'dumbbell'
  return <div className="thumb thumb-x"><Icon name={icon} /></div>
}

/* ------------------------------------------------------------------ links ---------------- */

// #246's card, as a <button> rather than a link: nothing on the page points at the address, so
// the browser has nothing to prefetch or preconnect to.
export function LinkCard({ url, compact, mini }) {
  const u = cleanUrl(url)
  if (!u) return null
  const yt = youtubeId(u)
  if (yt) return <YouTubeVideo key={yt} videoId={yt} compact={compact} mini={mini} />
  const video = linkKind(u) === 'video'
  let host = ''
  try { host = new URL(u).hostname } catch { /* cleanUrl already vouched for it */ }
  return (
    <button type="button" className={'exlink-card' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} data-swipe-ignore
      onClick={e => { e.stopPropagation(); openExternal(u) }}>
      <span className="exlink-icon"><Icon name={video ? 'play' : 'link'} /></span>
      <span className="exlink-meta">
        <span className="exlink-title">{video ? t('Watch video') : t('Open link')}</span>
        {!mini && host && <span className="exlink-sub" dir="ltr">{host}</span>}
      </span>
      <Icon name="chevronRight" className="exlink-arr" />
    </button>
  )
}

/* ------------------------------------------------------------------ the big picture ------- */

export default function CustomMedia({ ex, id, compact, minimizable, sayAs }) {
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  // The workout's list layout, from the store: only the workout card is minimizable.
  const listLayout = useStore(s => !!minimizable && ((s.S.active?.workoutView || s.S.workoutView) === 'list'))
  const m = mediaOf(ex)
  const link = cleanUrl(ex?.url)
  if (!m && !link) return null
  if (minimizable && gifSize === 'off') return null
  const mini = !!minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const toggle = minimizable
    // named like the catalogue's (Media.jsx): "My Curl: Minimize", one per exercise in a list (P4)
    ? <button className="giftoggle" aria-label={nameIn(sayAs || exerciseNameText(ex), mini ? t('Expand') : t('Minimize'))} onClick={toggleSize}><Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}</button>
    : null
  const cls = 'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')
  const name = exerciseNameFor(ex)
  if (!m) return <LinkCard url={link} compact={compact} mini={mini} />
  const body = m.kind === 'video'
    ? <CustomVideo key={m.hash} m={m} id={id} cls={cls} name={name} toggle={toggle} mini={mini} still={listLayout || reducedMotion()} />
    : m.kind === 'gif'
      ? <CustomGif key={m.hash} m={m} id={id} cls={cls} name={name} toggle={toggle} mini={mini} />
      : <CustomImage key={m.hash} m={m} id={id} cls={cls} name={name} toggle={toggle} />
  return <>
    {body}
    {link && !mini && <LinkCard url={link} compact />}
  </>
}

/**
 * One stored photo, GIF or video on its own, with the same rules as an exercise's: an image
 * shows, a GIF plays and a tap stills it, a short clip loops muted, a long one shows its poster
 * and plays with sound and controls on a tap. What the viewer of a workout's photos and videos
 * shows (WorkoutMedia.jsx). `m` must already have passed normalizeMediaRef.
 */
export function MediaView({ m, cls = 'exmedia', name = '', still = false }) {
  if (!m) return null
  const motionless = still || reducedMotion()
  return m.kind === 'video'
    ? <CustomVideo key={m.hash} m={m} cls={cls} name={name} still={motionless} />
    : m.kind === 'gif'
      ? <CustomGif key={m.hash} m={m} cls={cls} name={name} />
      : <CustomImage key={m.hash} m={m} cls={cls} name={name} zoom={false} />
}

// The tile that stands in for a file that is not here: a spinner-less dumbbell (nothing new to
// translate), and a tap that asks again.
const Tile = () => <div className="exmedia-x"><Icon name="dumbbell" /></div>

// A tap on a photo that is here opens it full screen to pinch and drag (Discord); one that is not
// asks for it again. `zoom` is off where the photo is already full screen (the viewers).
function CustomImage({ m, id, cls, name, toggle, zoom = true }) {
  const main = useMediaUrl(m)
  const [broken, setBroken] = useState(false)
  const ok = main.url && !broken
  const onTap = () => {
    if (!ok) { setBroken(false); main.load(); return }
    if (zoom) openPhotoZoom(m, name)
  }
  return (
    <div className={cls + (ok ? '' : ' broken') + (ok && zoom ? ' zoomable' : '')} id={id} onClick={onTap}>
      {ok ? <img decoding="async" draggable={false} src={main.url} alt={name} onError={() => setBroken(true)} /> : <Tile />}
      {toggle}
    </div>
  )
}

// The photo on black, as big as it fits: two fingers pinch it up to four times, one drags it
// around once it is bigger than the screen, the wheel zooms with a mouse. A tap that does not move
// closes it while it is not zoomed in, and so do the × and Back (the viewer sheet, Modals.jsx).
// It follows the fingers 1:1 with no animation, so Reduce Motion has nothing to take away.
function PhotoZoom({ m, name, close }) {
  const { url } = useMediaUrl(m)
  const img = useRef(null)
  const [view, setView] = useState({ z: 1, x: 0, y: 0 })
  const pts = useRef(new Map())
  const start = useRef(null)
  const moved = useRef(false)
  const size = () => ({ w: img.current?.offsetWidth || 0, h: img.current?.offsetHeight || 0 })
  const apart = () => { const [a, b] = [...pts.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 }
  const anchor = v => {
    const [a] = [...pts.current.values()]
    start.current = !a ? null : pts.current.size >= 2 ? { d: apart(), view: v } : { x: a.x, y: a.y, view: v }
  }
  const down = e => {
    if (pts.current.size === 0) moved.current = false
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    anchor(view)
  }
  const move = e => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const s0 = start.current
    if (!s0) return
    const { w, h } = size()
    if (s0.d) { moved.current = true; setView(pinchTo(s0.view, s0.d, apart(), w, h)); return }
    const dx = e.clientX - s0.x, dy = e.clientY - s0.y
    if (Math.hypot(dx, dy) > 8) moved.current = true
    setView(dragTo(s0.view, dx, dy, w, h))
  }
  const up = e => {
    if (!pts.current.delete(e.pointerId)) return
    if (!pts.current.size && !moved.current && view.z <= 1.01 && e.type === 'pointerup') { close(); return }
    setView(v => { anchor(v); return v })
  }
  const wheel = e => { if (e.deltaY) { const { w, h } = size(); setView(v => clampView({ ...v, z: v.z * Math.exp(-e.deltaY / 300) }, w, h)) } }
  return <div className="mviewer" role="dialog" aria-modal="true" aria-label={name || t('Photo')}>
    <div className="mviewer-bar">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
    </div>
    <div className="mviewer-stage pzoom" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
      {url && <img ref={img} src={url} alt={name} draggable={false}
        style={view.z > 1 ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` } : undefined} />}
    </div>
  </div>
}
export const openPhotoZoom = (m, name = '') => useUI.getState().openSheet(close => <PhotoZoom m={m} name={name} close={close} />, { kind: 'viewer' })

// Like the catalogue's GIFs: the animation plays, a tap switches to the still (the poster) and
// back, and a file that will not load falls back to the still, then to the tile.
function CustomGif({ m, id, cls, name, toggle, mini }) {
  const [playing, setPlaying] = useState(true)
  const main = useMediaUrl(m)
  const poster = useMediaUrl(m.poster || null)
  const [failed, setFailed] = useState(null)   // 'gif' → the still is showing; 'all' → the tile
  const showGif = playing && failed == null && !!main.url
  const src = showGif ? main.url : poster.url || (failed == null ? main.url : null)
  const broken = !src || failed === 'all'
  const onTap = () => {
    if (broken || failed) { setFailed(null); setPlaying(true); main.load(); poster.load(); return }
    setPlaying(p => !p)
  }
  return (
    <div className={cls + (broken ? ' broken' : '')} id={id} onClick={onTap}>
      {broken ? <Tile /> : <img decoding="async" draggable={false} src={src} alt={name} onError={() => setFailed(showGif ? 'gif' : 'all')} />}
      {toggle}
      {!mini && !broken && !failed && (
        <span className="gifhint"><Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}</span>
      )}
    </div>
  )
}

// iOS plays a video inline and unasked only when it is muted from the start, and React sets
// `muted` as a property after the element exists — too late for Safari's autoplay check. So the
// attribute is written by hand before the source is attached.
const mute = el => {
  if (!el) return
  el.muted = true
  el.defaultMuted = true
  el.setAttribute('muted', '')
}

function CustomVideo({ m, id, cls, name, toggle, mini, still }) {
  const loop = m.dur != null && m.dur <= LOOP_MAX_SEC
  const poster = useMediaUrl(m.poster || null)
  // The file itself only comes down unasked where a few MB cost nothing; otherwise on the tap.
  const main = useMediaUrl(m, { auto: prefetchAllowed() })
  const ref = useRef(null)
  const box = useRef(null)
  // Whether the box is on screen. Taken as yes until the observer says otherwise, so a browser
  // without one simply plays; with one, the first answer comes within a frame.
  const [visible, setVisible] = useState(true)
  // What a tap asked for: null until the first tap, then play (true) or pause (false).
  const [asked, setAsked] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [broken, setBroken] = useState(false)
  // A long video is playing with sound and controls since its tap.
  const [open, setOpen] = useState(false)
  // A short clip loops by itself where it may; a long one, or one that may not, waits for a tap.
  // Either way only while it can be seen: a card beside the one on screen (the swipe layout keeps
  // its neighbours rendered), one scrolled away in the list, or a sheet still sliding in does not
  // decode anything.
  const shouldPlay = visible && (asked ?? (loop && !still))

  useEffect(() => {
    const el = ref.current
    if (!el || !main.url) return
    if (shouldPlay) {
      const p = el.play()
      // Refused (no user gesture where the browser wants one): it waits for a tap instead. Only a
      // refusal is one: an AbortError is this effect's own pause() cutting the play() short — a
      // sheet still sliding in is off screen for the observer's first answer — and once the box
      // is on screen the effect asks it to play again.
      if (p && typeof p.then === 'function') {
        p.then(() => setPlaying(true), e => {
          if (e?.name === 'NotAllowedError') { setPlaying(false); setAsked(false) }
          else setPlaying(!el.paused)
        })
      }
    } else el.pause()
  }, [shouldPlay, main.url])

  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(([e]) => {
      setVisible(e.isIntersecting)
      // A long video leaving the screen stays paused when it comes back: it has sound.
      if (!e.isIntersecting && !loopRef.current) setAsked(a => (a ? false : a))
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const loopRef = useRef(loop)
  loopRef.current = loop && !open

  const onTap = () => {
    if (broken) { setBroken(false); main.load(); poster.load(); return }
    if (!main.url) { main.load(); setAsked(true); if (!loop) setOpen(true); return }
    if (!loop) {
      // The first tap on a long video hands it the browser's own controls, with sound; after
      // that the controls are the video's, and taps on it are theirs.
      if (!open) { setOpen(true); setAsked(true) }
      return
    }
    setAsked(!shouldPlay)
  }

  const loading = !main.url && main.status === 'loading'
  const hint = !mini && !broken && !(open && main.url)
  return (
    <div ref={box} className={cls + (broken || (!main.url && !poster.url) ? ' broken' : '')} id={id} onClick={open && main.url ? undefined : onTap}>
      {main.url && !broken
        ? <video ref={el => { ref.current = el; if (el && !open) mute(el) }} src={main.url} poster={poster.url || undefined}
            playsInline loop={loop && !open} controls={open} muted={!open}
            preload={loop ? 'auto' : 'metadata'} aria-label={name}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setBroken(true)} />
        : poster.url && !broken
          ? <img decoding="async" draggable={false} src={poster.url} alt={name} />
          : <Tile />}
      {toggle}
      {hint && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{loading ? t('Loading…') : playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}
