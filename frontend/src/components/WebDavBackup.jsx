import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { fmtAgo } from '../lib/format.js'
import { loadConfig, saveConfig, onConfigChange, urlProblem, folderUrl, errorText, DavError } from '../lib/webdav.js'
import { runBackup, listBackups, fetchBackup, forgetWebdav, getPassword, setPassword, clientFor, currentOwner, claimWebdav, webdavView } from '../lib/webdav-run.js'
import { confirmBackupImport } from './backup-restore.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, Switch, Button, TextField } from './ui.jsx'
import Icon from './Icon.jsx'

/* Settings → Data & backup → Back up to WebDAV (#582): the folder,
   the name and password, a daily backup on this device, Back up now and Restore. The rules and
   the client are lib/webdav.js; the runs lib/webdav-run.js. */

export const WEBDAV_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/WEBDAV_BACKUP.md'

/** This device's WebDAV settings, with `foreign` while another account than the one active set them up. */
export function useWebdavConfig() {
  const [cfg, setCfg] = useState(() => loadConfig())
  useEffect(() => onConfigChange(setCfg), [])
  const owner = useStore(s => currentOwner(s))
  // Settings from before they had an owner become the active account's (lib/webdav-run.js).
  useEffect(() => { if (owner) claimWebdav(owner) }, [owner])
  return webdavView(cfg, owner)
}

/** The line a row or a card shows about the last backup. */
export function webdavStatus(cfg) {
  if (!cfg) return null
  if (cfg.foreign) return { tone: 'attention', text: t('This backup belongs to another account') }
  if (cfg.last && !cfg.last.ok) return { tone: 'attention', text: t(errorText({ code: cfg.last.msg })) }
  if (cfg.lastOk) return { tone: 'ok', text: t('Last backup {0}', fmtAgo(cfg.lastOk)) }
  return { tone: 'ok', text: t('No backup yet') }
}

export const webdavSheet = () => useUI.getState().openSheet(close => <WebDavSheet close={close} />)

export function WebDavSheet({ close }) {
  const cfg = useWebdavConfig()
  if (cfg?.foreign) return <WebDavForeign close={close} />
  return cfg ? <WebDavManage cfg={cfg} close={close} /> : <WebDavSetup close={close} />
}

const confirmForget = () => confirmSheet({
  title: t('Disconnect WebDAV?'), message: t('This device stops backing up and forgets the password. The backups already in the folder stay there.'),
  confirmText: t('Disconnect'), danger: true, onConfirm: () => { forgetWebdav(); toast(t('Disconnected')) },
})

/* Somebody else set this device's WebDAV backup up (a shared phone or browser): nothing of this
   account goes to their folder and nothing of theirs is read back. Their address is not shown
   either. Disconnecting frees the device for a folder of this account's own. */
function WebDavForeign({ close }) {
  return <>
    <div className="intg-head">
      <h3 className="intg-h"><Icon name="cloud" /><span>{t('WebDAV backup')}</span></h3>
      <span className="intg-pill attention">{t('Paused')}</span>
    </div>
    <p className="intg-note warn" role="status">{t('This backup belongs to another account')}</p>
    <p className="intg-lead">{t('Someone else set it up on this device, so nothing of yours goes to their folder. Disconnect it to set up your own.')}</p>
    <div className="sect-b intg-end">
      <button type="button" className="lrow tap danger" onClick={confirmForget}><Icon name="trash" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Disconnect')}</span></span></button>
    </div>
    <div style={{ height: 8 }} />
    <Button variant="plain" onClick={close}>{t('Done')}</Button>
  </>
}

const toast = m => useUI.getState().toast(m)

