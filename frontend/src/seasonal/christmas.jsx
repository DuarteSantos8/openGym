import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import { seasonNow } from '../lib/season-clock.js'
import {
  DOORS, LAYOUT, OPEN_DEG, inAdvent, adventOpenable, adventOf, doorState, openDoor, markDone, nextDoor,
  countReps, repsDone, adventLit, treeOf, dragAngle, releaseOpens, springStep, springSettled,
} from '../lib/advent.js'
import { MOBILE } from '../lib/mobile.js'
import { appIconState, setAppIcon } from '../lib/app-icon.js'
import { yearStats, workoutsOfYear } from '../lib/wrapped.js'
import { openWrapped } from '../lib/wrapped-ui.js'
import { bestWeightForEntry, defaultConfig } from '../lib/history.js'
import { buildSessionEntry } from '../lib/session-start.js'
import { joinSessionNoProg } from '../lib/session-noprog.js'
import { closeThenNav } from '../lib/nav.js'
import { isOn } from '../lib/modules.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { FESTIVE_FLAME } from '../lib/streak-icons.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText, fmtDur, fmtNum, fmtVol, todayISO, uid } from '../lib/format.js'
import { shownWeight, exUnitOf } from '../lib/ex-unit.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from '../components/Icon.jsx'
import Glyph, { splitEmoji } from '../components/Glyph.jsx'
import { Button } from '../components/ui.jsx'
import { doorFor, finisherMinutes, REINDEER_KG, STRETCH } from './advent-doors.js'
import './christmas.css'

/* Christmas (v1.4.4), fetched only while the theme shows (components/Seasonal.jsx), with the
   advent calendar (lib/advent.js, seasonal/advent-doors.js). Like Halloween: hand-drawn inline
   SVG, moved with transforms and opacity only, every animation with an end, and everything
   aria-hidden and letting taps through except the present, Rudolph's nose and the calendar. The
   snow goes behind the page (z-index -1), so it can never sit on a button; Santa's team flies
   over it for a few seconds now and then, lets every tap through and leaves at the first touch. */

/* ---------------------------------------------------------------- art -- */

const Flake = () => (
  <svg className="xm-flakesvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M12 5.5 9.8 3.6M12 5.5l2.2-1.9M12 18.5l-2.2 1.9M12 18.5l2.2 1.9M5.6 8.3 5 5.5M5.6 8.3 2.8 9.2M18.4 15.7l.6 2.8M18.4 15.7l2.8-.9M5.6 15.7l-2.8-.9M5.6 15.7 5 18.5M18.4 8.3l2.8.9M18.4 8.3l.6-2.8" />
  </svg>
)

// Two leaves and three berries, for a card's empty corner.
const Holly = ({ className = '' }) => (
  <svg className={'xm-holly ' + className} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <path className="xm-leaf" d="M20 20 17 16.6l-2.2 4-3.9-2-1 4.8-4-1.2L4 31.4l5-2.7 1 2.4 3-3.9 2.3 1.9 1.6-4 2.2.8Z" />
    <path className="xm-leaf xm-leaf-b" d="m20 20 3.3-4-4-1.2 2-3.9-4.8-.4.8-4.1L9.2 5l2.8 4.8-2.4.9 3.9 3-1.9 2.2 4 1.7-.8 2.2Z" />
    <circle className="xm-berry" cx="21.2" cy="21.4" r="2.7" /><circle className="xm-berry" cx="25" cy="19.2" r="2.4" /><circle className="xm-berry" cx="23.4" cy="25" r="2.3" />
    <circle className="xm-shine" cx="20.4" cy="20.5" r=".8" /><circle className="xm-shine" cx="24.3" cy="18.4" r=".7" />
  </svg>
)

const Hat = () => (
  <svg className="xm-hatsvg" viewBox="0 0 28 22" aria-hidden="true" focusable="false">
    <path className="xm-red" d="M4.5 16.5C6 9 10.5 3.6 17 3.2c3.4-.2 6 1.6 7.4 4.4-2.4-1-4.6-.9-6.2.4 1.6 2.6 2.4 5.4 2.4 8.5Z" />
    <circle className="xm-white" cx="24.6" cy="8.6" r="2.9" />
    <rect className="xm-white" x="2.2" y="14.6" width="21.4" height="5.4" rx="2.7" />
  </svg>
)

// A present with a ribbon and a bow; `hue` 0 to 2 picks its paper.
const Present = ({ hue = 0 }) => (
  <svg className={'xm-presentsvg xm-p' + hue} viewBox="0 0 32 30" aria-hidden="true" focusable="false">
    <rect className="xm-box" x="3" y="11" width="26" height="18" rx="2.4" />
    <rect className="xm-lid" x="1.6" y="8" width="28.8" height="6" rx="2" />
    <path className="xm-ribbon" d="M14 8h4v21h-4Z" />
    <path className="xm-bow" d="M16 8c-2.4-4.6-8-6.4-8.8-3.4C6.5 7.3 10.6 8.2 16 8Zm0 0c2.4-4.6 8-6.4 8.8-3.4.7 2.7-3.4 3.6-8.8 3.4Z" />
  </svg>
)

const Snowman = ({ wave = false }) => (
  <svg className={'xm-snowmansvg' + (wave ? ' xm-waver' : '')} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    {wave && <path className="xm-arm xm-arm-wave" d="M27 24.4 34.6 17.6M32.4 19.4l2.6.4M33.2 18.4l-.2-2.6" />}
    {wave && <path className="xm-arm" d="M13 24.6 5.6 21.4M7.6 22.2l-2.2 1.4" />}
    <circle className="xm-snow" cx="20" cy="33" r="11" />
    <circle className="xm-snow" cx="20" cy="15.5" r="8" />
    <rect className="xm-hatblk" x="13.5" y="2" width="13" height="6.6" rx="1.2" />
    <rect className="xm-hatblk" x="10.5" y="7.6" width="19" height="2.3" rx="1.1" />
    <rect className="xm-red" x="13.5" y="6.2" width="13" height="1.6" />
    <circle className="xm-coal" cx="17.2" cy="14" r="1.1" /><circle className="xm-coal" cx="22.8" cy="14" r="1.1" />
    <path className="xm-carrot" d="M20 16.2 27.6 18 20 19.2Z" />
    <path className="xm-red" d="M12.6 21.6c4.6 2 10.2 2 14.8 0l.4 2.6c-5 2.2-10.6 2.2-15.6 0Z" />
  </svg>
)

// A gingerbread person, arms up, hanging by both hands from an edge.
const Gingerbread = () => (
  <svg className="xm-gingersvg" viewBox="0 0 24 34" aria-hidden="true" focusable="false">
    <path className="xm-ginger-limb" d="M9.4 14 5.4 2.2M14.6 14l4-11.8M10.4 23.4l-2.2 8.4M13.6 23.4l2.2 8.4" />
    <circle className="xm-ginger" cx="12" cy="9" r="4.8" />
    <rect className="xm-ginger" x="7.6" y="12.6" width="8.8" height="12" rx="3.8" />
    <circle className="xm-icing-dot" cx="10.3" cy="8.2" r=".8" /><circle className="xm-icing-dot" cx="13.7" cy="8.2" r=".8" />
    <path className="xm-icing" d="M10.2 10.6q1.8 1.4 3.6 0M6.4 4.4l1.6-.6M16 3.8l1.6.6M8.4 29.6l1.6.3M14 29.9l1.6-.3" />
    <circle className="xm-gumdrop" cx="12" cy="16" r="1" /><circle className="xm-gumdrop xm-g2" cx="12" cy="19.6" r="1" />
  </svg>
)

const Bauble = ({ gold = false }) => (
  <svg className={'xm-baublesvg' + (gold ? ' xm-gold' : '')} viewBox="0 0 16 20" aria-hidden="true" focusable="false">
    <rect className="xm-cap" x="5.6" y="1" width="4.8" height="3.4" rx=".8" />
    <circle className="xm-ball" cx="8" cy="11.6" r="7" />
    <path className="xm-band" d="M1.4 10.4q6.6 2.8 13.2 0" />
    <circle className="xm-gleam" cx="5.2" cy="8.6" r="1.6" />
  </svg>
)

