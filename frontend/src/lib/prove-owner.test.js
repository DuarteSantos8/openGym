import { describe, expect, it } from 'vitest'
import { proofChoices } from './prove-owner.js'

// Without a linked identity, proofChoices must reproduce exactly what ProveOwner rendered before
// the provider proof existed - every case here mirrors components/PasswordAuth.jsx's own
// precedence rule (`withPasskey = passkey && webauthnOK()`, `main = danger ? 'danger' : 'primary'`).
describe('proofChoices without a linked identity', () => {
  it('a passkey this browser can use is the loud option; a password beneath it is plain, behind a divider', () => {
    expect(proofChoices({ passkey: true, webauthn: true, password: true, identity: false, danger: false }))
      .toEqual({ passkey: 'primary', password: 'plain', passwordDivider: true, identity: null, identityDivider: false, deadEnd: null })
  })

  it('a destructive action colours both options danger, not just the loud one', () => {
    expect(proofChoices({ passkey: true, webauthn: true, password: true, identity: false, danger: true }))
      .toEqual({ passkey: 'danger', password: 'danger', passwordDivider: true, identity: null, identityDivider: false, deadEnd: null })
  })

  it('no divider, no passkey button, when the password is the only option', () => {
    expect(proofChoices({ passkey: true, webauthn: true, password: false, identity: false, danger: false }))
      .toEqual({ passkey: 'primary', password: null, passwordDivider: false, identity: null, identityDivider: false, deadEnd: null })
  })

  it('this browser cannot use the passkey: the password becomes the loud option', () => {
    expect(proofChoices({ passkey: true, webauthn: false, password: true, identity: false, danger: false }))
      .toEqual({ passkey: null, password: 'primary', passwordDivider: false, identity: null, identityDivider: false, deadEnd: null })
  })

  it('a passkey exists but this browser cannot use it, and there is no password: the specific dead end', () => {
    expect(proofChoices({ passkey: true, webauthn: false, password: false, identity: false, danger: false }))
      .toEqual({ passkey: null, password: null, passwordDivider: false, identity: null, identityDivider: false, deadEnd: 'no-passkey-here' })
  })

  it('no passkey at all and no password: the generic dead end', () => {
    expect(proofChoices({ passkey: false, webauthn: true, password: false, identity: false, danger: false }))
      .toEqual({ passkey: null, password: null, passwordDivider: false, identity: null, identityDivider: false, deadEnd: 'nothing' })
  })
})

describe('proofChoices with a linked identity', () => {
  it('renders after passkey and password, plain, behind its own divider, when either already claimed the loud slot', () => {
    expect(proofChoices({ passkey: true, webauthn: true, password: true, identity: true, danger: false }))
      .toEqual({ passkey: 'primary', password: 'plain', passwordDivider: true, identity: 'plain', identityDivider: true, deadEnd: null })
  })

  it('is the loud option, with its own divider, when only the password also renders', () => {
    expect(proofChoices({ passkey: false, webauthn: true, password: true, identity: true, danger: false }))
      .toEqual({ passkey: null, password: 'primary', passwordDivider: false, identity: 'plain', identityDivider: true, deadEnd: null })
  })

  it('is the only, loud option, with no divider, when nothing else can confirm here', () => {
    expect(proofChoices({ passkey: false, webauthn: true, password: false, identity: true, danger: false }))
      .toEqual({ passkey: null, password: null, passwordDivider: false, identity: 'primary', identityDivider: false, deadEnd: null })
  })

  it('a destructive action colours the identity option danger too, when it is the sole option', () => {
    expect(proofChoices({ passkey: false, webauthn: true, password: false, identity: true, danger: true }))
      .toEqual({ passkey: null, password: null, passwordDivider: false, identity: 'danger', identityDivider: false, deadEnd: null })
  })

  it('never reaches the dead end while the identity is available, whatever else is not', () => {
    expect(proofChoices({ passkey: true, webauthn: false, password: false, identity: true, danger: false }).deadEnd).toBeNull()
  })

  it('the dead end still applies when the identity itself is unavailable', () => {
    expect(proofChoices({ passkey: false, webauthn: true, password: false, identity: false, danger: false }).deadEnd).toBe('nothing')
  })
})
