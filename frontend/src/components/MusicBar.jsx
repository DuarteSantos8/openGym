import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { nowPlaying, control } from '../lib/music/index.js'
import Icon from './Icon.jsx'

// How often what plays is asked again while the workout is on screen. A song changes rarely, and
// a tap asks again at once (REFRESH after the player had time to act on it).
const POLL = 5000
const REFRESH = 700

const PROBLEM = {
  auth: () => t('Connect Spotify in Settings → Features.'),
  premium: () => t('Spotify Premium is needed to control the music.'),
  device: () => t('Start Spotify on one of your devices first.'),
  denied: () => t('Allow openGym to use Apple Music in the iPhone settings.'),
  failed: () => t('The music player did not answer.'),
}

/**
 * What plays, under the workout's header, with previous / play-pause / next (S.music, Settings →
 * Features → Music player). Asked every few seconds while the page is visible, never in the
 * background. A problem it cannot get past (not connected, no Premium) is said in the bar instead
 * of the song; one that may pass (no answer) keeps the last song and tries again — or, before any
 * song came, says so, rather than leave an empty bar holding its place above the tab bar.
 */
export default function MusicBar({ source, onBlocked, hideBlocked = false }) {
  const [track, setTrack] = useState(undefined)   // undefined: not asked yet; null: nothing plays
  const [problem, setProblem] = useState('')
  const timer = useRef(null)
  const alive = useRef(true)
  const answered = useRef(false)

  const ask = () => {
    clearTimeout(timer.current)
    if (document.visibilityState === 'hidden') return
    nowPlaying(source).then(
      tr => { if (!alive.current) return; answered.current = true; setTrack(tr); setProblem('') },
      e => {
        if (!alive.current) return
        if (e.code === 'auth' || e.code === 'denied') { setProblem(e.code); setTrack(null) }
        else if (!answered.current) setProblem('failed')
      }
    ).finally(() => { if (alive.current) timer.current = setTimeout(ask, POLL) })
  }

  useEffect(() => {
    alive.current = true
    answered.current = false
    setTrack(undefined); setProblem('')
    ask()
    const onVis = () => { if (document.visibilityState === 'visible') ask() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive.current = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVis) }
  }, [source])

  const act = action => {
    // The button answers at once; the next answer from the player says how it really went.
    if (action === 'play' || action === 'pause') setTrack(tr => tr ? { ...tr, playing: action === 'play' } : tr)
    control(source, action).then(
      () => setProblem(''),
      e => setProblem(e.code in PROBLEM ? e.code : 'failed')
    ).finally(() => { clearTimeout(timer.current); timer.current = setTimeout(ask, REFRESH) })
  }

  const blocked = problem === 'auth' || problem === 'denied'
  // The dock (MusicDock) says nothing about a player not connected yet: it keeps asking, hidden,
  // and shows once the player answers. The workout's own bar still says how to connect it.
  useEffect(() => { onBlocked?.(blocked) }, [blocked])
  if (track === undefined && !problem) return null
  if (blocked && hideBlocked) return null
  const playing = !!track?.playing
  const name = source === 'apple' ? 'Apple Music' : 'Spotify'
  const line1 = blocked || track === undefined ? name : track?.title || (track ? name : t('Nothing playing'))
  const line2 = problem ? PROBLEM[problem]() : track ? track.artist : name
  return <div className="musicbar" role="group" aria-label={t('Music')}>
    {track?.art ? <img className="mb-art" src={track.art} alt="" /> : <span className="mb-art"><Icon name="music" /></span>}
    <div className="mb-txt">
      <div className="mb-title">{line1}</div>
      <div className={'mb-sub' + (problem ? ' warn' : '')}>{line2}</div>
    </div>
    {!blocked && <div className="mb-acts">
      <button type="button" className="iconbtn" aria-label={t('Previous track')} onClick={() => act('previous')}><Icon name="skipBack" /></button>
      <button type="button" className="iconbtn mb-play" aria-label={playing ? t('Pause') : t('Play music')} onClick={() => act(playing ? 'pause' : 'play')}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <button type="button" className="iconbtn" aria-label={t('Next track')} onClick={() => act('next')}><Icon name="skipForward" /></button>
    </div>}
  </div>
}
