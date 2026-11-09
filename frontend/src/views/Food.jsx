import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  MEALS, MEAL_LABEL, mealAt, foodsOn, dayTotals, totalsOf, withFood, withoutFood, recentFoods,
  lookupBarcode, searchFoods, foodCSV, copyMeal, savedMeals, withSavedMeal, savedMealTotal, waterOn, withWater, weekOf,
} from '../lib/food.js'
import { scanCode, webScanner } from '../lib/scan.js'
import { fmtDate, fmtNum, isoOf, todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import CameraScan from '../components/CameraScan.jsx'
import { Button, NumberField, Row, SearchField, Section, Segmented, SelectRow, TextField } from '../components/ui.jsx'
import { ACTIVITY, ACTIVITY_LABEL, dailyGoal, targets, weightKg, splitOf } from '../lib/nutrition.js'
import { confirmSheet } from '../sheets.jsx'
import { saveCSV } from '../components/CsvExportSheet.jsx'
import { sexOf } from '../lib/strength-level.js'

const update = fn => useStore.getState().update(fn)
const toast = message => useUI.getState().toast(message)
const openSheet = render => useUI.getState().openSheet(render)
const shiftDay = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const mealOptions = () => MEALS.map(value => ({ value, label: t(MEAL_LABEL[value]) }))
const kcal = n => fmtNum(Math.round(n)) + ' kcal'
const macros = x => `${t('P')} ${fmtNum(x.p)} · ${t('C')} ${fmtNum(x.c)} · ${t('F')} ${fmtNum(x.f)}`
const subtitle = it => [it.b, it.g ? fmtNum(it.g) + ' g' : ''].filter(Boolean).join(' · ')
// Fiber, sugar and salt, left out when a label gave none of them.
const extras = x => (x.fib || x.sug || x.salt) ? `${t('Fiber')} ${fmtNum(x.fib)} g · ${t('Sugar')} ${fmtNum(x.sug)} g · ${t('Salt')} ${fmtNum(x.salt)} g` : ''
const waterGoal = S => (Number(S.waterGoal) > 0 ? Number(S.waterGoal) : 2000)

function save(id, item) {
  update(s => { s.foodLog = withFood(s.foodLog, id, item) })
}

// How much of a product, and under which meal. Also edits a logged item (`id`).
function FoodAmount({ item, id, close }) {
  const [g, setG] = useState(item.g || 100)
  const [meal, setMeal] = useState(item.m)
  const now = totalsOf({ ...item, g: item.g ? g : null })
  const done = () => { save(id || uid(), { ...item, m: meal, g: item.g ? g : null }); close() }
  const remove = () => { update(s => { s.foodLog = withoutFood(s.foodLog, id) }); close() }
  return <>
    <h3>{item.n}</h3>
    {item.b && <div className="muted small" style={{ marginBottom: 12 }}>{item.b}</div>}
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    <div style={{ height: 12 }} />
    {item.g != null && <label className="measure-field">
      <span>{t('Amount')}</span>
      <span className="measure-input"><NumberField value={g} onChange={v => setG(Math.max(0, +v || 0))} /><i>g</i></span>
    </label>}
    {item.g != null && <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      {[...(item.s ? [0.5, 1, 2].map(k => [t(k === 1 ? '1 serving ({0} g)' : '{0} servings', k === 1 ? fmtNum(item.s) : fmtNum(k)), item.s * k]) : []), ['100 g', 100]]
        .map(([label, v]) => <button type="button" key={label} className={'chip' + (g === v ? ' on' : '')} style={{ textTransform: 'none' }} onClick={() => setG(v)}>{label}</button>)}
    </div>}
    <div className="card" style={{ margin: '12px 0' }}>
      <div className="big">{kcal(now.kcal)}</div>
      <div className="muted small">{macros(now)}</div>
      {extras(now) && <div className="muted small">{extras(now)}</div>}
    </div>
    <Button variant="primary" onClick={done} disabled={item.g != null && !g}>{id ? t('Save') : t('Add')}</Button>
    <div style={{ height: 8 }} />
    {id
      ? <Button variant="ghost" className="dim" style={{ color: 'var(--red)' }} onClick={remove}>{t('Delete')}</Button>
      : <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>}
  </>
}

// Typed in by hand: a meal out, a product Open Food Facts does not know. A barcode that came with
// it is kept, so the next scan of it finds this entry (lib/food.js recentFoods).
function QuickAdd({ d, meal, code, close }) {
  const [n, setN] = useState('')
  const [v, setV] = useState({ kcal: null, p: null, c: null, f: null, fib: null, sug: null, salt: null })
  const field = (k, label, unit) => <label className="measure-field" key={k}>
    <span>{label}</span>
    <span className="measure-input"><NumberField nullable value={v[k]} onChange={x => setV(o => ({ ...o, [k]: x }))} /><i>{unit}</i></span>
  </label>
  const done = () => {
    save(uid(), { d, m: meal, n: n.trim(), c: code || '', per: [v.kcal, v.p, v.c, v.f, v.fib, v.sug, v.salt].map(x => +x || 0) })
    close()
  }
  return <>
    <h3>{t('Quick add')}</h3>
    {code && <div className="muted small" style={{ marginBottom: 12 }}>{t('Product not found. Enter it once and the next scan finds it.')}</div>}
    <TextField value={n} maxLength={120} placeholder={t('Name')} onChange={e => setN(e.target.value)} />
    <div className="measure-form" style={{ marginTop: 12 }}>
      {field('kcal', t('Calories'), 'kcal')}
      {field('p', t('Protein'), 'g')}
      {field('c', t('Carbs'), 'g')}
      {field('f', t('Fat'), 'g')}
      {field('fib', t('Fiber'), 'g')}
      {field('sug', t('Sugar'), 'g')}
      {field('salt', t('Salt'), 'g')}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={done} disabled={!n.trim() || !(v.kcal > 0)}>{t('Add')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

function FoodAdd({ d, meal: firstMeal, close }) {
  const S = useStore(s => s.S)
  const [meal, setMeal] = useState(firstMeal)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [busy, setBusy] = useState(false)

  // Search as you type, after a pause: Open Food Facts allows about 10 searches a minute.
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return }
    let gone = false
    const timer = setTimeout(async () => {
      setBusy(true)
      try { const r = await searchFoods(q); if (!gone) setHits(r) } catch { if (!gone) { setHits([]); toast(t('Could not reach Open Food Facts')) } }
      if (!gone) setBusy(false)
    }, 700)
    return () => { gone = true; clearTimeout(timer) }
  }, [q])

  const pick = item => { close(); openSheet(c => <FoodAmount item={{ ...item, d, m: meal }} close={c} />) }

  const found = async code => {
    const value = String(code?.value || '').replace(/\D/g, '')
    if (!value) return
    const known = recentFoods(S, 1000).find(x => x.c === value)
    if (known) { pick(known); return }
    setBusy(true)
    try {
      const item = await lookupBarcode(value)
      if (item) pick(item)
      else { close(); openSheet(c => <QuickAdd d={d} meal={meal} code={value} close={c} />) }
    } catch {
      // Offline or Open Food Facts down: the code is not lost, it goes with what you type in.
      toast(t('Could not reach Open Food Facts'))
      close(); openSheet(c => <QuickAdd d={d} meal={meal} code={value} close={c} />)
    } finally { setBusy(false) }
  }

  const scan = async () => {
    if (await webScanner()) {
      openSheet(closeCam => <CameraScan hint={t('Point the camera at the barcode')}
        onCancel={closeCam} onFound={code => { closeCam(); found(code) }} />)
      return
    }
    try { const code = await scanCode(); if (code) found(code) } catch { toast(t('Could not start the scanner')) }
  }

  const list = hits ?? recentFoods(S)
  const mine = hits ? [] : savedMeals(S)
  const addMeal = sm => {
    update(s => { for (const it of sm.items) s.foodLog = withFood(s.foodLog, uid(), { ...it, d, m: meal }) })
    close(); toast(t('{0} added', sm.n))
  }
  return <>
    <h3>{t('Add food')}</h3>
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    <div style={{ height: 12 }} />
    <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search products')} autoFocus />
    <div className="row" style={{ gap: 8, margin: '12px 0' }}>
      <Button icon="camera" onClick={scan} disabled={busy}>{t('Scan barcode')}</Button>
      <Button icon="plus" onClick={() => { close(); openSheet(c => <QuickAdd d={d} meal={meal} close={c} />) }}>{t('Quick add')}</Button>
    </div>
    {busy && <div className="muted small">{t('Searching…')}</div>}
    {!busy && hits && !hits.length && <div className="empty small">{t('Nothing found. Try another word or use quick add.')}</div>}
    {mine.length > 0 && <Section title={t('My meals')}>
      {mine.map(sm => <Row key={sm.id} title={sm.n} subtitle={sm.items.map(x => x.n).join(', ')}
        value={kcal(savedMealTotal(sm).kcal)} onClick={() => addMeal(sm)} />)}
    </Section>}
    {list.length > 0 && <Section title={hits ? t('Results') : t('Recent')}>
      {list.map((x, i) => <Row key={(x.c || x.n) + i} title={x.n} subtitle={x.b || null}
        value={x.g ? kcal(x.per[0]) + ' / 100 g' : kcal(x.per[0])} onClick={() => pick(x)} />)}
    </Section>}
    {hits && <div className="muted small" style={{ marginTop: 8 }}>{t('Product data from Open Food Facts.')}</div>}
  </>
}