/* One reindeer, facing right, mid-gallop: body, neck and head, an ear, antlers, a tail, front
   legs reaching forward and back legs pushing off, with a red harness band and a gold bell.
   `stride` 1 swaps the legs, so a pair never gallops in step. About 36 x 26 units. */
const Deer = ({ stride = 0, rudolph = false }) => <>
  <path className="xm-deerline" d={stride
    ? 'M22.6 17.6 27 21.2l3.2-.6M20.4 18.8l2.4 5.4M10.6 18.2 6.4 22.6 3 22.4M12.4 19l-2.2 5.6'
    : 'M22.4 17.8 25.4 23l3.4.2M20.6 18.6 25 21.6l3-1.4M10.4 18.4 5 21l-2.6 2.2M12.6 19.2 9.6 24.6'} />
  <ellipse className="xm-deer" cx="16.4" cy="14.6" rx="9.6" ry="5.2" />
  <path className="xm-deer" d="M21.4 11.6 26 4.8c.7-1 2-1.3 3-.6l.8.6-4.8 10Z" />
  <path className="xm-deer" d="M26.4 3.8c1.4-1 3.4-1.1 5.6-.4l2.6.9c.9.3 1 1.5.2 2l-1.6 1-4.6.6c-1.6.2-2.9-.9-3-2.4 0-.6.3-1.3.8-1.7Z" />
  <ellipse className="xm-deer xm-ear" cx="26.2" cy="3" rx="2" ry=".9" transform="rotate(-28 26.2 3)" />
  <path className="xm-antler" d="M27.6 2.8 26.4-1.6M26.9.4 24.8-.8M27.2 1.6 25.2 1.4M29.2 2.6l1-4.2M29.8.2l2.2-1M29.5 1.4l2.4.2" />
  <ellipse className="xm-tail" cx="6.6" cy="12.4" rx="1.8" ry="1.1" transform="rotate(-24 6.6 12.4)" />
  <path className="xm-harness" d="M21.6 10.4 24.8 15.6M15.6 9.6v10" />
  <circle className="xm-bell" cx="23.6" cy="14.6" r="1" />
  <circle className={rudolph ? 'xm-rudolph' : 'xm-snout'} cx="34.4" cy="5.8" r={rudolph ? 1.9 : 0.9} />
</>

/* Santa in his sleigh with all nine reindeer: Dasher, Dancer, Prancer and Vixen, Comet, Cupid,
   Donner and Blitzen in pairs, and Rudolph out in front with the nose that lights the way. The
   sleigh has a curled front, gold runners and a sack of presents; Santa a hat, a beard and his
   belt. A little sparkle trail follows. The pair's far reindeer is a touch higher and lighter. */
const PAIRS = [94, 136, 178, 220]
const SantaTeam = () => (
  <svg className="xm-teamsvg" viewBox="-30 -8 340 58" aria-hidden="true" focusable="false">
    {/* the reins, from Santa's mitt to every collar */}
    <path className="xm-reins" d="M52 15C80 12 100 12 117 14M52 15c40-4 70-4 107-1M52 15c50-5 100-4 149-1M52 15c60-6 130-5 191-1M52 15c70-7 160-6 233-2" />
    {PAIRS.map((x, i) => <g key={i} className="xm-pair" style={{ animationDelay: i * 0.11 + 's' }}>
      <g className="xm-far" transform={`translate(${x + 8} 6) scale(.9)`}><Deer stride={(i + 1) % 2} /></g>
      <g transform={`translate(${x} 10)`}><Deer stride={i % 2} /></g>
    </g>)}
    <g className="xm-pair" style={{ animationDelay: '.5s' }} transform="translate(264 8)"><Deer rudolph /></g>
    {/* the sleigh, its sack and Santa */}
    <g className="xm-sleighg">
      <path className="xm-sack" d="M6 26c-2.6-6.8-.6-14 5-17.4 4.6-2.8 10.4-1.6 13.4 2.4l1.6 15Z" />
      <rect className="xm-gift xm-gift-a" x="8.4" y="2.6" width="8" height="7.4" rx="1" /><path className="xm-giftrib" d="M12.4 2.6v7.4M8.4 6.3h8" />
      <rect className="xm-gift xm-gift-b" x="15.6" y="5" width="7" height="6" rx="1" transform="rotate(10 19 8)" />
      <path className="xm-santa" d="M24.6 30c-.4-8.6 2.6-15.6 9.6-16.6 6.6-.9 10.8 4.4 10.8 12.6l-.4 4Z" />
      <path className="xm-armline" d="M40.4 19.4 50.4 15" />
      <circle className="xm-mitt" cx="51.4" cy="14.8" r="1.8" />
      <rect className="xm-belt" x="25.4" y="23.2" width="19.4" height="3" rx="1" />
      <rect className="xm-buckle" x="33.2" y="22.6" width="4.2" height="4.2" rx=".8" />
      <circle className="xm-face" cx="39.4" cy="8.8" r="4.4" />
      <path className="xm-beard" d="M34.6 9.6c-.4 4.4 1.6 8 4.8 8.4 3 .4 5.2-2.2 5.4-6.8-1.6 1.2-3.6 1.6-5.2 1.2-1.8-.4-3.6-1.4-5-2.8Z" />
      <path className="xm-santa" d="M34.4 7c.6-4.6 3.8-7.2 7.4-6.6 1.6.3 2.4 1.4 2.4 2.8-1.2-.8-2.6-.8-3.4 0 .6 1.2.8 2.4.6 3.8Z" />
      <rect className="xm-fur" x="33.4" y="5.6" width="11.4" height="2.8" rx="1.4" />
      <circle className="xm-fur" cx="44.8" cy="3.6" r="1.7" />
      <path className="xm-sled" d="M12.6 22.4h44.6c5.6 0 9.4-2.8 11-8 .7-2.2 3.6-2.6 4.8-.6 1.4 2.4.2 6.6-2.6 9.8-3.8 4.4-9.4 6.8-15.6 6.8H22.6c-5.4 0-9.4-3.2-10-8Z" />
      <path className="xm-trim" d="M16.6 25.4h40.6c4 0 7-1.4 8.8-4.4" />
      <path className="xm-runner" d="M6.6 38.4h57.6c6.4 0 9.6-2.8 11-7 .5-1.6-.4-3-2-2.8M6.6 38.4c-3 0-4.6-2.4-3.4-4.4M22.4 30.6v7.8M52 30.6v7.8" />
    </g>
    {/* the sparkle trail */}
    <g className="xm-trail">
      {[[-6, 30, 2.4, 0], [-14, 22, 1.8, .3], [-22, 32, 1.5, .6], [-30, 25, 1.2, .9]].map(([x, y, r, d], i) =>
        <path key={i} className="xm-spark" style={{ animationDelay: d + 's' }} d={`M${x} ${y - r * 2}l${r * .5} ${r * 1.5} ${r * 1.5} ${r * .5}-${r * 1.5} ${r * .5}-${r * .5} ${r * 1.5}-${r * .5}-${r * 1.5}-${r * 1.5}-${r * .5} ${r * 1.5}-${r * .5}Z`} />)}
    </g>
  </svg>
)

// A candy cane, hung by its crook.
const CandyCane = () => (
  <svg className="xm-canesvg" viewBox="0 0 14 30" aria-hidden="true" focusable="false">
    <path className="xm-cane" d="M4 29V8.6a4 4 0 0 1 8 0v1.6" />
    <path className="xm-cane-s" d="M4 29V8.6a4 4 0 0 1 8 0v1.6" />
  </svg>
)

