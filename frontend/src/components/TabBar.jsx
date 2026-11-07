import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { dayApart, nextSessionIds } from '../lib/day-sessions.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed, { useElapsed } from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'
import { retapTab } from '../lib/scroll-top.js'
import { lensEdges, lensDir, nextMin } from '../lib/tabbar-glass.js'

// Module scope, not TabBar's render body. Declared inside it, `Tab` was a new function on every
// render, so React saw a different component type each time and threw the button away and built a
// fresh one — on a bar that is fixed on screen, and once a second for the whole of a rest. The
// state it took with it is the DOM node itself: focus, the :active tint, any in-flight transition.
// On the iPhone the bar is a tablist (two of them, Start sits between), and shrunk to a capsule
// the other three tabs leave the tab order and the one left says it brings them back.
function Tab({ active, icon, label, onClick, dot, tour, glass, i, min, shown }) {
  const name = glass && min && shown ? t('{0}, show all tabs', label) : label
  return (
    <button className={(glass ? 'gt ' : '') + (active ? 'on' : '')} onClick={onClick} data-tour={tour}
      aria-label={dot ? name + ', ' + t('Connection problem') : name !== label ? name : undefined}
      {...(glass && { role: 'tab', 'aria-selected': !!active, 'aria-posinset': i + 1, 'aria-setsize': 4, 'aria-expanded': min && shown ? false : undefined, inert: min && !shown, style: { '--k': i, '--o': i > 1 ? '64px' : '0px' } })}>
      <span className="tab-ic"><Icon name={icon} />{dot && <span className="tab-dot" aria-hidden="true" />}</span><span className={glass ? 'tl' : undefined}>{label}</span>
    </button>
  )
}

// The running workout's name for a screen reader, with the time in it. Its own component so the
// bar does not re-render every second (the same reason <Elapsed> is one).
function RunName({ start, pausedAt }) {
  return <span className="sr">{t('Resume workout, {0} elapsed', useElapsed(start, pausedAt))}</span>
}

// How long a press on Start is held before it opens the picker instead (#930).
export const START_HOLD_MS = 450

