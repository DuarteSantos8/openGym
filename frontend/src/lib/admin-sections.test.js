import { describe, expect, it } from 'vitest'
import { ADMIN_SECTIONS, adminSections, adminSectionOf, shownAdminSection } from './admin-sections.js'

const ids = config => adminSections(config).map(([id]) => id)
const BASE = ['overview', 'users', 'invites', 'coach', 'activity']

describe('adminSections', () => {
  it('offers only the always-on sections on a bare instance', () => {
    expect(ids({})).toEqual(BASE)
    expect(ids(undefined)).toEqual(BASE)
  })
  it('adds sign-in, community library and gyms when the config has them', () => {
    expect(ids({ oidc: { label: 'SSO' } })).toContain('signin')
    expect(ids({ shared: { types: [] } })).toContain('community')
    expect(ids({ trainers: { on: true } })).toContain('gyms')
    expect(ids({ trainers: { on: false } })).not.toContain('gyms')
  })
  it('keeps the declared order', () => {
    const all = ids({ oidc: {}, shared: { types: [] }, trainers: { on: true } })
    expect(all).toEqual(ADMIN_SECTIONS.map(([id]) => id))
  })
})

describe('adminSectionOf', () => {
  it('reads the section from the path, overview for /admin or unknown', () => {
    expect(adminSectionOf('/admin')).toBe('overview')
    expect(adminSectionOf('/admin/users')).toBe('users')
    expect(adminSectionOf('/admin/nope')).toBe('overview')
    expect(adminSectionOf(undefined)).toBe('overview')
  })
})

describe('shownAdminSection', () => {
  it('is the offered section the path names', () => {
    expect(shownAdminSection('/admin/gyms', { trainers: { on: true } })).toBe('gyms')
    expect(shownAdminSection('/admin/coach', {})).toBe('coach')
  })
  it('is the overview for an unknown section', () => {
    expect(shownAdminSection('/admin/nope', {})).toBe('overview')
    expect(shownAdminSection('/admin', {})).toBe('overview')
  })
  it('falls back to the overview for a section this instance switched off', () => {
    expect(shownAdminSection('/admin/gyms', {})).toBe('overview')
    expect(shownAdminSection('/admin/signin', { trainers: { on: true } })).toBe('overview')
  })
})
