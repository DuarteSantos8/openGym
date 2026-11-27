// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { logoutOwed, pendingCookieCleanup, trackCookieCleanup } from './cookie-cleanup.js'

it.each([false, true])('an older response preserves the next sign-out (full quota: %s)', async full => {
  const deny = full && vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full') })
  try {
    logoutOwed(true)
    let finish
    const request = new Promise(resolve => { finish = resolve })
    trackCookieCleanup(() => request)
    logoutOwed(false) // another tab completed sign-in and then failed to sign out
    logoutOwed(true)
    finish()
    await pendingCookieCleanup
    expect(logoutOwed()).toBe(true)
    trackCookieCleanup(() => Promise.resolve())
    await pendingCookieCleanup
    expect(logoutOwed()).toBe(false)
  } finally {
    if (deny) deny.mockRestore()
    logoutOwed(false)
  }
})

it('a settled read cannot erase another tab’s later logout after a browser restart', () => {
  const key = 'gym_logout_owed'
  localStorage.setItem(key, '1') // an older build left a marker before provider sign-in
  document.cookie = key + '=0; Path=/'
  const read = vi.spyOn(document, 'cookie', 'get').mockImplementationOnce(() => {
    read.mockRestore()
    logoutOwed(true) // another tab writes after our cookie snapshot
    return key + '=0'
  })
  try {
    logoutOwed()
    document.cookie = key + '=; Path=/; Max-Age=0'
    expect(localStorage.getItem(key)).toBeNull()
    expect(logoutOwed()).toBe(true)
  } finally {
    read.mockRestore()
    logoutOwed(false)
  }
})