export default function TabBar({ onStart, onPick }) {
  const nav = useNavigate()
  const hold = useRef(null)
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  // With the connection banner switched off, a sync problem shows as a dot on Home, the tab
  // Settings lives under (#369, #330).
  const trouble = useConnectionTrouble()
  const cur = loc.pathname.split('/')[1] || 'home'
  // A screen without a tab of its own lights the tab it is opened from (Muscles from both).
  const PARENT = { history: 'stats', 'structural-balance': 'stats', tools: 'stats', 'progress-photos': 'stats', measurements: 'stats', settings: 'home', checkin: 'home', muscles: 'library', trainer: 'home' }
  const parent = cur === 'muscles' && loc.state?.from === '/stats' ? 'stats' : PARENT[cur]
  const on = k => cur === k || parent === k

  // The iPhone app gets the floating glass bar that shrinks to a capsule while you scroll down
  // (index.css, Liquid Glass G1). Everywhere else the bar below is the old one.
  const ios = document.documentElement.dataset.platform === 'ios'
  const [minAt, setMinAt] = useState(null)       // the page it was shrunk on: another page starts full
  const min = ios && minAt === loc.pathname
  const [vw, setVw] = useState(window.innerWidth)
  const [said, setSaid] = useState('')
  const barRef = useRef(null)
  const lens = useRef([])
  const lensAt = useRef(0)
  const was = useRef(null)
  const scr = useRef(null)
  const found = ['home', 'plan', 'stats', 'library'].findIndex(on)
  const idx = Math.max(found, 0)                 // no tab lit: the capsule still shows Home
  const rm = ios && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const ax = ios && parseFloat(getComputedStyle(document.documentElement).fontSize) >= 20   // Settings → Text size: Larger
  const dir = !was.current || was.current.min ? '' : lensDir(was.current.idx, idx)
  const expand = () => { if (scr.current) { scr.current.min = false; scr.current.acc = 0 } setMinAt(null) }

  useEffect(() => {
    if (!ios) return undefined
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [ios])

  // The page scrolls the window (App.jsx). A restored scroll position is not a gesture, so the
  // first moments on a page only record where it is.
  useEffect(() => {
    if (!ios) return undefined
    const s = scr.current = { min: false, acc: 0, last: window.scrollY, quiet: Date.now() + 150 }
    const onScroll = () => {
      const y = window.scrollY
      if (Date.now() < s.quiet) { s.last = y; return }
      const r = nextMin({ min: s.min, acc: s.acc, y, last: s.last, scrollMax: document.documentElement.scrollHeight - window.innerHeight })
      s.last = y; s.acc = r.acc
      if (r.min === s.min) return
      s.min = r.min
      // Focus on a tab that is about to go inert would be lost: it moves to the one that stays.
      if (r.min && document.activeElement?.classList.contains('gt')) barRef.current.querySelectorAll('.gt')[idx]?.focus({ preventScroll: true })
      setMinAt(r.min ? loc.pathname : null)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [ios, loc.pathname, idx])

  // The lens: two elements, each placed by its two edges (lib/tabbar-glass.js). Reduce Motion
  // fades the idle one in at the new place and the other out, so it never slides.
  useLayoutEffect(() => {
    if (!ios) return
    const before = was.current
    const key = vw + (ax ? 'x' : '')
    was.current = { idx, min, key }
    const [l, r] = lensEdges({ screenW: vw, tab: idx, min, ax })
    const els = lens.current, c = lensAt.current
    const set = e => { e.style.setProperty('--ll', l + 'px'); e.style.setProperty('--lr', r + 'px') }
    if (!before || before.key !== key || (rm && before.idx === idx)) {
      els.forEach((e, i) => { e.style.transition = 'none'; set(e); e.style.opacity = i === c ? 1 : 0 })
      void els[0].offsetWidth
      els.forEach(e => { e.style.transition = '' })
    } else if (rm) {
      set(els[c ^ 1]); els[c ^ 1].style.opacity = 1; els[c].style.opacity = 0; lensAt.current = c ^ 1
    } else set(els[c])
  }, [ios, idx, min, rm, ax, vw])

  // Starting a workout is said once, aloud; the running time is not (it would talk all session).
  const active = !!S.active
  const wasActive = useRef(active)
  useEffect(() => {
    if (!active || wasActive.current) { wasActive.current = active; return undefined }
    wasActive.current = true
    setSaid(t('Workout started'))
    const id = setTimeout(() => setSaid(''), 2000)
    return () => clearTimeout(id)
  }, [active])

  if (!user && !isGuest) return null

  // Root tabs are peers, not another level to unwind with Android Back. The tab you are already
  // on takes you to the top of its page instead (lib/scroll-top.js). Shrunk, a tap brings the bar back.
  const switchTab = path => {
    if (min) { expand(); return }
    if (loc.pathname !== path || loc.search) nav(path, { replace: true })
    else retapTab(path)
  }
  const tab = (i, k, icon, label, path, tour) =>
    <Tab key={k} i={i} glass={ios} min={min} shown={i === idx} active={on(k)} icon={icon} label={label} dot={k === 'home' && trouble} onClick={() => switchTab(path)} tour={tour} />
  const tabs = [
    tab(0, 'home', 'house', t('Home'), '/home', 'tab-home'),
    tab(1, 'plan', 'calendar', t('Plan'), '/plan', 'tab-plan'),
    tab(2, 'stats', 'chart', t('Stats'), '/stats', 'tab-stats'),
    tab(3, 'library', 'dumbbell', t('Exercises'), '/library', 'tab-library'),
  ]

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
    }, ios ? 500 : START_HOLD_MS)   // 500 ms is the iPhone's own long press
  }
  const holdEnd = () => { if (hold.current !== 'fired') { clearTimeout(hold.current); hold.current = null } }
  const startProps = {
    'data-tour': 'start', onClick: startWorkout,
    onPointerDown: holdStart, onPointerUp: holdEnd, onPointerLeave: holdEnd, onPointerCancel: holdEnd,
    onContextMenu: e => { if (!S.active && onPick) e.preventDefault() },
  }

  if (ios) {
    return (
      <nav id="tabbar" ref={barRef} className={[min && 'min', dir, rm && 'rm', ax && 'ax', found < 0 && 'none'].filter(Boolean).join(' ')}>
        <span className="lens" aria-hidden="true" ref={e => { lens.current[0] = e }} />
        <span className="lens" aria-hidden="true" ref={e => { lens.current[1] = e }} />
        <div role="tablist" aria-label={t('Sections')}>{tabs.slice(0, 2)}</div>
        {/* Start is an action, not a section: it sits between the two lists, outside both. Its
            name carries the word and the running time; the orb's own text is for the eye. */}
        <button {...startProps} className={'orb' + (S.active ? ' rec' : '')} aria-keyshortcuts="Shift+Enter"
          aria-label={S.active ? undefined : t('Start workout')}
          onKeyDown={e => { if (e.key === 'Enter' && e.shiftKey && !S.active && onPick) { e.preventDefault(); onPick() } }}>
          <span className="cir" aria-hidden="true">{running ? <span className="t"><Elapsed start={S.active.start} pausedAt={S.active.pausedAt} /></span> : <Icon name="play" />}</span>
          <span className="tl" aria-hidden={running || undefined}>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>
          {running && <RunName start={S.active.start} pausedAt={S.active.pausedAt} />}
        </button>
        {/* The long press has no keyboard, VoiceOver or Switch Control equivalent: this is it.
            Invisible until focused. */}
        {!S.active && onPick && <button className="alt" onClick={onPick}>{t('Choose routine')}</button>}
        <div role="tablist" aria-label={t('More sections')}>{tabs.slice(2)}</div>
        <span className="sr" role="status" aria-live="polite">{said}</span>
      </nav>
    )
  }

  return (
    <nav id="tabbar">
      {tabs[0]}
      {tabs[1]}
      {/* On the workout screen itself there is nothing to resume, so the button reads as the
          tab it is and stays lit (#29); anywhere else it brings you back to the exercise you
          were on — the marker is kept in S.active.cur and never moves on its own (#21). The
          glyph is always play: start and resume are one concept, and an exercise is a dumbbell.
          A live session you stepped away from shows its running time instead of a word, the
          button still named Resume; a past workout being edited or logged after the fact has no
          clock to run. */}
      <button {...startProps} className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')}
        aria-label={running ? t('Resume') : undefined}>
        <span className="cir"><Icon name="play" /></span>
        {running ? <span className="tab-time"><Elapsed start={S.active.start} pausedAt={S.active.pausedAt} /></span>
          : <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>}
      </button>
      {tabs[2]}
      {tabs[3]}
    </nav>
  )
}
