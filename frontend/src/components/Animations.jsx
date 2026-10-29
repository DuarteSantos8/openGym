// Settings → Workout → Animation quality, and the hooks that put the chosen quality on screen
// (store apps only; the web and a self-hosted server show nothing new and keep their 180 px
// files). The rules are lib/anim-quality.js, the packs and the per-device choice lib/anim-packs.js.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { gifSrc, figureOf } from '../lib/exercises.js'
import { fmtMB } from '../lib/media-limits.js'
import { BUILTIN_PX, packId, parsePackId, wantedQuality, clipSources } from '../lib/anim-quality.js'
import { subscribe, getState, installedBases, deviceInfo, refresh, ensureWanted, writePrefs, download, remove, downloadBytes, diagnose, offeredQualities, targetPack, ALL_PACKS } from '../lib/anim-packs.js'
import { Section, Row, Switch, Button } from './ui.jsx'
import { useUI } from '../store/useUI.js'

const MB = 1024 * 1024
export const useAnimPacks = () => useSyncExternalStore(subscribe, getState, getState)

/**
 * Where a built-in exercise's animation comes from, best first (lib/anim-quality.js clipSources):
 * `{ still, sources }`. Off the store apps, always the built-in file.
 */
export function useAnimSources(ex, figure) {
  const packs = useAnimPacks()
  const builtin = ex?.gif ? gifSrc(ex, figure) : null
  if (!MOBILE) return { still: false, sources: builtin ? [builtin] : [] }
  const choice = packs.available ? packs.prefs.choice : (packs.prefs.choice === 'still' ? 'still' : 'builtin')
  return clipSources({ ex, figure, choice, device: deviceInfo(), installed: installedBases(packs), builtin })
}

/** Shell: what the device has, once, and the pack the choice wants for the figure shown. */
export function useAnimPacksBoot() {
  const figure = useStore(s => figureOf(s.S))
  useEffect(() => { if (MOBILE) refresh().then(() => ensureWanted(figure)).catch(() => {}) }, [])
  useEffect(() => { if (MOBILE && getState().checked) ensureWanted(figure) }, [figure])
}

// "Auto (360 px)", "Still only", "Built in (180 px)", "720 px".
export function choiceLabel(choice, packs = getState(), figure = 'male') {
  if (choice === 'still') return t('Still only')
  if (choice === 'builtin' || !packs.available) return t('Built in ({0} px)', BUILTIN_PX)
  if (choice === 'auto') {
    // A build that names its packs (Android) may not have the size Auto wants: the one it gets.
    const target = packs.offered ? targetPack('auto', figure, deviceInfo(), packs) : null
    const q = packs.offered ? (target ? parsePackId(target).px : 'builtin') : wantedQuality('auto', deviceInfo())
    return t('Auto ({0})', q === 'builtin' ? t('{0} px', BUILTIN_PX) : t('{0} px', q))
  }
  return t('{0} px', choice)
}

export function AnimationQualityRow() {
  const packs = useAnimPacks()
  const figure = useStore(s => figureOf(s.S))
  if (!MOBILE) return null
  return <Row icon="image" iconTint="var(--indigo)" title={t('Animation quality')} value={choiceLabel(packs.prefs.choice, packs, figure)} accessory="chevron"
    onClick={() => useUI.getState().openSheet(close => <AnimationQualitySheet close={close} />)} />
}

// One pack's line under its quality: downloaded and how big on this device, on its way, waiting
// for Wi-Fi, or what it would take to download ("~750 MB").
const sizeText = bytes => t('{0} MB', fmtMB(Math.max(0.1, bytes / MB)))
function packLine(p, id) {
  if (!p || p.state === 'none' || !p.state) {
    const dl = downloadBytes(id)
    return dl ? t('Not downloaded') + ' · ~' + sizeText(dl) : t('Not downloaded')
  }
  if (p.state === 'ready') {
    const dl = downloadBytes(id)
    return t('Downloaded · {0}', p.bytes > 0 ? sizeText(p.bytes) : dl ? '~' + sizeText(dl) : '…')
  }
  if (p.state === 'downloading') return t('Downloading… {0}%', Math.round((p.progress || 0) * 100))
  if (p.state === 'needs-wifi') return t('Waiting for Wi-Fi')
  return t('Download failed. Tap to try again.')
}

