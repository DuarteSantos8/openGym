import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { slotOf, TABS, workoutRunning } from '../lib/tab-route.js'
import { isSwitching, popToRoot, switchTab } from '../lib/use-tab-nav.js'
import Icon from './Icon.jsx'

// Module scope, not TabBar's render body. Declared inside it, `Tab` was a new function on every
// render, so React saw a different component type each time and threw the button away and built a
// fresh one — on a bar that is fixed on screen, and once a second for the whole of a rest. The
// state it took with it is the DOM node itself: focus, the :active tint, any in-flight transition.
function Tab({ active, icon, label, live, onClick }) {
  return (
    <button className={active ? 'on' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}
      aria-label={live ? t('{0}, workout in progress', label) : undefined}>
      <span className="tab-ic"><Icon name={icon} />{live && <span className="live-dot" aria-hidden="true" />}</span><span>{label}</span>
    </button>
  )
}

const LOOK = {
  home: ['house', () => t('Home')],
  train: ['dumbbell', () => t('Training')],
  food: ['utensils', () => t('Nutrition')],
  progress: ['chart', () => t('Progress')],
}

// The pill animates only once its first paint is two frames behind it, so it never slides in on
// a launch or a deep link: it mounts where it belongs.
export function useSlideReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setReady(true)) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [])
  return ready
}

// The lit tab's pill: one slot wide, moved by transform only, never onto the + slot. A move from
// one side of the + to the other jumps there and fades in rather than passing under the disc
// (`jumps` remounts the pill to replay the fade). With no tab lit (a page every tab can open) it
// fades out where it is and comes back from there. The previous slot is kept as state, adjusted
// while rendering (React's "storing information from previous renders"), not in a ref.
function TabPill({ active }) {
  const ready = useSlideReady()
  const lit = active >= 0
  const [pos, setPos] = useState(() => ({ slot: slotOf(Math.max(0, active)), jump: false, jumps: 0 }))
  const slot = lit ? slotOf(active) : pos.slot
  if (slot !== pos.slot) {
    const jump = (pos.slot < 2) !== (slot < 2)
    setPos({ slot, jump, jumps: pos.jumps + (jump ? 1 : 0) })
  }
  return (
    <span className={'tab-pill-track' + (ready ? ' ready' : '')} aria-hidden="true">
      <span className={'tab-pill-slot' + (lit ? '' : ' off') + (pos.jump ? ' jump' : '')} style={{ '--slot': slot }}>
        <span key={pos.jumps} className="tab-pill" />
      </span>
    </span>
  )
}

// `tab` is the tab on screen (lib/use-tab-nav.js) and `lit` whether the page is one of its own:
// a page every tab can open (Profile, the workout) sits on a tab but lights none.
export default function TabBar({ tab, lit, onPlus }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const active = lit ? TABS.indexOf(tab) : -1
  const live = workoutRunning(S)
  // The tab on screen again: back to its root. Another one: its own stack, where it was left.
  const go = target => { if (!isSwitching()) (target === tab ? popToRoot(target) : switchTab(target)) }
  const tabs = TABS.map((key, i) => (
    <Tab key={key} active={active === i} icon={LOOK[key][0]} label={LOOK[key][1]()} live={key === 'train' && live}
      onClick={() => go(key)} />
  ))

  return (
    <nav id="tabbar" aria-label={t('Main navigation')}>
      <TabPill active={active} />
      {tabs.slice(0, 2)}
      {/* The + opens the logging sheet on every tab. It is never a page of its own, so never lit,
          and it stays the accent while a workout runs: the dock and the Training dot say that. */}
      <button className="start" onClick={() => { if (!isSwitching()) onPlus() }} aria-haspopup="dialog" aria-label={t('Add')}>
        <span className="cir"><Icon name="plus" /></span>
      </button>
      {tabs.slice(2)}
    </nav>
  )
}
