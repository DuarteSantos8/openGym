// @vitest-environment happy-dom
// The Cloud edition's account screen, against a pretend client: every step someone can be on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Account, { wordFor, forgetLink } from './Account.jsx'
import { RESET_KEY } from '../../lib/cloud/pending-reset.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null; forgetLink(); window.sessionStorage.clear() })

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

async function mount(client, { url = '/account', go = vi.fn() } = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter initialEntries={[url]}><Account client={client} go={go} /></MemoryRouter>) })
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
    expect($('[data-save]').disabled).toBe(false)
    expect($('input[name="name"]').value).toBe('Sam')
  })

  it('offers a way on into the app from the account', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    expect($('[data-continue]')).not.toBeNull()
    expect($('[data-continue]').textContent).toBe('Continue')
  })

  it('deleting needs the word, then deletes, signs out and returns to sign in', async () => {
    const c = fakeClient({ session: { user: { id: 'u-1', email: 'a@example.com' } } })
    await mount(c)
    expect($('[data-delete]').disabled).toBe(true)
    await type('confirm', 'delet')
    expect($('[data-delete]').disabled).toBe(true)
    await type('confirm', 'Delete')
    await click('[data-delete]')
    expect(c.fn).toHaveBeenCalledWith('delete-account', { confirm: 'delete' })
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
