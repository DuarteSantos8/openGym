let enabled = true

export function setHapticsEnabled(v) { enabled = !!v }

export function hapticLight() { if (enabled && navigator.vibrate) navigator.vibrate(10) }
export function hapticMedium() { if (enabled && navigator.vibrate) navigator.vibrate(20) }
export function hapticSuccess() {
  if (enabled && navigator.vibrate) navigator.vibrate([15, 30, 15])
}
export function hapticWarning() {
  if (enabled && navigator.vibrate) navigator.vibrate([20, 40, 20])
}
