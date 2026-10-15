import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { findByBarcode, normalizeBarcode } from '../lib/nutrition/barcode.js'
import { foodKcal } from '../lib/nutrition/diary.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { asksQuantity, logServing } from '../lib/nutrition/log-serving.js'
import { settingOf } from '../lib/nutrition/use-nt-settings.js'
import { beep } from '../lib/sound.js'
import CameraScan from './CameraScan.jsx'
import { foodEditSheet } from './FoodEditSheet.jsx'
import { portionSheet } from './PortionSheet.jsx'
import { quickKcalSheet } from './QuickKcalSheet.jsx'
import { SheetHeader } from './sheet-layout.jsx'
import { Button, TextField } from './ui.jsx'

// What a failed lookup tells the person (not a miss: nobody said the product does not exist).
function lookupErrorText(e) {
  if (e?.code === 'offline' || e?.code === 'timeout') return t('The lookup did not go through: no connection.')
  if (e?.status === 429) return t('Too many lookups. Wait a minute and try again.')
  if (e?.status === 401) return t('The lookup did not go through: you are signed out.')
  return t('The lookup did not go through. Try again.')
}

// Scan a product, then log it the way a food from the picker is logged (PortionSheet), or keep it
// as one of your foods. `step` is one of
//   scan     the camera, and a field to type the code (no camera, or a code that will not read)
//   looking  asking your foods, then Open Food Facts
//   found    a product: Log, or Save to my foods
//   miss     no product for the code, or no energy value to log it with: search or Quick kcal
//   error    the lookup itself failed: Try again
// `onSearch` runs after the sheet closes when the person chooses Search foods.
// With `onPick` (a picker that wants the food, not a log: a recipe's ingredient) the found product
// is handed to it after the sheet closes, and the sheet logs and saves nothing itself.
export default function ScanSheet({ date, meal, mealName, onLogged, onSearch, onPick, close }) {
  const units = useUnits()
  const lang = useNutrition(s => s.settings.data?.offSearchLanguage)
  const beepOn = useNutrition(s => settingOf(s.settings.data, 'barcodeBeep'))
  const [step, setStep] = useState({ id: 'scan' })
  const [typed, setTyped] = useState('')
  const [notice, setNotice] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const lookUp = useCallback(async code => {
    setStep({ id: 'looking', code })
    try {
      const found = await findByBarcode(code, { lang: typeof lang === 'string' ? lang : 'en' })
      if (!alive.current) return
      if (found.kind === 'own' || found.kind === 'online') setStep({ id: 'found', code, kind: found.kind, food: found.food })
      else setStep({ id: 'miss', code, noNutrition: found.kind === 'no-nutrition' })
    } catch (e) {
      if (alive.current) setStep({ id: 'error', code, text: lookupErrorText(e) })
    }
  }, [lang])

  const submit = raw => {
    const code = normalizeBarcode(raw)
    if (!code) { setNotice(t('That is not a product barcode.')); return }
    setNotice(null)
    setSaved(false)
    setSaveError(null)
    lookUp(code)
  }
  // Stable: the camera restarts when this changes, so it reaches the latest submit through a ref.
  const submitRef = useRef(submit)
  useEffect(() => { submitRef.current = submit })
  // The camera read a code: a short beep when Profile › Foods & scanning says so.
  const onFound = useCallback(hit => { beep(beepOn, 1040, 0.12); submitRef.current(hit.value) }, [beepOn])

  const again = () => { setNotice(null); setTyped(''); setStep({ id: 'scan' }) }
  // A found product is logged as picked: asking how much first, unless Profile says not to.
  const log = food => {
    close()
    if (onPick) onPick(food)
    else if (asksQuantity(useNutrition.getState().settings.data)) portionSheet({ food, date, meal, mealName, onLogged })
    else logServing(food, { date, meal, mealName, onLogged })
  }
  const search = () => { close(); if (onSearch) onSearch() }
  const quick = () => { close(); quickKcalSheet({ date, meal, mealName, onLogged }) }
  // Foods' create flow, with the scanned code in its Barcode field (no id, so it creates).
  const create = code => { close(); foodEditSheet({ food: { barcode: code }, settings: useNutrition.getState().settings.data, onSaved: onPick }) }
  const save = async food => {
    if (busy) return
    setBusy(true)
    setSaveError(null)
    try {
      await useNutrition.getState().saveFood(food)
      if (!alive.current) return
      setSaved(true)
      useUI.getState().toast(t('Saved to your foods'))
    } catch (e) {
      if (alive.current) setSaveError(writeErrorText(e))
    }
    if (alive.current) setBusy(false)
  }

  // Each step has one heading line (marked data-step-heading; the sheet title on the scan step).
  // It takes focus when the step changes, so a screen reader hears the new step, not silence.
  const rootRef = useRef(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const root = rootRef.current
    const el = root?.querySelector('[data-step-heading]') ?? root?.querySelector('h3')
    if (!el) return
    el.tabIndex = -1
    el.focus({ preventScroll: true })
  }, [step.id])

  return <div className="scan-sheet" ref={rootRef}>
    <SheetHeader title={t('Scan a barcode')} />

    {step.id === 'scan' && <>
      <CameraScan product onFound={onFound} />
      {notice && <div className="nt-error small" role="alert">{notice}</div>}
      <form className="scan-type" onSubmit={e => { e.preventDefault(); submit(typed) }}>
        <TextField value={typed} onChange={e => setTyped(e.target.value)} inputMode="numeric" autoComplete="off"
          placeholder={t('Or type the barcode')} aria-label={t('Barcode')} />
        <Button type="submit" variant="tinted" disabled={!typed.trim()}>{t('Look up')}</Button>
      </form>
    </>}

    {step.id === 'looking' && <div className="muted small fp-note" role="status" data-step-heading>{t('Looking up {0}…', step.code)}</div>}

    {step.id === 'found' && <>
      <div className="scan-hit" role="status">
        <div className="tt" data-step-heading>{step.food.name}</div>
        <div className="ss muted small">{[step.food.brand, `${step.food.portion || 100} ${step.food.unit || 'g'}`, units.energy(foodKcal(step.food))].filter(Boolean).join(' · ')}</div>
        <div className="ss muted small">{step.kind === 'own' ? t('One of your foods') : t('From Open Food Facts')}</div>
      </div>
      {saveError && <div className="nt-error small" role="alert">{saveError}</div>}
      <div className="scan-actions">
        <Button variant="primary" onClick={() => log(step.food)}>{onPick ? t('Use') : t('Log')}</Button>
        {step.kind === 'online' && !onPick && <Button variant="tinted" onClick={() => save(step.food)} disabled={busy || saved}>
          {saved ? t('Saved') : busy ? t('Saving…') : t('Save to my foods')}</Button>}
        <Button variant="ghost" onClick={again}>{t('Scan another')}</Button>
      </div>
    </>}

    {step.id === 'miss' && <>
      <div className="scan-hit" role="status">
        <div className="tt" data-step-heading>{step.noNutrition ? t('No energy value for {0}', step.code) : t('No product found for {0}', step.code)}</div>
        <div className="ss muted small">{step.noNutrition
          ? t('Open Food Facts lists it without calories, so it cannot be logged from here.')
          : t('It is not in your foods or in Open Food Facts.')}</div>
      </div>
      <div className="scan-actions">
        <Button variant="primary" onClick={search}>{t('Search foods')}</Button>
        <Button variant="tinted" onClick={() => create(step.code)}>{t('New food')}</Button>
        {!onPick && <Button variant="tinted" onClick={quick}>{t('Quick kcal')}</Button>}
        <Button variant="ghost" onClick={again}>{t('Scan another')}</Button>
      </div>
    </>}

    {step.id === 'error' && <>
      <div className="nt-error small" role="alert" data-step-heading>{step.text}</div>
      <div className="scan-actions">
        <Button variant="primary" onClick={() => lookUp(step.code)}>{t('Try again')}</Button>
        <Button variant="ghost" onClick={again}>{t('Scan another')}</Button>
      </div>
    </>}
  </div>
}

export function scanSheet(props) {
  useUI.getState().openSheet(close => <ScanSheet {...props} close={close} />)
}
