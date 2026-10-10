import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'

function Tab({ active, icon, label, onClick, dot }) {
  return (
    <button className={active ? 'on' : ''} onClick={onClick} aria-label={dot ? label + ', ' + t('Connection problem') : undefined}>
      <span className="tab-ic">
        <Icon name={icon} />
        {dot && <span className="tab-dot" aria-hidden="true" />}
        <span>{label}</span>
      </span>
    </button>
  )
}

export default function GlassTabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const trouble = useConnectionTrouble()

  const barRef = useRef(null)
  const indicatorRef = useRef(null)
  const tabsRef = useRef([])
  const [hidden, setHidden] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragOffset = useRef(0)

  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home') || (cur === 'muscles' && k === 'library') || (cur === 'structural-balance' && k === 'stats')

  const running = !!S.active && cur !== 'workout' && !S.active.editingWorkoutId && !S.active.backfill && S.active.start > 0
  const isWorkoutScreen = cur === 'workout'

  const startWorkout = () => {
    if (!S.active) {
      if (effectiveRoutines(S, todayISO()).some(r => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }

  const measure = useCallback(() => {
    const bar = barRef.current
    const ind = indicatorRef.current
    if (!bar || !ind) return
    const tabs = tabsRef.current.filter(Boolean)
    const barRect = bar.getBoundingClientRect()
    const idx = tabs.findIndex(el => el.classList.contains('on'))
    if (idx < 0 || !tabs[idx]) {
      ind.style.opacity = '0'
      return
    }
    const rect = tabs[idx].getBoundingClientRect()
    const x = rect.left - barRect.left + rect.width / 2
    ind.style.opacity = '1'
    ind.style.transform = `translateX(${x - rect.width / 2}px)`
    ind.style.width = `${rect.width}px`
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [cur, measure])

  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (barRef.current) ro.observe(barRef.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [measure])

  useEffect(() => {
    if (isWorkoutScreen) {
      setHidden(true)
      return
    }
    let lastY = 0
    const onScroll = () => {
      const y = window.scrollY
      if (y > lastY && y > 80) setHidden(true)
      else if (y < lastY) setHidden(false)
      lastY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isWorkoutScreen])

  const onPointerDown = (e) => {
    if (!barRef.current) return
    setDragging(true)
    dragStartX.current = e.clientX
    dragOffset.current = 0
    barRef.current.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    if (!dragging || !indicatorRef.current || !barRef.current) return
    const dx = e.clientX - dragStartX.current
    const bar = barRef.current.getBoundingClientRect()
    const tabs = tabsRef.current.filter(Boolean)
    const idx = tabs.findIndex(el => el.classList.contains('on'))
    if (idx < 0 || !tabs[idx]) return
    const rect = tabs[idx].getBoundingClientRect()
    const center = rect.left - bar.left + rect.width / 2
    const maxDrag = bar.width * 0.35
    const clamped = Math.max(-maxDrag, Math.min(maxDrag, dx))
    indicatorRef.current.style.transform = `translateX(${center - rect.width / 2 + clamped}px)`
    indicatorRef.current.style.width = `${rect.width * 1.08}px`
  }

  const onPointerUp = (e) => {
    if (!dragging) return
    setDragging(false)
    const dx = e.clientX - dragStartX.current
    const bar = barRef.current.getBoundingClientRect()
    const tabs = tabsRef.current.filter(Boolean)
    const idx = tabs.findIndex(el => el.classList.contains('on'))
    if (idx < 0) return
    const threshold = bar.width * 0.18
    let next = idx
    if (dx < -threshold && idx < tabs.length - 1) next = idx + 1
    if (dx > threshold && idx > 0) next = idx - 1
    if (next !== idx && tabs[next]) {
      const routes = ['/home', '/plan', '/workout', '/stats', '/library']
      nav(routes[next] || '/home')
    }
    setTimeout(measure, 180)
  }

  if (!user && !isGuest) return null

  return (
    <nav
      id="tabbar"
      ref={barRef}
      className={['glass','glass--strong','glass--pill','glass--refract',hidden&&'tabbar-hidden-1'].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={t('Navigation')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={indicatorRef} className="tab-indicator" aria-hidden="true" />
      <div className="tab-list">
        <span ref={el => tabsRef.current[0] = el}><Tab active={on('home')} icon="house" label={t('Home')} dot={trouble} onClick={() => nav('/home')} /></span>
        <span ref={el => tabsRef.current[1] = el}><Tab active={on('plan')} icon="calendar" label={t('Plan')} onClick={() => nav('/plan')} /></span>
        <button
          ref={el => tabsRef.current[2] = el}
          className={'start' + (S.active ? ' rec' : '') + (S.active && isWorkoutScreen ? ' on' : '')}
          onClick={startWorkout}
          aria-label={running ? t('Resume') : undefined}
        >
          <span className="cir"><Icon name="play" /></span>
          {running ? <span className="tab-time"><Elapsed start={S.active.start} /></span>
            : <span>{S.active ? (isWorkoutScreen ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>}
        </button>
        <span ref={el => tabsRef.current[3] = el}><Tab active={on('stats')} icon="chart" label={t('Stats')} onClick={() => nav('/stats')} /></span>
        <span ref={el => tabsRef.current[4] = el}><Tab active={on('library')} icon="dumbbell" label={t('Exercises')} onClick={() => nav('/library')} /></span>
      </div>
    </nav>
  )
}
