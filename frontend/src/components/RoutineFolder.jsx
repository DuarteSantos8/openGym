// A routine's folder (lib/routine-folders.js): the row in the routine editor and the sheet it
// opens, one field with the folders already in use as chips to tap, and No folder.
import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { cleanFolder, folderOf, foldersOf, FOLDER_MAX } from '../lib/routine-folders.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { Button, Row } from './ui.jsx'

function FolderSheet({ id, close }) {
  const routines = useStore(s => s.S.routines)
  const update = useStore(s => s.update)
  const r = routines.find(x => x.id === id)
  const [name, setName] = useState(folderOf(r))
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef)
  const save = v => {
    const f = cleanFolder(v)
    update(s => {
      const x = s.routines.find(y => y.id === id)
      if (!x) return
      if (f) x.folder = f; else delete x.folder
    })
    close()
  }
  const used = foldersOf(routines)
  return <>
    <h3>{t('Folder')}</h3>
    <p className="small muted" style={{ marginTop: 0 }}>{t('Group routines by block or by goal. Put old ones in Archive, it stays folded.')}</p>
    <input ref={inputRef} className="input" type="text" maxLength={FOLDER_MAX} value={name} placeholder={t('Folder name')}
      aria-label={t('Folder name')} onFocus={onFocus} onChange={e => setName(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') save(name) }} />
    <div className="folder-chips">
      {[...new Set([...used, t('Archive')])].map(f => (
        <button key={f} type="button" className={'chip' + (cleanFolder(name).toLowerCase() === f.toLowerCase() ? ' on' : '')} onClick={() => save(f)}>{f}</button>
      ))}
    </div>
    <Button variant="primary" disabled={!cleanFolder(name)} onClick={() => save(name)}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    {folderOf(r) && <Button onClick={() => save('')}>{t('No folder')}</Button>}
  </>
}
export const routineFolderSheet = id => useUI.getState().openSheet(close => <FolderSheet id={id} close={close} />)

export function RoutineFolderRow({ r }) {
  const f = folderOf(r)
  return <Row icon="folder" iconTint="var(--blue)" title={t('Folder')} accessory="chevron" value={f || t('None')}
    onClick={() => routineFolderSheet(r.id)} />
}
