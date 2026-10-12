import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { Button } from './components/ui.jsx'
import { t } from './lib/i18n.js'
import { todayISO } from './lib/format.js'
import { MOBILE, shareExport } from './lib/mobile.js'
import { buildProgrammeBundle, parseProgramme, mergeProgramme } from './lib/programme-share.js'

const state = () => useStore.getState().S
const ui = () => useUI.getState()
const unreadable = () => ui().toast(t('Couldn’t read that file.'))

export async function exportProgrammeFile(definition) {
  try {
    const current = state().programmes?.definitions?.find(item => item.id === definition.id)
    if (!current) throw new Error('Programme removed')
    const bundle = buildProgrammeBundle(current, { customEx: state().customEx, unit: state().unit })
    const json = JSON.stringify(bundle, null, 2)
    const filename = 'opengym-programme-' + todayISO() + '.json'
    if (MOBILE) {
      try { await shareExport(json, filename) } catch { /* native share dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = filename; link.click()
    URL.revokeObjectURL(url)
    ui().toast(t('Programme file saved. Send it to a friend!'))
  } catch {
    ui().toast(t('Couldn’t export that programme.'))
  }
}

export const programmeShareSheet = definition =>
  ui().openSheet(close => <ProgrammeShare definition={definition} close={close} />)

export function ProgrammeShare({ definition, close }) {
  return <>
    <h3>{definition.name}</h3>
    <div className="muted small" style={{ margin: '8px 0 16px', lineHeight: 1.4 }}>
      {t('Weeks, routines and exercise notes only. No workout history or weigh-ins.')}
    </div>
    <Button variant="primary" icon="share" onClick={async () => { await exportProgrammeFile(definition); close() }}>
      {t('Export programme file')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export function importProgrammeFile(file, onImported) {
  if (!file) return
  // A programme contains text prescriptions, not media or an account backup.
  if (file.size > 2 * 1024 * 1024) { unreadable(); return }
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const bundle = parseProgramme(reader.result)
      ui().openSheet(close => <ProgrammeImport bundle={bundle} close={close} onImported={onImported} />)
    } catch (error) {
      ui().toast(error?.code === 'not-programme'
        ? t('Import failed: {0}', t('this isn’t an openGym programme file'))
        : t('Couldn’t read that file.'))
    }
  }
  reader.onerror = unreadable
  reader.readAsText(file)
}

export function ProgrammeImport({ bundle, close, onImported }) {
  const sessions = bundle.programme.weeks.reduce((n, week) =>
    n + week.days.reduce((count, day) => count + day.sessions.length, 0), 0)
  const apply = () => {
    try {
      useStore.getState().update(s => {
        const result = mergeProgramme(s, bundle)
        Object.assign(s, result.state)
      })
      close()
      onImported?.()
      ui().toast(t('Programme saved'))
    } catch {
      unreadable()
    }
  }
  return <>
    <h3>{t('Import “{0}”', bundle.programme.name)}</h3>
    <div className="muted small" style={{ margin: '8px 0 14px' }}>
      {t('{0} weeks', bundle.programme.weeks.length)}{' · ' + t('{0} planned sessions', sessions)}
    </div>
    <div className="dim small" style={{ marginBottom: 16, lineHeight: 1.4 }}>
      {t('Added as a new programme. Choose your own start date.')}
    </div>
    <Button variant="primary" icon="plus" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}