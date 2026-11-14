import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

// The one toast. Mostly text; with an action (the Undo after a set is removed) it carries a button
// at its end, stays longer and holds still while a finger or the mouse rests on it. Its × sends it
// away at once: five seconds of Undo over the set list is long when you did mean to delete. The ×
// sits at the start, the far end from Undo, so a thumb aiming for one never lands on the other.
export default function Toast() {
  const msg = useUI(s => s.toastMsg)
  const action = useUI(s => s.toastAction)
  const { pauseToast, resumeToast, runToastAction, dismissToast } = useUI.getState()
  // Motion (CSS only, nothing waits on it): the toast stays mounted and fades, so the words and the
  // Undo it showed stay while it goes out. A toast that replaces another swaps its content: the old
  // words fade as a ghost, the new ones come in after a beat. A tap on Undo takes the quick exit.
  const last = useRef({ msg: '', action: null })
  const quick = useRef(false)
  const shown = useRef(false)   // was a toast showing at the last commit
  const [ghost, setGhost] = useState('')
  const [swapKey, setSwapKey] = useState('')
  const view = msg ? { msg, action } : last.current
  const live = !!(view.msg && view.action)
  const key = view.msg + '|' + (view.action?.id ?? '')
  const swap = !!msg && ((shown.current && last.current.key !== key) || swapKey === key)
  useEffect(() => {
    const was = shown.current
    shown.current = !!msg
    if (!msg) { setSwapKey(''); return }
    quick.current = false
    if (was && last.current.key !== key) { setGhost(last.current.msg); setSwapKey(key) }
    last.current = { msg, action, key }
  }, [msg, action, key])
  const runAction = () => { quick.current = true; runToastAction() }
  return <div id="toast" role="status" className={(msg ? 'show' : quick.current ? 'quick' : '') + (live ? ' has-action' : '')}
    onPointerEnter={live ? pauseToast : undefined} onPointerDown={live ? pauseToast : undefined}
    onPointerLeave={live ? resumeToast : undefined} onPointerCancel={live ? resumeToast : undefined}
    onPointerUp={live ? (e => { if (e.pointerType !== 'mouse') resumeToast() }) : undefined}>
    {live && <button type="button" className="toast-x" aria-label={t('Close')} onClick={dismissToast}>
      <Icon name="xmark" />
    </button>}
    {ghost && <span className="toast-ghost" aria-hidden="true" onAnimationEnd={() => setGhost('')}>{ghost}</span>}
    <span className={'toast-msg' + (swap ? ' swap' : '')} key={key}>{view.msg}</span>
    {live && <button type="button" className={'toast-act' + (swap ? ' swap' : '')} key={view.action.id} onClick={runAction}>
      <Icon name="undo" />{view.action.label}
    </button>}
  </div>
}
