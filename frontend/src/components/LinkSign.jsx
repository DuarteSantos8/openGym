// The device button in the workout's top bar (docs/dev/DEVICE_LINK_STATUS.md): one round button
// beside ⋯ with a picture of the device that matters (the watch, else a Bluetooth source, else the
// sync server's cloud, else a dim phone). A live watch's screen is lit green; trouble turns the ring orange and changes the
// glyph's shape. Every change is a CSS transition on data-state, so nothing replays on a re-render.
// Opens the Devices sheet.
import { useLayoutEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { signFace } from '../lib/device-link-status.js'
import { useDeviceLink } from './useDeviceLink.js'

// Nothing live to sync in the editor of a saved workout or a backfill, or in the tour's sandbox.
export const showLinkSign = (A, editing, tour) => !(A.backfill || editing) && !tour

const NAME = { apple: () => t('Apple Watch'), wear: () => t('Wear OS watch'), zepp: () => t('Zepp OS watch'), server: () => t('Sync server'), hr: () => t('Heart rate') }
const WORD = {
  live: () => t('Live'), ok: () => t('All synced'), delayed: () => t('Delayed'), wait: () => t('Waiting to sync'),
  notAnswering: () => t('Not answering'), notFound: () => t('Not found'), offline: () => t('Offline'),
}

export function signLabel(f) {
  if (f.state === 'none') return t('Devices') + ': ' + t('Nothing connected')
  if (!f.row) return t('Devices') + ': ' + t('Checking…')
  return t('Devices') + ': ' + (f.row.device || NAME[f.row.kind]()) + ', ' + WORD[f.row.state]()
}

// 24 px drawings in the bar's 1.6 px stroke. The watch's screen is its own shape so it can light up.
const SCREEN = { x: 8.6, y: 8.4, width: 6.8, height: 7.2, rx: 1.5 }
function Watch() {
  return <>
    <rect className="ds-bloom" {...SCREEN} filter="url(#ds-blur)" />
    <rect className="ds-fill" {...SCREEN} />
    <rect className="ds-body" x="6.6" y="6.4" width="10.8" height="11.2" rx="3" />
    <path className="ds-body" d="M9 6.4l.6-3h4.8l.6 3M9 17.6l.6 3h4.8l.6-3" />
    <g className="ds-clock"><circle cx="12" cy="12" r="2.1" /><path d="M12 10.9V12l.8.6" /></g>
    <g className="ds-alert"><path d="M12 9.3v2.3" /><circle cx="12" cy="14.2" r=".25" /></g>
  </>
}
const CLOUD = 'M7 18.2h10.2a3.6 3.6 0 0 0 .1-7.2 5.4 5.4 0 0 0-10.4.6A3.3 3.3 0 0 0 7 18.2Z'
function Cloud() {
  return <>
    <path className="ds-fill" d={CLOUD} />
    <path className="ds-body" d={CLOUD} />
    <path className="ds-alert ds-slash" d="M4.6 4.4l14.8 15.4" />
  </>
}
// Wear OS and Zepp: a round watch whose round screen lights up.
function RoundWatch() {
  return <>
    <circle className="ds-bloom" cx="12" cy="12" r="3.9" filter="url(#ds-blur)" />
    <circle className="ds-fill" cx="12" cy="12" r="3.9" />
    <circle className="ds-body" cx="12" cy="12" r="5.9" />
    <path className="ds-body" d="M9.5 6.7l.5-3.3h4l.5 3.3M9.5 17.3l.5 3.3h4l.5-3.3" />
    <g className="ds-clock"><circle cx="12" cy="12" r="2.2" /><path d="M12 10.9V12l.8.6" /></g>
    <g className="ds-alert"><path d="M12 9.3v2.3" /><circle cx="12" cy="14.2" r=".25" /></g>
  </>
}
// Earbuds (AirPods, Powerbeats): a bud with a heartbeat trace; the trace lights up and draws itself in.
const BUD = 'M2.8 8.2a4 4.4 0 0 1 8 0V19.4a1.2 1.2 0 0 1-2.4 0V12.4C4.9 12 2.8 10.7 2.8 8.2Z'
const TRACE = 'M10.8 8.2H12.9L14.6 3.8 16.9 12.6 18.3 8.2H21.2'
function Earbuds() {
  return <>
    <path className="ds-body" d={BUD} />
    <path className="ds-body ds-trace" d={TRACE} />
    <path className="ds-pulse-bloom" d={TRACE} pathLength="1" filter="url(#ds-blur)" />
    <path className="ds-pulse" d={TRACE} pathLength="1" />
  </>
}
// The Bluetooth rune: lit, it turns the status green with a soft glow behind it.
const RUNE = 'M7.4 7.6 16.6 16.4 12 20.6V3.4l4.6 4.2L7.4 16.4'
function Bluetooth() {
  return <><path className="ds-bt-bloom" d={RUNE} filter="url(#ds-blur)" /><path className="ds-body ds-rune" d={RUNE} /></>
}
function Phone() {
  return <><rect className="ds-body" x="7.6" y="3.4" width="8.8" height="17.2" rx="2.4" /><path className="ds-body" d="M10.6 6h2.8" /></>
}
const GLYPH = { watch: Watch, roundWatch: RoundWatch, earbuds: Earbuds, bluetooth: Bluetooth, cloud: Cloud, phone: Phone }

export default function LinkSign() {
  return <DeviceSign face={signFace(useDeviceLink({ live: true }))} />
}

// The screen wakes only on a real change into Live (from checking, trouble or nothing), never when
// the button mounts already live, and a re-render mid-wake does not cut it short.
const WAKES_FROM = ['checking', 'trouble', 'none']
const WAKES = ['ds-wake', 'ds-draw'] // the screen rising (watches), the trace drawing in (earbuds)
export function DeviceSign({ face: f }) {
  const was = useRef(f.state)
  const [waking, setWaking] = useState(false)
  useLayoutEffect(() => {
    if (f.state !== was.current) setWaking(f.state === 'live' && WAKES_FROM.includes(was.current))
    was.current = f.state
  }, [f.state])
  const label = signLabel(f)
  const Glyph = GLYPH[f.device]
  const open = () => import('./DevicesSheet.jsx').then(m => m.openDevicesSheet())
  return <button type="button" className="iconbtn dev-sign" data-device={f.device} data-state={f.state}
    data-wake={waking || undefined} onAnimationEnd={e => WAKES.includes(e.animationName) && setWaking(false)}
    aria-label={label} title={label} onClick={open}>
    <svg className="ds-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="17.1" /></svg>
    <svg className="ds-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <defs><filter id="ds-blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2" /></filter></defs>
      <Glyph key={f.device} />
    </svg>
  </button>
}
