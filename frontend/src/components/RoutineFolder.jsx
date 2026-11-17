// A routine's folder (lib/routine-folders.js): the row in the routine editor opens Move to folder
// (RoutineMenus.jsx); the name sheet is New folder and Rename, with the helpers' refusals as errors.
import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { cleanFolder, createFolder, folderOf, renameFolder, FOLDER_MAX } from '../lib/routine-folders.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { Button, Row } from './ui.jsx'
import { moveSheet } from './RoutineMenus.jsx'

const update = fn => useStore.getState().update(fn)

function NameSheet({ mode, name = '', onDone, close }) {
  const [v, setV] = useState(name)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef)
  const save = () => {
    let res
    update(s => { res = mode === 'new' ? createFolder(s, v) : renameFolder(s, name, v) })
    // A new folder named like one that exists goes to that one.
    if (!res.ok && res.reason === 'taken' && mode === 'new' && onDone) res = { ok: true, name: res.name }
    if (!res.ok) { setErr(res.reason === 'taken' ? t('There’s already a folder called {0}.', cleanFolder(v)) : res.reason === 'reserved' ? t('That name is kept for the archive.') : ''); return }
    close()
    onDone?.(res.name || cleanFolder(v))
  }
  return <>
    <h3>{mode === 'new' ? t('New folder') : t('Rename folder')}</h3>
    <input ref={inputRef} className="input" type="text" maxLength={FOLDER_MAX} value={v} placeholder={t('Folder name')} autoFocus
      aria-label={t('Folder name')} aria-invalid={!!err || undefined} onFocus={onFocus}
      onChange={e => { setV(e.target.value); setErr('') }} onKeyDown={e => { if (e.key === 'Enter' && cleanFolder(v)) save() }} />
    {err && <p className="small" role="alert" style={{ color: 'var(--red)' }}>{err}</p>}
    <div style={{ height: 8 }} />
    <Button variant="primary" disabled={!cleanFolder(v)} onClick={save}>{t('Save')}</Button>
  </>
}
export const folderNameSheet = opts => useUI.getState().openSheet(close => <NameSheet {...opts} close={close} />)

export function RoutineFolderRow({ r }) {
  const f = folderOf(r)
  return <Row icon="folder" iconTint="var(--blue)" title={t('Folder')} accessory="chevron" value={f || t('None')}
    onClick={() => moveSheet([r.id])} />
}