// A little decorated tree with its star, for a card's edge and the workout's quiet corner.
const DecoTree = () => (
  <svg className="xm-decotree" viewBox="0 0 30 40" aria-hidden="true" focusable="false">
    <path className="xm-tree-c" d="M15 4 8 14h14Z" /><path className="xm-tree-c xm-tree-b" d="M15 10 5.5 23h19Z" /><path className="xm-tree-c" d="M15 17 3 33h24Z" />
    <rect className="xm-trunk" x="12.6" y="33" width="4.8" height="5" rx="1" />
    <path className="xm-garland" d="M10.6 12.6q4.4 2 8.8 0M8 20.6q7 3 14 0M5.6 29q9.4 3.6 18.8 0" />
    <circle className="xm-b1" cx="12.4" cy="15.4" r="1.4" /><circle className="xm-b2" cx="18" cy="19" r="1.4" /><circle className="xm-b3" cx="10" cy="24.6" r="1.5" />
    <circle className="xm-b1" cx="20.4" cy="27.4" r="1.5" /><circle className="xm-b2" cx="14.6" cy="30" r="1.4" />
    <path className="xm-tstar" d="m15 .4 1.1 2.3 2.5.3-1.8 1.7.4 2.5L15 6l-2.2 1.2.4-2.5-1.8-1.7 2.5-.3Z" />
  </svg>
)

// A gingerbread house: icing on the roof, a candy on every corner, smoke from the chimney optional.
const GingerHouse = () => (
  <svg className="xm-housesvg" viewBox="0 0 40 34" aria-hidden="true" focusable="false">
    <rect className="xm-ginger" x="29" y="3" width="4.4" height="9" rx=".8" />
    <rect className="xm-ginger" x="6" y="15" width="28" height="18" rx="1.6" />
    <path className="xm-ginger xm-roof" d="M2 17.6 20 3l18 14.6Z" />
    <path className="xm-icing" d="M2.6 17.4 20 3.6l17.4 13.8M3.4 17.6q1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0 1.6 2.4 3.2 0" />
    <rect className="xm-door" x="16.6" y="22.4" width="6.8" height="10.6" rx="3.4" />
    <rect className="xm-window" x="8.6" y="20.4" width="5.4" height="5.4" rx="1" /><rect className="xm-window" x="26" y="20.4" width="5.4" height="5.4" rx="1" />
    <path className="xm-icing" d="M11.3 20.4v5.4M8.6 23.1h5.4M28.7 20.4v5.4M26 23.1h5.4" />
    <circle className="xm-gumdrop" cx="20" cy="9.6" r="1.4" /><circle className="xm-gumdrop xm-g2" cx="13.8" cy="13.4" r="1.2" /><circle className="xm-gumdrop xm-g3" cx="26.2" cy="13.4" r="1.2" />
  </svg>
)

/* -------------------------------------------------------- the layer -- */

/* Snow at every start of the app, and again when it comes back after AWAY_MS or more away, as
   the Halloween spider does. Time away is counted at module level. */
export const AWAY_MS = 30 * 60 * 1000
let startTried = false
let hiddenAt = null
const onReturn = new Set()
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return }
    const away = hiddenAt !== null && Date.now() - hiddenAt >= AWAY_MS
    hiddenAt = null
    if (away) onReturn.forEach(fn => fn())
  })
}

/* Santa's flight: an occasional pass of the whole team across the screen, over the page but under
   every bar and sheet, letting taps through and fading away at the first touch. At
   most one per screen visit, a few seconds after it opens, and never again within FLIGHT_GAP_MS,
   so it stays a treat and not a screensaver. Never on the workout screen, never with reduced
   motion, never while the app is in the background. */
export const FLIGHT_GAP_MS = 90 * 1000
export const FLIGHT_PAUSE_MS = 6000
let lastFlight = 0
export const _resetFlightForTests = () => { lastFlight = 0 }

/**
 * The snow and Santa's flights. On the workout screen (`hidden`) only the snow, and only with
 * "Also during workouts" on (`workout`); with reduced motion, neither.
 */
export function Layer({ hidden, fresh, workout }) {
  const [snow, setSnow] = useState(0)        // 0: no snow; each new number is a new fall
  const [flight, setFlight] = useState(0)    // 0: Santa is elsewhere; each new number is a pass
  const show = !hidden || !!workout
  useEffect(() => {
    const fall = () => { if (!reducedMotion()) setSnow(n => n + 1) }
    if (!startTried) {
      startTried = true
      if (fresh) fall()
    }
    onReturn.add(fall)
    return () => { onReturn.delete(fall) }
  }, [fresh])
  useEffect(() => {
    if (hidden) return
    let tm = null
    const plan = () => {
      clearTimeout(tm)
      tm = setTimeout(() => {
        if (reducedMotion() || document.hidden || Date.now() - lastFlight < FLIGHT_GAP_MS) return
        lastFlight = Date.now()
        setFlight(n => n + 1)
      }, FLIGHT_PAUSE_MS + Math.random() * 4000)
    }
    plan()
    window.addEventListener('hashchange', plan)
    return () => { clearTimeout(tm); window.removeEventListener('hashchange', plan) }
  }, [hidden])
  // A touch anywhere while he flies: he steps aside at once instead of crossing what you tap.
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!flight) return
    setLeaving(false)
    const away = () => setLeaving(true)
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [flight])
  // Snow settling on the cards' top edges, on every screen the theme decorates (the workout screen
  // only with "Also during workouts"), and the warm festive tint with the Christmas colours on.
  const tint = useStore(s => s.S?.seasonal?.christmasColors === true)
  useEffect(() => {
    const de = document.documentElement
    if (show) de.dataset.xmCaps = '1'; else delete de.dataset.xmCaps
    if (tint) de.dataset.xmTint = '1'; else delete de.dataset.xmTint
    return () => { delete de.dataset.xmCaps; delete de.dataset.xmTint }
  }, [show, tint])
  const spark = useSetSparkle(hidden && !!workout)
  return <>
    {spark && <SetSparkle key={spark.n} at={spark} />}
    {snow > 0 && show && !reducedMotion() && <Snow key={snow} few={hidden} onGone={() => setSnow(0)} />}
    {flight > 0 && !hidden && <div key={flight} className={'xm-flight' + (leaving ? ' xm-leave' : '')} aria-hidden="true"
      onAnimationEnd={e => { if (e.target === e.currentTarget) setFlight(0) }}
      onTransitionEnd={e => { if (e.target === e.currentTarget && leaving) setFlight(0) }}><SantaTeam /></div>}
  </>
}

/* A short sparkle where a set was just ticked done, on the workout screen with "Also during
   workouts" on: the store's count of done sets goes up within a moment of a tap, and the sparkle
   shows at that tap. Never with reduced motion; never anything to tap itself. */
