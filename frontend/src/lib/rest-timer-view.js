// What the iPhone's fused rest/hold timer (components/RestTimer.jsx, TimerRow) shows for one
// reading of the clock. Pure, so the last-3-seconds state, the +15 s bound and the spoken label
// have a test; the component only draws what this returns.
import { t } from './i18n.js'
import { REST_MAX } from './duration.js'

export const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

/** The glow (3 pulses, then still) runs for the last three seconds of a countdown that is still counting. */
export const lastThree = (left, over) => !over && left > 0 && left <= 3

/** What a screen reader says: whole seconds up to 10, then rounded up to 5 s, so a label read twice
 *  in a row does not differ for the sake of one second. */
export const coarseLeft = left => (left > 10 ? Math.ceil(left / 5) * 5 : Math.max(0, left))

/** The reading for a rest (`over` = Ready) or a hold (`work`; `overtime` counts past zero). */
export function restView({ left, total, paused = false, over = false, work = false, overtime = false, switching = false }) {
  const progress = over || !(total > 0) ? 0 : Math.max(0, Math.min(1, left / total))
  return {
    time: over ? '0:00' : work && left <= 0 && overtime ? '+' + clock(-left) : clock(Math.max(0, left)),
    glow: lastThree(left, over),
    progress,
    ringOffset: over ? 0 : 100 * (1 - progress),
    label: work ? (paused ? t('Paused') : t('Hold')) : over ? t('Rest over') : switching ? t('Switch sides') : paused ? t('Paused') : t('Rest'),
    plusLabel: over ? t('Rest') + ' +15s' : '+15s',
    plusOff: !over && left >= REST_MAX,
    skipLabel: over ? t('Dismiss') : t('Skip'),
    spoken: over ? t('Rest over') : t('{0} left on the clock', clock(coarseLeft(left))),
    // Said once when the rest runs out, never per second.
    announce: over && !work ? t('Rest over') : '',
  }
}