export function foodAddSheet(d = todayISO(), meal = mealAt()) {
  return openSheet(close => <FoodAdd d={d} meal={meal} close={close} />)
}

const RATES = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5]
const LB = 0.45359237

// Your daily target: worked out from your body and the weekly change you aim for
// (lib/nutrition.js), or a number of your own.
function GoalSheet({ close }) {
  const S = useStore(s => s.S)
  const p = S.foodPlan || {}
  const [mode, setMode] = useState(S.foodPlan || !S.foodGoal ? 'auto' : 'own')
  const [cm, setCm] = useState(p.heightCm || null)
  const [sex, setSex] = useState(sexOf(S))
  const [born, setBorn] = useState(Number(S.birthYear) > 0 ? Number(S.birthYear) : null)
  const [activity, setActivity] = useState(p.activity || 'light')
  const [rate, setRate] = useState(Number.isFinite(p.rate) ? p.rate : -0.5)
  const [own, setOwn] = useState(S.foodGoal || null)
  const [split, setSplit] = useState(() => splitOf(S) || null)
  const splitOk = !split || Math.round(split.p + split.c + split.f) === 100
  const kg = weightKg(S)
  const age = born >= 1900 && born <= new Date().getFullYear() ? new Date().getFullYear() - born : null
  const res = targets({ kg, cm, sex, age, activity, rate })
  const wt = v => S.unit === 'lb' ? fmtNum(Math.round(v / LB * 10) / 10) + ' lb' : fmtNum(v) + ' kg'
  const rateLabel = r => r < 0 ? t('Lose {0} a week', wt(-r)) : r > 0 ? t('Gain {0} a week', wt(r)) : t('Keep my weight')

  const save = () => {
    update(s => {
      if (split) s.foodSplit = { p: split.p, c: split.c, f: split.f }; else delete s.foodSplit
      if (mode === 'own') { s.foodGoal = own > 0 ? Math.round(own) : null; delete s.foodPlan; return }
      s.foodPlan = { heightCm: Math.round(cm), activity, rate }
      if (sex) s.sex = sex
      if (born) s.birthYear = Math.round(born)
    })
    close()
  }
  const field = (label, value, set, unit) => <label className="measure-field">
    <span>{label}</span>
    <span className="measure-input"><NumberField nullable decimal={false} value={value} onChange={set} /><i>{unit}</i></span>
  </label>

  return <>
    <h3>{t('Daily calorie goal')}</h3>
    <Segmented value={mode} onChange={setMode} options={[{ value: 'auto', label: t('Work it out') }, { value: 'own', label: t('My own number') }]} />
    <div style={{ height: 12 }} />
    {mode === 'own' ? field(t('Goal'), own, setOwn, 'kcal') : <>
      <div className="muted small" style={{ marginBottom: 10 }}>
        {kg ? t('From your latest weigh-in: {0}.', wt(Math.round(kg * 10) / 10)) : t('Log your weight first: the target is worked out from it.')}
      </div>
      <Segmented value={sex} onChange={setSex} options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} />
      <div className="measure-form" style={{ marginTop: 12 }}>
        {field(t('Height'), cm, setCm, 'cm')}
        {field(t('Year of birth'), born, setBorn, '')}
      </div>
      <div className="sect-b" style={{ marginTop: 12 }}>
        <SelectRow title={t('Activity')} sheetTitle={t('How active are you?')} value={activity} onChange={setActivity} stackedValue
          options={Object.keys(ACTIVITY).map(k => ({ value: k, label: t(ACTIVITY_LABEL[k]) }))} />
        <SelectRow title={t('Weekly goal')} value={rate} onChange={setRate} stackedValue
          options={RATES.map(r => ({ value: r, label: rateLabel(r) }))} />
      </div>
      {res && <div className="card" style={{ margin: '12px 0 0' }}>
        <div className="big">{kcal(res.kcal)}</div>
        <div className="muted small">{t('Protein')} {res.p} g · {t('Carbs')} {res.c} g · {t('Fat')} {res.f} g</div>
        <div className="muted small" style={{ marginTop: 6 }}>{t('You burn about {0} a day, {1} of it at rest.', kcal(res.tdee), kcal(res.bmr))}</div>
        {res.capped && <div className="small" style={{ marginTop: 6, color: 'var(--orange)' }}>{t('Held to {0} a week: more than 1% of your body weight a week costs muscle.', wt(Math.abs(res.rate)))}</div>}
        {res.floored && <div className="small" style={{ marginTop: 6, color: 'var(--orange)' }}>{t('Raised to a safe minimum, so you will lose more slowly than you asked.')}</div>}
      </div>}
    </>}
    <h4 className="sec" style={{ marginTop: 16 }}>{t('Macros')}</h4>
    <Segmented value={split ? 'own' : 'rec'} onChange={v => setSplit(v === 'own' ? (split || { p: 30, c: 40, f: 30 }) : null)}
      options={[{ value: 'rec', label: t('Recommended') }, { value: 'own', label: t('My own split') }]} />
    {split && <>
      <div className="measure-form" style={{ marginTop: 12 }}>
        {[['p', t('Protein')], ['c', t('Carbs')], ['f', t('Fat')]].map(([k, label]) => <label className="measure-field" key={k}>
          <span>{label}</span>
          <span className="measure-input"><NumberField decimal={false} value={split[k]} onChange={v => setSplit(o => ({ ...o, [k]: Math.max(0, Math.round(+v || 0)) }))} /><i>%</i></span>
        </label>)}
      </div>
      {!splitOk && <div className="small" style={{ marginTop: 6, color: 'var(--red)' }}>{t('The three together have to make 100%. Now: {0}%.', fmtNum(split.p + split.c + split.f))}</div>}
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save} disabled={!splitOk || (mode === 'auto' ? !res : !(own > 0))}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

