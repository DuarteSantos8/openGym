import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { EXIDX, figureOf } from '../lib/exercises.js'
import { selectCatalogueAssets } from '../lib/catalogue-media-selection.js'
import { useCatalogueMedia } from './catalogue-media-hooks.js'
import { Button, Row, Section } from './ui.jsx'

export const mediaBytes = n => Number(n || 0) < 1000000
  ? `${Math.ceil(Number(n || 0) / 1000)} kB`
  : `${(Number(n || 0) / 1000000).toFixed(1)} MB`

export function catalogueDownloadError(error) {
  if (error?.code === 'offline') return t('Not downloaded. Connect to download.')
  if (error?.code === 'no-space') return t('Not enough space. Free some space and continue.')
  return t('Download failed. Try again.')
}

function batchStatus(status) {
  if (status === 'queued') return t('Queued')
  if (status === 'downloading') return t('Download animations')
  if (status === 'verifying') return t('Verifying')
  if (status === 'pausing') return t('Pausing')
  if (status === 'completed' || status === 'ready') return t('Completed')
  if (status === 'failed') return t('Download failed. Try again.')
  if (status === 'cancelled') return t('Cancel')
  return t('Paused')
}

/** Device downloads have their own controls and never write to the profile store. */
export default function CatalogueMediaManager({ service: supplied, initiallyOpen = false }) {
  const S = useStore(s => s.S)
  const { service, snapshot } = useCatalogueMedia(supplied)
  const [open, setOpen] = useState(initiallyOpen)
  const [preview, setPreview] = useState(null)
  const [cleanup, setCleanup] = useState(null)
  const [selected, setSelected] = useState([])
  const [savedLimit, setSavedLimit] = useState(30)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const state = snapshot || { resources: {}, batches: [], downloadedBytes: 0, bundledBytes: 0, obsoleteBytes: 0 }
  const saved = Object.keys(state.resources || {}).filter(id => state.resources[id].status === 'downloaded')
  const act = async fn => {
    setBusy(true); setMessage('')
    try { await fn() } catch (e) { setMessage(catalogueDownloadError(e)) }
    finally { setBusy(false) }
  }
  const prepare = (scope, batch) => act(async () => {
    if (!service) { setMessage(t('Animations are unavailable in this build.')); return }
    const ids = batch?.assetIds?.slice() || selectCatalogueAssets({ state: S, scope, manifest: service.manifest })
    if (!ids.length) { setMessage(scope === 'favourites' ? t('No favourites to download.') : t('Nothing to download.')); return }
    const estimate = await service.estimate(ids)
    if (!batch && !estimate.missingCount) { setPreview(null); setMessage(t('Nothing to download.')); return }
    setPreview({ ids, ...estimate, batchId: batch?.id || null, figure: figureOf(S) })
  })
  const start = () => act(async () => {
    if (preview.batchId) await service.resume(preview.batchId)
    else await service.enqueue(preview.ids)
    setPreview(null)
  })
  const askCleanup = (kind, ids) => {
    const requested = new Set(ids || [])
    const assets = new Map((service?.manifest.assets || []).map(a => [a.assetId, a]))
    const hashes = new Map()
    for (const id of requested) {
      const asset = assets.get(id)
      if (asset && !saved.some(other => !requested.has(other) && assets.get(other)?.sha256 === asset.sha256))
        hashes.set(asset.sha256, asset.bytes)
    }
    const bytes = kind === 'all' ? state.downloadedBytes : kind === 'obsolete' ? state.obsoleteBytes
      : [...hashes.values()].reduce((sum, bytes) => sum + bytes, 0)
    setCleanup({ kind, ids, bytes })
  }
  const remove = () => act(async () => {
    let result
    if (cleanup.kind === 'all') result = await service.removeAll()
    else if (cleanup.kind === 'obsolete') result = await service.removeObsolete()
    else result = await service.remove(cleanup.ids)
    if (result?.deferredCount) setMessage(t('{0} animations will be removed after playback.', result.deferredCount))
    setCleanup(null); setSelected([])
  })
  const cellular = !globalThis.navigator?.connection || globalThis.navigator.connection.type !== 'wifi'
  return <Section className="catalogue-media-manager">
    <Row icon="download" iconTint="var(--teal)" title={t('Offline exercise animations')}
      subtitle={t('{0} animations saved on this device', saved.length)} accessory="chevron" onClick={() => setOpen(value => !value)} />
    {open && <div className="catalogue-media-panel">
      <p>{t('Current drawings: {0}', figureOf(S) === 'female' ? t('Female') : t('Male'))}</p>
      <p className="catalogue-media-muted">{t('Bundled: {0} · Downloaded: {1} · Old files: {2}', mediaBytes(state.bundledBytes), mediaBytes(state.downloadedBytes), mediaBytes(state.obsoleteBytes))}</p>
      {!service && <p role="status">{t('Animations are unavailable in this build.')}</p>}
      <div className="catalogue-media-actions">
        <Button disabled={busy || !service} onClick={() => prepare('plan')}>{t('Download current plan')}</Button>
        <Button disabled={busy || !service} onClick={() => prepare('favourites')}>{t('Download favourites')}</Button>
        <Button disabled={busy || !service} onClick={() => prepare('all')}>{t('Download all animations')}</Button>
      </div>
      {preview && <div className="catalogue-media-confirm" role="group" aria-label={t('Download animations')}>
        <p>{t('Current drawings: {0}', preview.figure === 'female' ? t('Female') : t('Male'))}</p>
        <p>{t('{0} missing · {1} to download', preview.missingCount, mediaBytes(preview.downloadBytes))}</p>
        <p>{t('Allow {0} of free space', mediaBytes(preview.peakAdditionalBytes))}</p>
        {preview.freeBytes == null && <p>{t('Space could not be checked')}</p>}
        {preview.freeBytes != null && preview.freeBytes < preview.peakAdditionalBytes && <p role="alert">{t('Not enough space. Free some space and continue.')}</p>}
        {cellular && <p>{t('This download may use mobile data.')}</p>}
        <div className="catalogue-media-actions">
          <Button variant="primary" disabled={busy || (preview.freeBytes != null && preview.freeBytes < preview.peakAdditionalBytes)} onClick={start}>{t('Start')}</Button>
          <Button disabled={busy} onClick={() => setPreview(null)}>{t('Cancel')}</Button>
        </div>
      </div>}
      {!!state.batches?.length && <ul className="catalogue-media-batches">{state.batches.map(batch => {
        const completed = batch.completed?.length || 0
        const failed = Object.keys(batch.failed || {}).length
        const total = batch.assetIds?.length || 0
        const running = ['queued', 'downloading', 'verifying', 'pausing'].includes(batch.status)
        const error = batch.error || Object.values(batch.failed || {})[0]
        return <li key={batch.id}>
          <p>{batchStatus(batch.status)}</p>
          <p>{t('{0} completed · {1} failed · {2} total', completed, failed, total)}</p>
          <progress value={completed} max={Math.max(total, 1)} aria-label={t('Download animations')} />
          {error && <p role="status">{catalogueDownloadError(error)}</p>}
          {!!batch.unavailable?.length && <p role="status">{t('{0} animations are no longer available.', batch.unavailable.length)}</p>}
          <div className="catalogue-media-actions">
            {running && <Button disabled={busy || batch.status === 'pausing'} onClick={() => act(() => service.pause(batch.id))}>{t('Pause')}</Button>}
            {!running && !['completed', 'ready', 'cancelled'].includes(batch.status) && <Button disabled={busy} onClick={() => prepare(null, batch)}>{t('Continue')}</Button>}
            {!!failed && <Button disabled={busy} onClick={() => act(() => service.retry(batch.id))}>{t('Retry failed downloads')}</Button>}
            {!['completed', 'ready', 'cancelled'].includes(batch.status) && <Button disabled={busy} onClick={() => act(() => service.cancel(batch.id))}>{t('Cancel')}</Button>}
          </div>
        </li>
      })}</ul>}
      {!!saved.length && <fieldset className="catalogue-media-saved">
        <legend>{t('Delete selected downloads')}</legend>
        {saved.slice(0, savedLimit).map(id => {
          const asset = service?.manifest.assets.find(a => a.assetId === id)
          // Names are catalogue metadata, never a path or content digest.
          const ex = EXIDX[asset?.drawingId]
          const name = ex ? exerciseNameFor(ex) : null
          const figure = ex?.fv ? asset.drawingId === ex.fv ? t('Female') : t('Male')
            : ex?.mv ? asset.drawingId === ex.mv ? t('Male') : t('Female') : null
          return <label key={id}>
            <input type="checkbox" checked={selected.includes(id)} onChange={() => setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])} />
            <span>{name || t('Exercise animations')}{figure ? ` · ${figure}` : ''} · {mediaBytes(state.resources[id].bytes)}</span>
          </label>
        })}
        {saved.length > savedLimit && <Button onClick={() => setSavedLimit(n => n + 30)}>{t('Show more')}</Button>}
        <Button disabled={busy || !selected.length} onClick={() => askCleanup('selected', selected)}>{t('Delete selected downloads')}</Button>
      </fieldset>}
      <div className="catalogue-media-actions">
        <Button disabled={busy || !service || !state.downloadedBytes} onClick={() => askCleanup('all')}>{t('Delete all downloads')}</Button>
        <Button disabled={busy || !service || !state.obsoleteBytes} onClick={() => askCleanup('obsolete')}>{t('Delete old files')}</Button>
      </div>
      {cleanup && <div className="catalogue-media-confirm" role="group" aria-label={t('Delete selected downloads')}>
        <p>{t('Remove {0} of downloaded animations?', mediaBytes(cleanup.bytes))}</p>
        <p>{t('This affects only downloaded animations. Your training data stays saved.')}</p>
        <div className="catalogue-media-actions">
          <Button variant="danger" disabled={busy} onClick={remove}>{t('Delete')}</Button>
          <Button disabled={busy} onClick={() => setCleanup(null)}>{t('Cancel')}</Button>
        </div>
      </div>}
      <p role="status" aria-live="polite">{message}</p>
    </div>}
  </Section>
}
