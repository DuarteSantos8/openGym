// The end-of-rest sounds (Settings → Sound, #306) as data: what lib/sound.js chime() plays
// through Web Audio, and what android/.../RestTone.java renders, number for number, for a locked
// phone. Kept apart from lib/sound.js so the store, Settings and the native alarm (lib/rest-alert.js)
// can read the choice without the audio code. See lib/sound.js chime() for how a sound is played.
export const CHIME_PEAK = 0.9
const CHIME = [[1319, 0.16, 0], [988, 0.16, 0.22], [1319, 0.5, 0.44]]
const CLASSIC = [[880, 0.15, 0], [880, 0.15, 0.25], [1320, 0.4, 0.5]]
export const REST_SOUNDS = {
  chime: { notes: CHIME, peak: CHIME_PEAK, hold: 0.6, timbre: 'bright' },
  classic: { notes: CLASSIC },
  // ding-dong: two strikes a major third apart, left to ring out
  bell: { notes: [[1319, 0.9, 0], [1047, 1.3, 0.4]], peak: 0.55, hold: 0, timbre: 'bell' },
  // a sports watch: two pairs of short, square-cut beeps
  beep: { notes: [[1760, 0.08, 0], [1760, 0.08, 0.13], [1760, 0.08, 0.4], [1760, 0.08, 0.53]], peak: 0.8, hold: 0.8, timbre: 'bright' },
  // a coach's "wheet-wheeet", up both times
  whistle: { notes: [[1300, 0.16, 0, 2100], [1500, 0.42, 0.22, 2500]], peak: 0.7, hold: 0.55 },
  // three low, rising notes that melt into each other, for a quiet room or headphones
  soft: { notes: [[659, 0.4, 0], [784, 0.4, 0.2], [988, 0.8, 0.4]], peak: 0.3, hold: 0 },
}
export const REST_SOUND_IDS = Object.keys(REST_SOUNDS)

/**
 * The end-of-rest sound a profile plays. `S.restSound` names it; `S.classicChime` is how the
 * choice was stored before there were more than two, and an app from before #306 still writes
 * only that. So `classicChime: true` always means the classic beeps (this app clears it for any
 * other pick, so true can only be an older app's later choice), and a stored `restSound` of
 * 'classic' without it means that older app switched back to the chime.
 */
export function restSoundOf(S) {
  if (S?.classicChime === true) return 'classic'
  const k = S?.restSound
  return Object.hasOwn(REST_SOUNDS, k) && k !== 'classic' ? k : 'chime'
}

/**
 * The kinds of rest that can each have a sound of their own (Settings → Sound): the rest before
 * the next set of the same exercise, before the next round of a superset, and before the next
 * exercise (supersetFlow.restKind). `S.restSoundByKind` holds only the kinds given one, as
 * REST_SOUNDS ids; a kind without one plays the profile's sound (restSoundOf). The switch-sides
 * pause and the end of a hold are not kinds of rest and play that sound too.
 */
export const REST_KINDS = ['set', 'round', 'block']

export function restSoundFor(S, kind) {
  const k = REST_KINDS.includes(kind) ? S?.restSoundByKind?.[kind] : undefined
  return Object.hasOwn(REST_SOUNDS, k) ? k : restSoundOf(S)
}
