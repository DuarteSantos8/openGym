// Whether this device has seen a diary with something in it: until then Home's hero says the
// numbers count from the first log (motion-onboarding-summary-v2, "Home on first run"). Kept on
// the device: NutriTrace has no "first log" of its own, and a person whose diary already has
// entries only sees the line until the first day with a log loads here.
const KEY = 'gains.diaryLogged'

const store = () => { try { return globalThis.localStorage || null } catch { return null } }

export const hasLogged = () => store()?.getItem(KEY) === '1'

export function markLogged() {
  try { store()?.setItem(KEY, '1') } catch { /* private mode: the line shows again next time */ }
}

/** A loaded diary day with any food or water in it. */
export const dayHasLog = entry => !!(entry?.items?.length || entry?.water?.length)
