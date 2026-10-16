import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BRAND } from '../../brand.js'
import { Button } from '../../components/ui.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import EnvelopeScene from '../../components/onboarding/scenes/EnvelopeScene.jsx'
import { passkeyError, passkeyLogin } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { checkInvite } from '../../lib/onboarding/api.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { codeOf } from '../../lib/onboarding/flow.js'
import { askAddDeviceData } from '../../sheets.jsx'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'

// 0 Invite landing, /join/<code> (ux-onboarding §3, §6): the invite is checked on arrival, without
// using it up, so a bad one shows here with a next step instead of after the name and the passkey.
//   valid               "{inviter} invited you to Gains" → Create my account · I already have an account
//   used                "already been used"   → Sign in
//   revoked / expired   "no longer valid"     → Sign in
//   invalid             "doesn't work"        → Sign in
//   no answer           "couldn't check"      → Try again
//   signed in already   "You're already in as {name}" → Open Gains (the invite stays unused)
export default function InviteScreen() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const code = codeOf(pathname)
  const { state, act, go } = useOnboarding()
  const user = useStore(s => s.user)
  const [check, setCheck] = useState(() => (state.code === code && state.invite ? { kind: 'ok', invite: state.invite } : { kind: code ? 'loading' : 'ok', invite: code ? null : { status: 'invalid' } }))
  const [tries, setTries] = useState(0)

  // A landing with no code is no invite session: one kept from an earlier visit is let go.
  useEffect(() => {
    if (!code && !user) act({ type: 'invite', code: null, invite: null })
  }, [code, user, act])

  useEffect(() => {
    if (!code || user) return undefined
    let live = true
    checkInvite(code).then(invite => {
      if (!live) return
      act({ type: 'invite', code, invite })
      setCheck({ kind: 'ok', invite })
    }).catch(() => { if (live) setCheck({ kind: 'unavailable' }) })
    return () => { live = false }
  }, [code, user, tries, act])

  const signIn = async () => {
    try {
      const u = await passkeyLogin()
      useStore.getState().setUser(u, { adopt: true })
      await useStore.getState().adoptProfile(askAddDeviceData)
      navigate('/home', { replace: true })
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Sign-in failed')))
    }
  }

  const stage = <EnvelopeScene />
  if (user) {
    return <StepScreen noNav titleId="ob-inv-t" title={t('You’re already in as {0}', user.name)} stage={stage}
      sub={t('This invite stays unused, so it still works for someone else.')}
      footer={<Button variant="primary" onClick={() => navigate('/home', { replace: true })}>{t('Open {0}', BRAND.name)}</Button>} />
  }
  if (check.kind === 'loading') {
    return <StepScreen noNav titleId="ob-inv-t" title={t('Checking your invite…')} stage={stage} />
  }
  if (check.kind === 'unavailable') {
    return <StepScreen noNav titleId="ob-inv-t" title={t('We couldn’t check this invite')} stage={stage}
      sub={t('Check your connection and try again.')}
      footer={<Button variant="primary" onClick={() => { setCheck({ kind: 'loading' }); setTries(n => n + 1) }}>{t('Try again')}</Button>} />
  }
  const { status, inviterName } = check.invite
  if (status !== 'valid') {
    const title = status === 'used' ? t('This invite has already been used.')
      : status === 'invalid' ? t('This invite link doesn’t work')
        : t('This invite is no longer valid')
    return <StepScreen noNav titleId="ob-inv-t" title={title} stage={stage}
      sub={t('Ask whoever invited you for a new link. Already have an account? Sign in.')}
      footer={<Button variant="primary" icon="fingerprint" onClick={signIn}>{t('Sign in')}</Button>} />
  }
  const inviter = inviterName?.trim()
  return (
    <StepScreen noNav titleId="ob-inv-t" stage={stage}
      title={inviter ? t('{0} invited you to {1}', inviter, BRAND.name) : t('You’re invited to {0}', BRAND.name)}
      sub={t('Your training and your food in one place. Setting it up takes about a minute.')}
      lead={inviter && <div className="ob-disc" aria-hidden="true">{inviter[0].toUpperCase()}</div>}
      footer={<>
        <Button variant="primary" onClick={() => go('name', { replace: true })}>{t('Create my account')}</Button>
        <Button variant="plain" onClick={signIn}>{t('I already have an account')}</Button>
      </>} />
  )
}
