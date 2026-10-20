import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { shownSource } from '../lib/music/index.js'
import MusicBar from './MusicBar.jsx'

/**
 * The music bar on every screen with the tab bar, docked just above it (App.jsx): the same bar as
 * in the workout's header, so the next song is a tap away anywhere in the app. It steps aside while
 * a rest or a timed set is counting, whose bar takes that place, and is gone while Settings →
 * Features has the bar turned off.
 */
export default function MusicDock() {
  const S = useStore(s => s.S)
  const counting = useUI(s => !!(s.timer || s.work))
  const source = shownSource(S)
  const on = !!source && !counting
  // The page keeps room at its bottom for it (index.css body.has-music-dock), as for the rest bar.
  useEffect(() => {
    document.body.classList.toggle('has-music-dock', on)
    return () => document.body.classList.remove('has-music-dock')
  }, [on])
  if (!on) return null
  return <div className="music-dock"><MusicBar source={source} /></div>
}
