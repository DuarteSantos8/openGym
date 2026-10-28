import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDur } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { forgottenDue, quietFor, readAsked, writeAsked } from '../lib/forgotten-workout.js'
import { menuSheet, finishWorkout } from '../sheets.jsx'

// "All done?" for a workout left running (lib/forgotten-workout.js), the phone's side of the
// Watch's prompt. Looks every minute and when the app comes back; never over another sheet.
// Finish goes through the usual finishWorkout, which ends the session at its last set.
export default function ForgottenWorkout() {
  useEffect(() => {
    const check = () => {
      if (document.hidden) return
      const A = useStore.getState().S?.active
      const ui = useUI.getState()
      const now = Date.now()
      if (ui.sheets.length || !forgottenDue(A, now, readAsked(), !!(ui.timer || ui.work || ui.countIn))) return
      writeAsked(A, now)
      menuSheet({
        title: t('All done?'),
        subtitle: t('Nothing logged for {0}.', fmtDur(quietFor(A, now))),
        items: [
          { icon: 'play', label: t('Continue workout'), onClick: () => {} },
          { icon: 'check', label: t('Finish workout'), onClick: finishWorkout },
        ],
      })
    }
    const id = setInterval(check, 60000)
    document.addEventListener('visibilitychange', check)
    const first = setTimeout(check, 3000)
    return () => { clearInterval(id); clearTimeout(first); document.removeEventListener('visibilitychange', check) }
  }, [])
  return null
}
