import { describe, expect, it, vi } from 'vitest'
import { enterApp } from './enter-app.js'

const store = (over = {}) => ({ user: null, config: null, isGuest: () => false, setGuest: vi.fn(), ...over })

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

  it('leaves it to the server\'s own sign-in where the server says an account is required', () => {
    const st = store({ config: { allow_guest: false } })
    expect(enterApp(st)).toBe('server')
    expect(st.setGuest).not.toHaveBeenCalled()
  })
})
