import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import Icon from './Icon.jsx'

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const socialCount = useUI(s => s.socialCount)
  const setSocialCount = useUI(s => s.setSocialCount)
  useEffect(() => {
    if (!user) { setSocialCount(0); return }
    let gone = false
    const refresh = () => api('/api/social/counts').then(value => {
      if (!gone) setSocialCount(value.total)
    }).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { gone = true; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [user?.id, setSocialCount])
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (k === 'profile' && ['history', 'settings'].includes(cur))
    || (cur === 'muscles' && k === 'library')

  const startWorkout = () => {
    if (!S.active) {
      // A weekday can hold several routines; start the combined session if any of them has
      // exercises, otherwise fall through to the picker.
      if (effectiveRoutines(S, todayISO()).some(r => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }
  const Tab = ({ k, icon, to, label, badge = 0 }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      <span className="tab-icon"><Icon name={icon} />{badge > 0 && <b>{badge > 99 ? '99+' : badge}</b>}</span><span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      {/* On the workout screen itself there is nothing to resume, so the button reads as the
          tab it is and stays lit (#29); anywhere else it brings you back to the exercise you
          were on — the marker is kept in S.active.cur and never moves on its own (#21). */}
      <button className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? (cur === 'workout' ? 'dumbbell' : 'play') : 'dumbbell'} /></span>
        <span>{S.active ? (cur === 'workout' ? t('Workout') : t('Resume')) : t('Start')}</span>
      </button>
      <Tab k="profile" icon="personCircle" to="/profile" label={t('Profile')} badge={socialCount} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}
