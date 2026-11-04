import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { shownSource } from '../lib/music/index.js'
import MusicBar from './MusicBar.jsx'

/**
 * The music bar on every screen with the tab bar, docked just above it (App.jsx): the same bar as
 * in the workout's header, so the next song is a tap away anywhere in the app. It steps aside while
 * a rest or a timed set is counting, whose bar takes that place, and is gone while Settings →
 * Features has the bar turned off, or while the player is not connected yet.
 */
export default function MusicDock() {
  const S = useStore(s => s.S)
  const counting = useUI(s => !!(s.timer || s.work))
  const source = shownSource(S)
  // A player not connected (Spotify) or not allowed (Apple Music) leaves no card on every page
  // asking to connect it: the bar stays mounted, asking now and then, and shows once it answers.
  // Held per player, so another player chosen starts out shown.
  const [blockedFor, setBlockedFor] = useState('')
  const on = !!source && !counting && blockedFor !== source
  // The page keeps room at its bottom for it (index.css body.has-music-dock), as for the rest bar.
  useEffect(() => {
    document.body.classList.toggle('has-music-dock', on)
    return () => document.body.classList.remove('has-music-dock')
  }, [on])
  if (!source || counting) return null
  return <div className="music-dock" hidden={!on}><MusicBar source={source} onBlocked={b => setBlockedFor(b ? source : '')} hideBlocked /></div>
}
