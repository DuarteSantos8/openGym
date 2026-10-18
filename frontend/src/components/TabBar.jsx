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
  const text = useFit(label)
  return (
    <button className={active ? 'on' : ''} onClick={onClick} aria-label={dot ? label + ', ' + t('Connection problem') : undefined}>
      <span className="tab-ic"><Icon name={icon} />{dot && <span className="tab-dot" aria-hidden="true" />}</span><span ref={text}>{label}</span>
    </button>
  )
}

// Seven tabs share a phone's width, and a long name ("Impostazioni", "Einstellungen") is wider than
// its tab. Rather than cut it, its text is set a little smaller until it fits, never below 8px;
// every other tab keeps the bar's size. Measured again whenever the name changes (the language).
function useFit(label) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.fontSize = ''
    const room = el.clientWidth, need = el.scrollWidth
    if (!room || need <= room) return
    const size = parseFloat(getComputedStyle(el).fontSize) || 10
    // Two pixels to spare: the widths are whole pixels, the text is not.
    el.style.fontSize = Math.max(8, Math.floor(size * (room - 2) / need * 10) / 10) + 'px'
  }, [label])
  return ref
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
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'muscles' && k === 'library') || (cur === 'structural-balance' && k === 'stats')

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
    <nav id="tabbar">
      {/* Three tabs, Start in the middle, three tabs: Settings has its own place instead of a gear
          on Home. */}
      <Tab active={on('home')} icon="house" label={t('Home')} onClick={() => nav('/home')} />
      <Tab active={on('plan')} icon="calendar" label={t('Plan')} onClick={() => nav('/plan')} />
      <Tab active={on('stats')} icon="chart" label={t('Stats')} onClick={() => nav('/stats')} />
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
      <Tab active={on('health')} icon="heart" label={t('Health')} onClick={() => nav('/health')} />
      <Tab active={on('library')} icon="dumbbell" label={t('Exercises')} onClick={() => nav('/library')} />
      <Tab active={on('settings')} icon="gear" label={t('Settings')} dot={trouble} onClick={() => nav('/settings')} />
    </nav>
  )
}
