import { useCallback, useEffect, useMemo, useState } from 'react'
import { todayISO } from '../format.js'
import { NtApi } from './api.js'
import { MAX_TEMPLATES, applyTemplate, draftOf, goalsFor, makeTemplate, writesFor } from './goals.js'
import { useNutrition } from './store.js'

// The Goals page's state: NutriTrace's settings, an editable draft of them, and a save that
// writes only what the person changed here. A failed save keeps the draft and says why.
//
// `snapshot` is the settings the draft was made from. A save diffs the draft against it, so a
// setting changed elsewhere meanwhile is never put back to what this page first saw.
//
// `figures` are the server's own numbers behind Adaptive and Dynamic. They are shown when the
// server has them and left out when it has not: the page works without them. `adaptiveStatus`
// says whether the Adaptive estimate is still loading, failed, or in.

const idle = { state: 'idle', error: null }
const limitError = () => Object.assign(new Error('template limit'), { code: 'template-limit' })

export function useGoalsForm() {
  const settings = useNutrition(s => s.settings)
  const [draft, setDraft] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [figures, setFigures] = useState({ adaptive: null, adaptiveStatus: 'loading', caloriesOut: null })
  const [save, setSave] = useState(idle)

  const load = useCallback(() => useNutrition.getState().loadSettings({ force: true }), [])
  useEffect(() => { useNutrition.getState().loadSettings() }, [])
  useEffect(() => {
    let live = true
    NtApi.getAdaptiveTdee().then(
      adaptive => { if (live) setFigures(f => ({ ...f, adaptive, adaptiveStatus: 'ready' })) },
      () => { if (live) setFigures(f => ({ ...f, adaptiveStatus: 'failed' })) },
    )
    NtApi.getCaloriesOut(todayISO()).then(r => { if (live) setFigures(f => ({ ...f, caloriesOut: r.calories_out ?? null })) }, () => {})
    return () => { live = false }
  }, [])

  // The draft starts from the first settings that arrive and is the person's from then on.
  if (draft == null && settings.status === 'ready' && settings.data) {
    setDraft(draftOf(settings.data))
    setSnapshot(settings.data)
  }

  const patch = useCallback(changes => {
    setSave(s => (s.state === 'error' ? idle : s))
    setDraft(d => ({ ...d, ...(typeof changes === 'function' ? changes(d) : changes) }))
  }, [])

  const writes = useMemo(
    () => (draft && snapshot && settings.data ? writesFor(settings.data, draft, snapshot) : []),
    [draft, snapshot, settings.data],
  )

  // One attempt at a list of writes, in order; the first failure stops it. What was written stays
  // written (the cache follows each one), so a retry sends only the rest.
  const run = useCallback(async list => {
    setSave({ state: 'saving', error: null })
    try {
      for (const [key, value] of list) await useNutrition.getState().saveSetting(key, value)
      setSave(idle)
      return true
    } catch (error) {
      setSave({ state: 'error', error })
      return false
    }
  }, [])

  // The server's settings as they are now, or null (with the error shown) when they cannot be read.
  const fresh = useCallback(async () => {
    const data = await load()
    const { status, error } = useNutrition.getState().settings
    if (status === 'error' || !data) {
      setSave({ state: 'error', error })
      return null
    }
    return data
  }, [load])

  const submit = useCallback(async () => {
    if (!draft) return false
    setSave({ state: 'saving', error: null })
    // Goals is one setting holding every nutrient: merge into what the server has now.
    const current = await fresh()
    if (!current) return false
    const ok = await run(writesFor(current, draft, snapshot))
    if (ok) {
      const data = useNutrition.getState().settings.data
      setDraft(draftOf(data))
      setSnapshot(data)
    }
    return ok
  }, [draft, snapshot, fresh, run])

  const saveTemplate = useCallback(async name => {
    setSave({ state: 'saving', error: null })
    const current = await fresh()
    if (!current) return false
    const list = current.goalTemplates || []
    if (list.length >= MAX_TEMPLATES) {
      setSave({ state: 'error', error: limitError() })
      return false
    }
    const tpl = makeTemplate(name, goalsFor(current, draft, snapshot), draft.waterMl)
    return run([['goalTemplates', [...list, tpl]]])
  }, [draft, snapshot, fresh, run])

  const deleteTemplate = useCallback(async id => {
    setSave({ state: 'saving', error: null })
    const current = await fresh()
    if (!current) return false
    return run([['goalTemplates', (current.goalTemplates || []).filter(tpl => tpl.id !== id)]])
  }, [fresh, run])

  const pickTemplate = useCallback(tpl => patch(d => applyTemplate(d, tpl)), [patch])

  return {
    status: settings.status, loadError: settings.error, settings: settings.data, reload: load,
    draft, patch, dirty: writes.length > 0, save, submit,
    figures, saveTemplate, deleteTemplate, pickTemplate,
  }
}
