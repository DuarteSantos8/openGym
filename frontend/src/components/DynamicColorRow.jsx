import { t } from '../lib/i18n.js'
import { accentValue } from '../lib/accent.js'
import { dynamicLook, setDynamicChosen } from '../lib/dynamic-color.js'
import { useDynamicColor } from '../lib/use-dynamic-color.js'
import { setRestAccent } from '../lib/rest-alert.js'
import { Row, Switch } from './ui.jsx'

/* Settings → Look & Home → Wallpaper colors: Material You on this phone (lib/dynamic-color.js). The
   phone keeps the choice, so it is never synced; the profile's accent above stays as it is and
   comes back when this is off. Only there when the phone has wallpaper palettes (Android 12+). */
export default function DynamicColorRow({ S }) {
  const { palette, chosen } = useDynamicColor()
  if (!palette) return null
  const toggle = on => {
    setDynamicChosen(on)
    setRestAccent(on ? dynamicLook(palette, 'dark').accent : accentValue(S))
  }
  return <Row icon="image" iconTint="var(--teal)" title={t('Wallpaper colors')}
    subtitle={t('The accent and the backgrounds follow your wallpaper. Just for this phone.')}>
    <Switch aria-label={t('Wallpaper colors')} checked={chosen} onChange={toggle} />
  </Row>
}
