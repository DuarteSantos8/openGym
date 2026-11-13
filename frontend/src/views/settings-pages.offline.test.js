// openGym Offline (lib/build-caps.js) in Settings: nothing that needs a network is a page or a
// search hit, and the network log is there in the phone app only.
import { describe, expect, it } from 'vitest'
import { pageVisible, searchSettings } from './settings-pages.js'

const tr = s => s
const phone = { mobile: true, android: true, mod: () => true, user: null }
const offline = { ...phone, offline: true }

describe('Settings in openGym Offline', () => {
  it('has no Coach, Zepp or token pages, and keeps the network log', () => {
    expect(pageVisible('coach', phone)).toBe(true)
    expect(pageVisible('coach', offline)).toBe(false)
    expect(pageVisible('zepp', offline)).toBe(false)
    expect(pageVisible('api-tokens', { ...offline, user: { id: 'u' }, apiTokens: true })).toBe(false)
    expect(pageVisible('network', offline)).toBe(true)
    expect(pageVisible('network', phone)).toBe(true)
    expect(pageVisible('network', { mobile: false })).toBe(false)
  })

  it('finds no row that would need the network', () => {
    const titles = (q, c) => searchSettings(q, c, tr).map(h => h.title)
    expect(titles('connect to my server', phone)).toContain('Connect to my server')
    expect(titles('connect to my server', offline)).not.toContain('Connect to my server')
    expect(titles('hevy', offline)).not.toContain('Import from Hevy')
    expect(titles('hevy', offline)).not.toContain('Hevy')
    expect(titles('hevy', phone)).toContain('Import from Hevy')
    expect(titles('check for updates', offline)).toEqual([])
    expect(titles('network log', offline)).toContain('Network log')
    expect(titles('ai coach', offline)).not.toContain('AI Coach')
  })
})
