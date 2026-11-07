// Settings → Look & Home: Motion and Text size (lib/display-prefs.js), this device only.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { readDisplay, applyDisplay, followsSystemText, systemTextScale } from '../lib/display-prefs.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { Button, Row, Segmented } from './ui.jsx'

export const TEXT_ORDER = ['smallest', 'small', 'default', 'large', 'larger', 'largest']

export function textSizeOptions(win = globalThis) {
  const phone = followsSystemText(win)
  const labels = {
    smallest: t('Smallest'), small: t('Small'),
    default: phone ? t('Like the phone') : t('Default'),
    large: t('Large'), larger: t('Larger'), largest: t('Largest'),
  }
  const subs = {
    // The phone's own size, as the percentage the page uses for it now.
    default: phone ? t('Follows your phone’s text size, now {0}.', Math.round(systemTextScale(win) * 100) + ' %') : null,
    larger: t('For reading mid-set without your glasses.'),
    largest: t('Big enough to read from the bench.'),
  }
  return TEXT_ORDER.map(value => ({ value, label: labels[value], subtitle: subs[value] || null }))
}

/**
 * The text size picker: a tap applies at once and the sheet stays open, so the preview on top
 * (and the sheet, and the app behind it) already shows the size before you leave. Done closes.
 */
export function TextSizeSheet({ value, onChange, close }) {
  const [cur, setCur] = useState(value)
  const opts = textSizeOptions()
  const pick = v => { setCur(v); onChange(v) }
  return <>
    <h3>{t('Text size')}</h3>
    <div className="tsz-preview" aria-live="polite" data-text-preview>
      <div className="tsz-p-t">{t('Heavy squats, then pizza.')}</div>
      <div className="tsz-p-s">{t('Set {0} of {1}', 2, 4)} · 80 kg × 8</div>
      <div className="tsz-p-f">{t('This is how the app reads now.')}</div>
    </div>
    <div className="sect-b" role="radiogroup" aria-label={t('Text size')}>
      {opts.map(o => (
        <button key={o.value} role="radio" aria-checked={o.value === cur} className="lrow tap" onClick={() => pick(o.value)}>
          <span className="lrow-m"><span className="lrow-t">{o.label}</span>
            {o.subtitle && <span className="lrow-s">{o.subtitle}</span>}</span>
          {o.value === cur && <Icon name="check" className="lrow-k" />}
        </button>
      ))}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
    <div style={{ height: 8 }} />
  </>
}

export default function DisplayRows() {
  const [d, setD] = useState(readDisplay)
  const set = patch => setD(prev => applyDisplay({ ...prev, ...patch }, { save: true }))
  const cur = textSizeOptions().find(o => o.value === d.text)
  const openText = () => useUI.getState().openSheet(close => <TextSizeSheet value={d.text} onChange={v => set({ text: v })} close={close} />)
  return <>
    <Row icon="sparkles" iconTint="var(--teal)" title={t('Motion')} subtitle={t('Less: no sliding, bouncing or snow. Things just appear.')}>
      <Segmented className="seg-inline"
        options={[{ value: 'system', label: t('Like the phone') }, { value: 'less', label: t('Less') }]}
        value={d.motion} onChange={v => set({ motion: v })} />
    </Row>
    <Row icon="note" iconTint="var(--blue)" title={t('Text size')} value={cur?.label} accessory="chevron" onClick={openText} />
  </>
}
