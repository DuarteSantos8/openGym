import { useState } from 'react'
import { imgSrc, imgCdnSrc, gifSrc, gifCdnSrc, isCustomEx } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import CustomMedia, { CustomThumb } from './CustomMedia.jsx'

// An exercise's picture, wherever one shows. A custom exercise goes to CustomMedia.jsx — its own
// photo, GIF, video or link, from the local media store — and never through imgSrc/gifSrc, which
// name files of the shipped dataset (a stray img/gif on a custom exercise, written by a fork, is
// ignored). The split is by component, not by branch, so each side keeps its own hooks in order.
export default function Media(p) {
  return isCustomEx(p.ex) ? <CustomMedia {...p} /> : <BuiltinMedia key={p.ex.id + ':' + p.ex.gif + ':' + p.ex.img} {...p} />
}

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up, exactly like
// an exercise without media. Any other/legacy value behaves as 'full'.
function BuiltinMedia({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const [useGifCdn, setUseGifCdn] = useState(false)
  const [useImgCdn, setUseImgCdn] = useState(false)
  // 'gif' means both animation sources failed; 'all' means both still sources failed too.
  // A tap after failure retries from the local file, so a newly available file gets a chance.
  const [failed, setFailed] = useState(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!ex.gif) return null
  if (minimizable && gifSize === 'off') return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const showGif = playing && failed == null
  const src = showGif
    ? (useGifCdn ? gifCdnSrc(ex) : gifSrc(ex))
    : (useImgCdn ? imgCdnSrc(ex) : imgSrc(ex))
  const onError = () => {
    if (showGif && !useGifCdn && gifCdnSrc(ex) !== gifSrc(ex)) { setUseGifCdn(true); return }
    if (!showGif && !useImgCdn && imgCdnSrc(ex) !== imgSrc(ex)) { setUseImgCdn(true); return }
    setFailed(showGif ? 'gif' : 'all')
  }
  const onTap = () => {
    if (failed) { setFailed(null); setUseGifCdn(false); setUseImgCdn(false); setPlaying(true); return }
    setPlaying(p => !p)
  }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '')} id={id} onClick={onTap}>
      {failed === 'all'
        ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : <img key={src} decoding="async" draggable={false} src={src} alt={exerciseNameFor(ex)} onError={onError} />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && !failed && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

// Thumbnails try the local still before the CDN, then show a neutral tile if both fail.
// Switching exercises resets the source and failure state.
export function Thumb(p) {
  return isCustomEx(p.ex) ? <CustomThumb {...p} /> : <BuiltinThumb key={p.ex.id + ':' + p.ex.img} {...p} />
}
function BuiltinThumb({ ex }) {
  const [useCdn, setUseCdn] = useState(false)
  const [broken, setBroken] = useState(false)
  if (!ex.img || broken) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  const src = useCdn ? imgCdnSrc(ex) : imgSrc(ex)
  const onError = () => {
    if (!useCdn && imgCdnSrc(ex) !== imgSrc(ex)) { setUseCdn(true); return }
    setBroken(true)
  }
  return <img key={src} className="thumb" loading="lazy" decoding="async" draggable={false} src={src} alt="" onError={onError} />
}
