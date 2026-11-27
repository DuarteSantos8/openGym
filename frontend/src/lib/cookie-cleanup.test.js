// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { logoutOwed, pendingCookieCleanup, trackCookieCleanup } from './cookie-cleanup.js'

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

it('an earlier tab’s settled logout does not clear a later tab’s logout debt', async () => {
  try {
    logoutOwed(true)
    let finishFirst
    trackCookieCleanup(new Promise(resolve => { finishFirst = resolve }))
    // Another tab signs in, then signs out and fails after the first logout was sent.
    logoutOwed(false)
    logoutOwed(true)
    finishFirst()
    await pendingCookieCleanup
    expect(logoutOwed()).toBe(true)
    document.cookie = 'gym_logout_owed=; Path=/; Max-Age=0' // survives a browser restart too
    expect(logoutOwed()).toBe(true)
  } finally {
    logoutOwed(false)
  }
})

it('an earlier tab’s settled logout does not clear a later tab’s cookie debt when localStorage is full', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  try {
    logoutOwed(true)
    let finishFirst
    trackCookieCleanup(new Promise(resolve => { finishFirst = resolve }))
    logoutOwed(false)
    logoutOwed(true)
    finishFirst()
    await pendingCookieCleanup
    expect(logoutOwed()).toBe(true)
  } finally {
    setItem.mockRestore()
    logoutOwed(false)
  }
})
