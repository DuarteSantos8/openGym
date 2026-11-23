// LIFTIQ-FORK: the "LiftIQ sensor" row of Settings (new file): connection summary, opens the panel in a sheet.
// Plain English on purpose (see LIFTIQ-FORK.md). The panel and the vendored package load on demand.
import { Row, Section } from '../components/ui.jsx'
import { sensorStore } from './mini-store.js'
import { liftiqEnabled } from './feature.js'
import { statusText } from './format.js'

export function openSensorSheet() {
  return import('./SensorSheet.jsx').then(m => m.openSensorSheet())
}

export default function LiftiqSettingsSection() {
  const s = sensorStore.use()
  if (!liftiqEnabled()) return null
  return <Section title="LiftIQ sensor" footer="Bar speed and rep counting with the LiftIQ sensor. Android Chrome or desktop Chrome, https or localhost.">
    <Row icon="bolt" iconTint="var(--acc)" title="LiftIQ sensor" subtitle={statusText(s)}
      accessory="chevron" onClick={() => { void openSensorSheet() }} />
  </Section>
}
