// Settings → Workout → "Move to the next exercise" (#1017, #1360): when Cards bring the next
// exercise up by themselves. 'rest' waits for the rest after the last set to run out; 'now' moves
// on the moment that set is ticked and lets the rest keep counting underneath it.
//
// A pure reader, because the screen that shows the choice and the screen that acts on it are not
// the same file, and a value stored before this was a choice has to be read the old way.
// The row was a switch when it shipped, so profiles carry `true`. It keeps the behaviour its owner
// turned on then: the move at the end of the rest. Same reading lib/sound.js:182 gives an old
// rest-alert kind. Anything this app did not write is off, so a stray value cannot turn a
// hands-free feature on by itself.
export function autoNextMode(value) {
  if (value === true || value === 'rest') return 'rest'
  return value === 'now' ? 'now' : 'off'
}