const doneSets = A => (A && Array.isArray(A.entries) ? A.entries.reduce((n, e) => n + (Array.isArray(e?.sets) ? e.sets.filter(x => x?.done).length : 0), 0) : 0)
function useSetSparkle(on) {
  const done = useStore(s => doneSets(s.S?.active))
  const prev = useRef(done)
  const tap = useRef(null)
  const [spark, setSpark] = useState(null)
  useEffect(() => {
    if (!on) return
    const down = e => { tap.current = { x: e.clientX, y: e.clientY, t: Date.now() } }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [on])
  useEffect(() => {
    const was = prev.current
    prev.current = done
    if (!on || done <= was || reducedMotion()) return
    const p = tap.current
    if (!p || Date.now() - p.t > 1500) return
    setSpark(sp => ({ x: p.x, y: p.y, n: (sp?.n || 0) + 1 }))
  }, [done, on])
  useEffect(() => {
    if (!spark) return
    const tm = setTimeout(() => setSpark(null), 900)
    return () => clearTimeout(tm)
  }, [spark])
  return spark
}
const SPARKS = [[-26, -18], [24, -22], [-8, -32], [30, 4], [-30, 6], [6, 26]]
const SetSparkle = ({ at }) => (
  <div className="xm-setspark" aria-hidden="true" style={{ left: at.x, top: at.y }}>
    {SPARKS.map(([dx, dy], i) => <span key={i} className={'xm-sp' + (i % 3)} style={{ '--dx': dx + 'px', '--dy': dy + 'px', animationDelay: i * 25 + 'ms' }} />)}
  </div>
)

/* A few flakes, each falling a few times at its own pace, then gone: about a minute in all. The
   places and speeds come from a small fixed table, so the snow looks the same on every start. */
const FLAKES = [
  [6, 7, 13, 0, 18], [17, 5, 16, 4.5, -14], [29, 9, 12, 1.5, 22], [41, 6, 15, 7, -10], [52, 8, 14, 2.5, 16],
  [63, 5, 17, 5.5, -20], [74, 10, 13, 0.8, 12], [85, 6, 16, 3.4, -16], [94, 7, 14, 6.2, 10], [35, 4, 18, 9, 14],
  [70, 4, 19, 10.5, -12], [12, 5, 17, 11.5, 20],
]
function Snow({ few, onGone }) {
  const flakes = few ? FLAKES.filter((_, i) => i % 2 === 0) : FLAKES
  const left = useRef(flakes.length)
  return <div className="xm-snowfall" aria-hidden="true">
    {flakes.map(([x, size, dur, delay, drift], i) => (
      <span key={i} className={'xm-flake' + (i % 3 === 0 ? ' xm-star' : '')}
        style={{ left: x + '%', '--s': size + 'px', '--d': dur + 's', '--delay': delay + 's', '--drift': drift + 'px' }}
        onAnimationEnd={e => { if (e.target === e.currentTarget && --left.current === 0) onGone() }}>
        {i % 3 === 0 ? <Flake /> : null}
      </span>
    ))}
  </div>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  return <>{art(spot)}{NOSE_SPOTS.includes(spot) && <Nose spot={spot} />}</>
}
function art(spot) {
  switch (spot) {
    case 'header-bats': return <Lights />
    // Home: holly in the hero's corner, a gingerbread house peeking over its top edge.
    case 'home-hero': return <><Holly className="xm-holly-br" />
      <span className="xm-peek xm-peek-house" aria-hidden="true"><span className="xm-pk"><GingerHouse /></span></span>
      <span className="xm-peek xm-peek-snowman xm-peek-home" aria-hidden="true" data-snowman><span className="xm-pk"><Snowman wave /></span></span></>
    case 'home-streak': return <><PeekPresent /><span className="xm-peek xm-peek-mini" aria-hidden="true"><span className="xm-pk"><DecoTree /></span></span></>
    case 'streak-flame': return <FlameHat />
    case 'home-advent': return <><IconSuggest /><AdventCard /></>
    // Plan: a decorated tree and a present in the empty top corner of How you train.
    case 'plan-card': return <span className="xm-plandeco" aria-hidden="true"><span className="xm-pk"><DecoTree /></span><span className="xm-pk xm-pk-gift"><Present hue={1} /></span></span>
    // Stats: lights along the header, two baubles in the lifetime tile, a gingerbread person
    // hanging off the activity card, holly in a corner and a snowman peeking over a card.
    case 'stats-hdr': return <Lights />
    case 'stats-tile': return <span className="xm-baubles" aria-hidden="true"><HangingBauble len={26} /><HangingBauble len={12} gold className="xm-hang-b" /><span className="xm-hang xm-hang-c"><span className="xm-hangthread" /><CandyCane /></span></span>
    case 'stats-heatmap': return <span className="xm-ginger-hang" aria-hidden="true"><Gingerbread /></span>
    case 'stats-web': return <Holly className="xm-holly-bl" />
    case 'stats-peek': return <span className="xm-peek xm-peek-snowman" aria-hidden="true" data-snowman><span className="xm-pk"><Snowman wave /></span></span>
    // An empty list: a tiny snowman keeps it company.
    case 'empty': return <span className="xm-emptysnow" aria-hidden="true" data-snowman><Snowman /></span>
    // The workout screen: a bauble in one side gutter, a little tree in the other, two flakes along
    // the rest bar's top edge, presents beside the finish screen's trophy. Nothing on a set, a
    // button or a timer.
    case 'workout-hdr': return <>
      <WorkoutLights />
      <span className="xm-wcorner" aria-hidden="true"><HangingBauble len={20} className="xm-hang-w" /><span className="xm-hang xm-hang-w xm-hang-w2"><span className="xm-hangthread" /><CandyCane /></span></span>
      <span className="xm-wcorner xm-wcorner-e" aria-hidden="true"><span className="xm-wtree"><DecoTree /></span><HangingBauble len={34} gold className="xm-hang-we" /></span></>
    case 'rest-timer': return <RestFlakes />
    case 'streak-party':
    case 'finish': return <span className="xm-finish" aria-hidden="true"><span className="xm-pk"><Present hue={0} /></span><span className="xm-pk xm-pk-r"><Present hue={1} /></span></span>
    default: return null
  }
}

/* Rudolph hides somewhere every day: only his nose shows, glowing over the top edge of one card
   (on Plan: from behind the little tree), a different spot each day (NOSE_SPOTS, by the day of
   the year). Found (a tap), he says hi with a
   sparkle and a buzz, and stays hidden until tomorrow. Per device, like the present. */
export const NOSE_SPOTS = ['home-hero', 'plan-card', 'stats-tile', 'stats-web']
const dayOfYear = d => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 1)) / 864e5)
export const noseSpotOf = (now = seasonNow()) => NOSE_SPOTS[dayOfYear(now) % NOSE_SPOTS.length]

function Nose({ spot }) {
  const ref = useRef(null)
  const [gone, setGone] = useState(() => doneToday('rudolph'))
  const [burst, setBurst] = useState(null)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => { setBurst(null); setGone(true) }, 1100)
    return () => clearTimeout(tm)
  }, [burst])
  if (spot !== noseSpotOf() || (gone && !burst)) return null
  const tap = e => {
    e.stopPropagation()
    if (!onceToday('rudolph')) { setGone(true); return }
    vibrate([10, 30, 10, 30, 24])
    useUI.getState().toast(t('You found Rudolph! He says hi and hides again. New spot tomorrow.'))
    const r = ref.current?.getBoundingClientRect()
    if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    else setGone(true)
  }
  return <>
    {!burst && <span className={'xm-nose-peek' + (spot === 'plan-card' ? ' xm-nose-tree' : '')} aria-hidden="true" data-rudolph={spot}>
      <span className="xm-rudhead" aria-hidden="true">
        <svg viewBox="0 0 34 22" aria-hidden="true" focusable="false">
          <path className="xm-r-antler" d="M12.4 13.2 9.4 5.4M10.6 8.4 6.6 7.2M11.4 10.6 7.8 10.8M9.8 6.8 8.6 2.6M21.6 13.2l3-7.8M23.4 8.4l4-1.2M22.6 10.6l3.6.2M24.2 6.8l1.2-4.2" />
          <ellipse className="xm-r-ear" cx="9.8" cy="15.4" rx="3.2" ry="1.4" transform="rotate(-24 9.8 15.4)" />
          <ellipse className="xm-r-ear" cx="24.2" cy="15.4" rx="3.2" ry="1.4" transform="rotate(24 24.2 15.4)" />
          <path className="xm-r-head" d="M10.6 22c0-5 2.8-8.2 6.4-8.2s6.4 3.2 6.4 8.2Z" />
          <circle className="xm-r-eye" cx="14.8" cy="18.2" r=".9" /><circle className="xm-r-eye" cx="19.2" cy="18.2" r=".9" />
        </svg>
      </span>
      <button type="button" ref={ref} className="xm-nose" tabIndex={-1} aria-hidden="true" onClick={tap} onKeyDown={e => e.stopPropagation()}><i /></button>
    </span>}
    {burst && <Confetti at={burst} />}
  </>
}

// The Santa hat on the streak flame, unless the flame is the festive one, which has its own.
function FlameHat() {
  const festive = useStore(s => s.S?.flameIcon?.v === FESTIVE_FLAME.v)
  return festive ? null : <span className="xm-hat" aria-hidden="true"><Hat /></span>
}

/* A string of fairy lights along the top of a header: the wire sags between three hooks, the
   bulbs hang off it and twinkle a while, then simply stay lit. */
