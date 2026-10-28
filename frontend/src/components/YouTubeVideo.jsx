import { useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { platformNow } from '../lib/platform-now.js'

// No iframe, thumbnail or YouTube request until the user chooses to watch. The card says where the
// video comes from, because that tap is the moment Google sees the phone's address
// (website/privacy.html). The player is youtube-nocookie.com, the only frame host the web image's
// CSP allows (web/Dockerfile). It asks for the origin as its referrer itself: the instance's page
// policy is same-origin, and YouTube's embed refuses to play without one (Error 153).
//
// The iPhone app opens the video in YouTube instead: its page origin is capacitor://localhost,
// which can't send a referrer at all.
export default function YouTubeVideo({ videoId, compact, mini }) {
  const [playing, setPlaying] = useState(false)
  const inline = platformNow() !== 'ios'
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
      onClick={e => { if (inline) { e.stopPropagation(); setPlaying(true) } else open(e) }}>
      <span className="exlink-icon"><Icon name="play" /></span>
      <span className="exlink-meta"><span className="exlink-title">{t('Watch video')}</span>
        {!mini && <span className="exlink-sub">{inline ? t('Plays from YouTube, and only once you tap') : t('Opens in YouTube')}</span>}</span>
      <Icon name="chevronRight" className="exlink-arr" />
    </button>}
  </div>
}
