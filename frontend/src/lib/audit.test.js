import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { auditCat, auditLabel, auditReason, auditLine, fmtWhen } from './audit.js'

// Every event name and reason code the server can emit, read off api/server.js itself rather
// than kept as a second list here: the hand-kept copy silently missed the three pairing events
// for several releases, and the dashboard printed 'auth.pair.create' at the operator (QA C18).
// If a new one is added there without a label here, the first test fails rather than the
// dashboard quietly printing a dotted identifier at a person.
const SERVER = readFileSync(new URL('../../../api/server.js', import.meta.url), 'utf8')
const EVENTS = [...new Set([...SERVER.matchAll(/audit\(req, '([a-z.]+)'/g)].map(m => m[1]))]
const REASONS = [...new Set([...SERVER.matchAll(/msg: '([a-z-]+)'/g)].map(m => m[1]))]

describe('auditLabel', () => {
  it('has a sentence for every event the server emits', () => {
    for (const ev of EVENTS) {
      expect(auditLabel(ev), ev).not.toBe(ev)
      expect(auditLabel(ev)).toMatch(/^[A-Z]/)
    }
  })

  it('shows an unknown event raw instead of rendering undefined', () => {
    // A dashboard one version behind the server must still say something truthful.
    expect(auditLabel('auth.something.new')).toBe('auth.something.new')
    expect(auditLabel(undefined)).toBe('Unknown event')
    expect(auditLabel('')).toBe('Unknown event')
  })
})

describe('auditCat', () => {
  it('takes the filter category from the first segment', () => {
    expect(auditCat('auth.login.ok')).toBe('auth')
    expect(auditCat('admin.invite.create')).toBe('admin')
  })
  it('survives a missing event name', () => {
    expect(auditCat(undefined)).toBe('')
  })
  it('puts every known event in exactly auth or admin', () => {
    expect([...new Set(EVENTS.map(auditCat))].sort()).toEqual(['admin', 'auth'])
  })
})

describe('auditReason', () => {
  it('has plain English for every reason code', () => {
    for (const m of REASONS) {
      expect(auditReason(m), m).not.toBe(m)
      expect(auditReason(m).length).toBeGreaterThan(3)
    }
  })
  it('falls back to the raw code and tolerates none at all', () => {
    expect(auditReason('brand-new-code')).toBe('brand-new-code')
    expect(auditReason(undefined)).toBe('')
  })
})

describe('auditLine', () => {
  it('reads the server lists off api/server.js, pairing events included', () => {
    // Guards the extraction itself: an empty match would make the two loops above vacuous.
    expect(EVENTS).toEqual(expect.arrayContaining(['auth.login.ok', 'auth.pair.create', 'auth.pair.ok', 'auth.pair.fail', 'admin.audit.clear']))
    expect(REASONS).toEqual(expect.arrayContaining(['challenge-expired', 'code-invalid', 'user-unavailable']))
    expect(auditLine({ ev: 'auth.pair.fail', ok: false, msg: 'code-invalid' })).toEqual({ title: 'Pairing failed', sub: 'unknown caller · wrong or expired pairing code' })
    expect(auditLine({ ev: 'auth.pair.ok', ok: true, name: 'Verifier' })).toEqual({ title: 'Paired a phone', sub: 'Verifier' })
  })

  it('names the person who did it', () => {
    expect(auditLine({ ev: 'auth.login.ok', ok: true, uid: 'u1', name: 'Duarte' }))
      .toEqual({ title: 'Signed in', sub: 'Duarte' })
  })

  it('shows both sides of an admin action', () => {
    const l = auditLine({ ev: 'admin.user.disable', ok: true, uid: 'a', name: 'Duarte', tgt: 'b', tname: 'Ana' })
    expect(l.title).toBe('Disabled an account')
    expect(l.sub).toBe('Duarte · → Ana')
  })

  it('translates the reason on a failure but not the invite code on a success', () => {
    expect(auditLine({ ev: 'auth.login.fail', ok: false, msg: 'unknown-credential' }).sub)
      .toBe('unknown caller · unknown passkey')
    // admin.invite.* put the actual code in msg — that must not be run through auditReason.
    expect(auditLine({ ev: 'admin.invite.create', ok: true, name: 'Duarte', msg: 'A1B2C3D4' }).sub)
      .toBe('Duarte · A1B2C3D4')
  })

  it('says "unknown caller" only when a failure carries no identity', () => {
    expect(auditLine({ ev: 'auth.login.fail', ok: false }).sub).toBe('unknown caller')
    // A successful event without a name is not an anonymous attacker, so it stays blank.
    expect(auditLine({ ev: 'auth.logout', ok: true }).sub).toBe('')
  })

  it('falls back to the uid when the name was never recorded', () => {
    expect(auditLine({ ev: 'auth.login.fail', ok: false, uid: 'Xy1', msg: 'user-missing' }).sub)
      .toBe('Xy1 · the passkey points at a profile that no longer exists')
  })

  it('appends the network when the operator opted into IPs', () => {
    expect(auditLine({ ev: 'auth.login.ok', ok: true, name: 'Duarte', ip: '203.0.113.0/24' }).sub)
      .toBe('Duarte · 203.0.113.0/24')
  })

  it('renders nothing rather than throwing on a missing record', () => {
    expect(auditLine(undefined)).toEqual({ title: '', sub: '' })
  })
})

describe('fmtWhen', () => {
  const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime()
  const now = at(2026, 8, 23, 15, 0)   // Sunday

  it('says "today" for the same calendar day', () => {
    expect(fmtWhen(at(2026, 8, 23, 9, 5), now)).toMatch(/^today /)
    expect(fmtWhen(at(2026, 8, 23, 0, 1), now)).toMatch(/^today /)
  })

  it('uses the weekday inside the last six days', () => {
    const s = fmtWhen(at(2026, 8, 21, 18, 30), now)
    expect(s).not.toMatch(/^today/)
    expect(s).toMatch(/^[A-Za-zÀ-ÿ.]+ \d/)
  })

  it('falls back to a date once it is older', () => {
    expect(fmtWhen(at(2026, 8, 12, 14, 32), now)).toMatch(/\d/)
    expect(fmtWhen(at(2026, 8, 12, 14, 32), now)).not.toMatch(/^today/)
  })

  it('always carries a time of day — that is the whole point of not reusing fmtDate', () => {
    for (const ts of [at(2026, 8, 23, 9, 5), at(2026, 8, 21, 18, 30), at(2026, 8, 12, 14, 32)]) {
      expect(fmtWhen(ts, now)).toMatch(/\d{1,2}[:.]\d{2}/)
    }
  })

  it('does not call a future timestamp "3 days ago"', () => {
    // Clock skew between server and browser is real; a tomorrow must not read as a weekday.
    expect(fmtWhen(at(2026, 8, 30, 10, 0), now)).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
  })

  it('returns an empty string for a missing timestamp', () => {
    expect(fmtWhen(0)).toBe('')
    expect(fmtWhen(undefined)).toBe('')
  })
})