const SAG = [[0, 3], [100, 5], [200, 3], [300, 5]]
const BULBS = (() => {
  const out = []
  for (let k = 0; k < 3; k++) {
    const [x0, y0] = SAG[k], [x1, y1] = SAG[k + 1], cx = (x0 + x1) / 2, cy = 17
    for (const tt of [0.2, 0.5, 0.8]) {
      const u = 1 - tt
      out.push([(u * u * x0 + 2 * u * tt * cx + tt * tt * x1) / 3, u * u * y0 + 2 * u * tt * cy + tt * tt * y1])
    }
  }
  return out
})()
const WIRE = 'M' + SAG.map(([x, y], i) => (i ? `Q${(SAG[i - 1][0] + x) / 2} 17 ${x} ${y}` : `${x} ${y}`)).join('')
function Lights() {
  const still = reducedMotion()
  return <div className={'xm-lights' + (still ? ' xm-still' : '')} aria-hidden="true">
    <svg className="xm-wire" viewBox="0 0 300 22" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={WIRE} /></svg>
    {BULBS.map(([x, y], i) => <span key={i} className={'xm-bulb xm-b' + (i % 4)} style={{ left: x + '%', top: y + 'px', animationDelay: (i % 3) * 0.45 + (i % 2) * 0.2 + 's' }} />)}
  </div>
}

const HangingBauble = ({ len = 20, gold = false, className = '' }) => (
  <span className={'xm-hang ' + className} style={{ '--len': len + 'px' }} aria-hidden="true">
    <span className="xm-hangthread" /><Bauble gold={gold} />
  </span>
)

/* The rest bar: a gold star riding the end of its progress (RestTimer sets --rest-p, 0 to 1),
   and, with motion, two flakes drifting along its top edge. Under the clock and the buttons. */
function RestFlakes() {
  return <>
    <span className="xm-reststar" aria-hidden="true"><span className="xm-reststar-i"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="m6 .6 1.5 3.2 3.4.4-2.5 2.4.6 3.4L6 8.4 3 10l.6-3.4L1.1 4.2l3.4-.4Z" /></svg></span></span>
    {!reducedMotion() && <span className="xm-restflakes" aria-hidden="true">
      {[0, 1].map(i => <span key={i} className={'xm-restlane xm-rl' + i}><span className="xm-restflake"><Flake /></span></span>)}
    </span>}
  </>
}

/* Lights along the very top of the workout screen, in the strip above its header: small, and they
   twinkle a while and then just stay lit, calm enough to train with. */
function WorkoutLights() {
  const still = reducedMotion()
  return <span className={'xm-wlights' + (still ? ' xm-still' : '')} aria-hidden="true">
    {Array.from({ length: 11 }, (_, i) => <span key={i} className={'xm-bulb xm-b' + (i % 4)} style={{ left: 4 + i * 9.2 + '%', top: (i % 2 ? 4 : 2) + 'px', animationDelay: (i % 3) * 0.5 + 's' }} />)}
  </span>
}

// Said when the present is unwrapped: one a day, the same one all day.
const GIFTS = [
  'You found a present! Inside: one extra rep of good vibes.',
  'Unwrapped! It is a voucher for one guilt-free rest day.',
  'A present! It contains confidence. Heavy, so lift with your legs.',
  'Surprise! A tiny trophy, just for showing up.',
]
const CONFETTI = [[-110, -150, -30], [-60, -200, 20], [0, -230, -12], [60, -190, 34], [120, -140, -24], [-140, -70, 40], [150, -60, -40], [-30, -120, 60], [36, -110, -50]]

function PeekPresent() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1500)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the present is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('present') && onceToday('present')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      vibrate([20, 40, 20])
      toast(t(GIFTS[new Date().getDate() % GIFTS.length]))
    } else toast(t('That one is unwrapped. A new present turns up tomorrow.'))
  }
  return <>
    <span className="xm-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'xm-present' + (hop ? ' xm-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Present hue={2} /></button>
    </span>
    {burst && <Confetti at={burst} />}
  </>
}

const Confetti = ({ at }) => (
  <div className="xm-burst" aria-hidden="true" style={{ left: at.x, top: at.y }}>
    {CONFETTI.map(([dx, dy, r], i) => <span key={i} className={'xm-bit xm-c' + (i % 4)} style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r * 6 + 'deg', animationDelay: i * 30 + 'ms' }} />)}
  </div>
)

/* ------------------------------------------------ the festive icon -- */

// Asked once per phone: the icon is the phone's own (lib/app-icon.js), so is the answer.
export const ICON_ASKED = 'og_season_xmas_icon'
const asked = () => { try { return !!localStorage.getItem(ICON_ASKED) } catch (e) { return true } }
const markAsked = () => { try { localStorage.setItem(ICON_ASKED, '1') } catch (e) { /* no storage: it simply asks again */ } }

async function wearFestiveIcon() {
  const toast = useUI.getState().toast
  try {
    const r = await setAppIcon('christmas')
    toast(r.later ? t('New icon on its way. It shows up once you leave the app.') : t('Festive icon on. Very fetching.'))
    return true
  } catch (e) {
    toast(t('The icon could not be changed.'))
    return false
  }
}

/** Home, on a phone that can switch icons, from 1 December: one gentle question, once. */
function IconSuggest() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!MOBILE || asked()) return
    let live = true
    appIconState().then(s => { if (live && s && s.name !== 'christmas') setShow(true) })
    return () => { live = false }
  }, [])
  if (!show) return null
  const done = () => { markAsked(); setShow(false) }
  return <div className="card xm-ask" data-xmas-icon>
    <button type="button" className="iconbtn wr-x" aria-label={t('Not now')} onClick={done}><Icon name="xmark" /></button>
    <div className="row" style={{ gap: 12, alignItems: 'center', paddingInlineEnd: 34 }}>
      <img src="app-icons/christmas.png" alt="" width="48" height="48" className="xm-ask-img" draggable="false" />
      <div style={{ minWidth: 0 }}>
        <div className="ttl">{t('Fancy a festive icon?')}</div>
        <div className="muted small">{t('The barbell has put on its Santa hat. Just for this phone, and you can switch back in Settings any time.')}</div>
      </div>
    </div>
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button size="sm" variant="primary" icon="gift" onClick={async () => { done(); await wearFestiveIcon() }}>{t('Try it')}</Button>
      <Button size="sm" variant="ghost" onClick={done}>{t('No thanks')}</Button>
    </div>
  </div>
}

/* -------------------------------------------------- the calendar -- */

/** Opens something from outside the chunk (components/Seasonal.jsx openSeasonal). Only in December. */
export function open(what) {
  if (what !== 'advent' || !adventOpenable()) return false
  openAdvent()
  return true
}

const openAdvent = day => useUI.getState().openSheet(close => <AdventCalendar close={close} initial={day} />)

/** Home, 1 to 24 December: today's door, one tap away, and the tree so far as a row of baubles. */
function AdventCard() {
  const S = useStore(s => s.S)
  const now = seasonNow()
  if (!inAdvent(now)) return null
  const a = adventOf(S, now)
  const next = nextDoor(S, now)
  const today = now.getDate()
  const title = next === today ? t('Door {0} is waiting for you', today)
    : next ? t('Door {0} is still waiting', next)
    : a.opened.length >= DOORS ? t('All 24 doors open. Merry everything!')
    : t('All caught up. See you tomorrow!')
  return <div className="card tappable xm-advent" data-advent-home style={{ cursor: 'pointer' }} {...tappable(() => openAdvent())}>
    <div className="row between">
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i xm-advent-i" aria-hidden="true"><Glyph icon="tree" emoji="🎄" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Advent calendar')}</div>
          <div className="ttl">{title}</div>
        </div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
    <div className="xm-dots" aria-label={treeLabel(treeOf(S, now))} role="img">
      {Array.from({ length: DOORS }, (_, i) => {
        const d = i + 1
        const cls = adventLit(S, d, now) ? 'lit' : a.opened.includes(d) ? 'on' : d === today ? 'now' : d > today ? 'later' : ''
        return <i key={i} className={cls} />
      })}
    </div>
  </div>
}

const treeLabel = ({ hung, lit }) => tn('{0} bauble on the tree, {1} lit', '{0} baubles on the tree, {1} lit', hung, lit)

