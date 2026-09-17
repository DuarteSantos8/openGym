import { useState } from 'react'
import { imgSrc, gifSrc, getYouTubeId, isInstagramUrl, isTikTokUrl, isDirectVideoUrl } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation or attached video; tap toggles to still frame or plays video.
// `compact` shrinks it (superset cards).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up.
export default function Media({ ex, id, compact, minimizable }) {
  const isGif = !!ex?.gif
  const [playing, setPlaying] = useState(isGif)
  const [failed, setFailed] = useState(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)

  if (!ex || (!ex.gif && !ex.url)) return null
  if (minimizable && gifSize === 'off') return null

  const mini = minimizable && gifSize === 'mini'
  const height = compact ? 120 : mini ? 84 : 320
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }

  // Custom exercise video URL
  if (!ex.gif && ex.url) {
    const ytId = getYouTubeId(ex.url)
    if (ytId) {
      if (playing) {
        return (
          <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} style={{ background: '#000' }}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1`}
              title={exerciseNameFor(ex)}
              style={{ width: '100%', height, border: 0, display: 'block' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
            {minimizable && (
              <button className="giftoggle" onClick={toggleSize}>
                <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
              </button>
            )}
          </div>
        )
      }
      return (
        <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} onClick={() => setPlaying(true)} style={{ cursor: 'pointer', background: '#000' }}>
          <img decoding="async" draggable={false} src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`} alt={exerciseNameFor(ex)} style={{ objectFit: 'cover' }} />
          {!mini && (
            <span className="gifhint">
              <Icon name="play" />{t('tap to play')}
            </span>
          )}
          {minimizable && (
            <button className="giftoggle" onClick={toggleSize}>
              <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
            </button>
          )}
        </div>
      )
    }

    if (isDirectVideoUrl(ex.url)) {
      return (
        <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} style={{ background: '#000' }}>
          <video src={ex.url} controls playsInline style={{ width: '100%', height, objectFit: 'contain', display: 'block' }} />
          {minimizable && (
            <button className="giftoggle" onClick={toggleSize}>
              <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
            </button>
          )}
        </div>
      )
    }

    const isIg = isInstagramUrl(ex.url)
    const isTt = isTikTokUrl(ex.url)
    let domain = ''
    try { domain = new URL(ex.url).hostname.replace(/^www\./, '') } catch {}

    const title = isIg ? t('Watch on Instagram') : isTt ? t('Watch on TikTok') : t('Watch video / guide')
    const iconName = isIg ? 'instagram' : isTt ? 'tiktok' : 'link'

    return (
      <div
        className={'exlink-card' + (compact ? ' compact' : '') + (mini ? ' mini' : '')}
        id={id}
        role="button"
        tabIndex={0}
        data-swipe-ignore
        onClick={() => window.open(ex.url, '_blank', 'noopener')}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            window.open(ex.url, '_blank', 'noopener')
          }
        }}
      >
        <div className={'exlink-icon' + (isIg ? ' ig' : isTt ? ' tt' : '')}>
          <Icon name={iconName} />
        </div>
        <div className="exlink-meta">
          <span className="exlink-title">{title}</span>
          {domain && <span className="exlink-sub">{domain}</span>}
        </div>
        <Icon name="chevronRight" className="exlink-arr" />
      </div>
    )
  }

  // Built-in catalog exercise animation
  const showGif = playing && failed == null
  const onError = () => setFailed(showGif ? 'gif' : 'all')
  const onTap = () => {
    if (failed) { setFailed(null); setPlaying(true); return }
    setPlaying(p => !p)
  }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '')} id={id} onClick={onTap}>
      {failed === 'all'
        ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : <img decoding="async" draggable={false} src={showGif ? gifSrc(ex) : imgSrc(ex)} alt={exerciseNameFor(ex)} onError={onError} />}
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

export function Thumb({ ex }) {
  const ytId = !ex?.img && ex?.url ? getYouTubeId(ex.url) : null
  if (ytId) return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={`https://img.youtube.com/vi/${ytId}/hqdefault.jpg`} alt="" />
  if (ex?.img) return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={imgSrc(ex)} alt="" />
  if (ex?.url && isInstagramUrl(ex.url)) return <div className="thumb thumb-x"><Icon name="instagram" /></div>
  if (ex?.url && isTikTokUrl(ex.url)) return <div className="thumb thumb-x"><Icon name="tiktok" /></div>
  if (ex?.url) return <div className="thumb thumb-x"><Icon name="play" /></div>
  return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
}


