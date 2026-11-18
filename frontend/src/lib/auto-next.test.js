import { describe, expect, it } from 'vitest'
import { autoNextMode } from './auto-next.js'

describe('autoNextMode', () => {
  it('reads the three settings of the row', () => {
    expect(autoNextMode('off')).toBe('off')
    expect(autoNextMode('rest')).toBe('rest')
    expect(autoNextMode('now')).toBe('now')
  })

  // The row was a switch before it was a choice (#1017), so profiles carry `true`. It has to keep
  // the behaviour its owner turned on: the move at the end of the rest, not a new one.
  it('reads a saved switch as "when the rest ends"', () => {
    expect(autoNextMode(true)).toBe('rest')
  })

  // Off is the absence of the key, the way the switch stored it. Anything else is not a setting
  // this app wrote, and a stray value must not silently turn a hands-free feature on.
  it('reads anything else as off', () => {
    for (const value of [undefined, null, false, 0, '', 'Now', 'REST', 'yes', {}, []]) {
      expect(autoNextMode(value), JSON.stringify(value)).toBe('off')
    }
  })
})
