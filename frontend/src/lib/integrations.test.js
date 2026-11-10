// Settings → Integrations (v1.4.4): which card shows where, and what it says.
import { describe, expect, it } from 'vitest'
import { cardState, directory, webhookUrlProblem, normalizeWebhookUrl, oauthResult, oauthStartPath, CARDS, WORKS_WITH, PILL } from './integrations.js'

const web = { mobile: false, platform: null, user: null, demo: false, health: null, server: null, offered: [] }
const ids = ctx => directory(ctx).flatMap(c => c.cards.map(x => x.id))

describe('the directory', () => {
  it('a guest in a browser sees the phone-only stores as such, and webhooks as needing a server', () => {
    expect(cardState('apple-health', web)).toEqual({ status: 'device', action: null })
    expect(cardState('health-connect', web)).toEqual({ status: 'device', action: null })
    expect(cardState('webhook', web)).toEqual({ status: 'server', action: null })
    expect(cardState('mcp', web)).toEqual({ status: 'server', action: null })
    expect(ids(web)).not.toContain('coach')   // the server's Coach, not offered here
    expect(directory(web).map(c => c.id)).toEqual(['health', 'training', 'automation', 'ai'])
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

  it('Strava: needs a server that offers it, then one account, which can need a new sign-in', () => {
    expect(cardState('strava', web)).toEqual({ status: 'server', action: null })
    expect(cardState('strava', { ...web, demo: true }).status).toBe('server')
    const user = { ...web, user: { id: 'u1' } }
    expect(cardState('strava', user)).toBeNull()
    expect(cardState('strava', { ...user, offered: ['webhook'] })).toBeNull()
    expect(cardState('strava', { ...user, admin: true })).toEqual({ status: 'off', action: 'open' })
    const on = { ...user, offered: ['webhook', 'strava'], server: { connections: [{ provider: 'webhook', status: 'attention' }] } }
    expect(cardState('strava', on)).toEqual({ status: 'off', action: 'connect' })
    const conn = (status, paused = false) => ({ ...on, server: { connections: [{ provider: 'strava', status, paused }] } })
    expect(cardState('strava', conn('connected'))).toEqual({ status: 'connected', action: 'manage' })
    expect(cardState('strava', conn('paused', true))).toEqual({ status: 'off', action: 'manage' })
    expect(cardState('strava', conn('attention', true))).toEqual({ status: 'attention', action: 'manage' })
    // A paired phone sees the connection its server holds.
    expect(cardState('strava', { ...conn('connected'), mobile: true, platform: 'ios' }).status).toBe('connected')
    // With the training apps, and gone with the Integrations module.
    expect(directory(on).find(c => c.id === 'training').cards.map(c => c.id)).toEqual(['hevy', 'files', 'csv', 'strava'])
    expect(directory({ ...on, mod: id => id !== 'integrations' }).flatMap(c => c.cards.map(x => x.id))).not.toContain('strava')
  })

  it('back from a sign-in: the hash says which provider and how it went', () => {
    expect(oauthStartPath('strava')).toBe('/api/integrations/oauth/authorize?provider=strava')
    expect(oauthResult('#/settings/integrations?oauth=strava&result=connected')).toEqual({ provider: 'strava', result: 'connected', message: 'Strava connected. New workouts upload on their own.' })
    expect(oauthResult('#/settings/integrations?oauth=strava&result=denied').message).toBe('Strava connection cancelled')
    for (const r of ['scope', 'signin', 'off', 'error']) expect(oauthResult(`#/settings/integrations?oauth=strava&result=${r}`).message).toBeTruthy()
    expect(oauthResult('#/settings/integrations')).toBeNull()
    expect(oauthResult('#/settings/integrations?oauth=strava&result=constructor')).toBeNull()
    expect(oauthResult('#/settings/integrations?oauth=__proto__&result=connected')).toBeNull()
    expect(oauthResult('')).toBeNull()
  })

  it('the demo has no Hevy key to spend and no server', () => {
    const demo = { ...web, demo: true }
    expect(cardState('hevy', demo)).toBeNull()
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
