// The device button in the workout's top bar (docs/dev/DEVICE_LINK_STATUS.md): one round button
// beside ⋯ with a picture of the device that matters (the watch, else the sync server's cloud, else
// a dim phone). A live watch's screen is lit green; trouble turns the ring orange and changes the
// glyph's shape. Every change is a CSS transition on data-state, so nothing replays on a re-render.
// Opens the Devices sheet.
import { useLayoutEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { signFace } from '../lib/device-link-status.js'
import { useDeviceLink } from './useDeviceLink.js'

// Nothing live to sync in the editor of a saved workout or a backfill, or in the tour's sandbox.
export const showLinkSign = (A, editing, tour) => !(A.backfill || editing) && !tour

const NAME = { apple: () => t('Apple Watch'), wear: () => t('Wear OS watch'), zepp: () => t('Zepp OS watch'), server: () => t('Sync server') }
const WORD = {
  live: () => t('Live'), ok: () => t('All synced'), delayed: () => t('Delayed'), wait: () => t('Waiting to sync'),
  notAnswering: () => t('Not answering'), notFound: () => t('Not found'), offline: () => t('Offline'),
}

export function signLabel(f) {
  if (f.state === 'none') return t('Devices') + ': ' + t('Nothing connected')
  if (!f.row) return t('Devices') + ': ' + t('Checking…')
  return t('Devices') + ': ' + NAME[f.row.kind]() + ', ' + WORD[f.row.state]()
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
    <g className="ds-alert"><path d="M12 9.9v2.4" /><circle cx="12" cy="14.3" r=".35" /></g>
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
function Phone() {
  return <><rect className="ds-body" x="7.6" y="3.4" width="8.8" height="17.2" rx="2.4" /><path className="ds-body" d="M10.6 6h2.8" /></>
}
const GLYPH = { watch: Watch, cloud: Cloud, phone: Phone }

export default function LinkSign() {
  return <DeviceSign face={signFace(useDeviceLink({ live: true }))} />
}

// The screen wakes only on a real change into Live (from checking, trouble or nothing), never when
// the button mounts already live, and a re-render mid-wake does not cut it short.
const WAKES_FROM = ['checking', 'trouble', 'none']
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
    data-wake={waking || undefined} onAnimationEnd={e => e.animationName === 'ds-wake' && setWaking(false)}
    aria-label={label} title={label} onClick={open}>
    <svg className="ds-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="17.1" /></svg>
    <svg className="ds-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <defs><filter id="ds-blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2" /></filter></defs>
      <Glyph key={f.device} />
    </svg>
  </button>
}
