import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { isBodyweightEq, exOr } from '../lib/exercises.js'
import { ALL_EQUIPMENT, newProfile, profileEquipment, ACC_V } from '../lib/equipment.js'
import { fmtNum, fmtPlate } from '../lib/format.js'
import { usesBar, defaultBarWeight, hasBarOverride, isNoBar } from '../lib/bar.js'
import { PLATE_SIZES, pairsOf, ownsPlates, withPlatePairs, withStandardPlates, withLoadKind, loadKindFor, baseWeightFor } from '../lib/plates.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import Stepper from '../components/Stepper.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Switch, Segmented, Row, TextField, NumberField } from '../components/ui.jsx'
import { isOneArm, dumbbellsOf, withDumbbells, presetWeights, cleanWeights } from '../lib/dumbbells.js'
import { update, ui, toast } from './shared.js'

/* ============================ plate loading ============================ */
// One editor for every place an exercise's loading shows up (exercise detail, exercise config,
// mid-workout sheet). Three things, all per exercise and display-only (lib/plates.js):
//   • how the weight is loaded — per side of a bar, one stack, or not plate-loaded at all
//     (S.loadKind; absent = derived from the equipment, so most exercises never store it);
//   • the base weight before any plate goes on — the bar (S.barWeights, profile unit, lib/bar.js;
//     stepping down to 0 clears the override and falls back to the bar type's default), or a
//     sled's / machine's own weight for anything else;
//   • "No bar" for a bar exercise: an explicit 0 (issue #138 — a counterbalanced Smith machine),
//     so the whole total is plates. Distinct from the stepper's 0, which means "default".
// `cfg` is the routine/session config the caller has (its `bodyweight` flag turns a dumbbell
// exercise into "added weight", i.e. a single stack) — the default kind is derived from the
// same thing the workout screen derives it from, so what the editor shows as chosen is what
// the rows do. Without one, the equipment alone decides.
export function BarWeightEditor({ ex, cfg, extra }) {
  const st = useStore(s => s.S)
  const bar = usesBar(ex)
  const ctx = { ...(cfg || {}), id: ex.id }
  const kind = loadKindFor(st, ctx)
  const explicit = hasBarOverride(st, ex.id)
  const noBar = bar && isNoBar(st, ex.id)
  const def = defaultBarWeight(ex.eq, st.unit)
  const base = baseWeightFor(st, ex)
  // The kinds a pick would only be restating. With a `cfg` there is one: the same default the
  // rows derive. Without one the equipment decides — and for body-weight equipment that answer
  // ('single', the load being whatever you hang on) is not the one a routine logging the total
  // derives ('none', bodyweight: false), so the segment sits lit on a kind the rows do not use
  // and the pick that would fix it is the only way to say so: both readings are consulted, and
  // it is stored unless it is the default under either. Everything else keeps the plain rule —
  // a dumbbell's cfg-less 'none' is what a dumbbell row derives, and storing it would freeze
  // 'none' onto the exercise everywhere, override the 'single' an added-weight entry derives,
  // and leave no pick that takes the key off again.
  const defaults = cfg ? [loadKindFor(null, ctx)]
    : isBodyweightEq(ex.id) ? [true, false].map(b => loadKindFor(null, { id: ex.id, bodyweight: b }))
    : [loadKindFor(null, ctx)]
  // Picking what the equipment already implies puts the exercise back on it (a stamped null,
  // lib/plates.js), so a later change of the equipment's own default still reaches it.
  const setKind = k => update(s => {
    s.loadKind = withLoadKind(s.loadKind, ex.id, defaults.every(d => d === k) ? null : k)
  })
  const setBar = v => update(s => {
    s.barWeights = s.barWeights || {}
    const n = Math.max(0, Math.round((v || 0) * 100) / 100)
    if (n > 0) s.barWeights[ex.id] = n; else delete s.barWeights[ex.id]
  })
  // "No bar" is a stored 0, which is a different thing from no entry at all: a counterbalanced
  // Smith carriage weighs nothing in your hands, so the plate math and the drop-set steps must
  // start from what you logged (issue #138). Clearing it goes back to the bar type's default.
  const setNoBar = on => update(s => {
    s.barWeights = s.barWeights || {}
    if (on) s.barWeights[ex.id] = 0; else delete s.barWeights[ex.id]
  })
  return <>
    <Segmented className="seg-inline" value={kind} onChange={setKind}
      options={[{ value: 'pairs', label: t('Per side') }, { value: 'single', label: t('Single stack') }, { value: 'none', label: t('Off') }]} />
    <div className="small dim" style={{ margin: '8px 0 12px' }}>
      {kind === 'pairs' ? t('Plates split over both sides of a bar.')
        : kind === 'single' ? t('One stack: a belt, a landmine, a plate-loaded machine, a sled.')
          : t('No plate line under the sets.')}
    </div>
    {kind !== 'none' && <>
      {bar && <div className="list menu-list" style={{ marginBottom: 6 }}>
        <Row icon="barbell" title={t('No bar')} subtitle={t('The weight you log is all plates.')}>
          <Switch checked={noBar} onChange={setNoBar} />
        </Row>
      </div>}
      {!noBar && <div className="row cfgrow" style={{ marginBottom: 6 }}>
        <Stepper label={bar ? t('Bar ({0})', st.unit) : t('Base weight ({0})', st.unit)} value={base} step={2.5} onChange={setBar} />
      </div>}
      <div className="small dim" style={{ marginBottom: 18 }}>
        {noBar ? t('Plates are counted from 0. Turn this off for the default ({0}).', fmtNum(def) + ' ' + st.unit)
          : bar ? (explicit ? t('Set to 0 to go back to the default ({0}).', fmtNum(def) + ' ' + st.unit) : t('Default for this bar type.'))
            : t('The machine or sled itself, before any plate goes on. 0 if it is all plates.')}
        {extra ? ' ' + extra : ''}
      </div>
    </>}
  </>
}