// Each door's picture: openGym's own icon, or the emoji with Settings → Icons on Emoji (Glyph).
const KIND = {
  finisher: [['timer', '⏱️'], 'Quick finisher'],
  count: [['target', '🎯'], 'Count it up'],
  exercise: [['dumbbell', '🏋️'], 'Exercise of the day'],
  stretch: [['stretch', '🧘'], 'Cosy stretch'],
  stat: [['chart', '📊'], 'Stat of the day'],
  special: [['starFill', '⭐'], 'Merry everything!'],
}
const kindGlyph = ([icon, emoji]) => <Glyph icon={icon} emoji={emoji} />
const kindOf = door => KIND[door.kind] || KIND.stat

/* The tree: 24 hooks, one per door, in five rows from the top (3, 4, 5, 6, 6). An open door hangs
   its bauble; a lit one glows (its thing done, or a workout that day); door 24 lights the star.
   The hooks are dealt to the days in the calendar's own scrambled order, so the tree fills up all
   over and not row by row. */
const TREE_ROWS = [[34, 3, 10], [53, 4, 16], [70, 5, 22], [87, 6, 26], [104, 6, 34]]
const HOOKS = TREE_ROWS.flatMap(([y, n, half]) => Array.from({ length: n }, (_, i) => [60 - half + (2 * half * i) / (n - 1), y + (i % 2 ? 2.5 : 0)]))
const HOOK_OF = Object.fromEntries(LAYOUT.map((day, i) => [day, HOOKS[i]]))

export function Tree({ S, now }) {
  const a = adventOf(S, now)
  const star = a.opened.includes(24)
  return <svg className="xm-tree" viewBox="0 0 120 128" aria-hidden="true" focusable="false">
    <path className="xm-tree-c" d="M60 12 36 46h48Z" />
    <path className="xm-tree-c xm-tree-b" d="M60 28 27 76h66Z" />
    <path className="xm-tree-c" d="M60 50 16 112h88Z" />
    <rect className="xm-trunk" x="53" y="112" width="14" height="13" rx="2" />
    <path className="xm-garland" d="M44 40q16 8 32 0M36 63q24 11 48 0M26 92q34 14 68 0" />
    {LAYOUT.map(day => {
      const [x, y] = HOOK_OF[day]
      const hung = a.opened.includes(day)
      const lit = hung && adventLit(S, day, now)
      return hung
        ? <circle key={day} className={'xm-ball xm-bp' + (day % 3) + (lit ? ' xm-lit' : '')} cx={x} cy={y} r="4.3" data-ball={day} />
        : <circle key={day} className="xm-hook" cx={x} cy={y} r="1.3" />
    })}
    <path className={'xm-star' + (star ? ' xm-lit' : '')} d="m60 1.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L60 16.4l-5.8 3 1.1-6.4-4.7-4.6 6.5-.9Z" />
  </svg>
}

function AdventCalendar({ close, initial }) {
  const S = useStore(s => s.S)
  const now = seasonNow()
  const year = now.getFullYear()
  const [shown, setShown] = useState(initial || null)
  const [shake, setShake] = useState(null)
  const a = adventOf(S, now)
  const tap = day => {
    if (doorState(S, day, now) === 'locked') {
      setShake(day)
      vibrate(8)
      useUI.getState().toast(S.icons === 'emoji' ? t('No peeking 👀') : splitEmoji(t('No peeking 👀')).text)
      return
    }
    setShown(day)
  }
  if (shown) return <DoorView key={shown} day={shown} year={year} back={() => setShown(null)} close={close} />
  const tree = treeOf(S, now)
  return <div className="xm-cal">
    <h3><Glyph icon="tree" emoji="🎄" className="xm-h-g" /> {t('Advent calendar')}</h3>
    <div className="xm-treebox">
      <Tree S={S} now={now} />
      <div className="xm-treetext">
        <div className="xm-tree-n">{treeLabel(tree)}</div>
        <div className="muted small">{t('Every door you open hangs a bauble. Train that day, or do what is behind the door, and it lights up.')}</div>
        <div className="muted small">{t('Missed a day? Its door waits for you.')}</div>
      </div>
    </div>
    <div className="xm-grid">
      {LAYOUT.map(day => {
        const st = doorState(S, day, now)
        const lit = st === 'open' && adventLit(S, day, now)
        const label = st === 'locked' ? t('Door {0}, locked', day) : st === 'open' ? (lit ? t('Door {0}, open and lit', day) : t('Door {0}, open', day)) : t('Door {0}', day)
        return <button key={day} type="button" data-door={day} aria-label={label}
          className={'xm-door xm-' + st + ' xm-paper' + (day % 3) + (shake === day ? ' xm-shake' : '') + (lit ? ' xm-door-lit' : '')}
          onClick={() => tap(day)} onAnimationEnd={e => { if (e.animationName === 'xm-shake') setShake(null) }}>
          <span className="xm-door-in" aria-hidden="true">{kindGlyph(kindOf(doorFor(day, year))[0])}</span>
          <span className="xm-flap" aria-hidden="true"><span className="xm-num">{day}</span></span>
          {lit && <span className="xm-done" aria-hidden="true" />}
        </button>
      })}
    </div>
    <div className="muted small xm-tally">{t('{0} of 24 doors open', a.opened.length)}</div>
  </div>
}

/* ------------------------------------------------- the door itself -- */

/* The door, big, before it is opened: drag it open by its edge (it follows the finger, gives a
   little past shut and wide open, and springs open or back from where the swing is heading:
   lib/advent.js dragAngle, releaseOpens, springStep), or tap it, or press Enter. Past half way it
   counts as opened (saved, a buzz and a puff of snow) and the surprise shows as it settles. With
   reduced motion there is no swing: a tap opens it and the surprise fades in. */
const DOOR_SPRING = { response: 0.5, damping: 0.72 }
const TAP_PUSH = 520   // deg/s: a tap gives the door a shove of this much

function BigDoor({ day, kind, onOpen, onDone }) {
  const flap = useRef(null)
  const box = useRef(null)
  const st = useRef({ x: 0, v: 0 })
  const raf = useRef(0)
  const drag = useRef(null)
  const committed = useRef(false)
  const [hint, setHint] = useState(true)
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const paint = a => { if (flap.current) flap.current.style.transform = `rotateY(${rtl ? a : -a}deg)` }
  const commit = () => {
    if (committed.current) return
    committed.current = true
    onOpen(box.current?.getBoundingClientRect())
  }
  const springTo = (target, v) => {
    cancelAnimationFrame(raf.current)
    if (Number.isFinite(v)) st.current.v = v
    let last = performance.now()
    const tick = now => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      st.current = springStep(st.current, target, dt, DOOR_SPRING)
      paint(st.current.x)
      if (target === OPEN_DEG && st.current.x > OPEN_DEG * 0.5) commit()
      if (springSettled(st.current, target)) {
        st.current = { x: target, v: 0 }
        paint(target)
        if (target === OPEN_DEG) onDone()
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const openNow = () => {
    setHint(false)
    if (reducedMotion()) { commit(); onDone(); return }
    springTo(OPEN_DEG, TAP_PUSH)
  }
  const down = e => {
    if (drag.current || committed.current || reducedMotion()) return
    cancelAnimationFrame(raf.current)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { id: e.pointerId, x0: e.clientX, a0: st.current.x, w: box.current?.offsetWidth || 220, moved: false, hist: [[performance.now(), st.current.x]] }
  }
  const move = e => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x0
    if (!d.moved && Math.abs(dx) < 6) return
    if (!d.moved) { d.moved = true; setHint(false) }
    const a = Math.max(-12, d.a0 + dragAngle(dx, d.w, rtl))
    st.current = { x: a, v: 0 }
    paint(a)
    d.hist.push([performance.now(), a])
    if (d.hist.length > 6) d.hist.shift()
  }
  const up = e => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.moved) { openNow(); return }
    const [t0, a0] = d.hist[0], [t1, a1] = d.hist[d.hist.length - 1]
    const v = t1 > t0 ? ((a1 - a0) / (t1 - t0)) * 1000 : 0
    springTo(releaseOpens(st.current.x, v) ? OPEN_DEG : 0, v)
  }
  const cancel = e => { if (drag.current?.id === e.pointerId) { drag.current = null; springTo(0, 0) } }
  return <div className="xm-stage">
    <div className={'xm-bigdoor xm-paper' + (day % 3)} ref={box}>
      <div className="xm-bigdoor-in" aria-hidden="true">{kindGlyph(KIND[kind]?.[0] || KIND.stat[0])}</div>
      <button type="button" ref={flap} className={"xm-bigflap" + (hint ? " xm-nudge" : "")} data-bigdoor={day}
        aria-label={t('Open door {0}', day)}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
        onClick={e => { if (e.detail === 0) openNow() }}>
        <span className="xm-bigribbon" aria-hidden="true" />
        <span className="xm-bignum" aria-hidden="true">{day}</span>
        <span className="xm-bigknob" aria-hidden="true" />
      </button>
    </div>
    <div className={'muted small xm-hint' + (hint ? '' : ' xm-gone')} aria-hidden={!hint}>{t('Swipe the door open, or give it a tap')}</div>
  </div>
}

