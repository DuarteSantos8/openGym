// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { passwordError, PasswordSignInSheet, PasswordRegisterForm, PasswordRow, PasswordSheet, EmailSheet, looksLikeEmail } from './PasswordAuth.jsx'
import { normalizeEmail } from '../../../api/password.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Password sign-in on screen (#118): the sign-in sheet and its reset-code half, creating a profile
   with a password, and the Settings row that sets, changes or removes one — removing behind the
   same proof step adding a passkey uses. The API is a stand-in; what each form sends, and what it
   says back in the UI language, is the point. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, hasData: false, sheets: [], answers: {}, calls: [] }
  state.toast = vi.fn()
  state.setUser = vi.fn()
  state.adoptProfile = vi.fn(async () => ({}))
  state.pushState = vi.fn(async () => {})
  state.pullState = vi.fn(async () => {})
  state.passwordLogin = vi.fn()
  state.passwordRegister = vi.fn()
  state.passwordResetRedeem = vi.fn()
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'c1', credential: { id: 'k1' } }))
  state.api = vi.fn(async (path, init) => {
    state.calls.push({ path, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
    const a = state.answers[(init?.method || 'GET') + ' ' + path]
    if (a instanceof Error) throw a
    return a ?? {}
  })
  state.snapshot = () => ({
    S: {}, config: { password_login: true },
    setUser: state.setUser, adoptProfile: state.adoptProfile, pushState: state.pushState, pullState: state.pullState,
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => mocks.hasData }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a),
  webauthnOK: () => mocks.webauthn,
  passkeyAssertion: (...a) => mocks.passkeyAssertion(...a),
  passwordLogin: (...a) => mocks.passwordLogin(...a),
  passwordRegister: (...a) => mocks.passwordRegister(...a),
  passwordResetRedeem: (...a) => mocks.passwordResetRedeem(...a),
}))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

