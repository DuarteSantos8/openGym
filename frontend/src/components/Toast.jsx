import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'
import { isIOS } from '../lib/platform-now.js'

// The one toast. Mostly text; with an action (the Undo after a set is removed) it carries a button
// at its end, stays longer and holds still while a finger or the mouse rests on it. Its × sends it
// away at once: five seconds of Undo over the set list is long when you did mean to delete. The ×
// sits at the start, the far end from Undo, so a thumb aiming for one never lands on the other.
export default function Toast() {
  return isIOS() ? <GlassToast /> : <PlainToast />
}

function PlainToast() {
  const msg = useUI(s => s.toastMsg)
  const action = useUI(s => s.toastAction)
  const { pauseToast, resumeToast, runToastAction, dismissToast } = useUI.getState()
  const live = !!(msg && action)
  return <div id="toast" role="status" className={(msg ? 'show' : '') + (live ? ' has-action' : '')}
    onPointerEnter={live ? pauseToast : undefined} onPointerDown={live ? pauseToast : undefined}
    onPointerLeave={live ? resumeToast : undefined} onPointerCancel={live ? resumeToast : undefined}
    onPointerUp={live ? (e => { if (e.pointerType !== 'mouse') resumeToast() }) : undefined}>
    {live && <button type="button" className="toast-x" aria-label={t('Close')} onClick={dismissToast}>
      <Icon name="xmark" />
    </button>}
    <span className="toast-msg">{msg}</span>
    {live && <button type="button" className="toast-act" key={action.id} onClick={runToastAction}>
      <Icon name="undo" />{action.label}
    </button>}
  </div>
}

// iPhone (Liquid Glass G4). Nothing here times out. A message with no action is one button: tap it,
// or touch anything else, and it goes. With an action (Undo) it is a close button first and the
// action last, and touching elsewhere leaves it; it stays until one of those two, a route change or
// the app coming back from the background. VoiceOver hears the message once, from a hidden live
// region that is emptied and refilled on the next frame so the same words twice are read twice.
function GlassToast() {
  const msg = useUI(s => s.toastMsg)
  const id = useUI(s => s.toastId)
  const action = useUI(s => s.toastAction)
  const { runToastAction, dismissToast } = useUI.getState()
  const say = useRef(null)
  useEffect(() => {
    const el = say.current
    if (!el) return undefined
    el.textContent = ''
    const raf = requestAnimationFrame(() => { el.textContent = msg })
    return () => cancelAnimationFrame(raf)
  }, [msg, id])
  const key = useLocation().key
  const at = useRef(key)
  useEffect(() => { at.current = key }, [id])   // the route this toast came up on
  useEffect(() => { if (at.current !== key && useUI.getState().toastMsg) dismissToast() }, [key])
  useEffect(() => {
    if (!msg) return undefined
    const away = () => dismissToast()
    const touch = e => { if (!action && !e.target.closest?.('#toast')) dismissToast() }
    const hide = () => { if (document.hidden) away() }
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('visibilitychange', hide)
    return () => { document.removeEventListener('pointerdown', touch, true); document.removeEventListener('visibilitychange', hide) }
  }, [msg, id, !!action])
  return <>
    <div className="toast-live" role="status" aria-live="polite" ref={say} />
    <div id="toast" className={(msg ? 'show' : '') + (action ? ' has-action' : '')} inert={!msg || undefined}>
      {action
        ? <>
          <button type="button" className="toast-x" aria-label={t('Close')} onClick={dismissToast}><Icon name="xmark" /></button>
          <span className="toast-msg">{msg}</span>
          <button type="button" className="toast-act" key={action.id} onClick={runToastAction}><Icon name="undo" />{action.label}</button>
        </>
        : <button type="button" className="toast-dis" onClick={dismissToast}><Icon name="checkCircle" /><span className="toast-msg">{msg}</span></button>}
    </div>
  </>
}
