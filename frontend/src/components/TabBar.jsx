import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Module scope, not TabBar's render body. Declared inside it, `Tab` was a new function on every
// render, so React saw a different component type each time and threw the button away and built a
// fresh one — on a bar that is fixed on screen, and once a second for the whole of a rest. The
// state it took with it is the DOM node itself: focus, the :active tint, any in-flight transition.
function Tab({ active, icon, label, onClick }) {
  return (
    <button className={active ? 'on' : ''} onClick={onClick}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )
}

// Home = today, Start = the workout launch point, Plan, Progress, Coach.
// Exercises lives on as a route (/library), reached from Start and the workout,
// not as a main tab.
export default function TabBar() {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k
    || (k === 'progress' && (cur === 'stats' || cur === 'history' || cur === 'structural-balance'))
    || (k === 'home' && cur === 'settings')
    || (k === 'start' && cur === 'workout')

  // The center button never starts anything by itself: it opens the Start
  // section, unless a session is already running, which it resumes in place.
  const goStart = () => {
    if (S.active) { nav('/workout'); return }
    nav('/start')
  }

  return (
    <nav id="tabbar">
      <Tab active={on('home')} icon="house" label={t('Home')} onClick={() => nav('/home')} />
      <Tab active={on('plan')} icon="calendar" label={t('Plan')} onClick={() => nav('/plan')} />
      {/* On the workout screen itself there is nothing to resume, so the button reads as the
          tab it is and stays lit (#29); anywhere else it brings you back to the exercise you
          were on — the marker is kept in S.active.cur and never moves on its own (#21). */}
      <button className={'start' + (S.active ? ' rec' : '') + ((S.active && cur === 'workout') || cur === 'start' ? ' on' : '')} onClick={goStart}>
        <span className="cir"><Icon name={S.active ? (cur === 'workout' ? 'dumbbell' : 'play') : 'dumbbell'} /></span>
        <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>
      </button>
      <Tab active={on('progress')} icon="chart" label={t('Progress')} onClick={() => nav('/progress')} />
      <Tab active={on('coach')} icon="sparkles" label={t('Coach')} onClick={() => nav('/coach')} />
    </nav>
  )
}
