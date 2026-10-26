import { useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// No iframe, thumbnail or YouTube request until the user chooses to watch.
export default function YouTubeVideo({ videoId, compact, mini }) {
  const [playing, setPlaying] = useState(false)
  const open = e => {
    e.stopPropagation()
    window.open('https://www.youtube.com/watch?v=' + videoId, '_blank', 'noopener,noreferrer')
  }
  return <div className={'youtube-video' + (compact ? ' compact' : '')} data-swipe-ignore>
    {playing ? <>
      <iframe title={t('Watch video') + ' · YouTube'}
        src={'https://www.youtube-nocookie.com/embed/' + videoId + '?autoplay=1&playsinline=1'}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin" />
      <div className="youtube-actions">
        <button type="button" className="btn sm" onClick={e => { e.stopPropagation(); setPlaying(false) }}>{t('Close')}</button>
        <button type="button" className="btn sm" onClick={open}>{t('Open link')} · YouTube</button>
      </div>
    </> : <button type="button" className={'exlink-card' + (mini ? ' mini' : '')}
      onClick={e => { e.stopPropagation(); setPlaying(true) }}>
      <span className="exlink-icon"><Icon name="play" /></span>
      <span className="exlink-meta"><span className="exlink-title">{t('Watch video')}</span>
        {!mini && <span className="exlink-sub">YouTube</span>}</span>
      <Icon name="chevronRight" className="exlink-arr" />
    </button>}
  </div>
}
