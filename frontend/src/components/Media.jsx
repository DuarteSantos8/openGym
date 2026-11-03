import { useEffect, useState } from 'react'
import { imgSrc, gifSrc, isVideoSrc, isCustomEx, figureOf } from '../lib/exercises.js'
import { MOBILE } from '../lib/mobile.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import CustomMedia, { CustomThumb } from './CustomMedia.jsx'
import { useAnimSources } from './Animations.jsx'

// An exercise's picture, wherever one shows. A custom exercise goes to CustomMedia.jsx — its own
// photo, GIF, video or link, from the local media store — and never through imgSrc/gifSrc, which
// name files of the shipped dataset (a stray img/gif on a custom exercise, written by a fork, is
// ignored). The split is by component, not by branch, so each side keeps its own hooks in order.
export default function Media(p) {
  return isCustomEx(p.ex) ? <CustomMedia {...p} /> : <BuiltinMedia {...p} />
}

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up, exactly like
// an exercise without media. Any other/legacy value behaves as 'full'.
function BuiltinMedia({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  // 'gif' → the animation failed, the still is showing; 'all' → the still failed too. Media is
  // fetched from wherever the build points (a mount, a CDN): a dropped connection, an expired
  // session on a gated instance or a CDN hiccup used to leave the browser's broken-image glyph
  // on a white block. Now the still stands in for the animation, a neutral tile stands in for
  // both, and a tap tries again — no text, so nothing new to translate.
  const [failed, setFailed] = useState(null)
  const gifSize = useStore(s => s.S.gifSize)
  const body = useStore(s => figureOf(s.S))
  const update = useStore(s => s.update)
  // In the store apps the animation may come from a downloaded pack at the chosen quality
  // (Settings → Animation quality, components/Animations.jsx): the sources are the best file
  // first and the built-in one last, and one that will not load hands over to the next before the
  // still is shown. 'Still only' asks for no animation at all. Elsewhere: the built-in file.
  const anim = useAnimSources(ex, body)
  const sourcesKey = anim.sources.join('|')
  const [tried, setTried] = useState({ key: sourcesKey, i: 0 })
  const at = tried.key === sourcesKey ? tried.i : 0
  const gif = anim.sources[Math.min(at, Math.max(0, anim.sources.length - 1))] || gifSrc(ex, body)
  const clip = ex.gif && isVideoSrc(gif) ? gif : null
  const clipSrc = useClipInMemory(clip)
  if (!ex.gif) return null
  if (minimizable && gifSize === 'off') return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const showGif = playing && failed == null && !anim.still
  const onError = () => {
    if (showGif && at < anim.sources.length - 1) { setTried({ key: sourcesKey, i: at + 1 }); return }
    setFailed(showGif ? 'gif' : 'all')
  }
  const onTap = () => {
    if (failed) { setFailed(null); setPlaying(true); setTried({ key: sourcesKey, i: 0 }); return }
    if (anim.still) return
    setPlaying(p => !p)
  }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '')} id={id} onClick={onTap}>
      {failed === 'all'
        ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : showGif && clip && clipSrc
          // No poster: Android's WebView went back to it at every loop and stalled there (the
          // still above stands in while the clip loads, so nothing is lost without it).
          ? <video ref={autoplayClip} className="catvid" src={clipSrc} autoPlay muted loop playsInline disablePictureInPicture
              aria-label={exerciseNameFor(ex)} onError={onError} />
          : showGif && clip
            // the phone app is still reading the clip into memory: the still holds its place
            ? <img decoding="async" draggable={false} src={imgSrc(ex, body)} alt={exerciseNameFor(ex)} />
          : <img decoding="async" draggable={false} src={showGif ? gif : imgSrc(ex, body)} alt={exerciseNameFor(ex)} onError={onError} />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && !failed && !anim.still && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

// In the phone app the clips come out of the app package through Capacitor's local server, which
// answers every seek with a fresh, slow read: each loop jumped back to 0 and sat there for one to
// five seconds, and users saw "slow and buggy" animations (the web, with its HTTP cache, never
// did). So the app reads a clip into memory once (20-40 KB) and plays it from there; the last few
// stay, so reopening an exercise is instant. The web keeps its URL and the browser's cache.
const MEMORY_CLIPS = 30
const clipCache = new Map()          // src -> object URL, oldest first
const clipLoads = new Map()          // src -> pending promise
function loadClip(src) {
  if (clipCache.has(src)) {
    const url = clipCache.get(src)
    clipCache.delete(src); clipCache.set(src, url)   // most recently used last
    return Promise.resolve(url)
  }
  if (!clipLoads.has(src)) {
    clipLoads.set(src, fetch(src)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(blob => {
        const url = URL.createObjectURL(blob)
        clipCache.set(src, url)
        while (clipCache.size > MEMORY_CLIPS) {
          const [old, oldUrl] = clipCache.entries().next().value
          clipCache.delete(old); URL.revokeObjectURL(oldUrl)
        }
        return url
      })
      .finally(() => clipLoads.delete(src)))
  }
  return clipLoads.get(src)
}

export function useClipInMemory(src, inApp = MOBILE) {
  const [url, setUrl] = useState(() => (src && inApp ? clipCache.get(src) || null : src))
  useEffect(() => {
    if (!src || !inApp) { setUrl(src); return }
    let alive = true
    setUrl(clipCache.get(src) || null)
    // A read that fails falls back to the URL itself: playing slowly beats not playing.
    loadClip(src).then(u => { if (alive) setUrl(u) }, () => { if (alive) setUrl(src) })
    return () => { alive = false }
  }, [src, inApp])
  return url
}

// React sets `muted` as a property only, never as the attribute, and Android's WebView (the phone
// app) allows autoplay only for a video that carries the attribute: the loop sat on its first frame
// there while every desktop browser played it. Set it before the first frame and start playback
// ourselves; a refusal leaves the still showing, which a tap can still start.
export function autoplayMuted(el) {
  if (!el) return
  el.muted = true
  el.defaultMuted = true
  el.setAttribute('muted', '')
  const p = el.play?.()
  if (p && typeof p.catch === 'function') p.catch(() => {})
}

// An exercise's clip plays while it is on screen. Each one used to loop for as long as it was
// mounted: in the List layout every exercise of the workout has one, and five clips nobody could
// see decoded ~28 frames a second each (headless Chrome, synthetic clips). One observer for all of
// them pauses a clip that scrolls out of view and starts it again just before it comes back.
// Without IntersectionObserver (old browsers, tests) the clips simply loop as before.
let clipObserver = null
const clipsInView = () => clipObserver || (clipObserver = new IntersectionObserver(entries => {
  for (const e of entries) {
    const v = e.target
    if (e.isIntersecting) { const p = v.play?.(); if (p && typeof p.catch === 'function') p.catch(() => {}) }
    else v.pause?.()
  }
}, { rootMargin: '100px 0px' }))
export function autoplayClip(el) {
  autoplayMuted(el)
  if (!el || typeof IntersectionObserver === 'undefined') return
  const io = clipsInView()
  io.observe(el)
  return () => io.unobserve(el)
}

// A still that will not load (offline and never cached, a lapsed session on a gated instance, a
// CDN hiccup) gets the same neutral tile as an exercise without media, instead of the browser's
// broken-image glyph in a list of them (#281). The failure is remembered per image, so a list
// that re-renders does not ask again; a new exercise in the same slot tries its own.
export function Thumb(p) {
  return isCustomEx(p.ex) ? <CustomThumb {...p} /> : <BuiltinThumb {...p} />
}
function BuiltinThumb({ ex }) {
  const body = useStore(s => figureOf(s.S))
  const src = ex.img ? imgSrc(ex, body) : null
  const [broken, setBroken] = useState(null)
  if (!src || broken === src) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={src} alt="" onError={() => setBroken(src)} />
}
