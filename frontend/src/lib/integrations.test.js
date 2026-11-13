// Settings → Integrations (v1.4.4): which card shows where, and what it says.
import { describe, expect, it } from 'vitest'
import { cardState, directory, webhookUrlProblem, normalizeWebhookUrl, CARDS, WORKS_WITH, PILL } from './integrations.js'

const web = { mobile: false, platform: null, user: null, demo: false, health: null, server: null, offered: [] }
const ids = ctx => directory(ctx).flatMap(c => c.cards.map(x => x.id))

describe('the directory', () => {
  it('a guest in a browser sees the phone-only stores as such, and webhooks as needing a server', () => {
    expect(cardState('apple-health', web)).toEqual({ status: 'device', action: null })
    expect(cardState('health-connect', web)).toEqual({ status: 'device', action: null })
    expect(cardState('webhook', web)).toEqual({ status: 'server', action: null })
    expect(cardState('mcp', web)).toEqual({ status: 'server', action: null })
    expect(ids(web)).not.toContain('coach')   // the server's Coach, not offered here
    expect(directory(web).map(c => c.id)).toEqual(['health', 'training', 'automation', 'ai', 'sister'])
  })

  // #1105: files and backups live on Data & backup only; this page is the live links to other services.
  it('holds no file or backup action, and the calendar feed sits with the automation', () => {
    for (const ctx of [web, { ...web, user: { id: 'u' }, tokens: true }, { ...web, mobile: true, platform: 'ios' }]) {
      for (const id of ['hevy', 'files', 'csv', 'webdav']) expect(ids(ctx)).not.toContain(id)
    }
    const dir = directory({ ...web, user: { id: 'u' }, tokens: true, offered: ['webhook'] })
    expect(dir.find(c => c.id === 'automation').cards.map(c => c.id)).toEqual(['calendar', 'webhook'])
  })

  it('openNutrition (gm-hooks): this device links itself, no server needed; off until linked, never in the demo', () => {
    expect(cardState('opennutrition', web)).toEqual({ status: 'off', action: 'connect' })
    expect(cardState('opennutrition', { ...web, nutrition: { url: 'https://n.example', at: 1 } })).toEqual({ status: 'connected', action: 'manage' })
    expect(cardState('opennutrition', { ...web, nutrition: { url: 'https://n.example', error: 'revoked' } })).toEqual({ status: 'attention', action: 'manage' })
    expect(cardState('opennutrition', { ...web, demo: true })).toBeNull()
    expect(ids({ ...web, mod: id => id !== 'integrations' })).not.toContain('opennutrition')
  })

  it('a phone reading only vitals or sport counts as connected, not off', () => {
    const android = { ...web, mobile: true, platform: 'android' }
    for (const k of ['readBody', 'readVitals', 'readSport']) expect(cardState('health-connect', { ...android, health: { status: 'available', [k]: true } }).status).toBe('connected')
  })

  it('a phone shows its own store only, by what the store says', () => {
    const android = { ...web, mobile: true, platform: 'android', health: { status: 'available', on: false } }
    expect(cardState('apple-health', android)).toBeNull()
    expect(cardState('health-connect', android)).toEqual({ status: 'off', action: 'connect' })
    expect(cardState('health-connect', { ...android, health: { status: 'available', readHr: true } }).status).toBe('connected')
    expect(cardState('health-connect', { ...android, health: { status: 'available', on: true, error: 'permission' } })).toEqual({ status: 'attention', action: 'manage' })
    expect(cardState('health-connect', { ...android, health: { status: 'missing' } })).toEqual({ status: 'off', action: 'connect' })
    expect(cardState('health-connect', { ...android, health: { status: 'unsupported' } }).status).toBe('device')
    const ios = { ...web, mobile: true, platform: 'ios', health: { status: 'available', on: true } }
    expect(cardState('health-connect', ios)).toBeNull()
    expect(cardState('apple-health', ios).status).toBe('connected')
    // A phone kept local: webhooks need a server, the Coach is the phone's own.
    expect(cardState('webhook', ios).status).toBe('server')
    expect(cardState('coach', { ...ios, coachMode: 'byok' })).toEqual({ status: 'connected', action: 'manage' })
    expect(cardState('coach', ios)).toEqual({ status: 'off', action: 'connect' })
  })

  it('webhooks: hidden where the server does not offer them, except to its admin', () => {
    const user = { ...web, user: { id: 'u1' } }
    expect(cardState('webhook', user)).toBeNull()
    expect(cardState('webhook', { ...user, admin: true })).toEqual({ status: 'off', action: 'open' })
    const on = { ...user, offered: ['webhook'], server: { providers: [{ id: 'webhook' }], connections: [] } }
    expect(cardState('webhook', on)).toEqual({ status: 'off', action: 'connect' })
    const conn = s => ({ ...on, server: { connections: [{ provider: 'webhook', status: s, paused: s === 'paused' }] } })
    expect(cardState('webhook', conn('connected'))).toEqual({ status: 'connected', action: 'manage' })
    expect(cardState('webhook', conn('attention'))).toEqual({ status: 'attention', action: 'manage' })
    expect(cardState('webhook', conn('paused')).status).toBe('off')
    expect(cardState('mcp', user)).toEqual({ status: null, action: 'open' })
  })

  it('the demo has no server', () => {
    const demo = { ...web, demo: true }
    expect(cardState('webhook', demo).status).toBe('server')
  })

  it('every card says what it does, and the "works with" list has no Connect of its own', () => {
    for (const c of CARDS) { expect(c.desc).toBeTruthy(); expect(c.syncs.length).toBeGreaterThan(0) }
    expect(WORKS_WITH.map(w => w.name)).toEqual(['Garmin', 'COROS', 'Polar', 'Fitbit', 'Samsung Health', 'Oura', 'Withings', 'Renpho'])
    expect(WORKS_WITH.every(w => ['hr', 'weight', 'both'].includes(w.reads))).toBe(true)
    expect(Object.keys(PILL)).toEqual(['connected', 'off', 'attention', 'device', 'server'])
  })
})

