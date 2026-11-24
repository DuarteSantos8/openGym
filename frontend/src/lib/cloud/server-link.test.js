import { describe, expect, it } from 'vitest'
import { createServerLink, LINK_KEY, PENDING_MS, ENDED_MS } from './server-link.js'

const box = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) }, m } }
const sam = { id: 7, name: 'Sam' }
const admin = { id: 1, name: 'Admin' }
// One browser, any number of tabs: each tab is its own object over the same storage and clock.
function browser() {
  const s = box()
  let t = 1_000_000
  return { s, tab: () => createServerLink(s, () => t), tick: ms => { t += ms } }
}
const linked = (b, hosted = 'u-1', server = sam) => { b.tab().leaving(hosted); const tab = b.tab(); tab.check({ hostedId: hosted, serverUser: server }); return tab }

describe('whose server profile this is', () => {
  it('with nothing noted, a server profile is left alone: an admin with a passkey, or one from before', () => {
    const tab = browser().tab()
    expect(tab.check({ hostedId: null, serverUser: admin })).toBe('ok')
    expect(tab.check({ hostedId: 'u-1', serverUser: admin })).toBe('ok')
    expect(tab.ownerOf(admin)).toBeNull()
  })

  it('Continue notes who is on their way; back with a server profile, that profile is theirs', () => {
    const b = browser()
    b.tab().leaving('u-1')
    const tab = b.tab()                       // a new page load
    expect(tab.ownerOf(sam)).toBeNull()       // not yet: nothing has come back
    expect(tab.check({ hostedId: 'u-1', serverUser: sam })).toBe('ok')
    expect(tab.ownerOf(sam)).toBe('u-1')
    expect(JSON.parse(b.s.m.get(LINK_KEY))).toEqual({ id: 'u-1', state: 'linked', server: '7' })
  })

  it('signed out of the account, or someone else signed in: that profile has to be ended, and it goes on saying so', () => {
    const b = browser(), tab = linked(b)
    expect(tab.check({ hostedId: null, serverUser: sam })).toBe('end')
    expect(tab.check({ hostedId: 'u-2', serverUser: sam })).toBe('end')
    expect(b.tab().check({ hostedId: 'u-2', serverUser: sam })).toBe('end')   // over a reload, in any tab
    expect(tab.check({ hostedId: 'u-1', serverUser: sam })).toBe('ok')
  })

  it('a different profile on the server than the one opened through the account is none of its business', () => {
    const tab = linked(browser())
    expect(tab.check({ hostedId: null, serverUser: admin })).toBe('ok')
    expect(tab.ownerOf(admin)).toBeNull()
    expect(tab.ownerOf(sam)).toBe('u-1')      // and the note stands
  })

  // Found in review of #79: a tab that did not see the server profile (yet) threw the note
  // away, and the profile that then arrived belonged to nobody and was never ended.
  it('a tab that sees no server profile does not throw the note away, pending or linked', () => {
    const b = browser()
    b.tab().leaving('u-1')
    expect(b.tab().check({ hostedId: 'u-1', serverUser: null })).toBe('ok')    // another tab, while consent is open
    expect(b.tab().check({ hostedId: null, serverUser: null })).toBe('ok')
    const back = b.tab()
    expect(back.check({ hostedId: 'u-1', serverUser: sam })).toBe('ok')        // the first tab comes back
    expect(back.ownerOf(sam)).toBe('u-1')
    expect(b.tab().check({ hostedId: 'u-1', serverUser: null })).toBe('ok')    // a tab that has not caught up
    expect(b.tab().check({ hostedId: null, serverUser: sam })).toBe('end')     // still known whose it is
  })

  it('a sign-in that never came back stops counting after a while', () => {
    const b = browser()
    b.tab().leaving('u-1')
    b.tick(PENDING_MS + 1)
    // so an admin's passkey sign-in later, with the account signed out, is not ended
    expect(b.tab().check({ hostedId: null, serverUser: admin })).toBe('ok')
    expect(b.s.m.has(LINK_KEY)).toBe(false)
  })

  it('came back as someone else than left, while the attempt still counts: not theirs', () => {
    const b = browser()
    b.tab().leaving('u-1')
    expect(b.tab().check({ hostedId: 'u-2', serverUser: sam })).toBe('end')
    expect(b.tab().check({ hostedId: null, serverUser: sam })).toBe('end')
  })

  it('the next person to go through the sign-in replaces the note', () => {
    const b = browser()
    linked(b, 'u-1', sam)
    const tab = linked(b, 'u-2', { id: 9, name: 'Kim' })
    expect(tab.ownerOf({ id: 9 })).toBe('u-2')
    expect(tab.ownerOf(sam)).toBeNull()
  })

  // The tab that signs out ends the server profile itself. Other tabs still show it, and nothing
  // else tells them: for a short while the note says "ended", so they let go as well.
  it('ended: other tabs with that profile let go of it too, whoever is signed in by then', () => {
    const b = browser(), tab = linked(b)
    tab.ended()
    expect(tab.ownerOf(sam)).toBeNull()
    expect(b.tab().check({ hostedId: null, serverUser: sam })).toBe('end')
    expect(b.tab().check({ hostedId: 'u-1', serverUser: sam })).toBe('end')
    expect(b.tab().check({ hostedId: null, serverUser: admin })).toBe('ok')     // another profile: not its business
    expect(b.tab().check({ hostedId: null, serverUser: null })).toBe('ok')
    b.tick(ENDED_MS + 1)
    // after that it is over: an admin opening that same profile with a passkey is left alone
    expect(b.tab().check({ hostedId: null, serverUser: sam })).toBe('ok')
    expect(b.s.m.has(LINK_KEY)).toBe(false)
  })

  it('ended changes nothing while a sign-in is still out, or when nothing was noted', () => {
    const b = browser()
    b.tab().ended()
    expect(b.s.m.has(LINK_KEY)).toBe(false)
    b.tab().leaving('u-1')
    b.tab().ended()                                   // signed out of the account while consent is open elsewhere
    expect(b.tab().check({ hostedId: null, serverUser: sam })).toBe('end')      // the profile that then arrives is not theirs
  })

  it('pauses the ended note during deletion, then restores it on failure or timeout', () => {
    const b = browser(), tab = linked(b)
    tab.ended()
    const finish = tab.beginDeletion('u-1')
    const seen = { hostedId: 'u-1', serverUser: sam }
    expect(b.tab().check(seen)).toBe('ok')
    finish()
    expect(b.tab().check(seen)).toBe('end')
    tab.beginDeletion('u-1')
    b.tick(30_001)
    expect(b.tab().check(seen)).toBe('end')
  })
  it('does not suppress a different account while deletion is pending', () => {
    const b = browser(), tab = linked(b)
    tab.beginDeletion('u-1')
    expect(b.tab().check({ hostedId: 'u-2', serverUser: sam })).toBe('end')
  })
  it('going through the sign-in again replaces an ended note at once', () => {
    const b = browser(), tab = linked(b)
    tab.ended()
    b.tab().leaving('u-1')
    expect(b.tab().check({ hostedId: 'u-1', serverUser: sam })).toBe('ok')
    expect(b.tab().ownerOf(sam)).toBe('u-1')
  })

  it('keeps ids and nothing else, and reads rubbish as nothing', () => {
    const b = browser()
    b.tab().leaving('u-1')
    expect(JSON.parse(b.s.m.get(LINK_KEY))).toEqual({ id: 'u-1', state: 'pending', at: 1_000_000 })
    for (const bad of ['{not json', JSON.stringify({ id: 5, state: 'linked', server: '7' }), JSON.stringify({ id: 'u-1', state: 'linked' }), JSON.stringify({ id: 'u-1', state: 'pending' }), JSON.stringify({ id: 'u-1', state: 'ended', server: '7' }), JSON.stringify({ id: 'u-1', state: 'other', at: 1 })]) {
      b.s.setItem(LINK_KEY, bad)
      expect(b.tab().check({ hostedId: null, serverUser: sam })).toBe('ok')
    }
    b.tab().leaving('')
    b.tab().leaving(5)
  })

  it('works without storage, for the life of the page', () => {
    const tab = createServerLink(null, () => 5)
    tab.leaving('u-1')
    tab.check({ hostedId: 'u-1', serverUser: sam })
    expect(tab.ownerOf(sam)).toBe('u-1')
    const refuses = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') }, removeItem() { throw new Error('no') } }
    const other = createServerLink(refuses, () => 5)
    other.leaving('u-1')
    other.check({ hostedId: 'u-1', serverUser: sam })
    expect(other.check({ hostedId: null, serverUser: sam })).toBe('end')
  })
})
