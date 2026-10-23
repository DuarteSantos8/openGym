// The Coach's message box (views/CoachChat.jsx): it grows with what is typed, up to about 40% of
// what the keyboard leaves of the screen, and scrolls inside after that. A toggle opens it into a
// tall editor for a long message and back. The height is worked out from the space above the
// keyboard (lib/native-keyboard.js visibleBottom: the visual viewport on iOS, the layout viewport
// less the keyboard the Android app reports), so it never grows under the keyboard.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { visibleBottom, NATIVE_KEYBOARD_EVENT } from '../lib/native-keyboard.js'
import Icon from './Icon.jsx'

export const MIN_HEIGHT = 44
export const GROW_SHARE = 0.4
export const TALL_SHARE = 0.7
// The toggle shows once the text no longer fits in about three lines, or while expanded.
export const TOGGLE_FROM = 3 * 21 + 22

/**
 * The box's height in px: what the text needs, between one line and 40% of the free screen; or
 * 70% of it when expanded. `visible` is the height left above the keyboard.
 */
export function composerHeight({ scrollHeight = 0, visible = 0, expanded = false }) {
  const room = Math.max(MIN_HEIGHT, Math.round(visible || 0))
  if (expanded) return Math.max(MIN_HEIGHT, Math.round(room * TALL_SHARE))
  return Math.max(MIN_HEIGHT, Math.min(Math.ceil(scrollHeight || 0), Math.round(room * GROW_SHARE)))
}

export default function ChatInput({ value, onChange, onSend, placeholder, disabled, maxLength, expanded, setExpanded }) {
  const ref = useRef(null)
  const [tall, setTall] = useState(false)   // whether the text needs more than a few lines
  // The keyboard coming up or going down changes the room: measured again then.
  const [room, setRoom] = useState(0)
  useEffect(() => {
    const again = () => setRoom(r => r + 1)
    const vv = window.visualViewport
    vv?.addEventListener?.('resize', again)
    window.addEventListener(NATIVE_KEYBOARD_EVENT, again)
    return () => { vv?.removeEventListener?.('resize', again); window.removeEventListener(NATIVE_KEYBOARD_EVENT, again) }
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Measured from its natural height: shrink first, so deleting text shrinks the box too.
    el.style.height = 'auto'
    const need = el.scrollHeight
    const h = composerHeight({ scrollHeight: need, visible: visibleBottom(), expanded })
    el.style.height = h + 'px'
    // The chat leaves room for what the box grew by, so the last message is never under it.
    el.closest('.chat')?.style.setProperty('--composer-extra', Math.max(0, h - MIN_HEIGHT) + 'px')
    setTall(need > TOGGLE_FROM)
  }, [value, expanded, room])
  return <>
    {(tall || expanded) && <button type="button" className="composer-grow" onClick={() => setExpanded(!expanded)}
      aria-label={expanded ? t('Make the box smaller') : t('Make the box bigger')} aria-pressed={expanded}>
      <Icon name={expanded ? 'minimize' : 'expand'} />
    </button>}
    <textarea ref={ref} rows={1} value={value} maxLength={maxLength} placeholder={placeholder} disabled={disabled}
      onChange={e => onChange(e.target.value)}
      // Enter sends; Shift+Enter makes a new line. In the tall editor Enter is a new line too:
      // that is what it is opened for.
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !expanded) { e.preventDefault(); onSend() } }} />
  </>
}