// What a meal on a day can do as a whole: come back from the day before, be saved to add again
// in one tap, or be cleared.
function MealMenu({ d, meal, close }) {
  const S = useStore(s => s.S)
  const items = foodsOn(S, d).filter(i => i.m === meal)
  const prev = shiftDay(d, -1)
  const yesterday = foodsOn(S, prev).filter(i => i.m === meal)
  const [name, setName] = useState('')
  const label = t(MEAL_LABEL[meal])
  const copyFrom = () => {
    update(s => { s.foodLog = copyMeal(s.foodLog, prev, d, meal, uid) })
    close(); toast(t('{0} copied', label))
  }
  const copyToday = () => {
    update(s => { s.foodLog = copyMeal(s.foodLog, d, todayISO(), meal, uid) })
    close(); toast(t('{0} copied', label))
  }
  const saveMeal = () => {
    update(s => { s.foodMeals = withSavedMeal(s.foodMeals, uid(), name, items) })
    close(); toast(t('{0} saved', name.trim()))
  }
  const clear = () => confirmSheet({
    title: t('Clear {0}?', label), message: t('Removes everything logged under {0} on this day.', label),
    confirmText: t('Clear'), danger: true,
    onConfirm: () => { update(s => { for (const it of items) s.foodLog = withoutFood(s.foodLog, it.id) }); close() },
  })
  return <>
    <h3>{label}</h3>
    <Section>
      <Row icon="copy" title={t('Copy from the day before')} subtitle={yesterday.length ? kcal(dayTotals(yesterday).kcal) : t('Nothing logged then')}
        onClick={yesterday.length ? copyFrom : undefined} />
      {d !== todayISO() && items.length > 0 && <Row icon="copy" title={t('Copy to today')} onClick={copyToday} />}
    </Section>
    {items.length > 0 && <>
      <h4 className="sec">{t('Save as a meal')}</h4>
      <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
        <TextField value={name} maxLength={60} placeholder={t('Name, for example Weekday breakfast')} onChange={e => setName(e.target.value)} />
        <Button icon="plus" onClick={saveMeal} disabled={!name.trim()}>{t('Save')}</Button>
      </div>
      <div style={{ height: 12 }} />
      <Button variant="ghost" className="dim" style={{ color: 'var(--red)' }} onClick={clear}>{t('Clear {0}', label)}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

// Saved meals, to rename or delete.
function SavedMealsSheet({ close }) {
  const S = useStore(s => s.S)
  const list = savedMeals(S)
  return <>
    <h3>{t('My meals')}</h3>
    {list.length ? <Section>{list.map(sm => <Row key={sm.id} title={sm.n} subtitle={sm.items.map(x => x.n).join(', ')}
      value={kcal(savedMealTotal(sm).kcal)}>
      <button className="iconbtn" style={{ color: 'var(--red)' }} aria-label={t('Delete')}
        onClick={() => update(s => { s.foodMeals = { ...(s.foodMeals || {}), [sm.id]: { _ts: Date.now() } } })}><Icon name="trash" /></button>
    </Row>)}</Section> : <div className="empty small">{t('Save a meal from its menu on the diary, then add it again in one tap.')}</div>}
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

// Everything that is not about today: goals, water, saved meals, the export.
function FoodSettings({ close }) {
  const S = useStore(s => s.S)
  const goal = dailyGoal(S)
  const [water, setWater] = useState(waterGoal(S))
  const exportIt = async () => {
    try { await saveCSV(foodCSV(useStore.getState().S), `opengym-food-${todayISO()}.csv`); toast(t('CSV exported')) } catch { /* share sheet dismissed */ }
  }
  return <>
    <h3>{t('Food diary settings')}</h3>
    <Section>
      <Row icon="target" title={t('Daily calorie goal')} subtitle={goal?.auto ? t('Worked out from your body') : goal ? t('Your own number') : null}
        value={goal ? kcal(goal.kcal) : null} accessory="chevron" onClick={() => openSheet(c => <GoalSheet close={c} />)} />
      <Row icon="list" title={t('My meals')} value={String(savedMeals(S).length)} accessory="chevron" onClick={() => openSheet(c => <SavedMealsSheet close={c} />)} />
    </Section>
    <label className="measure-field">
      <span>{t('Water goal')}</span>
      <span className="measure-input"><NumberField decimal={false} value={water}
        onChange={v => { setWater(v); if (+v > 0) update(s => { s.waterGoal = Math.round(+v) }) }} /><i>ml</i></span>
    </label>
    <div style={{ height: 12 }} />
    <Section>
      <Row icon="download" title={t('Export as spreadsheet (CSV)')} subtitle={t('Every logged item, one row each.')} onClick={exportIt} />
    </Section>
    <div className="muted small">{t('Product data from Open Food Facts.')}</div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

// The last seven days against the goal: a bar per day and the average of the days you logged.
function WeekCard({ S, d, goal }) {
  const w = weekOf(S, d, shiftDay)
  const top = Math.max(goal?.kcal || 0, ...w.days.map(x => x.kcal), 1)
  return <div className="card">
    <div className="row between">
      <div>
        <div className="muted small">{t('Last 7 days')}</div>
        <b>{w.logged ? t('{0} a day on average', kcal(w.avg.kcal)) : t('Nothing logged yet')}</b>
        {w.logged > 0 && <div className="muted small">{macros(w.avg)}</div>}
      </div>
    </div>
    <div className="row" style={{ gap: 6, alignItems: 'flex-end', height: 90, marginTop: 12, position: 'relative' }}>
      {goal && <div aria-hidden="true" style={{ position: 'absolute', insetInline: 0, bottom: `${goal.kcal / top * 72 + 16}px`, borderTop: '1px dashed var(--gold-ink)' }} />}
      {w.days.map(x => <div key={x.d} style={{ flex: 1, textAlign: 'center' }} title={`${fmtDate(x.d, true)}: ${kcal(x.kcal)}`}>
        <div style={{ height: Math.max(2, x.kcal / top * 72), borderRadius: 4, background: goal && x.kcal > goal.kcal ? 'var(--orange)' : 'var(--teal)', opacity: x.kcal ? 1 : 0.25 }} />
        <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>{new Date(x.d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</div>
      </div>)}
    </div>
  </div>
}

// Eaten against the target, as "80 / 180 g".
const ofGoal = (v, g, unit) => g ? `${fmtNum(Math.round(v))} / ${fmtNum(g)} ${unit}` : `${fmtNum(v)} ${unit}`

export default function Food() {
  const S = useStore(s => s.S)
  const [d, setD] = useState(todayISO())
  const items = foodsOn(S, d)
  const total = dayTotals(items)
  const goal = dailyGoal(S)
  const left = goal ? goal.kcal - total.kcal : null
  const today = todayISO()
  const water = waterOn(S, d)

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}><h1>{t('Food diary')}</h1></div>
      <button className="iconbtn" onClick={() => openSheet(c => <FoodSettings close={c} />)} aria-label={t('Food diary settings')}><Icon name="gear" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="iconbtn" onClick={() => setD(shiftDay(d, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <b>{d === today ? t('Today') : fmtDate(d, true)}</b>
        <button className="iconbtn" onClick={() => setD(shiftDay(d, 1))} disabled={d >= today} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>
      <div className="row between">
        <div>
          <div className="muted small">{t('Eaten')}</div>
          <div className="big" style={{ marginTop: 3 }}>{kcal(total.kcal)}</div>
          {left != null && <div className="small" style={{ marginTop: 3, color: left < 0 ? 'var(--red)' : 'var(--label-2)' }}>
            {left < 0 ? t('{0} over', kcal(-left)) : t('{0} left', kcal(left))}
          </div>}
        </div>
        <Button size="sm" variant="ghost" icon="target" onClick={() => openSheet(c => <GoalSheet close={c} />)}>{goal ? kcal(goal.kcal) : t('Goal')}</Button>
      </div>
      <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {[['p', t('Protein')], ['c', t('Carbs')], ['f', t('Fat')]].map(([k, label]) =>
          <div key={k} className="small"><div className="muted">{label}</div><b>{ofGoal(total[k], goal?.[k], 'g')}</b></div>)}
      </div>
      {extras(total) && <div className="muted small" style={{ marginTop: 8 }}>{extras(total)}</div>}
    </div>

    <div className="card">
      <div className="row between">
        <div>
          <div className="muted small">{t('Water')}</div>
          <b>{fmtNum(water)} / {fmtNum(waterGoal(S))} ml</b>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" icon="minus" aria-label={t('Less water')} disabled={!water}
            onClick={() => update(s => { s.foodWater = withWater(s.foodWater, d, water - 250) })} />
          <Button size="sm" icon="plus" onClick={() => update(s => { s.foodWater = withWater(s.foodWater, d, water + 250) })}>250 ml</Button>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--sep)', marginTop: 10, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, water / waterGoal(S) * 100)}%`, height: '100%', background: 'var(--blue)' }} />
      </div>
    </div>

    {MEALS.map(m => {
      const mine = items.filter(i => i.m === m)
      return <Section key={m} className="food-meal" title={<span className="row between">
        <span>{t(MEAL_LABEL[m])} · {kcal(total.meals[m].kcal)}</span>
        <button type="button" className="iconbtn" aria-label={t('Meal options')}
          onClick={() => openSheet(c => <MealMenu d={d} meal={m} close={c} />)}><Icon name="more" /></button>
      </span>}>
        {mine.map(it => <Row key={it.id} title={it.n} subtitle={subtitle(it) || null} value={kcal(totalsOf(it).kcal)}
          onClick={() => openSheet(c => <FoodAmount item={it} id={it.id} close={c} />)} />)}
        <Row icon="plus" title={t('Add food')} onClick={() => foodAddSheet(d, m)} />
      </Section>
    })}

    <WeekCard S={S} d={d} goal={goal} />
  </div>
}