export function WebDavSetup({ close, cfg = null }) {
  const [url, setUrl] = useState(cfg?.url || '')
  const [user, setUser] = useState(cfg?.user || '')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const problem = url ? urlProblem(url) : null
  const save = async () => {
    const p = urlProblem(url)
    if (p) { setErr(t(p)); return }
    setBusy(true); setErr(null)
    // Bound to whoever sets it up: another account on this device never backs up into it.
    const next = { ...(cfg || {}), url: folderUrl(url), user: user.trim(), daily: cfg ? cfg.daily : true, owner: currentOwner() || cfg?.owner || undefined }
    try {
      const password = pass || await getPassword()
      if (!password) throw new DavError('no-password')
      // Tried before anything is kept: reading the folder's list proves the address and the login.
      const client = await clientFor(next, password)
      await client.index()
      await setPassword(password)
      saveConfig(next)
      toast(t('Connected. Your first backup goes up now.'))
      runBackup({ manual: true }).then(r => { if (!r.ok && r.error) toast(t(errorText(r.error))) })
      if (cfg) close()
    } catch (e) {
      setErr(t(errorText(e)))
    } finally { setBusy(false) }
  }
  return <>
    <div className="intg-head"><h3 className="intg-h"><Icon name="cloud" /><span>{t('WebDAV backup')}</span></h3></div>
    <p className="intg-lead">{t('A copy of everything, once a day, in a folder of your own: Nextcloud, ownCloud, a NAS, anything that speaks WebDAV. Your server, nobody else’s.')}</p>
    <label className="intg-label" htmlFor="dav-url">{t('Folder address')}</label>
    <TextField id="dav-url" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      placeholder="https://cloud.example.com/remote.php/dav/files/me/openGym/" value={url} onChange={e => setUrl(e.target.value)} />
    {problem && <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>{t(problem)}</div>}
    <label className="intg-label" htmlFor="dav-user">{t('User name')}</label>
    <TextField id="dav-user" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="username" value={user} onChange={e => setUser(e.target.value)} />
    <label className="intg-label" htmlFor="dav-pass">{t('Password')}</label>
    <TextField id="dav-pass" type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)}
      placeholder={cfg ? t('Leave empty to keep the one saved') : t('An app password is best')} />
    <p className="sect-f" style={{ marginTop: 6 }}>{t('The password stays on this device, in its secure storage. It is never synced or put in a backup.')}</p>
    {err && <div className="small" role="alert" style={{ color: 'var(--red)', margin: '4px 0 10px' }}>{err}</div>}
    <Button variant="primary" disabled={busy || !url || !!problem} onClick={save}>{busy ? t('Checking…') : t('Connect')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="tinted" onClick={() => window.open(WEBDAV_DOCS, '_blank', 'noopener')}>{t('How to set it up')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{cfg ? t('Cancel') : t('Done')}</Button>
  </>
}

function WebDavManage({ cfg, close }) {
  const [busy, setBusy] = useState(false)
  const st = webdavStatus(cfg)
  const host = (() => { try { return new URL(cfg.url).host } catch { return cfg.url } })()
  const now = async () => {
    setBusy(true)
    const r = await runBackup({ manual: true })
    setBusy(false)
    toast(r.ok ? t('Backed up to {0}', host) : t(errorText(r.error)))
  }
  const restore = async () => {
    setBusy(true)
    let list
    try { list = await listBackups() } catch (e) { setBusy(false); toast(t(errorText(e))); return }
    setBusy(false)
    if (!list.length) { toast(t('No openGym backups in that folder yet.')); return }
    useUI.getState().openSheet(c => <RestoreList list={list} close={c} />)
  }
  const forget = confirmForget
  return <>
    <div className="intg-head">
      <h3 className="intg-h"><Icon name="cloud" /><span>{t('WebDAV backup')}</span></h3>
      <span className={'intg-pill ' + (st.tone === 'attention' ? 'attention' : 'connected')}>{st.tone === 'attention' ? t('Needs attention') : t('Connected')}</span>
    </div>
    <p className="intg-lead" translate="no">{cfg.user ? cfg.user + ' · ' : ''}{host}</p>
    <p className={'intg-note' + (st.tone === 'attention' ? ' warn' : '')} role="status">{st.text}</p>
    <Section>
      <Row icon="calendar" iconTint="var(--blue)" title={t('Back up every day')} subtitle={t('When the app is open, at most once a day, on this device.')}>
        <Switch aria-label={t('Back up every day')} checked={cfg.daily} onChange={v => saveConfig({ ...cfg, daily: v })} />
      </Row>
    </Section>
    <div className="sect-b">
      <button type="button" className="lrow tap" disabled={busy} onClick={now}><Icon name="share" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Back up now')}</span></span></button>
      <button type="button" className="lrow tap" disabled={busy} onClick={restore}><Icon name="download" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Restore from a backup')}</span></span></button>
      <button type="button" className="lrow tap" disabled={busy} onClick={() => useUI.getState().openSheet(c => <WebDavSetup cfg={cfg} close={c} />)}><Icon name="pencil" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Change server or password')}</span></span></button>
    </div>
    <p className="sect-f">{tn('Keeps the newest {0} backup, one per day.', 'Keeps the newest {0} backups, one per day.', 14)}</p>
    <div className="sect-b intg-end">
      <button type="button" className="lrow tap danger" onClick={forget}><Icon name="trash" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Disconnect')}</span></span></button>
    </div>
    <div style={{ height: 8 }} />
    <Button variant="plain" onClick={close}>{t('Done')}</Button>
  </>
}

function RestoreList({ list, close }) {
  const [busy, setBusy] = useState(null)
  const pick = async b => {
    setBusy(b.name)
    try {
      const text = await fetchBackup(b.name)
      const { readBackupFile } = await import('../lib/backup-media.js')
      const read = await readBackupFile(new File([text], b.name, { type: 'application/json' }))
      close()
      await confirmBackupImport(read)
    } catch (e) {
      if (e instanceof DavError) toast(t(errorText(e)))
      else { const { backupImportError } = await import('../lib/backup-media.js'); toast(backupImportError(e)) }
    } finally { setBusy(null) }
  }
  return <>
    <h3>{t('Restore from a backup')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick one. You choose whether it replaces what is here or merges with it.')}</div>
    <Section>
      {list.map(b => <Row key={b.name} icon="clock" iconTint="var(--blue)" accessory="chevron"
        title={b.name.slice('opengym-backup-'.length, -'.json'.length)}
        subtitle={[b.workouts != null ? tn('{0} workout', '{0} workouts', b.workouts) : null, b.size ? Math.max(1, Math.round(b.size / 1024)) + ' KB' : null].filter(Boolean).join(' · ') || null}
        value={busy === b.name ? t('Loading…') : null} onClick={busy ? undefined : () => pick(b)} />)}
    </Section>
    <Button variant="plain" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Settings → Data & backup: the way to the same sheet, with how the last backup went. */
export function WebDavRow() {
  const cfg = useWebdavConfig()
  const st = webdavStatus(cfg)
  return <Row icon="cloud" iconTint="var(--blue)" title={t('Back up to WebDAV')}
    subtitle={st ? st.text : t('Nextcloud or any WebDAV folder, once a day')} accessory="chevron" onClick={webdavSheet} />
}

