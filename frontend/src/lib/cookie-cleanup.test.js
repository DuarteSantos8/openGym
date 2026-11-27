// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { logoutOwed } from './cookie-cleanup.js'

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
