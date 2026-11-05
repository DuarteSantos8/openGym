// Settings → Plan → "Gemini API key": where the user pastes the free key from Google AI Studio that
// powers the AI review on the Plan's performance screen. The key goes to the platform's secure
// storage (lib/perf-report.js → lib/coach-secrets.js) and nowhere else: not S, so it never syncs or
// lands in a backup, and never the code.
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { AI_STUDIO_KEY_URL, clearGeminiKey, getGeminiKey, setGeminiKey } from '../lib/perf-report.js'
import { Button, TextField } from './ui.jsx'
import { openExternal } from './CustomMedia.jsx'

const listeners = new Set()
const changed = () => listeners.forEach(f => f())

/** Whether a key is saved on this device (null while it is being read), kept current after a save or removal. */
export function useHasGeminiKey() {
  const [has, setHas] = useState(null)
  useEffect(() => {
    let alive = true
    const read = () => getGeminiKey().then(k => { if (alive) setHas(!!k) }, () => { if (alive) setHas(false) })
    read()
    listeners.add(read)
    return () => { alive = false; listeners.delete(read) }
  }, [])
  return has
}

export function GeminiKeySheet({ close }) {
  const has = useHasGeminiKey()
  const [key, setKey] = useState('')
  const toast = m => useUI.getState().toast(m)
  const save = async () => {
    const v = key.trim()
    if (!v) return
    await setGeminiKey(v)
    changed(); close(); toast(t('Key saved'))
  }
  const remove = async () => { await clearGeminiKey(); changed(); close(); toast(t('Key removed')) }
  return <>
    <h3>{t('Gemini API key')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Free from Google AI Studio. It stays on this phone, in its secure storage: never in your plan, a backup or the app’s code.')}</div>
    <TextField type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      placeholder={has ? t('A key is saved. Paste a new one to replace it') : t('Paste your key')}
      value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={!key.trim()} onClick={save}>{t('Save')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="tinted" icon="link" onClick={() => openExternal(AI_STUDIO_KEY_URL)}>{t('Create a free key')}</Button>
    {has && <><div style={{ height: 10 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Remove key')}</Button></>}
  </>
}

export const openGeminiKeySheet = () => useUI.getState().openSheet(close => <GeminiKeySheet close={close} />)
