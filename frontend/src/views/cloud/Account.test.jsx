// @vitest-environment happy-dom
// The Cloud edition's account screen, against a pretend client: every step someone can be on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Account, { wordFor, forgetLink } from './Account.jsx'
import { RESET_KEY } from '../../lib/cloud/pending-reset.js'
import { cloudAccount, setCloudAccount } from '../../lib/account-badge.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null; forgetLink(); window.sessionStorage.clear(); setCloudAccount(null) })

const err = code => Object.assign(new Error(code), { code })
function fakeClient({ session = null, profile = { display_name: 'Sam' } } = {}) {
  let current = session
  const listeners = new Set()
  const set = s => { current = s; listeners.forEach(fn => fn(s)) }
  const user = { id: 'u-1', email: 'a@example.com' }
  const auth = {
    session: () => current,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    signIn: vi.fn(async (email, password) => { if (password !== 'right-password') throw err('invalid_credentials'); set({ user }) }),
    signUp: vi.fn(async () => ({ session: null, needsConfirmation: true })),
    signOut: vi.fn(async () => set(null)),
    recover: vi.fn(async () => {}),
    verify: vi.fn(async () => set({ user })),
    updatePassword: vi.fn(async () => {}),
    authorization: vi.fn(async () => ({ client: { name: 'Ironvane server' } })),
    consent: vi.fn(async (_id, ok) => ({ redirectTo: ok ? 'https://api.example/cb?code=1' : 'https://api.example/cb?error=access_denied' })),
  }
  const profiles = { get: vi.fn(async () => profile), update: vi.fn(async p => ({ ...profile, ...p })) }
  const fn = vi.fn(async name => (name === 'export-account' ? { status: 200, data: { account: user } } : { status: 200, data: { deleted: true } }))
  return { auth, profiles, fn, set, user }
}

let where = ''
function Where() { where = useLocation().pathname; return null }
const noServer = () => ({ user: () => null, signOut: vi.fn(async () => ({ owed: false })) })
const noNote = () => ({ leaving: vi.fn(), ended: vi.fn(), ownerOf: () => null })
// The open server profile was opened through this account (lib/cloud/server-link.js).
const theirs = (id = 'u-1') => ({ ...noNote(), ownerOf: user => (user ? id : null) })
async function mount(client, { url = '/account', go = vi.fn(), enter = vi.fn(), link = vi.fn(), server = noServer(), note = noNote(), from = null } = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter initialEntries={from ? [from, url] : [url]} initialIndex={from ? 1 : 0}><Where /><Account client={client} go={go} enter={enter} link={link} server={server} note={note} /></MemoryRouter>) })
  await act(async () => {})
  return go
}
const $ = sel => container.querySelector(sel)
const mode = () => $('.iv-acct').dataset.mode
const type = async (name, value) => { const el = $(`input[name="${name}"]`); await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })) }) }
const submit = async (sel = 'form') => { await act(async () => { $(sel).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) }); await act(async () => {}) }
const click = async sel => { await act(async () => { $(sel).click() }); await act(async () => {}) }

describe('wordFor', () => {
  it('has words for what the server refuses, and never shows a raw code', () => {
    expect(wordFor('invalid_credentials')).toBe('That email or password is not right.')
    expect(wordFor('email_address_invalid')).toBe('That email address is not accepted.')
    expect(wordFor('network')).toMatch(/No connection/)
    for (const odd of ['some_new_code', undefined, null, '<script>']) expect(wordFor(odd)).toBe('Something went wrong. Try again.')
  })
})

