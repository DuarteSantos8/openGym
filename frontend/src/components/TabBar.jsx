import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'

// Module scope, not TabBar's render body. Declared inside it, `Tab` was a new function on every
// render, so React saw a different component type each time and threw the button away and built a
// fresh one — on a bar that is fixed on screen, and once a second for the whole of a rest. The
// state it took with it is the DOM node itself: focus, the :active tint, any in-flight transition.
function Tab({ active, icon, label, onClick, dot }) {
  return (
    <button className={active ? 'on' : ''} onClick={onClick} aria-label={dot ? label + ', ' + t('Connection problem') : undefined}>
      <span className="tab-ic"><Icon name={icon} />{dot && <span className="tab-dot" aria-hidden="true" />}</span><span className="tab-l">{label}</span>
    </button>
  )
}

// Seven tabs share a phone's width, and a long name ("Impostazioni", "Einstellungen") is wider than
// its tab. Rather than cut it, the names are set a little smaller until the longest fits, never
// below 8px: all of them together (--tab-fs), so the bar keeps one size of type instead of a
// different one under each icon. Measured again when the names change (the language) or the bar's
// width does (a phone turned sideways).
function useFitLabels(ref, key) {
  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar) return
    const fit = () => {
      bar.style.removeProperty('--tab-fs')
      let size = 0, scale = 1
      for (const el of bar.querySelectorAll('.tab-l')) {
        size = size || parseFloat(getComputedStyle(el).fontSize) || 10
        const room = el.clientWidth, need = el.scrollWidth
        // Two pixels to spare: the widths are whole pixels, the text is not.
        if (room && need > room) scale = Math.min(scale, (room - 2) / need)
      }
      if (scale < 1) bar.style.setProperty('--tab-fs', Math.max(8, Math.floor(size * scale * 10) / 10) + 'px')
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    let w = bar.clientWidth
    const ro = new ResizeObserver(() => { if (bar.clientWidth !== w) { w = bar.clientWidth; fit() } })
    ro.observe(bar)
    return () => ro.disconnect()
  }, [key])
}

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  // With the connection banner switched off, a sync problem shows as a dot on Settings, where the
  // connection lives (#369, #330).
  const trouble = useConnectionTrouble()
  const barRef = useRef(null)
  useFitLabels(barRef, [t('Home'), t('Plan'), t('Stats'), t('Health'), t('Exercises'), t('Settings')].join('|'))
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  // A screen without a tab of its own lights the tab it is opened from (Muscles from both).
  // Settings has a tab of its own here.
  const PARENT = { history: 'stats', 'structural-balance': 'stats', 'progress-photos': 'stats', measurements: 'stats', checkin: 'home', muscles: 'library' }
  const parent = cur === 'muscles' && loc.state?.from === '/stats' ? 'stats' : PARENT[cur]
  const on = k => cur === k || parent === k

  // Root tabs are peers, not another level to unwind with Android Back.
  const switchTab = path => {
    if (loc.pathname !== path || loc.search) nav(path, { replace: true })
  }

  const running = !!S.active && cur !== 'workout' && !S.active.editingWorkoutId && !S.active.backfill && S.active.start > 0
  const startWorkout = () => {
    if (!S.active) {
      // A weekday can hold several routines; start the combined session if any of them has
      // exercises, otherwise fall through to the picker.
      if (effectiveRoutines(S, todayISO()).some(r => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }

  return (
    <nav id="tabbar" ref={barRef}>
      {/* Three tabs, Start in the middle, three tabs: Settings has its own place instead of a gear
          on Home. */}
      <Tab active={on('home')} icon="house" label={t('Home')} onClick={() => switchTab('/home')} />
      <Tab active={on('plan')} icon="calendar" label={t('Plan')} onClick={() => switchTab('/plan')} />
      <Tab active={on('stats')} icon="chart" label={t('Stats')} onClick={() => switchTab('/stats')} />
      {/* On the workout screen itself there is nothing to resume, so the button reads as the
          tab it is and stays lit (#29); anywhere else it brings you back to the exercise you
          were on — the marker is kept in S.active.cur and never moves on its own (#21). The
          glyph is always play: start and resume are one concept, and an exercise is a dumbbell.
          A live session you stepped away from shows its running time instead of a word, the
          button still named Resume; a past workout being edited or logged after the fact has no
          clock to run. */}
      <button className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={startWorkout}
        aria-label={running ? t('Resume') : undefined}>
        <span className="cir"><Icon name="play" /></span>
        {running ? <span className="tab-time"><Elapsed start={S.active.start} /></span>
          : <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>}
      </button>
      <Tab active={on('health')} icon="heart" label={t('Health')} onClick={() => switchTab('/health')} />
      <Tab active={on('library')} icon="dumbbell" label={t('Exercises')} onClick={() => switchTab('/library')} />
      <Tab active={on('settings')} icon="gear" label={t('Settings')} dot={trouble} onClick={() => switchTab('/settings')} />
    </nav>
  )
}
