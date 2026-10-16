import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import TroubleSheet from '../../components/onboarding/TroubleSheet.jsx'
import KeyScene from '../../components/onboarding/scenes/KeyScene.jsx'
import { passkeyError, passkeyRegister, webauthnOK } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { pathOf } from '../../lib/onboarding/flow.js'
import { cx } from '../../lib/ui-kit.js'
import { hasData, useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'

// 1 Name + passkey (§3 screen 1): the name, prefilled with the one the inviter suggested, and the
// passkey made with the invite's code. Cancelling the prompt says so inline, with "Having trouble?"
// (§6), and nothing is lost: the button just works again.
export default function NameScreen() {
  const { state, act, go } = useOnboarding()
  const [name, setName] = useState(() => state.name ?? state.invite?.suggestedName ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [shake, setShake] = useState(0)
  const inviter = state.invite?.status === 'valid' ? state.invite.inviterName : null
  const ok = !!name.trim() && !busy

  // Signed in already (a reload after the passkey): there is no second account to make here.
  const signedIn = useStore(s => !!s.user)
  if (signedIn && !busy) return <Navigate to="/onboarding" replace />
  // The invite this account is made with is the one the landing checked in this tab. With none (the
  // address typed in, an invite left behind) there is nothing to make an account with: the landing.
  if (!state.code) return <Navigate to={pathOf('invite', null)} replace />

  const trouble = () => useUI.getState().openSheet(close => <TroubleSheet close={close} code={state.code} />)
  const create = async () => {
    if (!ok) return
    if (!webauthnOK()) { setProblem(t('This browser can’t make a passkey.')); return }
    setProblem(null)
    setBusy(true)
    try {
      const u = await passkeyRegister(name.trim(), state.code)
      // On first, then signed in: the layout lets a signed-in person past the name step only forward.
      go('passkey', { replace: true })
      const store = useStore.getState()
      store.setUser(u)
      if (hasData(store.S)) store.pushState()
      else store.pullState()
    } catch (e) {
      setBusy(false)
      setShake(n => n + 1)
      setProblem(e.name === 'NotAllowedError' || e.name === 'AbortError'
        ? t('No passkey created. Try again.')
        : passkeyError(e, t('Registration failed')))
    }
  }
  return (
    <StepScreen titleId="ob-name-t" title={t('What should we call you?')}
      sub={inviter ? t('{0} and your other friends on Gains will see this name.', inviter) : t('Your friends on Gains will see this name.')}
      stage={<KeyScene name={name} inviter={inviter} />}
      footer={<>
        <p className="ob-reass"><Icon name="keyRound" /><span>{t('No password to remember. Face ID or your fingerprint keeps your account safe.')}</span></p>
        {problem && <div className="ob-pk-err" role="alert">
          <Icon name="info" /><span>{problem}</span>
          <Button size="sm" variant="plain" onClick={trouble}>{t('Having trouble?')}</Button>
        </div>}
        <Button key={shake} variant="primary" className={cx(shake > 0 && 'ob-shake')} disabled={!name.trim()} aria-busy={busy || undefined}
          icon={busy ? undefined : 'scanFace'} onClick={create}>
          {busy && <span className="ob-spin" aria-hidden="true" />}{t('Create passkey')}
        </Button>
      </>}>
      <label className="ob-field">
        <span className="sr-only">{t('Your name')}</span>
        <input type="text" autoComplete="given-name" enterKeyHint="go" maxLength={30} placeholder={t('Your name')} value={name}
          onChange={e => { setName(e.target.value); act({ type: 'name', name: e.target.value }) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
      </label>
    </StepScreen>
  )
}
