import { t } from '../i18n.js'
import { useUI } from '../../store/useUI.js'

// What a failed write tells the person. The input it came from stays where it was.
export function writeErrorText(e) {
  if (e?.code === 'offline' || e?.code === 'timeout') return t('Not saved: no connection. Try again when you are back online.')
  if (e?.status === 401) return t('Not saved: you are signed out. Sign in and try again.')
  if (e?.code === 'changed') return t('Not saved: this entry changed elsewhere. The diary now shows its latest state.')
  return t('Not saved. Try again.')
}

// What a failed read tells the person.
export function loadErrorText(e) {
  if (e?.code === 'offline' || e?.code === 'timeout') return t('The diary did not load: no connection.')
  if (e?.status === 401) return t('The diary did not load: you are signed out.')
  return t('The diary did not load.')
}

/** The toast after a log or a removal, with an Undo that takes it back. When the Undo fails it says
 *  so and offers Try again, which runs the same `undo` (so it must send the same entries each time). */
export function toastLogged(message, undo) {
  const run = () => {
    undo().catch(e => useUI.getState().toast(writeErrorText(e), { action: t('Try again'), onAction: run }))
  }
  useUI.getState().toast(message, { action: t('Undo'), onAction: run })
}
