import { useStore } from '../store/useStore.js'
import { beep, chime, vibrate, alertBuzz } from './sound.js'
import { toneFor } from './user-sounds.js'
import { recordSoundOn } from './set-records.js'

// A timer alarm is functional. Its caller can supply the selected rest-kind tone
// and native delivery timestamp. The three optional workout cues can be quiet.
export function cue(kind, settings = useStore.getState().S, ringRest) {
  if (kind === 'rest-over') {
    if (settings.sound) {
      if (ringRest) ringRest()
      else chime(true, toneFor(settings, 'rest'))
    }
    if (settings.vibrate !== false) alertBuzz([200, 100, 200])
    return
  }

  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const sound = settings.sound
  const haptics = settings.vibrate !== false
  switch (kind) {
    case 'set-done':
      if (sound) beep(true, 1040, 0.12)
      if (haptics) vibrate(30)
      break
    case 'record':
      if (sound && recordSoundOn(settings)) {
        beep(true, 1320, 0.1, 0.14)
        beep(true, 1760, 0.22, 0.26)
      }
      if (haptics) vibrate([40, 60, 40, 60, 120])
      break
    case 'session-done':
      if (sound) {
        beep(true, 880, 0.15)
        beep(true, 1100, 0.15, 0.18)
        beep(true, 1320, 0.3, 0.36)
      }
      if (haptics && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') vibrate([40, 60, 120])
      break
  }
}
