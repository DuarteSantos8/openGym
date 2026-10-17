// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
vi.mock('./local.js', () => ({ LOCAL: true }))
import { api } from './api.js'
it('refuses backend operations before making any network request in personal mode', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(api('/api/config')).rejects.toMatchObject({ code: 'local-only', status: 0 })
  await expect(api('/api/data', { method: 'PUT', body: '{}' })).rejects.toMatchObject({ code: 'local-only' })
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockRestore()
})