// TestFlight builds (or the title tapped five times): what the native side knows about each pack
// and whether its sample drawing loads, for a screenshot when a download does not show. Not
// translated on purpose: it is for the person fixing it.
function PackDetails({ figure }) {
  const [rows, setRows] = useState(null)
  const run = async () => {
    setRows([])
    const ids = (getState().offered || ALL_PACKS).filter(id => id.endsWith('-' + figure))
    const out = []
    for (const id of ids) { out.push(await diagnose(id)); setRows([...out]) }
  }
  return <Section title="Details">
    <Row icon="info" title="Check the packs" subtitle="State, where they are read from, a sample drawing" accessory="chevron" onClick={run} />
    {rows && <pre className="small dim" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text', padding: '8px 12px', margin: 0 }}>
      {rows.length ? rows.map(r => JSON.stringify(r, null, 1)).join('\n\n') : '…'}
    </pre>}
  </Section>
}

export function AnimationQualitySheet({ close }) {
  const packs = useAnimPacks()
  const figure = useStore(s => figureOf(s.S))
  const { choice, wifiOnly } = packs.prefs
  const pick = c => { writePrefs({ choice: c }); ensureWanted(figure) }
  const retry = id => () => download(id)
  const qualities = packs.available ? offeredQualities(figure, packs) : []
  const ready = Object.entries(packs.packs).filter(([, p]) => p.state === 'ready')
  const taps = useRef(0)
  const [details, setDetails] = useState(false)
  const tapTitle = () => { taps.current += 1; if (taps.current >= 5) setDetails(true) }
  return <>
    <h3 onClick={tapTitle}>{t('Animation quality')}</h3>
    <Section footer={packs.available
      ? t('Sharper animations download once per figure. Until they’re here you see the built-in ones, so nothing ever goes blank.')
      : t('Sharper animations aren’t available on this device yet. The built-in ones work everywhere.')}>
      {packs.available && <Row title={choiceLabel('auto', packs, figure)} subtitle={t('A good size for this screen.')} accessory={choice === 'auto' ? 'check' : 'none'} onClick={() => pick('auto')} />}
      <Row title={t('Still only')} subtitle={t('No animation, just the picture. Easy on battery.')} accessory={choice === 'still' ? 'check' : 'none'} onClick={() => pick('still')} />
      <Row title={choiceLabel('builtin', packs, figure)} accessory={choice === 'builtin' || (!packs.available && choice !== 'still') ? 'check' : 'none'} onClick={() => pick('builtin')} />
      {qualities.map(px => {
        const id = packId(px, figure)
        const p = packs.packs[id]
        const failed = p?.state === 'failed' || p?.state === 'needs-wifi'
        return <Row key={px} title={t('{0} px', px)} subtitle={packLine(p, id)} accessory={choice === px ? 'check' : 'none'}
          onClick={failed && choice === px ? retry(id) : () => pick(px)} />
      })}
    </Section>
    {packs.available && <Section>
      <Row icon="cloud" iconTint="var(--blue)" title={t('Download over Wi-Fi only')}>
        <Switch checked={wifiOnly} onChange={v => writePrefs({ wifiOnly: v })} />
      </Row>
    </Section>}
    {ready.length > 0 && <Section title={t('On this device')}>
      {ready.map(([id, p]) => {
        const [, px, fig] = /^anim-(\d+)-(male|female)$/.exec(id) || []
        return <Row key={id} title={t('{0} px', px) + ' · ' + (fig === 'female' ? t('Female') : t('Male'))}
          subtitle={p.bytes > 0 ? sizeText(p.bytes) : '…'}>
          <Button size="sm" variant="danger" onClick={() => remove(id)}>{t('Delete')}</Button>
        </Row>
      })}
    </Section>}
    {packs.available && (packs.testflight || details) && <PackDetails figure={figure} />}
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
