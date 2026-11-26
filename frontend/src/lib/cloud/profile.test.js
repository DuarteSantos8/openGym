import { describe, it, expect, vi } from 'vitest'
import { createProfiles, cleanProfilePatch } from './profile.js'

const URL0 = 'https://proj.example'
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const authOf = (token = 'at-1', id = 'u-1') => ({ fresh: async () => token, session: () => (token ? { user: { id, email: 'a@example.com' } } : null) })

function setup(answer, auth = authOf()) {
  const calls = []
  const fetchImpl = vi.fn(async (url, init = {}) => { calls.push({ url: url.replace(URL0, ''), method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }); return typeof answer === 'function' ? answer(calls.length) : answer })
  return { profiles: createProfiles({ url: URL0, key: 'pk', auth, fetchImpl }), calls }
}

describe('cleanProfilePatch', () => {
  it('keeps only the two fields a person may change, trimmed and checked', () => {
    expect(cleanProfilePatch({ display_name: '  Sam  ', experience: 'beginner', node_uid: 'x', id: 'y' })).toEqual({ display_name: 'Sam', experience: 'beginner' })
    expect(cleanProfilePatch({ display_name: '' })).toEqual({ display_name: null })
    expect(cleanProfilePatch({ display_name: 'x'.repeat(200) }).display_name).toHaveLength(80)
    expect(cleanProfilePatch({ experience: 'wizard' })).toEqual({})
    expect(cleanProfilePatch({ experience: null })).toEqual({ experience: null })
    expect(cleanProfilePatch(null)).toEqual({})
  })
})

describe('profiles', () => {
  it('reads the signed-in user\'s own row with the public key and their token', async () => {
    const { profiles, calls } = setup(res(200, [{ id: 'u-1', display_name: 'Sam', experience: 'beginner', node_uid: null }]))
    expect(await profiles.get()).toEqual({ id: 'u-1', display_name: 'Sam', experience: 'beginner', node_uid: null })
    expect(calls[0].url).toBe('/rest/v1/profiles?select=id,display_name,experience,node_uid&id=eq.u-1')
    expect(calls[0].headers).toMatchObject({ apikey: 'pk', Authorization: 'Bearer at-1' })
  })

  it('is null when nobody is signed in, without asking the server', async () => {
    const { profiles, calls } = setup(res(200, []), authOf(null))
    expect(await profiles.get()).toBeNull()
    expect(await profiles.update({ display_name: 'x' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('changes only the allowed fields and returns the row as the server now has it', async () => {
    const { profiles, calls } = setup(res(200, [{ id: 'u-1', display_name: 'Sam', experience: 'advanced', node_uid: null }]))
    const out = await profiles.update({ experience: 'advanced', node_uid: 'mine-now' })
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: '/rest/v1/profiles?id=eq.u-1&select=id,display_name,experience,node_uid', body: { experience: 'advanced' } })
    expect(calls[0].headers.Prefer).toBe('return=representation')
    expect(out.experience).toBe('advanced')
  })

  it('does not call the server with nothing to change', async () => {
    const { profiles, calls } = setup(res(200, []))
    expect(await profiles.update({ node_uid: 'x' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('says so when the server refuses or cannot be reached', async () => {
    const refused = setup(res(403, { message: 'permission denied' }))
    await expect(refused.profiles.get()).rejects.toMatchObject({ code: 'refused', status: 403 })
    const down = setup(() => { throw new TypeError('offline') })
    await expect(down.profiles.get()).rejects.toMatchObject({ code: 'network' })
  })
})