describe('Account', () => {
  it('signs in, shows who is signed in, and signs out again', async () => {
    const c = fakeClient()
    await mount(c)
    expect(mode()).toBe('signin')
    expect($('.iv-acct-title').textContent).toBe('Sign in')
    expect($('[data-submit]').disabled).toBe(true)
    await type('email', 'a@example.com'); await type('password', 'right-password')
    await submit()
    expect(c.auth.signIn).toHaveBeenCalledWith('a@example.com', 'right-password')
    expect(mode()).toBe('account')
    expect($('.iv-acct-who').textContent).toContain('a@example.com')
    expect($('input[name="name"]').value).toBe('Sam')
    expect($('input[name="password"]')).toBeNull()
    await click('[data-signout]')
    expect(mode()).toBe('signin')
  })

  it('signing out is immediate: a slow server cannot undo what is tapped next', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    let finish
    c.auth.signOut.mockImplementationOnce(() => { c.set(null); return new Promise(r => { finish = r }) })
    await mount(c)
    await click('[data-signout]')
    expect(mode()).toBe('signin')
    await click('[data-go="signup"]')
    expect(mode()).toBe('signup')
    await act(async () => { finish() })
    expect(mode()).toBe('signup')
  })

  it('says a wrong password in words, as an alert, and stays on the form', async () => {
    const c = fakeClient()
    await mount(c)
    await type('email', 'a@example.com'); await type('password', 'nope')
    await submit()
    expect($('[role="alert"]').textContent).toBe('That email or password is not right.')
    expect(mode()).toBe('signin')
    expect(container.textContent).not.toContain('invalid_credentials')
  })

  it('creating an account asks for 8 characters and then says to check the inbox', async () => {
    const c = fakeClient()
    await mount(c)
    await click('[data-go="signup"]')
    expect($('.iv-acct-title').textContent).toBe('Create account')
    // a first password is a password, not a "new" one
    expect($('input[name="password"]').closest('label').querySelector('span').textContent).toBe('Password')
    await type('email', 'new@example.com'); await type('password', 'short')
    expect($('[data-submit]').disabled).toBe(true)
    await type('password', 'long-enough')
    await submit()
    expect(c.auth.signUp).toHaveBeenCalledWith('new@example.com', 'long-enough', expect.objectContaining({ redirectTo: expect.stringContaining('#/account') }))
    expect(mode()).toBe('sent')
    expect(container.textContent).toContain('new@example.com')
  })

  // Found by the owner on the real project: signing up with an address that already has an
  // account. The server answers exactly as for a new one and sends nothing, so that nobody can
  // probe which addresses are registered. The screen said "we sent a link" and stopped there.
  // It cannot know either, so it says what to do if nothing arrives, the same for everyone.
  it('after creating an account, says what to do if no email comes: sign in, or reset the password', async () => {
    const c = fakeClient()
    await mount(c)
    await click('[data-go="signup"]')
    await type('email', 'taken@example.com'); await type('password', 'long-enough')
    await submit()
    expect(mode()).toBe('sent')
    expect($('.iv-acct-hint').textContent).toBe('No email after a minute? This address may already have an account: sign in, or reset your password.')
    expect($('[data-go="signin"]')).not.toBeNull()
    await click('[data-go="forgot"]')
    expect(mode()).toBe('forgot')
    expect($('input[name="email"]').value).toBe('taken@example.com')   // not asked for twice
    await submit()
    expect(c.auth.recover).toHaveBeenCalledWith('taken@example.com', expect.any(Object))
    expect(mode()).toBe('sent')
    // a reset was asked for this time: offering another reset here would be a loop
    expect($('.iv-acct-hint')).toBeNull()
    expect($('[data-go="forgot"]')).toBeNull()
  })

  it('a forgotten password: the reset is asked for and the next step is the inbox', async () => {
    const c = fakeClient()
    await mount(c)
    await click('[data-go="forgot"]')
    await type('email', 'a@example.com')
    await submit()
    expect(c.auth.recover).toHaveBeenCalledWith('a@example.com', expect.any(Object))
    expect(mode()).toBe('sent')
  })

  it('a reset link signs in and goes straight to choosing a new password', async () => {
    const c = fakeClient()
    await mount(c, { url: '/account?token_hash=h-1&type=recovery' })
    expect(c.auth.verify).toHaveBeenCalledWith({ type: 'recovery', tokenHash: 'h-1' })
    expect(mode()).toBe('newpass')
    await type('password', 'a-new-long-password')
    await submit()
    expect(c.auth.updatePassword).toHaveBeenCalledWith('a-new-long-password')
    expect(mode()).toBe('account')
  })

  // Found by the cloud E2E: the app remounts a view when its address changes, and dropping the
  // link's hash from the address is such a change. The step must survive that.
  it('still asks for the new password after the screen is remounted', async () => {
    const c = fakeClient()
    await mount(c, { url: '/account?token_hash=h-1&type=recovery' })
    expect(mode()).toBe('newpass')
    act(() => root.unmount()); container.remove()
    await mount(c, { url: '/account' })
    expect(mode()).toBe('newpass')
    await type('password', 'a-new-long-password')
    await submit()
    expect(mode()).toBe('account')
    act(() => root.unmount()); container.remove()
    await mount(c, { url: '/account' })
    expect(mode()).toBe('account')
  })

  // Found in review of #66: the step was kept in the page's memory, so loading the page again
  // lost it while the session the link gave stayed, and the account opened with the old password
  // still in force. It is kept for the tab now, tied to the account the link signed in.
  it('still asks for the new password when the page is loaded again in the same tab', async () => {
    const c = fakeClient()
    await mount(c, { url: '/account?token_hash=h-1&type=recovery' })
    expect(window.sessionStorage.getItem(RESET_KEY)).toBe('u-1')
    act(() => root.unmount()); container.remove()
    forgetLink()                                        // a reload: the page's memory is gone, the tab's is not
    await mount(c, { url: '/account' })
    expect(mode()).toBe('newpass')
    await type('password', 'a-new-long-password')
    await submit()
    expect(mode()).toBe('account')
    expect(window.sessionStorage.getItem(RESET_KEY)).toBeNull()
  })

  it('a reset left unfinished is not asked of a different account, and signing out forgets it', async () => {
    window.sessionStorage.setItem(RESET_KEY, 'u-other')
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    expect(mode()).toBe('account')
    expect(window.sessionStorage.getItem(RESET_KEY)).toBeNull()

    window.sessionStorage.setItem(RESET_KEY, 'u-1')
    act(() => root.unmount()); container.remove()
    await mount(c)
    expect(mode()).toBe('newpass')
    await act(async () => { c.set(null) })
    expect(mode()).toBe('signin')
    expect(window.sessionStorage.getItem(RESET_KEY)).toBeNull()
  })

  it('a dead link still says so after the screen is remounted, until something else is done', async () => {
    const c = fakeClient()
    c.auth.verify.mockRejectedValueOnce(err('otp_expired'))
    await mount(c, { url: '/account?token_hash=old&type=signup' })
    act(() => root.unmount()); container.remove()
    await mount(c, { url: '/account' })
    expect($('[role="alert"]').textContent).toBe('This link has expired. Ask for a new one.')
    await type('email', 'a@example.com'); await type('password', 'right-password')
    await submit()
    expect(mode()).toBe('account')
    act(() => root.unmount()); container.remove()
    await mount(c, { url: '/account' })
    expect($('[role="alert"]')).toBeNull()
  })

  it('a dead link says so', async () => {
    const c = fakeClient()
    c.auth.verify.mockRejectedValueOnce(err('otp_expired'))
    await mount(c, { url: '/account?token_hash=old&type=signup' })
    expect($('[role="alert"]').textContent).toBe('This link has expired. Ask for a new one.')
    expect(mode()).toBe('signin')
  })

  it('saves the name, and exporting or signing out does not submit the form', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x'); globalThis.URL.revokeObjectURL = vi.fn()
    await mount(c)
    await type('name', 'Samira')
    await click('[data-export]')
    expect(c.fn).toHaveBeenCalledWith('export-account')
    expect(c.profiles.update).not.toHaveBeenCalled()
    await click('[data-save]')
    expect(c.profiles.update).toHaveBeenCalledWith({ display_name: 'Samira' })
  })

  // Found by the owner on the real project: Save was pressed eight times in a row. Every one of
  // them was accepted by the server, and the screen showed nothing.
  it('Save says that it saved, and has nothing to do until the name changes again', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    expect($('[data-saved]').textContent).toBe('')
    expect($('[data-save]').disabled).toBe(true)                 // "Sam" is what is saved already
    await type('name', 'Samira')
    expect($('[data-save]').disabled).toBe(false)
    await click('[data-save]')
    expect($('[data-saved]').textContent).toBe('Saved')
    expect($('[data-saved]').getAttribute('role')).toBe('status')
    expect($('[data-save]').disabled).toBe(true)
    await type('name', 'Samira K')
    expect($('[data-saved]').textContent).toBe('')
    expect($('[data-save]').disabled).toBe(false)
  })

  // Review of #73.
  it('typing on while a save is under way is not written over when it lands', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    let land
    c.profiles.update = vi.fn(() => new Promise(r => { land = () => r({ display_name: 'Samira' }) }))
    await mount(c)
    await type('name', 'Samira')
    await click('[data-save]')
    await type('name', 'Samira K')
    await act(async () => { land() })
    expect($('input[name="name"]').value).toBe('Samira K')
    expect($('[data-saved]').textContent).toBe('')          // what is on screen is not what was saved
    expect($('[data-save]').disabled).toBe(false)
    expect($('.iv-acct-title').textContent).toBe('Samira')  // what was saved, was
  })

  it('a save that lands after signing out does not bring the account back', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    let land
    c.profiles.update = vi.fn(() => new Promise(r => { land = () => r({ display_name: 'Samira' }) }))
    await mount(c)
    await type('name', 'Samira')
    await click('[data-save]')
    await act(async () => { c.set(null) })
    await act(async () => { land() })
    expect(cloudAccount()).toBeNull()
    expect(mode()).toBe('signin')
    expect($('input[name="name"]')).toBeNull()
  })

  it('a save that lands after leaving the screen and signing out does not bring the account back either', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    let land
    c.profiles.update = vi.fn(() => new Promise(r => { land = () => r({ display_name: 'Samira' }) }))
    await mount(c)
    await type('name', 'Samira')
    await click('[data-save]')
    act(() => root.unmount()); root = null
    c.set(null)
    await act(async () => { land() })
    expect(cloudAccount()).toBeNull()
  })

  it('a save that fails does not say Saved', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    c.profiles.update = vi.fn(async () => { throw err('network') })
    await mount(c)
    await type('name', 'Samira')
    await click('[data-save]')
    expect($('[data-saved]').textContent).toBe('')
    expect($('[role="alert"]')).not.toBeNull()
  })

  it('the rest of the app hears the saved name', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    await type('name', 'Samira')
    await click('[data-save]')
    expect(cloudAccount()).toEqual({ email: 'a@example.com', name: 'Samira' })
    setCloudAccount(null)
  })

  it('a profile that loads late does not write over a name already being typed', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    let arrive
    c.profiles.get.mockImplementationOnce(() => new Promise(r => { arrive = r }))
    await mount(c)
    await type('name', 'Typed first')
    await act(async () => { arrive({ display_name: 'From the server' }) })
    expect($('input[name="name"]').value).toBe('Typed first')
  })

  // Review of #62.
  it('the word typed to delete one account does not carry over to the next one signed in', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    await type('confirm', 'delete')
    expect($('[data-delete]').disabled).toBe(false)
    await click('[data-signout]')
    await act(async () => { c.set({ user: { id: 'u-2', email: 'b@example.com' } }) })
    await act(async () => {})
    expect(mode()).toBe('account')
    expect($('input[name="confirm"]').value).toBe('')
    expect($('[data-delete]').disabled).toBe(true)
  })

  it('the name cannot be saved before it has loaded, so an empty field never erases it', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    let arrive
    c.profiles.get.mockImplementationOnce(() => new Promise(r => { arrive = r }))
    await mount(c)
    expect($('[data-save]').disabled).toBe(true)
    await submit('form')
    expect(c.profiles.update).not.toHaveBeenCalled()
    await act(async () => { arrive({ display_name: 'Sam' }) })
    expect($('input[name="name"]').value).toBe('Sam')
    // loaded now, and what is in the field is what is saved: Save has nothing to do yet
    expect($('[data-save]').disabled).toBe(true)
    await type('name', 'Sam K')
    expect($('[data-save]').disabled).toBe(false)
  })

  it('offers a way on into the app from the account', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    expect($('[data-continue]')).not.toBeNull()
    expect($('[data-continue]').textContent).toBe('Continue')
  })

  // Found in review of #70: the first screen now sends people here, and an app installed to the
  // home screen has no browser back. Signed out, there was no way to return and pick "Continue
  // without account".
  it('signed out, there is a way back to where they came from', async () => {
    const c = fakeClient()
    await mount(c)
    for (const step of [null, 'signup', 'signin']) {
      if (step) await click(`[data-go="${step}"]`)
      expect($('[data-back]'), step || 'signin').not.toBeNull()
      expect($('[data-back]').textContent).toBe('Back')
      expect($('[data-back]').getAttribute('type')).toBe('button')     // never submits the form
    }
    // The reset step has one "Back" already, to the sign-in step: one tap from the way out, not two buttons with one name.
    await click('[data-go="forgot"]')
    expect($('[data-back]')).toBeNull()
    await click('[data-go="signin"]')
    expect(where).toBe('/account')
    await click('[data-back]')
    expect(where).toBe('/home')
    expect(c.auth.recover).not.toHaveBeenCalled()
  })

  // Found in review of #71: Back always went to the app's front door. Someone who opened the
  // account from Settings was sent to Home, and the account stayed behind them in the history.
  it('Back returns to where they came from when that was inside the app', async () => {
    const state = vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx: 1 })
    try {
      const c = fakeClient()
      await mount(c, { from: '/settings' })
      expect(where).toBe('/account')
      await click('[data-back]')
      expect(where).toBe('/settings')
    } finally { state.mockRestore() }
  })

  it('Back goes to the app when the account was the first thing opened (a link, a bookmark)', async () => {
    const state = vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx: 0 })
    try {
      const c = fakeClient()
      await mount(c)
      await click('[data-back]')
      expect(where).toBe('/home')
    } finally { state.mockRestore() }
  })

  it('signed in, Continue is the way on, and there is no second "Back"', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    expect($('[data-back]')).toBeNull()
  })

  // Found by the owner on the real project: Continue went to the app's address and nothing more,
  // so someone signed in to their account landed on the app's own sign-in screen.
  it('Continue takes a signed-in person into the app, not just to its address', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    const enter = vi.fn()
    await mount(c, { enter })
    await click('[data-continue]')
    expect(enter).toHaveBeenCalledTimes(1)
  })

  // Where the app's own server signs people in with this account, Continue leaves for that
  // sign-in instead of opening a profile on this device (lib/cloud/enter-app.js).
  it('Continue leaves for the server\'s sign-in when that is the way in, and does not go to the app first', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    const link = vi.fn()
    await mount(c, { enter: () => 'link', link })
    await click('[data-continue]')
    expect(link).toHaveBeenCalledTimes(1)
    expect(where).toBe('/account')
    // On its way: the button waits, so a second press cannot start a second sign-in.
    expect($('[data-continue]').disabled).toBe(true)
  })

  // The two sessions end together (lib/cloud/server-link.js; found in review of #78). ----------
  const me = { user: { id: 'u-1', email: 'a@example.com' } }
  // A server profile is open; signing out of it works unless `stuck`.
  const openServer = ({ stuck = false } = {}) => {
    let user = { id: 7, name: 'Sam' }
    return { user: () => user, signOut: vi.fn(async () => { if (stuck) return { owed: true, count: 2, stashed: false }; user = null; return { owed: false } }) }
  }

  it('Continue notes whose account is on its way before leaving for the server\'s sign-in', async () => {
    const c = fakeClient({ session: me })
    const order = []
    const note = { ...noNote(), leaving: vi.fn(() => order.push('note')) }
    await mount(c, { enter: () => 'link', link: () => order.push('leave'), note })
    await click('[data-continue]')
    expect(note.leaving).toHaveBeenCalledWith('u-1')
    expect(order).toEqual(['note', 'leave'])
  })

  it('a server profile opened through another account is signed out first, then Continue goes through the sign-in', async () => {
    const c = fakeClient({ session: me })
    const server = openServer(), link = vi.fn(), note = noNote()
    await mount(c, { enter: () => 'switch', link, server, note })
    await click('[data-continue]')
    expect(server.signOut).toHaveBeenCalledWith({ force: true })
    expect(note.leaving).toHaveBeenCalledWith('u-1')
    expect(link).toHaveBeenCalledTimes(1)
    expect(where).toBe('/account')
  })

  it('and if that profile cannot be signed out, Continue goes nowhere and says so', async () => {
    const c = fakeClient({ session: me })
    const server = openServer({ stuck: true }), link = vi.fn()
    await mount(c, { enter: () => 'switch', link, server })
    await click('[data-continue]')
    expect(link).not.toHaveBeenCalled()
    expect(where).toBe('/account')
    expect($('[role="alert"]').textContent).toMatch(/could not be signed out/)
    expect($('[data-continue]').disabled).toBe(false)
  })

  it('signing out of the account signs out of the server profile too, and first', async () => {
    const c = fakeClient({ session: me })
    const server = openServer(), note = noNote()
    const order = []
    const really = server.signOut.getMockImplementation()
    server.signOut.mockImplementationOnce(async o => { order.push('server'); return really(o) })
    c.auth.signOut.mockImplementationOnce(async () => { order.push('account'); c.set(null) })
    await mount(c, { server, note })
    await click('[data-signout]')
    expect(server.signOut).toHaveBeenCalledWith({ force: true })
    expect(order).toEqual(['server', 'account'])
    expect(note.ended).toHaveBeenCalled()
    expect(mode()).toBe('signin')
  })

  it('a server profile that cannot be signed out keeps the account signed in, and says so', async () => {
    const c = fakeClient({ session: me })
    const server = openServer({ stuck: true })
    await mount(c, { server })
    await click('[data-signout]')
    expect(c.auth.signOut).not.toHaveBeenCalled()
    expect(mode()).toBe('account')
    expect($('[role="alert"]').textContent).toMatch(/could not be signed out/)
  })

  // No server profile in this tab proves nothing about other tabs, so the note of whose profile
  // is open is not this tab's to drop (found in review of #79).
  it('with no server profile open here, signing out touches nothing on the server and keeps the note', async () => {
    const c = fakeClient({ session: me })
    const server = noServer(), note = noNote()
    await mount(c, { server, note })
    await click('[data-signout]')
    expect(server.signOut).not.toHaveBeenCalled()
    expect(note.ended).not.toHaveBeenCalled()
    expect(c.auth.signOut).toHaveBeenCalled()
  })

  it('Continue is told whose server profile is open, to judge whether it has to be swapped', async () => {
    const c = fakeClient({ session: me })
    const enter = vi.fn(() => 'already')
    await mount(c, { enter, server: openServer(), note: theirs('u-9') })
    await click('[data-continue]')
    expect(enter).toHaveBeenCalledWith({ hostedId: 'u-1', owner: 'u-9', lasting: true })
  })

  // Found in review of #81: a browser that is not keeping the account session.
  it('Continue is told when the session will not outlive the page, and the screen says so', async () => {
    const c = fakeClient({ session: me })
    c.auth.lasting = () => false
    const enter = vi.fn(() => 'device'), link = vi.fn(), note = noNote()
    await mount(c, { enter, link, note })
    expect($('[data-not-kept]').textContent).toMatch(/not keeping you signed in/)
    await click('[data-continue]')
    expect(enter).toHaveBeenCalledWith({ hostedId: 'u-1', owner: null, lasting: false })
    expect(link).not.toHaveBeenCalled()
    expect(note.leaving).not.toHaveBeenCalled()
    expect(where).toBe('/home')
  })

  it('and never leaves for the server\'s sign-in then, even after swapping out someone else\'s profile', async () => {
    const c = fakeClient({ session: me })
    c.auth.lasting = () => false
    const server = openServer(), link = vi.fn(), note = noNote()
    const enter = vi.fn().mockReturnValueOnce('switch').mockReturnValueOnce('device')
    await mount(c, { enter, link, server, note })
    await click('[data-continue]')
    expect(server.signOut).toHaveBeenCalledWith({ force: true })
    expect(enter).toHaveBeenCalledTimes(2)
    expect(link).not.toHaveBeenCalled()
    expect(note.leaving).not.toHaveBeenCalled()
    expect(where).toBe('/home')
  })

  // Found in review of #82: nothing can be stored at all. The line must not promise that training
  // is kept, and Continue must say why it goes nowhere.
  it('where the browser stores nothing, the line promises nothing and Continue says why it cannot go on', async () => {
    const c = fakeClient({ session: me })
    c.auth.lasting = () => false
    await mount(c, { enter: () => 'refused' })
    expect($('[data-not-kept]').textContent).not.toMatch(/stays on this device/)
    expect($('[data-not-kept]').textContent).toMatch(/may not be kept/)
    await click('[data-continue]')
    expect(where).toBe('/account')
    expect($('[role="alert"]').textContent).toMatch(/will not store anything/)
    expect($('[data-continue]').disabled).toBe(false)
  })

  it('a session that lasts shows no such line', async () => {
    const c = fakeClient({ session: me })
    await mount(c)
    expect($('[data-not-kept]')).toBeNull()
  })

  // Deleting the account here removes the account, not the training on the server. With a
  // server profile open, saying "deleted" would leave that behind: it has to go first, and the
  // app's own Settings is where that is done, with its own proof.
  it('with their own server profile open, the account cannot be deleted from here until the training is', async () => {
    const c = fakeClient({ session: me })
    await mount(c, { server: openServer(), note: theirs('u-1') })
    expect($('.iv-acct-danger').textContent).toMatch(/Delete your training first/)
    expect($('[data-delete]')).toBeNull()
    expect($('input[name="confirm"]')).toBeNull()
    expect(c.fn).not.toHaveBeenCalled()
  })

  // Found in review of #79: the guard looked only at "a server profile is open". A profile that
  // has nothing to do with this account (a server with its own passkeys, an admin) must not be
  // named as something to delete.
  it('a server profile that is not this account\'s is left out of it: the account deletes as before', async () => {
    for (const note of [noNote(), theirs('u-2')]) {
      const c = fakeClient({ session: me })
      await mount(c, { server: openServer(), note })
      expect($('.iv-acct-danger').textContent).not.toMatch(/Delete your training first/)
      await type('confirm', 'delete')
      await click('[data-delete]')
      expect(c.fn).toHaveBeenCalledWith('delete-account', { confirm: 'delete', subject: 'u-1' })
      act(() => root.unmount()); container.remove(); root = container = null
    }
  })

  it('Continue goes to the app in every other case, and starts no sign-in', async () => {
    for (const how of ['already', 'device', 'server']) {
      const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
      const link = vi.fn()
      await mount(c, { enter: () => how, link })
      await click('[data-continue]')
      expect(link).not.toHaveBeenCalled()
      expect(where).toBe('/home')
      act(() => root.unmount()); container.remove(); root = container = null
    }
  })

  it('deleting needs the word, then deletes, signs out and returns to sign in', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    expect($('[data-delete]').disabled).toBe(true)
    await type('confirm', 'delet')
    expect($('[data-delete]').disabled).toBe(true)
    await type('confirm', 'Delete')
    await click('[data-delete]')
    expect(c.fn).toHaveBeenCalledWith('delete-account', { confirm: 'delete', subject: 'u-1' })
    expect(c.auth.signOut).toHaveBeenCalled()
    expect(mode()).toBe('signin')
  })

  it('a running subscription blocks deletion, in words', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    c.fn.mockResolvedValueOnce({ status: 409, data: { error: 'subscription_active' } })
    await mount(c)
    await type('confirm', 'delete')
    await click('[data-delete]')
    expect($('[role="alert"]').textContent).toBe('Cancel your subscription first, then delete the account.')
    expect(c.auth.signOut).not.toHaveBeenCalled()
    expect(mode()).toBe('account')
  })

  it('deletes directly when the deployment explicitly has no training server', async () => {
    const c = fakeClient({ session: me })
    const config = vi.fn(async () => null)
    await mount(c, { server: { ...noServer(), configured: false, config } })
    await type('confirm', 'delete')
    await click('[data-delete]')
    expect(config).not.toHaveBeenCalled()
    expect(c.fn).toHaveBeenCalledExactlyOnceWith('delete-account', { confirm: 'delete', subject: 'u-1' })
  })

  it.each([null, { allow_guest: true }])('refuses when the configured training server cannot confirm OIDC (%j)', async config => {
    const c = fakeClient({ session: me })
    const go = await mount(c, { server: { ...noServer(), configured: true, config: async () => config } })
    await type('confirm', 'delete')
    await click('[data-delete]')
    expect($('[role="alert"]').textContent).toBe('Could not reach your server')
    expect(c.fn).not.toHaveBeenCalled()
    expect(go).not.toHaveBeenCalled()
  })

  it('approving a sign-in to the app\'s server names who asks and sends the browser on', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    const go = await mount(c, { url: '/account?authorization_id=az-1' })
    expect(mode()).toBe('consent')
    expect($('.iv-acct-title').textContent).toBe('Allow Ironvane server to sign you in?')
    await click('[data-allow]')
    expect(c.auth.consent).toHaveBeenCalledWith('az-1', true)
    expect(go).toHaveBeenCalledWith('https://api.example/cb?code=1')
  })

  it('signed out with a pending approval: sign in first, then it asks', async () => {
    const c = fakeClient()
    await mount(c, { url: '/account?authorization_id=az-1' })
    expect(mode()).toBe('signin')
    await type('email', 'a@example.com'); await type('password', 'right-password')
    await submit()
    expect(mode()).toBe('consent')
  })

  it('with no project in the build it says so and offers no form', async () => {
    await mount(null)
    expect($('form')).toBeNull()
    expect($('[role="alert"]')).not.toBeNull()
  })
})