// What a dumbbell or kettlebell weight means (issue #474, lib/dumbbells.js): as entered (the
// default, how every set before this was counted), one bell, or both together. `value` is the
// meaning in force and `onChange` stores a pick; the caller decides where (the routine's slot or
// the exercise's own default). The line under it says what the pick does to the numbers.
export function DbLoadPicker({ ex, cfg, value, onChange }) {
  const one = isOneArm({ ...(cfg || {}), id: ex.id })
  return <>
    <Segmented className="seg-inline" value={value} onChange={onChange}
      options={[{ value: 'as', label: t('As entered') }, { value: 'each', label: t('Each') }, { value: 'total', label: t('Both') }]} />
    <div className="small dim" style={{ margin: '8px 0 18px' }}>
      {value === 'each' ? (one ? t('The weight of the one you hold. One arm, so it counts once.') : t('The weight of one, so 20 means 20 in each hand. Volume counts both.'))
        : value === 'total' ? t('Both together, so 40 means two 20s.')
          : t('Counted as you type it, the way it always was.')}
    </div>
  </>
}

// Mid-workout sheet behind the ⋯ menu's "Plate loading" — same values, same editor.
function BarWeightSheet({ exId, cfg, close }) {
  const ex = exOr(exId)
  return <>
    <h3>{t('Plate loading')}</h3>
    <div className={`muted small ${exerciseNameClass(ex)}`} style={{ marginBottom: 12 }}>{exerciseNameFor(ex)}</div>
    <BarWeightEditor ex={ex} cfg={cfg} extra={t('Applies to this exercise everywhere, not just this plan.')} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const barWeightSheet = (exId, cfg) => ui().openSheet(close => <BarWeightSheet exId={exId} cfg={cfg} close={close} />)

// The plates you own, as pairs per size, for the profile's unit (Settings → Equipment → Plates).
// The first edit copies the standard set into S.plates[unit] and changes one count in it, so the
// list you see is always the list the set rows load from. "Back to the standard set" empties the
// unit's list again. Both are stamped (lib/plates.js), so the last change wins a sync.
function PlateInventorySheet({ close }) {
  const st = useStore(s => s.S)
  const unit = st.unit === 'lb' ? 'lb' : 'kg'
  const own = ownsPlates(st)
  const setPairs = (w, n) => update(s => { s.plates = withPlatePairs(s, w, n) })
  const reset = () => update(s => { s.plates = withStandardPlates(s) })
  return <>
    <h3>{t('Plates')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Pairs of each size you own. Every set row loads from this list, so a home gym with one pair of 45s is never told to use two.')}
    </div>
    {PLATE_SIZES[unit].map(w => (
      <div className="row cfgrow" key={w} style={{ marginBottom: 6 }}>
        <Stepper label={fmtPlate(w) + ' ' + unit} value={pairsOf(st, w)} step={1} decimal={false} unit={t('pairs')} onChange={n => setPairs(w, n)} />
      </div>
    ))}
    <div className="small dim" style={{ margin: '4px 0 14px' }}>
      {own ? t('Your own list for {0}.', unit) : t('The standard set, plenty of each. Change any count to make it yours.')}
    </div>
    {own && <Button onClick={reset} style={{ marginBottom: 8 }}>{t('Back to the standard set')}</Button>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const plateInventorySheet = () => ui().openSheet(close => <PlateInventorySheet close={close} />)

// The dumbbells you own, for the profile's unit (Settings → Equipment → Dumbbells, issue #376):
// a list of single bells, kept per unit like the plates (lib/dumbbells.js). With one, progression,
// deloads, warm-ups, drops and the stepper of every dumbbell lift land on these; an empty list
// puts them back on the increment. Tapping a weight takes it off, the field adds one, and the
// quick fill writes the usual rack for the unit to edit from. Every change is stamped.
function DumbbellInventorySheet({ close }) {
  const st = useStore(s => s.S)
  const unit = st.unit === 'lb' ? 'lb' : 'kg'
  const list = dumbbellsOf(st)
  const [draft, setDraft] = useState(null)
  const save = ws => update(s => { s.dumbbells = withDumbbells(s, ws) })
  const preset = presetWeights(unit)
  const add = () => {
    const w = cleanWeights([draft])[0]
    if (!w) { toast(t('Enter a valid weight')); return }
    save([...list, w])
    setDraft(null)
  }
  return <>
    <h3>{t('Dumbbells')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('The weights you own, one bell each. Progression, deloads, warm-ups and the + and − buttons of dumbbell lifts land only on these.')}
    </div>
    {list.length > 0
      ? <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', touchAction: 'auto', marginBottom: 12 }}>
        {list.map(w => <button key={w} className="chip on nocap" aria-label={t('Remove {0}', fmtPlate(w) + ' ' + unit)}
          onClick={() => save(list.filter(x => x !== w))}>{fmtPlate(w)} <Icon name="xmark" /></button>)}
      </div>
      : <div className="small dim" style={{ marginBottom: 12 }}>{t('No list yet, so dumbbell lifts step by their increment as usual.')}</div>}
    <div className="row" style={{ gap: 8, marginBottom: 12 }}>
      <NumberField className="input" decimal value={draft ?? ''} onChange={v => setDraft(v)}
        aria-label={t('Weight ({0})', unit)} placeholder={t('Weight ({0})', unit)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
      <Button icon="plus" onClick={add} style={{ flex: '0 0 auto', width: 'auto' }}>{t('Add')}</Button>
    </div>
    <Button onClick={() => save(preset)} style={{ marginBottom: 8 }}>
      {t('Fill in {0} to {1} {2}, every {3}', fmtPlate(preset[0]), fmtPlate(preset.at(-1)), unit, fmtPlate(preset[1] - preset[0]))}
    </Button>
    {list.length > 0 && <Button variant="danger" onClick={() => save([])} style={{ marginBottom: 8 }}>{t('Clear the list')}</Button>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const dumbbellInventorySheet = () => ui().openSheet(close => <DumbbellInventorySheet close={close} />)

/* ============================ equipment profiles ============================ */
// Create or edit one profile ("Home", "Gym", ...): a name plus a checklist of what you have.
function EquipmentProfileSheet({ profile, close }) {
  const update = useStore(s => s.update)
  const nameRef = useRef(null)
  const [checked, setChecked] = useState(new Set(profile ? profileEquipment(profile) : []))
  const toggle = k => setChecked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const save = () => {
    const name = (nameRef.current.value || '').trim()
    if (!name) { return }
    update(s => {
      s.equipProfiles = s.equipProfiles || []
      const equipment = [...checked]
      if (profile) {
        const p = s.equipProfiles.find(x => x.id === profile.id)
        if (p) { p.name = name; p.equipment = equipment; p.accV = ACC_V }
      } else {
        const p = newProfile(name); p.equipment = equipment
        s.equipProfiles.push(p)
        if (!s.activeEquipId) s.activeEquipId = p.id
      }
    })
    close()
  }
  return <>
    <h3>{profile ? t('Edit profile') : t('New equipment profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Name it after where you train (like "Home" or "Gym"), then tick what you’ve got there.')}
    </div>
    <TextField ref={nameRef} defaultValue={profile?.name || ''} placeholder={t('Profile name')} maxLength={40} />
    <div style={{ height: 12 }} />
    <div className="chips">
      {ALL_EQUIPMENT.map(k => (
        <button key={k} className={'chip' + (checked.has(k) ? ' on' : '')} onClick={() => toggle(k)}>{t(k)}</button>
      ))}
    </div>
    <div className="dim small" style={{ marginTop: 10 }}>
      {t('Body-weight exercises are always available, unless they need a pull-up bar or a bench.')}
    </div>
    <div style={{ height: 14 }} /><Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const equipmentProfileSheet = profile => ui().openSheet(close => <EquipmentProfileSheet profile={profile} close={close} />)
