import { describe, expect, it, vi } from 'vitest'
import { enterApp } from './enter-app.js'

it('keeps training on this device when the callback belongs to another origin', () => {
  const st = store({ config: { oidc: { only: true, webOrigin: 'https://other.example' }, allow_guest: true } })
  expect(enterApp(st)).toBe('device')
  expect(st.setGuest).toHaveBeenCalledWith(true)
})

// Like the app's store: choosing this device's profile is kept, and isGuest reads it back.
const store = (over = {}) => { let guest = false; return { user: null, config: null, isGuest: () => guest, setGuest: vi.fn(v => { guest = !!v }), ...over } }

describe('enterApp: a signed-in account going on into the app', () => {
  it('opens this device\'s own profile when nobody is in the app yet', () => {
    const st = store()
    expect(enterApp(st)).toBe('device')
    expect(st.setGuest).toHaveBeenCalledWith(true)
  })

  it('also when a server answered and does not forbid it', () => {
    for (const config of [{}, { allow_guest: true }]) {
      const st = store({ config })
      expect(enterApp(st)).toBe('device')
      expect(st.setGuest).toHaveBeenCalledWith(true)
    }
  })

  it('changes nothing for someone already in the app, on a server profile or on this device', () => {
    for (const st of [store({ user: { id: 1 } }), store({ isGuest: () => true })]) {
      expect(enterApp(st)).toBe('already')
      expect(st.setGuest).not.toHaveBeenCalled()
    }
  })

  // The app's own server, where there is one, signs people in with this same account (ADR 0013).
  // Then going on into the app means becoming a profile on that server, so that training
  // follows the account: a device profile would leave them signed in and still on their own.
  it('goes through the server\'s sign-in where the server signs people in with the account', () => {
    for (const config of [{ oidc: { label: 'Ironvane' } }, { oidc: { label: 'Ironvane', only: true }, allow_guest: true }, { oidc: { label: 'Ironvane' }, allow_guest: false }]) {
      const st = store({ config })
      expect(enterApp(st)).toBe('link')
      expect(st.setGuest).not.toHaveBeenCalled()
    }
  })

  it('also for someone already on this device\'s profile: that is the profile to attach', () => {
    const st = store({ config: { oidc: { label: 'Ironvane' } }, isGuest: () => true })
    expect(enterApp(st)).toBe('link')
    expect(st.setGuest).not.toHaveBeenCalled()
  })

  // Found in review of #78: the server profile left open by whoever was here before is not
  // this person's to walk into (lib/cloud/server-link.js keeps whose it is).
  it('a server profile opened through a different account is not "already in": it has to be swapped', () => {
    const st = store({ config: { oidc: { label: 'Ironvane' } }, user: { id: 1 } })
    expect(enterApp(st, { hostedId: 'u-2', owner: 'u-1' })).toBe('switch')
    expect(enterApp(st, { hostedId: 'u-1', owner: 'u-1' })).toBe('already')
    // nobody noted: an admin's passkey, or a profile from before. Left as it is.
    expect(enterApp(st, { hostedId: 'u-2', owner: null })).toBe('already')
    expect(enterApp(st)).toBe('already')
  })

  // Found in review of #81: the server's sign-in is a full-page trip. Where the browser is not
  // keeping the account session (private browsing, storage full), the person comes back signed
  // out, and the profile just opened is ended again. So that trip is not offered there: what
  // works is this device's profile.
  it('where the account session will not outlive the page, the server\'s sign-in is not the way in', () => {
    const open = store({ config: { oidc: { label: 'Ironvane', only: true }, allow_guest: true } })
    expect(enterApp(open, { hostedId: 'u-1', lasting: false })).toBe('device')
    expect(open.setGuest).toHaveBeenCalledWith(true)
    expect(enterApp(store({ config: { oidc: { label: 'Ironvane' }, allow_guest: true }, isGuest: () => true }), { hostedId: 'u-1', lasting: false })).toBe('already')
    expect(enterApp(store({ config: { oidc: { label: 'Ironvane', only: true }, allow_guest: false } }), { hostedId: 'u-1', lasting: false })).toBe('server')
    // said or not said, the default is that it lasts
    expect(enterApp(store({ config: { oidc: { label: 'Ironvane' } } }), { hostedId: 'u-1', lasting: true })).toBe('link')
    expect(enterApp(store({ config: { oidc: { label: 'Ironvane' } } }), { hostedId: 'u-1' })).toBe('link')
  })

  // Found in review of #82: a browser whose storage refuses everything cannot open a device
  // profile either (the store keeps that choice in storage, and writing it throws). That is an
  // answer of its own, not an error to trip over.
  it('says so when this device\'s profile cannot be opened because storage refuses it', () => {
    const throws = store({ config: { allow_guest: true }, setGuest: () => { throw new Error('QuotaExceededError') } })
    expect(enterApp(throws)).toBe('refused')
    // or the write went nowhere without a word
    const silent = store({ config: { allow_guest: true }, setGuest: () => {}, isGuest: () => false })
    expect(enterApp(silent)).toBe('refused')
    const full = store({ config: { oidc: { label: 'Ironvane', only: true }, allow_guest: true }, setGuest: () => { throw new Error('QuotaExceededError') } })
    expect(enterApp(full, { hostedId: 'u-1', lasting: false })).toBe('refused')
  })

  it('but not for someone already on a server profile', () => {
    expect(enterApp(store({ config: { oidc: { label: 'Ironvane' } }, user: { id: 1 } }))).toBe('already')
  })

  it('leaves it to the server\'s own sign-in where the server says an account is required', () => {
    const st = store({ config: { allow_guest: false } })
    expect(enterApp(st)).toBe('server')
    expect(st.setGuest).not.toHaveBeenCalled()
  })
})
