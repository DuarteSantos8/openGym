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
  // Bumped when the player changes and when the bar goes: whatever was started before (a poll, a
  // tap) checks it when it ends, and changes nothing if it no longer matches.
  const life = useRef(0)
  // One poll at a time: the life of the poll in flight (-1: none), and whether another was asked
  // for meanwhile (the page shown again, a tap), which then follows at once instead of in POLL.
  const polling = useRef(-1)
  const wanted = useRef(false)
  const answered = useRef(false)

  const ask = () => {
    const my = life.current
    clearTimeout(timer.current)
    if (document.visibilityState === 'hidden') return
    if (polling.current === my) { wanted.current = true; return }
    polling.current = my
    nowPlaying(source).then(
      tr => { if (my !== life.current) return; answered.current = true; setTrack(tr); setProblem('') },
      e => {
        if (my !== life.current) return
        if (e.code === 'auth' || e.code === 'denied') { setProblem(e.code); setTrack(null) }
        else if (!answered.current) setProblem('failed')
      }
    ).finally(() => {
      if (polling.current === my) polling.current = -1
      if (my !== life.current) return
      const soon = wanted.current
      wanted.current = false
      clearTimeout(timer.current)
      timer.current = setTimeout(ask, soon ? 0 : POLL)
    })
  }

  useEffect(() => {
    life.current++
    wanted.current = false
    answered.current = false
    setTrack(undefined); setProblem('')
    ask()
    const onVis = () => { if (document.visibilityState === 'visible') ask() }
    document.addEventListener('visibilitychange', onVis)
    return () => { life.current++; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVis) }
  }, [source])

  const act = action => {
    const my = life.current
    // The button answers at once; the next answer from the player says how it really went.
    if (action === 'play' || action === 'pause') setTrack(tr => tr ? { ...tr, playing: action === 'play' } : tr)
    control(source, action).then(
      () => { if (my === life.current) setProblem('') },
      e => { if (my === life.current) setProblem(e.code in PROBLEM ? e.code : 'failed') }
    ).finally(() => {
      if (my !== life.current) return
      clearTimeout(timer.current)
      timer.current = setTimeout(ask, REFRESH)
    })
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
