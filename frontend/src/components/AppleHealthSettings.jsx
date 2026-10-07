import { useEffect, useRef, useState } from 'react'
import { Row, Switch } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n-core.js'
import { appleHealthAvailable, appleHealthEnabled, enableAppleHealth, disableAppleHealth, syncAppleHealth } from '../lib/apple-health.js'

export default function AppleHealthSettings({ available } = {}) {
  const owner = useStore(s => JSON.stringify([s.sync?.server || 'local', s.user?.id || 'local']))
  return <HealthRows key={owner} available={available} />
}

function HealthRows({ available: supplied }) {
  const [available, setAvailable] = useState(supplied === true)
  const [enabled, setEnabled] = useState(() => appleHealthEnabled(useStore))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    if (typeof supplied === 'boolean') setAvailable(supplied)
    else appleHealthAvailable().then(value => { if (alive.current) setAvailable(value) })
    return () => { alive.current = false }
  }, [supplied])

  async function connect(authorize) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (authorize) await enableAppleHealth(useStore)
      await syncAppleHealth(useStore)
    } catch (err) {
      if (alive.current) setError(err.message || String(err))
    } finally {
      if (alive.current) { setEnabled(appleHealthEnabled(useStore)); setBusy(false) }
    }
  }

  if (!available) return null
  return <>
    <Row icon="heart" iconTint="var(--red)" title={t('Sync with Apple Health')}
      subtitle={busy ? t('Connecting…') : t('Sync body weight both ways and save finished workouts to Health.')}>
      <Switch aria-label={t('Sync with Apple Health')} checked={enabled} disabled={busy} onChange={value => {
        if (value) connect(true)
        else { disableAppleHealth(); setEnabled(false); setError('') }
      }} />
    </Row>
    {error && <div className="lrow" role="alert">{t('Apple Health: {0}', error)}</div>}
    {enabled && <Row icon="shuffle" title={t('Sync Apple Health now')} onClick={busy ? undefined : () => connect(false)} />}
  </>
}
