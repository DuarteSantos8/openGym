import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function Nutrition() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let live = true
    setResult(null)
    if (user) {
      api('/api/nutrition/hello').then(body => {
        if (typeof body.message !== 'string' || !body.message.trim()) throw new Error('Invalid greeting')
        if (live) setResult({ message: body.message })
      }).catch(error => { if (live) setResult({ error: error.status === 401 ? 'session' : 'unavailable' }) })
    }
    // A late answer from another route/account must never appear on this screen.
    return () => { live = false }
  }, [user?.id, attempt])

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1>{t('Nutrition')}</h1>
    </div>
    <div className="card" aria-live="polite">
      {!user ? <p>{t('Sign in to use Nutrition.')}</p>
        : !result ? <p role="status">{t('Loading…')}</p>
          : result.error ? <>
            <p role="alert">{result.error === 'session' ? t('Sign in to use Nutrition.') : t('Nutrition is unavailable. Please try again.')}</p>
            <Button onClick={() => setAttempt(n => n + 1)}>{t('Retry')}</Button>
          </> : <p>{result.message}</p>}
    </div>
  </>
}
