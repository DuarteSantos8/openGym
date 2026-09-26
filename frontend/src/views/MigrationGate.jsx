// Full-screen and blocking: a v1 profile — on this device or on the server — is converted before
// anything else in the app may read or write it (spec "Blocking migration screen"). One action at
// a time: OK, then nothing while it works, Try again after a failure. No back, no close, no tabs.
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const STAGES = { backup: 'Creating backup', convert: 'Converting training data', check: 'Checking converted data', load: 'Loading your profile' }
const size = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

export default function MigrationGate() {
  const { migration, confirmMigration, retryMigration } = useStore()
  const { phase, stage, summary } = migration
  return (
    <div className="narrow" style={wrap} role="dialog" aria-modal="true" aria-labelledby="migration-title">
      <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
      <h1 id="migration-title" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', margin: '10px 0 12px' }}>{t('Your training data needs an upgrade')}</h1>
      {phase === 'error' ? <>
        <div className="muted" style={{ marginBottom: 26 }}>{t('The upgrade did not finish. No original server file was overwritten. Please contact the administrator of this openGym instance.')}</div>
        <Button variant="primary" onClick={() => retryMigration()}>{t('Try again')}</Button>
      </> : phase === 'confirm' ? <>
        <div className="muted" style={{ marginBottom: 14 }}>{t('openGym is updating how your progression and warm-ups are stored. A backup of your current data is created first. With a long training history this can take a few moments.')}</div>
        {summary && <div className="dim small" style={{ marginBottom: 26 }}>{t('{0} routines · {1} workouts · {2}', summary.routines, summary.workouts, size(summary.bytes))}</div>}
        <Button variant="primary" onClick={() => confirmMigration()}>{t('OK')}</Button>
      </> : (
        <div className="muted" role="status" aria-live="polite">{phase === 'working' ? t(STAGES[stage]) : ''}</div>
      )}
    </div>
  )
}
