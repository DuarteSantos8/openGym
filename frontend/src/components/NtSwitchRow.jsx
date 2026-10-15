import { settingOf, useNtSettings } from '../lib/nutrition/use-nt-settings.js'
import { Row, Switch } from './ui.jsx'

// A boolean NutriTrace setting as a switch row. `k` is the settings key; unsaved, it reads as
// NutriTrace's default. The title is the row's label and its accessible name.
export default function NtSwitchRow({ k, icon, tint, title, subtitle }) {
  const { data, busy, save } = useNtSettings()
  return <Row icon={icon} iconTint={tint} title={title} subtitle={subtitle}>
    <Switch aria-label={title} checked={settingOf(data, k) === true} disabled={!!busy[k]} onChange={v => save(k, v)} />
  </Row>
}
