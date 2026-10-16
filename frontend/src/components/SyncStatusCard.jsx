import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DEMO } from '../lib/demo.js'
import { t } from '../lib/i18n.js'
import { fmtAgo } from '../lib/format.js'
import { nutritionAvailable } from '../lib/nutrition/api.js'
import { isHubTrouble, syncNow as hubSyncNow, useHubStatusRefresh, useHubSync } from '../lib/nutrition/sync.js'
import { TONE_TINT as TINT, connectionView, useOnline } from './ServerSync.jsx'
import { Row, Section } from './ui.jsx'

// The hub's Gains ↔ NutriTrace sync, in words (fitness-hub src/sync/engine.ts SyncState).
function hubView(status) {
  if (!status) return { tone: 'quiet', icon: 'cloud', line: t('Not synced yet') }
  switch (status.state) {
    case 'ok': return { tone: 'ok', icon: 'cloud', line: t('All synced') }
    case 'syncing': return { tone: 'wait', icon: 'reset', line: t('Syncing…') }
    case 'retrying': return { tone: 'wait', icon: 'reset', line: t('Trying again soon') }
    case 'needs_confirmation': return { tone: 'bad', icon: 'warning', line: t('Waiting for your confirmation') }
    case 'suspended': return { tone: 'bad', icon: 'warning', line: t('Paused') }
    default: return { tone: 'bad', icon: 'warning', line: t('Nutrition sync needs attention') }
  }
}

// Profile's sync status (ia-proposal §5): the same two states the avatar's dot watches, Gains'
// own sync and the hub's Gains ↔ NutriTrace sync, and one "Sync now" for both. Only for an
// account that syncs: a guest, a phone kept local and the demo have nothing to sync.
export default function SyncStatusCard() {
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  const online = useOnline()
  const hub = useHubSync(s => s.status)
  const nutrition = nutritionAvailable(user)
  const [busy, setBusy] = useState(false)
  useHubStatusRefresh()
  if (!user || DEMO || !sync) return null
  const view = connectionView(sync, { online })
  const hv = hubView(hub)
  const now = async () => {
    if (busy) return
    setBusy(true)
    try {
      // Gains first (the hub reads the change from there), so the hub run need not push again.
      const st = await useStore.getState().syncNow()
      const trainingView = connectionView(st)
      // A training sync that failed says so first; then the hub's half: no answer, or a state that
      // needs the person, is not "All synced".
      let line = trainingView?.line
      if (nutrition && trainingView?.tone === 'ok') {
        const hubStatus = await hubSyncNow({ pushed: true })
        if (!hubStatus) line = t('Training synced, but nutrition did not: the sync service did not answer.')
        else if (isHubTrouble(hubStatus)) line = t('Nutrition sync needs attention')
      }
      if (line) useUI.getState().toast(line)
    } finally {
      setBusy(false)
    }
  }
  return <Section title={t('Sync')}>
    <Row icon={view.icon} iconTint={TINT[view.tone]} title={t('Training and body')} className="sync-status"
      subtitle={[view.line, sync.lastSynced ? t('Last synced: {0}', fmtAgo(sync.lastSynced)) : null].filter(Boolean).join(' · ')} />
    {nutrition && <Row icon={hv.icon} iconTint={TINT[hv.tone]} title={t('Nutrition')}
      subtitle={[hv.line, hub?.last_synced_at ? t('Last synced: {0}', fmtAgo(hub.last_synced_at)) : null].filter(Boolean).join(' · ')} />}
    <Row icon="reset" iconTint="var(--acc)" title={busy ? t('Syncing…') : t('Sync now')} onClick={now} />
  </Section>
}
