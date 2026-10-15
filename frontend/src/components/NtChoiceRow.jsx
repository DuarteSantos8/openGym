import { settingOf, useNtSettings } from '../lib/nutrition/use-nt-settings.js'
import { SelectRow } from './ui.jsx'

// A NutriTrace setting with a fixed set of values as a picker row. `options` are
// `{ value, label, subtitle? }`; unsaved, the key reads as NutriTrace's default.
export default function NtChoiceRow({ k, icon, tint, title, options, search }) {
  const { data, save } = useNtSettings()
  return <SelectRow icon={icon} iconTint={tint} title={title} value={settingOf(data, k)} options={options}
    search={search} onChange={v => save(k, v)} />
}