const fail = (status, data) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
function type(el, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const byPlaceholder = (host, p) => host.querySelector(`input[placeholder="${p}"]`)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const submit = async host => { act(() => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle() }
const alertText = host => host.querySelector('[role="alert"]')?.textContent || null
const click = async (host, text) => { act(() => button(host, text).click()); await settle() }

beforeEach(() => {
  mocks.webauthn = true
  mocks.hasData = false
  mocks.sheets.length = 0
  mocks.answers = {}
  mocks.calls.length = 0
  for (const f of [mocks.toast, mocks.setUser, mocks.adoptProfile, mocks.pushState, mocks.pullState, mocks.passwordLogin,
    mocks.passwordRegister, mocks.passwordResetRedeem, mocks.passkeyAssertion]) f.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('passwordError', () => {
  it('words each server code in the UI language, and a pause with how long it lasts', () => {
    expect(passwordError(fail(401, { code: 'bad-credentials' }))).toBe('Wrong name, e-mail or password.')
    expect(passwordError(fail(400, { code: 'email-invalid' }))).toBe('That is not an e-mail address.')
    expect(passwordError(fail(409, { code: 'email-taken' }))).toBe('Another profile already uses this e-mail address.')
    expect(passwordError(fail(400, { code: 'too-common' }))).toMatch(/too easy to guess/)
    expect(passwordError(fail(400, { code: 'too-short' }))).toBe('Use at least 10 characters.')
    expect(passwordError(fail(409, { code: 'last-way-in' }))).toMatch(/only way into your profile/)
    expect(passwordError(fail(429, { code: 'locked', retryAfter: 120 }))).toBe('Too many attempts. Try again in 2 minutes.')
    expect(passwordError(fail(429, { code: 'locked', retryAfter: 30 }))).toBe('Too many attempts. Try again in 30 seconds.')
    // No code: what the server said, as it said it.
    expect(passwordError(fail(500, { error: 'server error' }))).toBe('server error')
  })
})

describe('PasswordSignInSheet', () => {
  it('signs in with the name and password, then carries on like a passkey sign-in', async () => {
    mocks.passwordLogin.mockResolvedValue({ id: 'u1', name: 'Ana' })
    const close = vi.fn()
    const host = mount(<PasswordSignInSheet close={close} />)
    const name = byPlaceholder(host, 'Name or e-mail')
    const pw = byPlaceholder(host, 'Password')
    // What password managers look for.
    expect(name.getAttribute('autocomplete')).toBe('username')
    expect(pw.getAttribute('autocomplete')).toBe('current-password')
    expect(pw.type).toBe('password')
    type(name, '  Ana '); type(pw, 'correct horse battery')
    await submit(host)
    expect(mocks.passwordLogin).toHaveBeenCalledWith('Ana', 'correct horse battery')
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u1', name: 'Ana' }, { adopt: true })   // nothing syncs until the question is answered
    expect(close).toHaveBeenCalled()
    expect(mocks.adoptProfile).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Welcome back, Ana')
  })

  it('a wrong password stays on the sheet and says so, without signing anyone in', async () => {
    mocks.passwordLogin.mockRejectedValue(fail(401, { error: 'wrong name or password', code: 'bad-credentials' }))
    const close = vi.fn()
    const host = mount(<PasswordSignInSheet close={close} />)
    type(byPlaceholder(host, 'Name or e-mail'), 'Ana'); type(byPlaceholder(host, 'Password'), 'nope nope nope')
    await submit(host)
    expect(alertText(host)).toBe('Wrong name, e-mail or password.')
    expect(mocks.setUser).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('redeems a reset code with a new password; a too-short or mistyped one is caught before any request', async () => {
    mocks.passwordResetRedeem.mockResolvedValue({ id: 'u1', name: 'Ana' })
    const host = mount(<PasswordSignInSheet close={() => {}} />)
    act(() => button(host, 'Have a reset code from your admin?').click())
    expect(host.querySelector('h3').textContent).toBe('Reset your password')
    type(byPlaceholder(host, 'Name or e-mail'), 'Ana')
    type(byPlaceholder(host, 'Reset code'), 'k7wq-2mzp-4hxa')
    type(byPlaceholder(host, 'New password'), 'short')
    await submit(host)
    expect(alertText(host)).toBe('Use at least 10 characters.')
    expect(mocks.passwordResetRedeem).not.toHaveBeenCalled()
    // A typo would only show at the next sign-in, and cost another code from the admin.
    const again = byPlaceholder(host, 'Repeat the password')
    expect(again.getAttribute('autocomplete')).toBe('new-password')
    type(byPlaceholder(host, 'New password'), 'a brand new passphrase')
    type(again, 'a brand new passphrse')
    await submit(host)
    expect(alertText(host)).toBe('The two passwords are not the same.')
    expect(mocks.passwordResetRedeem).not.toHaveBeenCalled()
    type(again, 'a brand new passphrase')
    await submit(host)
    expect(mocks.passwordResetRedeem).toHaveBeenCalledWith('Ana', 'K7WQ-2MZP-4HXA', 'a brand new passphrase')
    expect(mocks.setUser).toHaveBeenCalled()
  })

  it('the one field takes an e-mail as well as a name, long enough for either, and sends it as typed', async () => {
    mocks.passwordLogin.mockResolvedValue({ id: 'u1', name: 'Ana' })
    const host = mount(<PasswordSignInSheet close={() => {}} />)
    expect(host.textContent).toContain('Use your profile name (or the e-mail you added to it) and your password.')
    const field = byPlaceholder(host, 'Name or e-mail')
    // Not type="email": that would refuse a plain name.
    expect(field.type).toBe('text')
    expect(field.getAttribute('autocomplete')).toBe('username')
    expect(+field.getAttribute('maxlength')).toBe(254)
    await submit(host)
    expect(alertText(host)).toBe('Enter your name or e-mail.')
    expect(mocks.passwordLogin).not.toHaveBeenCalled()
    type(field, ' Ana@Example.com '); type(byPlaceholder(host, 'Password'), 'correct horse battery')
    await submit(host)
    expect(mocks.passwordLogin).toHaveBeenCalledWith('Ana@Example.com', 'correct horse battery')
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u1', name: 'Ana' }, { adopt: true })
  })

  it('a reset code is redeemed with the e-mail too', async () => {
    mocks.passwordResetRedeem.mockResolvedValue({ id: 'u1', name: 'Ana' })
    const host = mount(<PasswordSignInSheet close={() => {}} />)
    act(() => button(host, 'Have a reset code from your admin?').click())
    type(byPlaceholder(host, 'Name or e-mail'), 'ana@example.com')
    type(byPlaceholder(host, 'Reset code'), 'K7WQ-2MZP-4HXA')
    type(byPlaceholder(host, 'New password'), 'a brand new passphrase')
    type(byPlaceholder(host, 'Repeat the password'), 'a brand new passphrase')
    await submit(host)
    expect(mocks.passwordResetRedeem).toHaveBeenCalledWith('ana@example.com', 'K7WQ-2MZP-4HXA', 'a brand new passphrase')
  })

  it('offers the passkey only when the caller hands one over and this browser can make one', () => {
    const onPasskey = vi.fn()
    const host = mount(<PasswordSignInSheet close={() => {}} onPasskey={onPasskey} />)
    act(() => button(host, 'Sign in with passkey').click())
    expect(onPasskey).toHaveBeenCalled()
    mocks.webauthn = false
    expect(button(mount(<PasswordSignInSheet close={() => {}} onPasskey={onPasskey} />), 'Sign in with passkey')).toBeUndefined()
    mocks.webauthn = true
    expect(button(mount(<PasswordSignInSheet close={() => {}} />), 'Sign in with passkey')).toBeUndefined()
  })
})

describe('PasswordRegisterForm', () => {
  function Harness({ inviteOnly }) {
    const [name, setName] = React.useState('')
    const [code, setCode] = React.useState('')
    return <PasswordRegisterForm close={() => {}} inviteOnly={inviteOnly} name={name} setName={setName} code={code} setCode={setCode} />
  }
  it('checks the invite and the repeated password here, then creates the profile', async () => {
    mocks.passwordRegister.mockResolvedValue({ id: 'u9', name: 'Cleo' })
    const host = mount(<Harness inviteOnly />)
    type(byPlaceholder(host, 'Your name'), 'Cleo')
    type(byPlaceholder(host, 'Password'), 'correct horse battery')
    type(byPlaceholder(host, 'Repeat the password'), 'correct horse battery')
    await submit(host)
    expect(alertText(host)).toBe('An invite code is required')
    type(byPlaceholder(host, 'Invite code'), 'abc123')
    type(byPlaceholder(host, 'Repeat the password'), 'correct horse batterY')
    await submit(host)
    expect(alertText(host)).toBe('The two passwords are not the same.')
    expect(mocks.passwordRegister).not.toHaveBeenCalled()
    type(byPlaceholder(host, 'Repeat the password'), 'correct horse battery')
    await submit(host)
    expect(mocks.passwordRegister).toHaveBeenCalledWith('Cleo', 'correct horse battery', 'ABC123', '')
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u9', name: 'Cleo' })
    expect(mocks.pullState).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Welcome, Cleo')
  })

  it('takes an optional e-mail, checks its shape here, and says when another profile has it', async () => {
    mocks.passwordRegister.mockResolvedValue({ id: 'u9', name: 'Cleo' })
    const host = mount(<Harness />)
    const mail = byPlaceholder(host, 'E-mail (optional)')
    expect(mail.type).toBe('email')
    expect(mail.getAttribute('autocomplete')).toBe('email')
    expect(host.textContent).toContain('Lets you sign in with it instead of your name. Nothing is ever sent to it.')
    type(byPlaceholder(host, 'Your name'), 'Cleo')
    type(mail, 'cleo at example')
    type(byPlaceholder(host, 'Password'), 'correct horse battery')
    type(byPlaceholder(host, 'Repeat the password'), 'correct horse battery')
    await submit(host)
    expect(alertText(host)).toBe('That is not an e-mail address.')
    expect(mocks.passwordRegister).not.toHaveBeenCalled()
    mocks.passwordRegister.mockRejectedValueOnce(fail(409, { code: 'email-taken' }))
    type(mail, ' cleo@example.com ')
    await submit(host)
    expect(mocks.passwordRegister).toHaveBeenLastCalledWith('Cleo', 'correct horse battery', '', 'cleo@example.com')
    expect(alertText(host)).toBe('Another profile already uses this e-mail address.')
    await submit(host)
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u9', name: 'Cleo' })
  })

  it('a name already taken by a password profile is said in words', async () => {
    mocks.passwordRegister.mockRejectedValue(fail(409, { code: 'name-taken' }))
    const host = mount(<Harness />)
    type(byPlaceholder(host, 'Your name'), 'Ana')
    type(byPlaceholder(host, 'Password'), 'correct horse battery')
    type(byPlaceholder(host, 'Repeat the password'), 'correct horse battery')
    await submit(host)
    expect(alertText(host)).toBe('Another profile already signs in with this name.')
  })
})

describe('Settings → Password', () => {
  const rowTitle = host => host.querySelector('.lrow-t')?.textContent
  const rowSub = host => host.querySelector('.lrow-s')?.textContent

  it('shows whether a password is set, and nothing when a first one could not be confirmed here', async () => {
    mocks.answers['GET /api/account/password'] = { set: true, setAt: null, passkeys: 1, name: 'Ana', nameTaken: false }
    const host = mount(<PasswordRow />)
    await settle()
    expect(rowTitle(host)).toBe('Password')
    expect(rowSub(host)).toBe('Set · sign in as “Ana”')

    mocks.answers['GET /api/account/password'] = { set: false, setAt: null, passkeys: 1, name: 'Ana', nameTaken: false }
    mocks.webauthn = false
    const none = mount(<PasswordRow />)
    await settle()
    expect(none.textContent).toBe('')
  })

  it('the sign-in e-mail sits right under the password, with the address when there is one', async () => {
    const titles = host => [...host.querySelectorAll('.lrow-t')].map(e => e.textContent)
    const subs = host => [...host.querySelectorAll('.lrow-s')].map(e => e.textContent)
    mocks.answers['GET /api/account/password'] = { set: true, setAt: null, passkeys: 1, name: 'Ana', nameTaken: false, email: 'ana@example.com' }
    const host = mount(<PasswordRow />)
    await settle()
    expect(titles(host)).toEqual(['Password', 'Sign-in e-mail'])
    expect(subs(host)[1]).toBe('Sign in with “ana@example.com” instead of your name')
    mocks.answers['GET /api/account/password'] = { set: true, setAt: null, passkeys: 0, name: 'Ana', nameTaken: false, email: null }
    const unset = mount(<PasswordRow />)
    await settle()
    expect(subs(unset)[1]).toBe('Not set. Lets you sign in with an e-mail instead of your name.')
    act(() => [...unset.querySelectorAll('.lrow')].find(r => r.textContent.includes('Sign-in e-mail')).click())
    const sheet = mount(mocks.sheets.at(-1).render(() => {}))
    expect(sheet.querySelector('h3').textContent).toBe('Add a sign-in e-mail')
  })

  // The server signs in by an address only for a profile with a password (emailHolder in
  // api/server.js), so a passkey-only profile, or one whose name is blocked, is not offered one;
  // an address saved while a password existed stays reachable, and says it is asleep.
  it('the sign-in e-mail row needs a password, and a saved address without one says it does not sign in', async () => {
    const titles = host => [...host.querySelectorAll('.lrow-t')].map(e => e.textContent)
    const subs = host => [...host.querySelectorAll('.lrow-s')].map(e => e.textContent)
    mocks.answers['GET /api/account/password'] = { set: false, setAt: null, passkeys: 1, name: 'Ana', nameTaken: false, email: null }
    const passkeyOnly = mount(<PasswordRow />)
    await settle()
    expect(titles(passkeyOnly)).toEqual(['Password'])
    mocks.answers['GET /api/account/password'] = { set: false, setAt: null, passkeys: 1, name: 'Ana', nameTaken: true, email: null }
    const blocked = mount(<PasswordRow />)
    await settle()
    expect(titles(blocked)).toEqual(['Password'])
    mocks.answers['GET /api/account/password'] = { set: false, setAt: null, passkeys: 1, name: 'Ana', nameTaken: false, email: 'ana@example.com' }
    const kept = mount(<PasswordRow />)
    await settle()
    expect(titles(kept)).toEqual(['Password', 'Sign-in e-mail'])
    expect(subs(kept)[1]).toBe('“ana@example.com” is saved, but signs in only once this profile has a password.')
  })

  it('a first password is confirmed with the passkey and sent with its assertion', async () => {
    const done = vi.fn(), close = vi.fn()
    const host = mount(<PasswordSheet status={{ set: false, passkeys: 1, name: 'Ana' }} close={close} done={done} />)
    expect(byPlaceholder(host, 'Current password')).toBeNull()
    type(byPlaceholder(host, 'New password'), 'correct horse battery')
    type(byPlaceholder(host, 'Repeat the password'), 'correct horse battery')
    await submit(host)
    expect(mocks.passkeyAssertion).toHaveBeenCalled()
    expect(mocks.calls.at(-1)).toEqual({ path: '/api/account/password', method: 'POST', body: { next: 'correct horse battery', cid: 'c1', credential: { id: 'k1' } } })
    expect(close).toHaveBeenCalled()
    expect(done).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Password saved. You’re now signed out everywhere else.')
  })

  it('a change sends the current password; a wrong one is said on the sheet', async () => {
    mocks.answers['POST /api/account/password'] = fail(403, { code: 'current-wrong' })
    const close = vi.fn()
    const host = mount(<PasswordSheet status={{ set: true, passkeys: 0, name: 'Ana' }} close={close} done={() => {}} />)
    type(byPlaceholder(host, 'Current password'), 'old passphrase here')
    type(byPlaceholder(host, 'New password'), 'a brand new passphrase')
    type(byPlaceholder(host, 'Repeat the password'), 'a brand new passphrase')
    await submit(host)
    expect(mocks.calls.at(-1).body).toEqual({ next: 'a brand new passphrase', current: 'old passphrase here' })
    expect(mocks.passkeyAssertion).not.toHaveBeenCalled()
    expect(alertText(host)).toBe('Your current password is not right.')
    expect(close).not.toHaveBeenCalled()
    // No passkey on this profile: the password is its only way in, so there is no "Remove" —
    // and no "confirm with your passkey" either.
    expect(button(host, 'Remove password')).toBeUndefined()
    expect(button(host, 'Forgot it? Confirm with your passkey instead')).toBeUndefined()
  })

})

/* Removing the password asks for the proof setting one does (proveOwner in api/server.js): the
   password itself or a passkey of this profile, on the sheet that says what removing means. */
describe('Settings → Password → Remove', () => {
  const named = name => Object.assign(new Error(name), { name })
  const deletes = () => mocks.calls.filter(c => c.method === 'DELETE')
  function openRemove(status = { set: true, passkeys: 2, name: 'Ana' }) {
    const done = vi.fn(), close = vi.fn()
    const host = mount(<PasswordSheet status={status} close={close} done={done} />)
    act(() => button(host, 'Remove password').click())
    const removeClose = vi.fn()
    const sheet = mount(mocks.sheets.at(-1).render(removeClose))
    return { sheet, close: removeClose, sheetClose: close, done }
  }

  it('asks for proof before anything is sent, then removes with the password as proof', async () => {
    mocks.answers['DELETE /api/account/password'] = { ok: true }
    const { sheet, close, sheetClose, done } = openRemove()
    expect(sheet.querySelector('h3').textContent).toBe('Remove your password?')
    expect(sheet.textContent).toContain('Only your passkeys sign in to this profile afterwards.')
    expect(sheet.textContent).toContain('First confirm that it is you.')
    expect(deletes()).toEqual([])
    await submit(sheet)
    expect(alertText(sheet)).toBe('Enter your password.')
    expect(deletes()).toEqual([])
    type(byPlaceholder(sheet, 'Current password'), 'correct horse battery')
    await click(sheet, 'Remove')
    expect(deletes()).toEqual([{ path: '/api/account/password', method: 'DELETE', body: { current: 'correct horse battery' } }])
    expect(close).toHaveBeenCalled()
    expect(sheetClose).toHaveBeenCalled()
    expect(done).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Password removed')
  })

  it('or with a passkey of the profile, whose assertion goes with the removal', async () => {
    mocks.answers['DELETE /api/account/password'] = { ok: true }
    const { sheet, close } = openRemove()
    expect(button(sheet, 'Confirm with a passkey').className).toMatch(/\bdanger\b/)
    await click(sheet, 'Confirm with a passkey')
    expect(mocks.passkeyAssertion).toHaveBeenCalledTimes(1)
    expect(deletes()).toEqual([{ path: '/api/account/password', method: 'DELETE', body: { cid: 'c1', credential: { id: 'k1' } } }])
    expect(close).toHaveBeenCalled()
  })

  it('a wrong password, a passkey the server refuses, or a removal that became the last way in stay on the sheet', async () => {
    const { sheet, close, done } = openRemove()
    mocks.answers['DELETE /api/account/password'] = fail(403, { code: 'current-wrong' })
    type(byPlaceholder(sheet, 'Current password'), 'not it')
    await submit(sheet)
    expect(alertText(sheet)).toBe('Your current password is not right.')
    mocks.answers['DELETE /api/account/password'] = fail(403, { code: 'passkey' })
    await click(sheet, 'Confirm with a passkey')
    expect(alertText(sheet)).toBe('Your passkey could not be confirmed.')
    mocks.answers['DELETE /api/account/password'] = fail(409, { code: 'last-way-in' })
    await click(sheet, 'Confirm with a passkey')
    expect(alertText(sheet)).toBe('This password is the only way into your profile, so it cannot be removed.')
    mocks.answers['DELETE /api/account/password'] = fail(429, { code: 'locked', retryAfter: 60 })
    await submit(sheet)
    expect(alertText(sheet)).toMatch(/^Too many attempts. Try again /)
    expect(close).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('a dismissed passkey prompt removes nothing and is no error; Cancel just closes', async () => {
    const { sheet, close } = openRemove()
    mocks.passkeyAssertion.mockRejectedValueOnce(named('NotAllowedError'))
    await click(sheet, 'Confirm with a passkey')
    expect(deletes()).toEqual([])
    expect(alertText(sheet)).toBeNull()
    await click(sheet, 'Cancel')
    expect(close).toHaveBeenCalled()
    expect(deletes()).toEqual([])
  })

  it('a passkey prompt still open when the sheet goes removes nothing when it answers', async () => {
    let answer, signal
    mocks.passkeyAssertion.mockImplementationOnce(opts => new Promise(resolve => { signal = opts?.signal; answer = resolve }))
    const { sheet } = openRemove()
    await click(sheet, 'Confirm with a passkey')
    act(() => { const m = mounted.pop(); m.root.unmount(); m.host.remove() })
    expect(signal.aborted).toBe(true)
    await act(async () => { answer({ cid: 'c1', credential: { id: 'k1' } }) })
    await settle()
    expect(deletes()).toEqual([])
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('without passkey support in this browser the password is the proof', async () => {
    mocks.webauthn = false
    const { sheet } = openRemove()
    expect(button(sheet, 'Confirm with a passkey')).toBeUndefined()
    expect(button(sheet, 'Remove').className).toMatch(/\bdanger\b/)
    expect(byPlaceholder(sheet, 'Current password')).not.toBeNull()
  })

  it('only offered while a passkey remains', () => {
    const host = mount(<PasswordSheet status={{ set: true, passkeys: 0, name: 'Ana' }} close={() => {}} done={() => {}} />)
    expect(button(host, 'Remove password')).toBeUndefined()
  })
})

/* Settings → Sign-in e-mail: the address first, checked here, then the owner's proof (proveOwner in
   api/server.js) — the password or a passkey of this profile — which carries the save. Removing
   takes the same proof. Nothing is sent before the proof. */
describe('Settings → Sign-in e-mail', () => {
  const posts = () => mocks.calls.filter(c => c.path === '/api/account/email')
  function open(status = { set: true, passkeys: 1, name: 'Ana', email: null }) {
    const close = vi.fn(), done = vi.fn()
    return { host: mount(<EmailSheet status={status} close={close} done={done} />), close, done }
  }

  it('checks the address before asking for proof, then saves it with the password as proof', async () => {
    mocks.answers['POST /api/account/email'] = { ok: true, email: 'ana@example.com' }
    const { host, close, done } = open()
    const input = byPlaceholder(host, 'E-mail address')
    expect(input.type).toBe('email')
    expect(input.getAttribute('autocomplete')).toBe('email')
    expect(host.textContent).toContain('We never send anything to it')
    type(input, 'not an address')
    await submit(host)
    expect(alertText(host)).toBe('That is not an e-mail address.')
    expect(byPlaceholder(host, 'Current password')).toBeNull()
    type(byPlaceholder(host, 'E-mail address'), ' ana@example.com ')
    await submit(host)
    // The proof step: nothing sent yet.
    expect(host.textContent).toContain('ana@example.com')
    expect(host.textContent).toContain('First confirm that it is you.')
    expect(posts()).toEqual([])
    type(byPlaceholder(host, 'Current password'), 'correct horse battery')
    await click(host, 'Save')
    expect(posts()).toEqual([{ path: '/api/account/email', method: 'POST', body: { email: 'ana@example.com', current: 'correct horse battery' } }])
    expect(close).toHaveBeenCalled()
    expect(done).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('E-mail saved')
  })

  it('or with a passkey; an address another profile uses is said on the proof step', async () => {
    mocks.answers['POST /api/account/email'] = fail(409, { code: 'email-taken' })
    const { host, close } = open({ set: false, passkeys: 1, name: 'Ana', email: null })
    type(byPlaceholder(host, 'E-mail address'), 'ana@example.com')
    await submit(host)
    // No password on this profile: the passkey is the only proof offered.
    expect(byPlaceholder(host, 'Current password')).toBeNull()
    await click(host, 'Confirm with a passkey')
    expect(mocks.passkeyAssertion).toHaveBeenCalledTimes(1)
    expect(posts()).toEqual([{ path: '/api/account/email', method: 'POST', body: { email: 'ana@example.com', cid: 'c1', credential: { id: 'k1' } } }])
    expect(alertText(host)).toBe('Another profile already uses this e-mail address.')
    expect(close).not.toHaveBeenCalled()
    await click(host, 'Back')
    expect(byPlaceholder(host, 'E-mail address').value).toBe('ana@example.com')
  })

  it('changing to the address it already has is caught here', async () => {
    const { host } = open({ set: true, passkeys: 1, name: 'Ana', email: 'ana@example.com' })
    expect(host.querySelector('h3').textContent).toBe('Change sign-in e-mail')
    expect(byPlaceholder(host, 'E-mail address').value).toBe('ana@example.com')
    type(byPlaceholder(host, 'E-mail address'), 'ANA@example.com')
    await submit(host)
    expect(alertText(host)).toBe('That is already your sign-in e-mail.')
  })

  it('the address it already has is recognised the way the server folds it (NFKC), not only by case', async () => {
    const { host } = open({ set: true, passkeys: 1, name: 'Ana', email: 'ana@example.com' })
    type(byPlaceholder(host, 'E-mail address'), '\uFF21na@example.com')   // a full-width "A"
    await submit(host)
    expect(alertText(host)).toBe('That is already your sign-in e-mail.')
    expect(posts()).toEqual([])
  })

  it('looks at an address the way the server does, so nothing it accepts is refused here or the other way round', () => {
    const cases = ['ana@example.com', ' Ana@Example.COM ', '\uFF21na@example.com', 'a.b+c@sub.example.co', 'ana@example.c', 'ana@example',
      'ana@@example.com', 'a b@example.com', 'ana@.example.com', 'ana@-example.com', 'ana@example..com', 'a..b@example.com',
      '"ana"@example.com', 'ana@exa,mple.com', 'ana@example.c0m', 'x'.repeat(65) + '@example.com', 'a@' + 'b'.repeat(250) + '.com',
      'ana@exämple.de', 'ana@example.com.', '', '@example.com', 'ana@']
    for (const c of cases) expect(looksLikeEmail(c), JSON.stringify(c)).toBe(normalizeEmail(c) !== null)
  })

  it('removing asks for the same proof, then removes', async () => {
    mocks.answers['DELETE /api/account/email'] = { ok: true, email: null }
    const { host, close, done } = open({ set: true, passkeys: 1, name: 'Ana', email: 'ana@example.com' })
    act(() => button(host, 'Remove e-mail').click())
    const removeClose = vi.fn()
    const sheet = mount(mocks.sheets.at(-1).render(removeClose))
    expect(sheet.querySelector('h3').textContent).toBe('Remove your sign-in e-mail?')
    expect(sheet.textContent).toContain('Afterwards you sign in with your profile name only.')
    expect(posts()).toEqual([])
    type(byPlaceholder(sheet, 'Current password'), 'correct horse battery')
    await click(sheet, 'Remove')
    expect(posts()).toEqual([{ path: '/api/account/email', method: 'DELETE', body: { current: 'correct horse battery' } }])
    expect(removeClose).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(done).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('E-mail removed')
  })

  it('no remove button while there is no address', () => {
    const { host } = open()
    expect(button(host, 'Remove e-mail')).toBeUndefined()
  })
})