// A puff of snow out of the door as it opens.
const PUFF = [[-120, -60, 7], [-80, -130, 5], [-20, -150, 6], [40, -140, 5], [100, -90, 7], [130, -20, 5], [-140, 10, 6], [-60, -40, 4], [70, -40, 4], [10, -90, 5], [-100, 50, 4], [110, 40, 4]]
const SnowPuff = ({ at }) => (
  <div className="xm-burst" aria-hidden="true" style={{ left: at.x, top: at.y }}>
    {PUFF.map(([dx, dy, s], i) => <span key={i} className="xm-puff" style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--s': s + 'px', animationDelay: i * 18 + 'ms' }} />)}
  </div>
)

function DoorView({ day, year, back, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const now = seasonNow()
  const door = doorFor(day, year)
  const [icon, title] = kindOf(door)
  const [phase, setPhase] = useState(() => (adventOf(S, now).opened.includes(day) ? 'open' : 'shut'))
  const [burst, setBurst] = useState(null)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1500)
    return () => clearTimeout(tm)
  }, [burst])
  const date = new Date(year, 11, day).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' })
  const a = adventOf(S, now)
  const done = a.done.includes(day)
  const lit = adventLit(S, day, now)
  const celebrate = el => {
    vibrate([15, 30, 15])
    const r = el?.getBoundingClientRect?.()
    if (r && !reducedMotion()) setBurst({ kind: 'confetti', x: r.left + r.width / 2, y: r.top })
  }
  const did = el => {
    if (!done) { update(s => { markDone(s, day, seasonNow()) }); celebrate(el) }
  }
  const opened = rect => {
    update(s => { openDoor(s, day, seasonNow()) })
    vibrate([12, 40, 18])
    if (rect && !reducedMotion()) setBurst({ kind: 'snow', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }
  const fx = burst && (burst.kind === 'snow' ? <SnowPuff at={burst} /> : <Confetti at={burst} />)
  const top = <button type="button" className="btn ghost sm xm-back" onClick={back}><Icon name="chevronLeft" /><span>{t('Back to the calendar')}</span></button>
  if (phase !== 'open') return <div className="xm-reveal-wrap">{top}<BigDoor day={day} kind={door.kind} onOpen={opened} onDone={() => setPhase('open')} />{fx}</div>
  return <div className="xm-reveal-wrap">
    {top}
    <div className={'xm-reveal xm-k-' + door.kind} data-door-open={day}>
      <div className="xm-reveal-top"><span className="xm-reveal-day">{date}</span><span className="xm-reveal-kind">{t(title)}</span></div>
      <div className="xm-reveal-icon" aria-hidden="true">{kindGlyph(icon)}</div>
      {door.kind === 'finisher' && <FinisherDoor door={door} close={close} did={did} />}
      {door.kind === 'count' && <CountDoor day={day} door={door} celebrate={celebrate} />}
      {door.kind === 'exercise' && <ExerciseDoor door={door} close={close} did={did} />}
      {door.kind === 'stat' && <StatDoor S={S} stat={door.stat} year={year} />}
      {door.kind === 'stretch' && <StretchDoor close={close} did={did} />}
      {door.kind === 'special' && <SpecialDoor S={S} year={year} close={close} did={did} />}
      {door.text && <p className="xm-reveal-aside">{t(door.text)}</p>}
      <div className={'xm-litline' + (lit ? ' xm-on' : '')} data-lit={lit ? '1' : '0'}>
        <span className="xm-litball" aria-hidden="true" />
        {lit ? t('Bauble lit. Nice work.') : t('Train today, or do this, and its bauble lights up.')}
      </div>
    </div>
    {fx}
  </div>
}

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')
const exName = id => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : id)

/* A door's moves as a quick workout, or added to the end of the one running: built the way the
   workout screen builds a freestyle exercise, so the hold timer, rests and sounds are the app's
   own. Two moves share a superset so they alternate. A finisher skips the weigh-in: nobody wants
   to step on the scales for five minutes of jumping jacks. */
function startOrAdd(update, name, cfgs, close) {
  const sg = cfgs.length > 1 ? 'xm' + uid() : null
  let added = false
  update(s => {
    const entries = cfgs.map(cfg => ({ id: cfg.id, ...buildSessionEntry(s, cfg.id, cfg, null, null), ...(sg ? { sg } : {}) }))
    if (s.active) {
      added = true
      s.active.entries.push(...entries.map(e => joinSessionNoProg(s.active, e)))
    } else {
      s.active = { id: uid(), d: todayISO(), start: Date.now(), routineIds: [], name, bw: null, cur: 0, entries, workoutView: s.workoutView || 'cards' }
    }
  })
  if (added) { useUI.getState().toast(t('Added to this workout. Finish strong!')); return }
  useUI.getState().stopRest?.()
  closeThenNav(close, '/workout')
}

function FinisherDoor({ door, close, did }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const moves = door.moves.filter(([id]) => EXIDX[id])
  const go = e => {
    did(e.currentTarget)
    startOrAdd(update, t(door.name), moves.map(([id, sets, sec]) => ({ ...defaultConfig(id, 'time'), id, sets, sec, restSec: door.rest })), close)
  }
  return <>
    <div className="xm-big-name">{t(door.name)}</div>
    <div className="muted small">{tn('About {0} minute, two moves back to back', 'About {0} minutes, two moves back to back', finisherMinutes(door))}</div>
    <ul className="xm-moves">{moves.map(([id, sets, sec]) => <li key={id}><span>{exName(id)}</span><span className="xm-dose">{sets} × {clock(sec)}</span></li>)}</ul>
    <Button variant="primary" icon={S.active ? 'plus' : 'play'} onClick={go}>{S.active ? t('Add to this workout') : t('Start the finisher')}</Button>
  </>
}

function ExerciseDoor({ door, close, did }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  if (!EXIDX[door.id]) return null
  const timed = door.sec > 0
  const cfg = timed ? { ...defaultConfig(door.id, 'time'), id: door.id, sets: door.sets, sec: door.sec } : { ...defaultConfig(door.id, 'reps'), id: door.id, sets: door.sets, reps: door.reps }
  const go = e => { did(e.currentTarget); startOrAdd(update, exName(door.id), [cfg], close) }
  return <>
    <div className="xm-big-name">{exName(door.id)}</div>
    <div className="xm-dose-big">{door.sets} × {timed ? clock(door.sec) : door.reps}</div>
    <Button variant="primary" icon={S.active ? 'plus' : 'play'} onClick={go}>{S.active ? t('Add to this workout') : t('Start a workout with it')}</Button>
  </>
}

/* A count over the day: a ring that fills, a big plus by the door's step, a small minus for a
   slip of the thumb. Reaching the goal does the door, with confetti. */
function CountDoor({ day, door, celebrate }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const plus = useRef(null)
  const n = repsDone(S, day, door.goal)
  const done = n >= door.goal
  const add = by => {
    let r = false
    update(s => { r = countReps(s, day, by, door.goal, seasonNow()) })
    if (r === 'done') celebrate(plus.current)
    else if (r) vibrate(8)
  }
  const R = 44, C = 2 * Math.PI * R
  return <>
    <div className="xm-big-name">{exName(door.id)}</div>
    <div className="xm-ring" role="img" aria-label={t('{0} of {1} done', n, door.goal)}>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="xm-ring-bg" cx="50" cy="50" r={R} />
        <circle className="xm-ring-fg" cx="50" cy="50" r={R} style={{ strokeDasharray: C, strokeDashoffset: C * (1 - n / door.goal) }} />
      </svg>
      <span className="xm-ring-n" aria-hidden="true"><b>{n}</b><span>/ {door.goal}</span></span>
    </div>
    {done
      ? <div className="xm-badge"><Glyph icon="medal" emoji="🏅" /> {t('All {0}. Done!', door.goal)}</div>
      : <div className="xm-countbtns">
        <Button variant="ghost" size="sm" icon="minus" aria-label={t('Take {0} back', door.step)} disabled={n === 0} onClick={() => add(-door.step)} />
        <span ref={plus} style={{ display: 'inline-block' }}><Button variant="primary" icon="plus" onClick={() => add(door.step)}>{String(door.step)}</Button></span>
      </div>}
    {!done && <div className="muted small">{t('Spread them over the day. Every {0} counts.', door.step)}</div>}
  </>
}

/** A number from the user's own year, for a stat door. null when the year has no workout yet. */
export function statOf(S, stat, year) {
  const st = yearStats(S, year)
  if (!st) return null
  const y = String(year)
  if (stat === 'best' && st.topExercise) {
    const id = st.topExercise.id
    let best = 0
    for (const w of workoutsOfYear(S, year)) for (const e of Array.isArray(w.entries) ? w.entries : []) if (e?.id === id) best = Math.max(best, bestWeightForEntry(e) || 0)
    if (best > 0) {
      const name = EXIDX[id] ? exerciseNameText(EXIDX[id]) : st.topExercise.name || id
      return { line: t('Your {0} best on {1}', y, name), big: fmtNum(shownWeight(S, id, best)) + ' ' + exUnitOf(S, id), sub: t('Santa checked it twice. Still a very good number.') }
    }
  }
  if (stat === 'volume' && st.volume > 0) {
    const deer = Math.round(st.volumeKg / REINDEER_KG)
    return {
      line: t('Lifted in {0} so far', y), big: fmtVol(Math.round(st.volume), st.unit),
      sub: deer >= 1 ? tn('That is about {0} reindeer. Rudolph would like a lie-down.', 'That is about {0} reindeer. Rudolph would like a lie-down.', deer) : t('Not quite a reindeer yet. Plenty of December left.'),
    }
  }
  if (stat === 'muscle' && st.topMuscle && MUSCLE_NAME[st.topMuscle.id]) {
    return { line: t('Your most trained muscle in {0}', y), big: t(MUSCLE_NAME[st.topMuscle.id]), sub: t('{0}% of all the work you did. Clearly a favourite.', Math.round(st.topMuscle.share * 100)) }
  }
  if (stat === 'streak' && st.streak?.weeks > 0) {
    return { line: t('Your longest streak in {0}', y), big: tn('{0} week', '{0} weeks', st.streak.weeks), sub: t('Weeks in a row with at least one workout. The elves are taking notes.') }
  }
  return { line: t('Workouts in {0} so far', y), big: fmtNum(st.workouts), sub: st.ms > 0 ? t('Time trained: {0}', fmtDur(st.ms)) : t('Lifted in total: {0}', fmtVol(Math.round(st.volume), st.unit)) }
}

function StatDoor({ S, stat, year }) {
  const s = statOf(S, stat, year)
  if (!s) return <p className="xm-reveal-text">{t('Your numbers turn up behind this door once you log a workout. No rush, it is the season of naps.')}</p>
  return <div className="xm-stat">
    <div className="muted small">{s.line}</div>
    <div className="xm-stat-big">{s.big}</div>
    <div className="muted small">{s.sub}</div>
  </div>
}

function StretchDoor({ close, did }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const name = t('Cosy stretch')
  const ids = STRETCH.map(([id]) => id).filter(id => EXIDX[id])
  const have = S.routines.some(r => r.name === name && r.ex?.length === ids.length && r.ex.every((e, i) => e.id === ids[i]))
  const add = e => {
    did(e.currentTarget)
    update(s => {
      s.routines.push({ id: uid(), name, emoji: 'stretch', ex: STRETCH.filter(([id]) => EXIDX[id]).map(([id, sets, sec]) => ({ ...defaultConfig(id, 'time'), id, sets, sec })) })
    })
    useUI.getState().toast(t('Added to your routines. Socks optional.'))
    close()
  }
  return <>
    <p className="xm-reveal-text">{t('Six gentle holds for a cold evening, about ten minutes. Best done in your comfiest socks.')}</p>
    <ul className="xm-stretch">{ids.map(id => <li key={id}>{exerciseNameText(EXIDX[id])}</li>)}</ul>
    {have ? <div className="xm-badge">✓ {t('Already in your routines.')}</div>
      : <Button variant="primary" icon="plus" onClick={add}>{t('Add to my routines')}</Button>}
  </>
}

/* Door 24: the year so far on one card (lib/wrapped.js), a way into the full Wrapped, and a present:
   the festive flame for the streak (lib/streak-icons.js FESTIVE_FLAME), yours to keep, plus the
   Christmas app icon on a phone that can switch icons. */
function SpecialDoor({ S, year, close, did }) {
  const update = useStore(s => s.update)
  const [canIcon, setCanIcon] = useState(false)
  useEffect(() => {
    if (!MOBILE) return
    let live = true
    appIconState().then(s => { if (live && s && s.name !== 'christmas') setCanIcon(true) })
    return () => { live = false }
  }, [])
  const st = yearStats(S, year)
  const worn = S.flameIcon?.k === 'icon' && S.flameIcon.v === FESTIVE_FLAME.v
  const wear = e => {
    did(e.currentTarget)
    update(s => { s.flameIcon = { k: 'icon', v: FESTIVE_FLAME.v, c: FESTIVE_FLAME.c } })
    useUI.getState().toast(t('Festive flame on. Your streak looks very merry.'))
  }
  return <>
    {st && <div className="xm-review" data-review>
      <div><b>{fmtNum(st.workouts)}</b><span>{t('Workouts')}</span></div>
      <div><b>{st.ms > 0 ? fmtDur(st.ms) : '0'}</b><span>{t('Time')}</span></div>
      <div><b>{fmtVol(Math.round(st.volume), st.unit)}</b><span>{t('Volume')}</span></div>
      <div><b>{tn('{0} week', '{0} weeks', st.streak?.weeks || 0)}</b><span>{t('Longest streak')}</span></div>
    </div>}
    <p className="xm-reveal-text">{t('Whatever you celebrate, even if it is mostly a day on the sofa: thank you for training with openGym this year. Rest well, eat well, see you in the new year.')}</p>
    <div className="xm-gift">
      <span className="xm-gift-i" aria-hidden="true"><Icon name={FESTIVE_FLAME.v} /></span>
      <div className="xm-gift-t">
        <div className="ttl">{t('Your present: a festive flame')}</div>
        <div className="muted small">{t('Your streak wears a Santa hat, all year if you like. Change it any time in Settings, Icons.')}</div>
      </div>
    </div>
    <div className="xm-actions">
      {worn ? <div className="xm-badge"><Glyph icon="check" emoji="✅" /> {t('Wearing it. Very merry.')}</div>
        : <Button variant="primary" icon="gift" onClick={wear}>{t('Put it on')}</Button>}
      {st && isOn(S, 'motivation') && <Button variant="ghost" icon="sparkles" onClick={() => { close(); openWrapped(year) }}>{t('Show me my year')}</Button>}
    </div>
    {canIcon && <>
      <p className="xm-reveal-text muted small">{t('One more surprise: the barbell has a festive outfit for your home screen.')}</p>
      <Button variant="ghost" icon="gift" onClick={async () => { markAsked(); if (await wearFestiveIcon()) setCanIcon(false) }}>{t('Try the Christmas icon')}</Button>
    </>}
  </>
}
