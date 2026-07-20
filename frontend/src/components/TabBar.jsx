import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'

const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  plan: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></>,
  stats: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  library: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>
}

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home')

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    }
    nav('/workout')
  }
  const Icon = ({ k }) => <svg viewBox="0 0 24 24">{ICONS[k]}</svg>

  return (
    <nav id="tabbar">
      <button className={on('home') ? 'on' : ''} onClick={() => nav('/home')}><Icon k="home" /><span>Home</span></button>
      <button className={on('plan') ? 'on' : ''} onClick={() => nav('/plan')}><Icon k="plan" /><span>Plan</span></button>
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M2.5 9.5v5M21.5 9.5v5M6.5 12h11" /></svg></span>
        <span>{S.active ? 'Resume' : 'Start'}</span>
      </button>
      <button className={on('stats') ? 'on' : ''} onClick={() => nav('/stats')}><Icon k="stats" /><span>Stats</span></button>
      <button className={on('library') ? 'on' : ''} onClick={() => nav('/library')}><Icon k="library" /><span>Exercises</span></button>
    </nav>
  )
}
