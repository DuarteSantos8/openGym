import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { dayApart, nextSessionIds } from '../lib/day-sessions.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import BrandLogo from './BrandLogo.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'
import { retapTab } from '../lib/scroll-top.js'
import './TabBar.css'

// Module scope, not TabBar's render body. Declared inside it, `Tab` was a new function on every
// render, so React saw a different component type each time and threw the button away and built a
// fresh one — on a bar that is fixed on screen, and once a second for the whole of a rest. The
// state it took with it is the DOM node itself: focus, the :active tint, any in-flight transition.
function Tab({ active, icon, label, onClick, dot, tour }) {
  return (
    <button className={active ? 'on' : ''} onClick={onClick} data-tour={tour} aria-current={active ? 'page' : undefined} aria-label={dot ? label + ', ' + t('Connection problem') : undefined}>
      <span className="tab-ic"><Icon name={icon} />{dot && <span className="tab-dot" aria-hidden="true" />}</span><span>{label}</span>
    </button>
  )
}

// How long a press on Start is held before it opens the picker instead (#930).
export const START_HOLD_MS = 450

export default function TabBar({ onStart, onPick }) {
  const nav = useNavigate()
  const hold = useRef(null)
  const bar = useRef(null)
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const shown = !!user || isGuest
  useEffect(() => {
    const el = bar.current
    if (!shown || !el) return undefined
    const root = document.documentElement
    const measure = () => {
      const box = el.getBoundingClientRect()
      const start = el.querySelector('.start').getBoundingClientRect()
      const height = box.bottom - Math.min(box.top, start.top)
      // The rendered height already includes the safe-area padding. Only replace the fallback
      // once there is a real box, so a hidden first render cannot collapse the page offset.
      if (height > 0) root.style.setProperty('--tabbar-height', height + 'px')
    }
    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el, { box: 'border-box' })
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      root.style.removeProperty('--tabbar-height')
    }
  }, [shown])
  // With the connection banner switched off, a sync problem shows as a dot on Today (the /home
  // route), the tab Settings lives under (#369, #330).
  const trouble = useConnectionTrouble()
  if (!shown) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  // A screen without a tab of its own lights the tab it is opened from (Muscles from both).
  const PARENT = { history: 'stats', 'structural-balance': 'stats', tools: 'stats', 'progress-photos': 'stats', measurements: 'stats', settings: 'home', checkin: 'home', muscles: 'library', trainer: 'home' }
  const parent = cur === 'muscles' && loc.state?.from === '/stats' ? 'stats' : PARENT[cur]
  const on = k => cur === k || parent === k

  // Root tabs are peers, not another level to unwind with Android Back. The tab you are already
  // on takes you to the top of its page instead (lib/scroll-top.js).
  const switchTab = path => {
    if (loc.pathname !== path || loc.search) nav(path, { replace: true })
    else retapTab(path)
  }

  const running = !!S.active && cur !== 'workout' && !S.active.editingWorkoutId && !S.active.backfill && S.active.start > 0
  const startWorkout = () => {
    // The press was held: the picker is open already, and this click is its release.
    if (hold.current === 'fired') { hold.current = null; return }
    if (!S.active) {
      // Settings → Workout → Start button (#930): every tap asks which workout.
      if (S.startPick === 'ask' && onPick) { onPick(); return }
      // A day trained separately (#908) starts its next session not done yet.
      if (dayApart(S, todayISO())) {
        const ids = nextSessionIds(S, todayISO())
        if (ids) { onStart(ids); return }
      // A weekday can hold several routines; start the combined session if any of them has
      // exercises, otherwise fall through to the picker.
      } else if (effectiveRoutines(S, todayISO()).some(r => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }
  // A long press on Start opens the picker (#930): today's plan on top, everything else below.
  // A tap still does what Start always did. Only with no workout running.
  const holdStart = () => {
    if (S.active || !onPick) return
    clearTimeout(hold.current)
    hold.current = setTimeout(() => {
      hold.current = 'fired'
      try { navigator.vibrate?.(10) } catch { /* no vibration here */ }
      onPick()
    }, START_HOLD_MS)
  }
  const holdEnd = () => { if (hold.current !== 'fired') { clearTimeout(hold.current); hold.current = null } }

  return (
    <nav id="tabbar" ref={bar}>
      <BrandLogo size={28} className="tabbar-brand" />
      {/* Ironvane: Today · Plan · Start · Library · Progress. The routes keep their names (/home,
          /stats, /library), so links, shortcuts, the tour and back buttons still land; Library sits
          next to Start because it is opened mid-workout, Progress at the edge, checked least. */}
      <Tab active={on('home')} icon="house" label={t('Today')} dot={trouble} onClick={() => switchTab('/home')} tour="tab-home" />
      <Tab active={on('plan')} icon="calendar" label={t('Plan')} onClick={() => switchTab('/plan')} tour="tab-plan" />
      {/* On the workout screen itself there is nothing to resume, so the button reads as the
          tab it is and stays lit (#29); anywhere else it brings you back to the exercise you
          were on — the marker is kept in S.active.cur and never moves on its own (#21). The
          glyph is always play: start and resume are one concept, and an exercise is a dumbbell.
          A live session you stepped away from shows its running time alongside its stable
          Resume label; a past workout being edited or logged after the fact has no
          clock to run. */}
      <button data-tour="start" className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={startWorkout}
        onPointerDown={holdStart} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd}
        onContextMenu={e => { if (!S.active && onPick) e.preventDefault() }}
        aria-current={S.active && cur === 'workout' ? 'page' : undefined}>
        <span className="cir"><Icon name="play" /></span>
        {running ? <span className="tab-resume">{t('Resume')} <span className="tab-time" aria-hidden="true"><Elapsed start={S.active.start} pausedAt={S.active.pausedAt} /></span></span>
          : <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>}
      </button>
      <Tab active={on('library')} icon="dumbbell" label={t('Library')} onClick={() => switchTab('/library')} tour="tab-library" />
      <Tab active={on('stats')} icon="chart" label={t('Progress')} onClick={() => switchTab('/stats')} tour="tab-stats" />
    </nav>
  )
}
