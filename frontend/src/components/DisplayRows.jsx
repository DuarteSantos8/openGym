// Settings → Look & Home: Motion and Text size (lib/display-prefs.js), this device only.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { readDisplay, applyDisplay } from '../lib/display-prefs.js'
import { Row, Segmented, SelectRow } from './ui.jsx'

export default function DisplayRows() {
  const [d, setD] = useState(readDisplay)
  const set = patch => setD(applyDisplay({ ...d, ...patch }, { save: true }))
  return <>
    <Row icon="sparkles" iconTint="var(--teal)" title={t('Motion')} subtitle={t('Less: no sliding, bouncing or snow. Things just appear.')}>
      <Segmented className="seg-inline"
        options={[{ value: 'system', label: t('Like the phone') }, { value: 'less', label: t('Less') }]}
        value={d.motion} onChange={v => set({ motion: v })} />
    </Row>
    <SelectRow icon="note" iconTint="var(--blue)" title={t('Text size')} sheetTitle={t('Text size')}
      value={d.text} onChange={v => set({ text: v })}
      options={[
        { value: 'small', label: t('Small') },
        { value: 'default', label: t('Default') },
        { value: 'large', label: t('Large') },
        { value: 'larger', label: t('Larger'), subtitle: t('For reading mid-set without your glasses.') },
      ]} />
  </>
}