describe('webhookUrlProblem', () => {
  it('asks for https, or http on a server that opened the home network', () => {
    expect(webhookUrlProblem('')).toMatch(/Paste/)
    expect(webhookUrlProblem('nope')).toMatch(/URL/)
    expect(webhookUrlProblem('http://192.168.1.2:8123/x')).toMatch(/https/)
    expect(webhookUrlProblem('http://192.168.1.2:8123/x', { lan: true })).toBeNull()
    expect(webhookUrlProblem('https://ha.example.com/api/webhook/x')).toBeNull()
    expect(webhookUrlProblem('ftp://x.example.com', { lan: true })).toMatch(/http:\/\//)
  })
})

describe('normalizeWebhookUrl', () => {
  it('puts https:// in front of a pasted host and path, and leaves the rest alone', () => {
    expect(normalizeWebhookUrl(' ha.example.com/api/webhook/x ')).toBe('https://ha.example.com/api/webhook/x')
    expect(normalizeWebhookUrl('homeassistant.local:8123/api/webhook/x')).toBe('https://homeassistant.local:8123/api/webhook/x')
    expect(normalizeWebhookUrl('http://192.168.1.5:8123/x')).toBe('http://192.168.1.5:8123/x')
    expect(normalizeWebhookUrl('ftp://nas/x')).toBe('ftp://nas/x')
    expect(normalizeWebhookUrl('not a url')).toBe('not a url')
    expect(normalizeWebhookUrl('')).toBe('')
  })
})

describe('the calendar card', () => {
  it('needs the server and its tokens, and says when it is on', async () => {
    const { cardState } = await import('./integrations.js')
    expect(cardState('calendar', { user: null })).toEqual({ status: 'server', action: null })
    expect(cardState('calendar', { user: { id: 'u' }, tokens: false })).toBeNull()
    expect(cardState('calendar', { user: { id: 'u' }, tokens: true, calendar: { on: false } })).toEqual({ status: 'off', action: 'connect' })
    expect(cardState('calendar', { user: { id: 'u' }, tokens: true, calendar: { on: true } })).toEqual({ status: 'connected', action: 'manage' })
  })
})

describe('the Strava card (#478)', () => {
  it('only where the server offers it, an admin is told how; then connect, connected or attention', async () => {
    const { cardState } = await import('./integrations.js')
    const u = { user: { id: 'u' } }
    expect(cardState('strava', { user: null })).toEqual({ status: 'server', action: null })
    expect(cardState('strava', { ...u, offered: ['webhook'] })).toBeNull()
    expect(cardState('strava', { ...u, admin: true, offered: [] })).toEqual({ status: 'off', action: 'open' })
    expect(cardState('strava', { ...u, offered: ['strava'], server: { connections: [] } })).toEqual({ status: 'off', action: 'connect' })
    expect(cardState('strava', { ...u, offered: ['strava'], server: { connections: [{ provider: 'strava', status: 'connected' }] } })).toEqual({ status: 'connected', action: 'manage' })
    expect(cardState('strava', { ...u, offered: ['strava'], server: { connections: [{ provider: 'strava', status: 'attention' }] } })).toEqual({ status: 'attention', action: 'manage' })
  })
})
