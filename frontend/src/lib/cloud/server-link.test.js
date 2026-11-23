import { describe, expect, it } from 'vitest'
import { createServerLink, LINK_KEY } from './server-link.js'

const box = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) }, m } }
const server = { id: 7, name: 'Sam' }

describe('whose server profile this is', () => {
  it('with nothing noted, a server profile is left alone: an admin with a passkey, or one from before', () => {
    const link = createServerLink(box())
    expect(link.check({ hostedId: null, serverUser: server })).toBe('ok')
    expect(link.check({ hostedId: 'u-1', serverUser: server })).toBe('ok')
    expect(link.check({ hostedId: 'u-1', serverUser: null })).toBe('ok')
  })

  it('Continue notes who is on their way; back with a server profile, it is theirs', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    // a new page load: a new object over the same storage
    const link = createServerLink(s)
    expect(link.check({ hostedId: 'u-1', serverUser: server })).toBe('ok')
    expect(link.owner()).toBe('u-1')
  })

  it('signed out of the account afterwards: the server profile is not theirs to leave open', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    const link = createServerLink(s)
    link.check({ hostedId: 'u-1', serverUser: server })
    expect(link.check({ hostedId: null, serverUser: server })).toBe('end')
  })

  it('someone else signed in to the account: the same', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    const link = createServerLink(s)
    link.check({ hostedId: 'u-1', serverUser: server })
    expect(link.check({ hostedId: 'u-2', serverUser: server })).toBe('end')
    // and it goes on saying so until the server profile is gone
    expect(link.check({ hostedId: 'u-2', serverUser: server })).toBe('end')
    expect(link.check({ hostedId: 'u-2', serverUser: null })).toBe('ok')
    expect(link.owner()).toBeNull()
  })

  it('this also holds over a reload: the note is kept with the browser, not the page', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    createServerLink(s).check({ hostedId: 'u-1', serverUser: server })
    expect(createServerLink(s).check({ hostedId: null, serverUser: server })).toBe('end')
  })

  it('a sign-in that did not come back with a profile leaves no note behind', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    const link = createServerLink(s)          // back, refused: no server profile
    expect(link.check({ hostedId: 'u-1', serverUser: null })).toBe('ok')
    expect(link.owner()).toBeNull()
    // so an admin's passkey sign-in later, with the account signed out, is not ended
    expect(link.check({ hostedId: null, serverUser: server })).toBe('ok')
  })

  it('on the page that is about to leave, the note survives a check that sees no profile yet', () => {
    const link = createServerLink(box())
    link.leaving('u-1')
    expect(link.check({ hostedId: 'u-1', serverUser: null })).toBe('ok')
    expect(link.owner()).toBe('u-1')
  })

  it('came back as someone else than left: not theirs', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    expect(createServerLink(s).check({ hostedId: 'u-2', serverUser: server })).toBe('end')
  })

  it('the server profile ended elsewhere: the note goes with it', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    const link = createServerLink(s)
    link.check({ hostedId: 'u-1', serverUser: server })
    expect(link.check({ hostedId: 'u-1', serverUser: null })).toBe('ok')
    expect(link.owner()).toBeNull()
  })

  it('keeps an id and nothing else, and reads rubbish as nothing', () => {
    const s = box()
    createServerLink(s).leaving('u-1')
    expect(JSON.parse(s.m.get(LINK_KEY))).toEqual({ id: 'u-1', state: 'pending' })
    s.setItem(LINK_KEY, '{not json')
    expect(createServerLink(s).owner()).toBeNull()
    s.setItem(LINK_KEY, JSON.stringify({ id: 5, state: 'linked' }))
    expect(createServerLink(s).owner()).toBeNull()
  })

  it('works without storage, for the life of the page', () => {
    const link = createServerLink(null)
    link.leaving('u-1')
    expect(link.owner()).toBe('u-1')
    const refuses = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') }, removeItem() { throw new Error('no') } }
    const other = createServerLink(refuses)
    other.leaving('u-1')
    expect(other.owner()).toBe('u-1')
  })
})
