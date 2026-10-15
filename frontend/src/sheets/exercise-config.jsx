import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { isCardio, isBodyweightEq, smOf, isAssisted, isCustomEx } from '../lib/exercises.js'
import { fmtNum } from '../lib/format.js'
import { defaultConfig, modeOf, EFFORT, capEffort, stepEffort, isBw, isPerSide, sideReps, MAX_PLANNED_WARMUPS } from '../lib/history.js'
import { toScale, rirOf, EFFORT_PRESETS, effortColor, effortInk } from '../lib/effort.js'
import { t, tn, descFor, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import Media from '../components/Media.jsx'
import Stepper from '../components/Stepper.jsx'
import { durationSheet } from '../components/DurationWheel.jsx'
import { REST_MAX, fmtRest } from '../lib/duration.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch, Segmented, SelectRow, Row, NumberField } from '../components/ui.jsx'
import { glyphOf, GLYPH_GROUPS } from '../lib/glyphs.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { isBellEx, dbLoadOf, dbLoadFor } from '../lib/dumbbells.js'
import { policyFor, defaultIncrement, POLICIES_FOR, POLICY_NAME, POLICY_DESC, MAX_BW_SETS, MAX_TRIPLE_SETS } from '../lib/progression.js'
import { normalizeRepRange } from '../lib/rep-range.js'
import { isBackoff, backoffWeights } from '../lib/backoff.js'
import { isPyramid, normalizePyramid, normalizePyramidRest, normalizePyramidWeight, pyramidFromFlat, flatFromPyramid, pyramidLabel, PYRAMID_MAX, MAX_PYRAMID_SETS, PYRAMID_PRESETS } from '../lib/pyramid.js'
import { speedUnitOf, toSpeed, fromSpeed } from '../lib/speed.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { ui } from './shared.js'
import { BarWeightEditor, DbLoadPicker } from './equipment.jsx'
import { customExSheet, trainedBy } from './exercise.jsx'

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
const progressionStepOf = (c, mode, ex, unit) =>
  c.inc >= 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit))
// Back-off sets step down by the same Step, so a plan using them needs one even with no rule.
const progressionStepIsValid = (step, policy, backoff = false) =>
  (policy === 'off' && !backoff) || (Number.isFinite(step) && step > 0)
// Back-off sets (lib/backoff.js) are offered where there is a load to step down: rep work on a
// loaded exercise, not a pyramid (it owns each set), not a rest-pause (one work set), not an
// assistance machine (less load is harder there).
const backoffOffered = (c, mode, ex, bw) => mode === 'reps' && !bw && !isAssisted({ ...c, id: ex.id })
  && !(Array.isArray(c.pyramid) && c.pyramid.length) && c.intensifier?.type !== 'restpause'

// Double and triple progression both climb a rep range (`repsMin`..`reps`), so the sheet keeps it
// normalised for either.
const climbsRange = policy => policy === 'double' || policy === 'triple'
// Triple progression's set ceiling while it is being edited: never below the starting sets.
const setsMaxOf = c => Math.max(Math.max(1, Math.round(c.sets) || 1), Math.min(MAX_TRIPLE_SETS, Math.round(c.setsMax) || 0))

function ProgressionFields({ ex, mode, c, setC, routine, unit, perSide, bw }) {
  // Triple progression adds sets and then load. Bodyweight work with nothing added already climbs
  // reps and then sets on its own (the rep ceiling below), and has no load to finish the cycle
  // with, so it is not offered there.
  const options = (POLICIES_FOR[mode] || ['off']).filter(p => p !== 'triple' || !bw || c.weight > 0 || c.prog === 'triple')
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode)
  const active = policyFor({ ...c, id: ex.id }, routine, mode)
  const inc = progressionStepOf(c, mode, ex, unit)
  const canBackoff = backoffOffered(c, mode, ex, bw)
  const backoff = canBackoff && c.backoff === true
  const invalid = !progressionStepIsValid(inc, active, backoff)
  // "26 → 24 → 22 kg": what the sets will open at, from the weight and step typed above.
  const preview = backoff && c.weight > 0 && inc > 0
    ? backoffWeights(c.weight, Math.max(1, Math.round(c.sets) || 1), inc).map(fmtNum).join(' → ') + ' ' + unit
    : ''
  const stride = mode === 'reps' && perSide ? 2 : 1
  const range = climbsRange(active) ? normalizeRepRange(c.reps, c.repsMin, stride) : null
  const epleyEligible = mode === 'reps' && !isBw({ ...c, id: ex.id }) && (active === 'linear' || climbsRange(active))
  // What is typed is shown as typed, 0 for an emptied field included: shown as the default 90
  // instead, the field could not be emptied to type a new percentage.
  const deloadPercent = Math.round((c.deloadFactor != null && Number.isFinite(Number(c.deloadFactor)) ? Number(c.deloadFactor) : 0.9) * 100)
  const setRule = v => setC(x => {
    const next = { ...x, prog: v || undefined }
    // Greyskull's final set is taken to failure by design, so choosing it here switches "Last set
    // to failure" on too, unless it was already decided. Only the sheet's draft: nothing is
    // written until Save, and a plan saved before stays what it was.
    if (v === 'greyskull' && next.lastToFailure == null) next.lastToFailure = true
    const picked = policyFor({ ...next, id: ex.id }, routine, mode)
    // Triple progression opens with room for two more sets, the usual 3 to 5.
    if (picked === 'triple' && !(next.setsMax > 0)) next.setsMax = Math.min(MAX_TRIPLE_SETS, Math.max(1, Math.round(next.sets) || 1) + 2)
    return climbsRange(picked)
      ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, stride) }
      : next
  })
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={setRule}
        options={[{ value: '', label: t('Follow the routine ({0})', t(POLICY_NAME[inherited])) },
          ...options.map(p => ({ value: p, label: t(POLICY_NAME[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t(POLICY_DESC[active])}</div>
    {/* Double progression on a weighted exercise fills this row with four steppers; `cfgrow-4`
        lets it wrap into two pairs on phones, where four abreast left the inputs a few px wide. */}
    {(active !== 'off' || backoff) && <div className={'row cfgrow' + ((active === 'double' && epleyEligible) || active === 'triple' ? ' cfgrow-4' : '')} style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : 1.25} decimal={mode !== 'time'} invalid={invalid} className={invalid ? 'invalid' : ''}
        onChange={v => setC(x => ({ ...x, inc: v }))} />
      {climbsRange(active) && <>
        {/* The draft stays as typed: normalising on every keystroke turned "12" into 92 (the
            "1" was pulled above the lower bound first). Save and the engine normalise anyway. */}
        <Stepper label={t('Reps from')} value={c.repsMin ?? range.repsMin} step={stride} decimal={false}
          onChange={v => setC(x => ({ ...x, repsMin: v }))} />
        <Stepper label={t('Reps up to')} value={c.reps ?? range.reps} step={stride} decimal={false}
          onChange={v => setC(x => ({ ...x, reps: v }))} />
      </>}
      {/* Where triple progression stops adding sets; the Sets above are where it starts. */}
      {active === 'triple' && <Stepper label={t('Sets up to')} value={c.setsMax ?? setsMaxOf(c)} step={1} decimal={false}
        onChange={v => setC(x => ({ ...x, setsMax: v }))} />}
      {epleyEligible && <Stepper label={t('Deload 1RM (%)')} value={deloadPercent} step={5} min={50} max={95} decimal={false}
        onChange={v => setC(x => ({ ...x, deloadFactor: Number(v) / 100 }))} />}
    </div>}
    {invalid && <div className="small" role="alert" style={{ color: 'var(--red-ink)', marginTop: -10, marginBottom: 18 }}>
      {t('Enter a positive step to use this progression rule.')}
    </div>}
    {/* Off by default and only written when on, so every plan saved before it stays the shape
        it was. The step is the one above: the gear's own increment, set once per exercise. */}
    {canBackoff && <>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <Row icon="steps" iconTint="var(--acc)" title={t('Back-off sets')}
          subtitle={t('Each set one step lighter than the one before. The weight above is the first set.')}>
          <Switch checked={backoff} onChange={v => setC(x => ({ ...x, backoff: v || undefined }))} />
        </Row>
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {backoff
          ? (preview ? t('Sets open at {0}. The first set goes up when every set reaches its reps, and the rest follow it.', preview) : t('The first set goes up when every set reaches its reps, and the rest follow it.'))
          : t('All sets at the same weight.')}
      </div>
    </>}
  </>
}

// The drop-set and rest-pause fields take what is typed and are held to their minimums once left
// (Stepper `min`). A sheet saved from a field still being typed in is held to them here: an
// emptied weight drop would otherwise plan drops at the same weight.
const intensifierToSave = x => (x.type === 'dropset'
  ? { ...x, count: Math.max(1, Math.round(x.count) || 0), pct: Math.max(5, Number(x.pct) || 0) }
  : x.type === 'restpause'
    ? { ...x, totalReps: Math.max(1, Math.round(x.totalReps) || 0), restSec: Math.max(5, Number(x.restSec) || 0) }
    : x)

function ExConfig({ ex, existing, onSave, onDelete, onReplace, close, routine, initial, saveLabel }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  const speedUnit = speedUnitOf(st)
  const seed = existing || initial || defaultConfig(ex.id)
  const [c, setC] = useState(() => {
    const cfg = { ...seed }
    // A session's target carries the meaning of its dumbbell weight as a stamp (lib/dumbbells.js);
    // one that only repeats the exercise's own default is not the slot's choice, so it is not kept.
    if (cfg.dbLoad != null && dbLoadOf(cfg.dbLoad) === dbLoadFor(st, ex.id)) delete cfg.dbLoad
    return climbsRange(policyFor({ ...cfg, id: ex.id }, routine, modeOf({ ...cfg, id: ex.id })))
      ? { ...cfg, ...normalizeRepRange(cfg.reps, cfg.repsMin, isPerSide(cfg) ? 2 : 1) }
      : cfg
  })
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id })
  // Both default from the dataset and are then whatever the config says — see isBw.
  const bw = !cardio && isBw({ ...c, id: ex.id })
  const perSide = isPerSide(c)
  // Pyramid sets: one rep target per set, in place of the flat Sets × Reps (CONTEXT.md).
  const pyramid = mode === 'reps' && isPyramid({ ...c, mode })
  const setPyramidAt = (i, v) => setC(x => ({ ...x, pyramid: x.pyramid.map((p, j) => (j === i ? v : p)) }))
  const progressionPolicy =policyFor({ ...c, id: ex.id }, routine, mode)
  const progressionStepInvalid = !progressionStepIsValid(progressionStepOf(c, mode, ex, st.unit), progressionPolicy, c.backoff === true && backoffOffered(c, mode, ex, bw))
  const activePolicy = policyFor({ ...c, id: ex.id }, routine, mode)
  // Both climb a range: the flat Reps stepper gives way to "Reps from" / "Reps up to".
  const ranged = mode === 'reps' && climbsRange(activePolicy)
  const triple = mode === 'reps' && activePolicy === 'triple'
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = m => setC(x => {
    const next = { ...defaultConfig(ex.id, m), ...x, mode: m }
    return m === 'reps' && climbsRange(policyFor({ ...next, id: ex.id }, routine, 'reps'))
      ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, isPerSide(next) ? 2 : 1) }
      : next
  })
  const save = () => {
    if (progressionStepInvalid) return
    close()
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    // Epley deloading is configurable per occurrence, but the default stays omitted so older
    // plans retain their compact shape and keep the existing 90% behaviour.
    if (mode === 'reps' && !bw && (activePolicy === 'linear' || climbsRange(activePolicy))) {
      const deloadFactor = Math.max(0.5, Math.min(0.95, Number(c.deloadFactor) || 0.9))
      if (deloadFactor !== 0.9) prog.deloadFactor = deloadFactor
    }
    // Written only when it differs from what the dataset already says, so a barbell config
    // stays exactly the shape it was before these flags existed.
    // `bodyweight` is true of a hold as much as of a set of reps. `side` used to be dropped on
    // switching to Time too — a timed hold has no rep count to split — but "per side" does not
    // have to mean splitting: for a hold it means doing the whole thing once per side, so the
    // flag now survives the switch and buildWorkSets doubles the planned sets instead.
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    // Free text, e.g. a pyramid's per-set loading ("bar only, +1 plate/side each set") — the
    // sets/reps/weight fields are one flat target and have no room for that on their own.
    // Mode-independent, so it is spread in below rather than folded into `flags`.
    const note = (c.note || '').trim().slice(0, 500)
    const withNote = note ? { note } : {}
    // Only written when there are any, so a plan that never asked for warm-ups keeps the exact
    // shape it had — and reads back as 0 either way (buildSets).
    const warmupSets = Math.max(0, Math.min(MAX_PLANNED_WARMUPS, Math.round(c.warmupSets) || 0))
    const withWarmups = warmupSets ? { warmupSets } : {}
    // Per-exercise rest (issue #10): written only when a positive value was set, so 0 keeps
    // inheriting the global rest timer and a config that never touched it stays the shape it
    // was. Mode-independent — a heavy triple, a plank and a cardio interval all rest.
    const restSec = Math.max(0, Math.round(c.restSec) || 0)
    const withRest = restSec ? { restSec } : {}
    // What a dumbbell weight means in this slot (lib/dumbbells.js): written only when the slot
    // picked its own, so every other config stays the shape it was.
    const dbLoad = isBellEx(ex) && !bw ? dbLoadOf(c.dbLoad) : null
    const withMeant = dbLoad ? { dbLoad } : {}
    // "Last set to failure": written only when on, so a plan that never asked keeps its shape.
    const withFailure = c.lastToFailure === true ? { lastToFailure: true } : {}
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8), ...withNote, ...withRest })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...flags, ...(perSide ? { side: true } : {}), ...prog, ...withNote, ...withWarmups, ...withRest, ...withMeant, ...withFailure })
    else {
      // A unilateral target is stored even: the split has to divide, and a typed 15 would
      // otherwise plan seven reps on one side and eight on the other, every session.
      const typed = Math.max(1, Math.round(c.reps) || 10)
      const stride = perSide ? 2 : 1
      let reps = perSide ? Math.ceil(typed / stride) * stride : typed
      let range = null
      if (ranged) {
        range = normalizeRepRange(reps, c.repsMin, stride)
        reps = range.reps
      }
      const out = { sets, mode: 'reps', reps, weight: Math.max(0, c.weight || 0), ...flags, ...(perSide ? { side: true } : {}), ...prog, ...withNote, ...withWarmups, ...withRest, ...withMeant }
      // The list is the prescription; sets and reps follow it, so everything that reads the
      // flat target (a config sheet reopened with the toggle off, older builds) still makes sense.
      const list = pyramid ? normalizePyramid(c.pyramid, stride) : []
      if (list.length) Object.assign(out, flatFromPyramid(list), { pyramid: list })
      const pyramidRest = list.length ? normalizePyramidRest(c.pyramidRest, list.length) : []
      if (pyramidRest.length) out.pyramidRest = pyramidRest
      const pyramidWeight = list.length && !bw ? normalizePyramidWeight(c.pyramidWeight, list.length) : []
      if (pyramidWeight.length) out.pyramidWeight = pyramidWeight
      if (ranged) out.repsMin = range.repsMin
      // Triple progression's set ceiling, written only when it is above the starting sets: at the
      // same number it would add nothing, and the plan keeps the shape it had.
      if (triple && !list.length && setsMaxOf(c) > sets) out.setsMax = setsMaxOf(c)
      // A ceiling below the working reps would tell you to add a set on day one.
      if (bw && !(out.weight > 0) && c.repsMax > 0) out.repsMax = Math.max(reps, Math.round(c.repsMax))
      // Every set in this exercise becomes a drop-set/rest-pause (buildSets stamps the rows) —
      // decided here, in the plan, not re-decided live each time you train it.
      if (!list.length && c.intensifier && c.intensifier.type) out.intensifier = intensifierToSave(c.intensifier)
      // Back-off sets: written only when on, and only where the sheet offered them.
      if (c.backoff === true && backoffOffered(out, 'reps', ex, bw) && isBackoff({ ...out, backoff: true })) out.backoff = true
      // A pyramid has its own Max set for this, so the flag is not offered (or kept) there.
      if (!list.length) Object.assign(out, withFailure)
      onSave(out)
    }
  }
  return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <Media ex={ex} />
    {/* The same tags the exercise detail sheet shows, secondaries included: choosing what goes
        into a plan is exactly when "what else does this hit" matters, and until now that was
        only visible from the Exercises tab, after the fact. Custom exercises and the newer
        metadata name muscles by the map's ids ("forearm", "gluteal"), which only MUSCLE_NAME
        turns into a translatable label. */}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t(MUSCLE_NAME[ex.tg] || ex.tg || ex.bp)}</span><span className="tag">{t(ex.eq)}</span>
      {!cardio && (ex.secondaries?.length ? ex.secondaries : smOf(ex)).filter(trainedBy(ex)).slice(0, 3)
        .map((s, i) => <span key={i} className="tag dim">{t(MUSCLE_NAME[s] || s)}</span>)}
    </div>
    {descFor(ex) && <div className="exnote">{descFor(ex)}</div>}
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        {/* Typed and stepped in the profile's unit, kept in km/h (lib/speed.js). */}
        <Stepper label={speedUnit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)')} value={toSpeed(c.speed, speedUnit)} step={0.5}
          onChange={v => setC(x => ({ ...x, speed: fromSpeed(v, speedUnit) }))} />
      </> : mode === 'time' ? <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />
        {/* A bodyweight hold's load is the "Added" row below — showing both put two fields on
            one value. */}
        {!bw && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </> : <>
        {/* Rest-pause always trains as exactly two rows — a warm-up at this rep count, then one
            rest-pause work set — so "Sets" has nothing left to mean and only invites a mismatch. */}
        {c.intensifier?.type !== 'restpause' && !pyramid &&
          <Stepper label={triple ? t('Sets from') : t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />}
        {!ranged && !pyramid && <Stepper label={t('Reps')} value={c.reps} step={perSide ? 2 : 1} decimal={false} onChange={v => setC(x => ({ ...x, reps: v }))} />}
        {/* On bodyweight work the weight stepper is the click #32 is about, so it is not here
            until there is a belt to describe — see the added-weight row below. */}
        {!bw && !pyramid && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </>}
    </div>
    {/* Pyramid sets: a row per set, each with its own reps or Max, rest and weight. A set left
        at 0 weight starts from that same set last time (buildSets). */}
    {pyramid && <div style={{ marginTop: -10, marginBottom: 18 }}>
      {/* Presets replace the list (and its rests and weights) in one tap; the sheet is not saved
          until Save. */}
      <div className="chips" style={{ marginBottom: 10 }}>
        {PYRAMID_PRESETS.map((preset, k) => <button key={k} type="button" className="chip"
          onClick={() => setC(x => ({ ...x, pyramid: [...preset], pyramidRest: undefined, pyramidWeight: undefined }))}>{pyramidLabel(preset)}</button>)}
      </div>
      {c.pyramid.map((p, i) => <div key={i} style={{ marginBottom: 10 }}>
        <div className="row cfgrow" style={{ marginBottom: 4 }}>
          {p === PYRAMID_MAX
            ? <div className="small"><strong>{t('Set {0}', i + 1)}</strong> · {t('Max: as many reps as you can')}</div>
            : <Stepper label={t('Set {0}', i + 1)} value={p} step={perSide ? 2 : 1} min={1} decimal={false} onChange={v => setPyramidAt(i, v)} />}
          <Stepper label={t('Rest (s)')} value={(c.pyramidRest || [])[i] || 0} step={15} decimal={false}
            onChange={v => setC(x => {
              const rest = Array.from({ length: x.pyramid.length }, (_, j) => (x.pyramidRest || [])[j] || 0)
              rest[i] = v
              return { ...x, pyramidRest: rest }
            })} />
        </div>
        {/* Bodyweight work has its one "Added" load below instead. */}
        {!bw && <div className="row cfgrow" style={{ marginBottom: 4 }}>
          <Stepper label={t('Weight ({0})', st.unit)} value={(c.pyramidWeight || [])[i] || 0} step={2.5}
            onChange={v => setC(x => {
              const weight = Array.from({ length: x.pyramid.length }, (_, j) => (x.pyramidWeight || [])[j] || 0)
              weight[i] = v
              return { ...x, pyramidWeight: weight }
            })} />
        </div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button size="sm" variant={p === PYRAMID_MAX ? 'primary' : 'plain'} aria-pressed={p === PYRAMID_MAX}
            onClick={() => setPyramidAt(i, p === PYRAMID_MAX ? (c.reps || 10) : PYRAMID_MAX)}>{t('Max')}</Button>
          {c.pyramid.length > 1 && <Button size="sm" icon="trash" aria-label={t('Remove set')} title={t('Remove set')}
            onClick={() => setC(x => ({ ...x, pyramid: x.pyramid.filter((_, j) => j !== i), pyramidRest: x.pyramidRest?.filter((_, j) => j !== i), pyramidWeight: x.pyramidWeight?.filter((_, j) => j !== i) }))} />}
        </div>
      </div>)}
      <Button size="sm" icon="plus" disabled={c.pyramid.length >= MAX_PYRAMID_SETS}
        onClick={() => setC(x => ({
          ...x,
          pyramid: [...x.pyramid, x.pyramid[x.pyramid.length - 1]],
          // The new set copies the last one's rest too, like its target.
          pyramidRest: x.pyramidRest?.length ? [...x.pyramid.map((_, j) => x.pyramidRest[j] || 0), x.pyramidRest[x.pyramid.length - 1] || 0] : x.pyramidRest,
          pyramidWeight: x.pyramidWeight?.length ? [...x.pyramid.map((_, j) => x.pyramidWeight[j] || 0), x.pyramidWeight[x.pyramid.length - 1] || 0] : x.pyramidWeight,
        }))}>{t('Add set')}</Button>
      <div className="small dim" style={{ marginTop: 8 }}>{t('A set left at 0 rest uses the exercise’s rest.')}</div>
      {!bw && <div className="small dim" style={{ marginTop: 4 }}>{t('A set left at 0 weight starts from that set’s weight last time.')}</div>}
    </div>}
    {c.intensifier?.type === 'restpause' && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {t('Rest-pause always trains as one warm-up set at this rep count, then one rest-pause work set. "Sets" isn’t used here.')}
    </div>}
    {/* Planned warm-ups: the session used to start at the work weight and you added every
        warm-up by hand, every time. Rest-pause is excluded because it builds its own warm-up
        row, and cardio because an interval plan has no load to ramp. */}
    {!cardio && c.intensifier?.type !== 'restpause' && <>
      <div className="row cfgrow" style={{ marginBottom: 6 }}>
        <Stepper label={t('Warm-up sets')} value={c.warmupSets || 0} step={1} decimal={false}
          onChange={v => setC(x => ({ ...x, warmupSets: Math.max(0, Math.min(MAX_PLANNED_WARMUPS, Math.round(v) || 0)) }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {(c.warmupSets || 0) > 0
          ? t('Added before your work sets and left out of volume, records and progression. Each one closes half the gap to the work weight, never below the bar on a barbell lift, and you can still change any of them mid-session.')
          : t('Ramp-up sets added before the work sets, so you do not have to add them by hand each session.')}
      </div>
    </>}
    {mode === 'time' && !bw && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    {/* Per-exercise rest (issue #10). Its own full-width row, like the other steppers with an
        explanation under them, and outside every mode branch because a heavy triple, a plank
        and a cardio interval all rest — they just do not all want the same break. */}
    {/* On the same wheel as the default rest timer (v1.3.11): 0:00 is "no rest of its own", so
        the default applies, and the row says which default that is. */}
    <div className="sect-b cfg-rest" style={{ marginBottom: 6 }}>
      <Row icon="timer" iconTint="var(--orange)" title={t('Rest for this exercise')} accessory="chevron"
        value={c.restSec > 0 ? fmtRest(c.restSec) : t('Default ({0})', fmtRest(st.restSec))}
        onClick={() => durationSheet({
          title: t('Rest for this exercise'), value: c.restSec > 0 ? c.restSec : 0, max: REST_MAX,
          off: t('Default ({0})', fmtRest(st.restSec)),
          footer: t('Rest after each set of this exercise. 0:00 means your default rest.'),
          onDone: v => setC(x => ({ ...x, restSec: v })),
        })} />
    </div>
    <div className="small dim" style={{ marginBottom: 18 }}>
      {t('Rest after each set of this exercise. 0:00 means your default rest.')}
    </div>
    {/* ---------- bodyweight + per side (issues #31/#32/#33) ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
        subtitle={bw ? (mode === 'time' ? t('No weight to enter. Just time the hold.') : t('No weight to enter. Just log the reps.')) : t('Ask for a weight on every set.')}>
        <Switch checked={bw} onChange={v => setC(x => ({ ...x, bodyweight: v, weight: v ? 0 : x.weight }))} />
      </Row>
      {mode !== 'cardio' && <Row icon="sides" iconTint="var(--blue)" title={t('Per side')}
        subtitle={mode === 'time'
          ? (perSide
            ? tn('{0} set becomes {1}: one on each side, {2}s held every time.', '{0} sets become {1}: one on each side, {2}s held every time.', c.sets || 0, (c.sets || 0) * 2, c.sec || 0)
            : t('For side planks, single-arm holds and the like. Trains each side on its own.'))
          : (perSide ? t('You still log the total: {0} is {1} per side.', c.reps || 0, fmtNum(sideReps(c.reps))) : t('For lunges, single-arm rows and the like.'))}>
        {/* Reps: turning it on rounds the target up to an even number, since half of an odd total
            is a rep one side does not get. Time: nothing to round — a hold's whole duration
            happens twice, so only the flag changes (buildWorkSets doubles the planned sets). */}
        <Switch checked={perSide} onChange={v => setC(x => {
          if (mode === 'time') return { ...x, side: v || undefined }
          const next = { ...x, side: v || undefined, reps: v ? Math.ceil((x.reps || 0) / 2) * 2 : x.reps }
          return climbsRange(policyFor({ ...next, id: ex.id }, routine, 'reps'))
            ? { ...next, ...normalizeRepRange(next.reps, next.repsMin, v ? 2 : 1) }
            : next
        })} />
      </Row>}
      {/* Off keeps the list as `pyramidDraft`, so a stray tap does not lose it before Save
          (save writes neither field unless the toggle is on). */}
      {/* The last work set of every session is marked as taken to failure, like Greyskull's
          final AMRAP set (workout-model isFailureSet, history.js applyFailurePlan). A pyramid
          already has its Max set for that. */}
      {!pyramid && <Row icon="gauge" iconTint="var(--purple)" title={t('Last set to failure')}
        subtitle={c.lastToFailure ? t('The last set goes until nothing is left, and counts as all-out effort unless you rate it.') : t('Plan the final set as an all-out one.')}>
        <Switch checked={c.lastToFailure === true} onChange={v => setC(x => ({ ...x, lastToFailure: v || undefined }))} />
      </Row>}
      {mode === 'reps' && <Row icon="steps" iconTint="var(--acc)" title={t('Pyramid sets')}
        subtitle={t('A different rep target for each set, e.g. 12 · 8 · 6 · Max · 12.')}>
        <Switch checked={pyramid} onChange={v => setC(x => (v
          ? { ...x, pyramid: x.pyramidDraft || pyramidFromFlat(x), intensifier: undefined }
          : { ...x, ...flatFromPyramid(x.pyramid), pyramidDraft: x.pyramid, pyramid: undefined }))} />
      </Row>}
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
    {bw && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
          onChange={v => setC(x => ({ ...x, weight: v }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('For dips or pull-ups with a belt. Progression then follows the weight.')}
      </div>
    </>}
    {/* The rep ceiling only means something when there is no load to add instead. */}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Top of the range')} value={c.repsMax || 0} step={1} decimal={false}
        onChange={v => setC(x => ({ ...x, repsMax: v }))} />
    </div>}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {c.repsMax > 0
        ? t('Reps climb to {0}, then a set is added and the reps start over. At {1} sets it asks you to add weight instead.', c.repsMax, MAX_BW_SETS)
        : t('Reps climb by one whenever every set was clean. Set a ceiling to add sets instead of reps forever.')}
    </div>}
    {/* A pyramid already shapes every set; a drop-set or rest-pause would reshape them again. */}
    {mode === 'reps' && !pyramid && <>
      <h4 className="sec">{t('Drop-set / rest-pause')}</h4>
      <div className="sect-b" style={{ marginBottom: 8 }}>
        <SelectRow title={t('Intensifier')} sheetTitle={t('Intensifier')} value={c.intensifier?.type || ''}
          onChange={v => setC(x => ({
            ...x,
            intensifier: !v ? undefined : v === 'dropset'
              ? { type: 'dropset', count: x.intensifier?.count || 1, pct: x.intensifier?.pct || 20 }
              // The activation set's own reps are whatever "Reps" above already says — a
              // rest-pause plan only adds two new numbers: the total extra reps wanted past
              // it, and the rest between the bursts that total gets split into.
              : { type: 'restpause', totalReps: x.intensifier?.totalReps || x.reps || 8, restSec: x.intensifier?.restSec || st.restPauseSec || 15 },
          }))}
          options={[
            { value: '', label: t('None') },
            { value: 'dropset', label: t('Drop-set') },
            { value: 'restpause', label: t('Rest-pause') },
          ]} />
      </div>
      {c.intensifier?.type === 'dropset' && <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Drops')} value={c.intensifier.count} step={1} min={1} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, count: v } }))} />
        <Stepper label={t('Weight drop (%)')} value={c.intensifier.pct} step={5} min={5} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, pct: v } }))} />
      </div>}
      {c.intensifier?.type === 'restpause' && <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Rest-pause reps')} value={c.intensifier.totalReps} step={1} min={1} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, totalReps: v } }))} />
        <Stepper label={t('Rest (s)')} value={c.intensifier.restSec} step={5} min={5} decimal={false}
          onChange={v => setC(x => ({ ...x, intensifier: { ...x.intensifier, restSec: v } }))} />
      </div>}
      {c.intensifier?.type && <div className="small dim" style={{ marginTop: -2, marginBottom: 18 }}>
        {c.intensifier.type === 'dropset'
          ? t('Every set becomes a drop-set: after the main set, {0} drop(s) with no rest, each about {1}% lighter.', c.intensifier.count, c.intensifier.pct)
          : t('Every set becomes rest-pause: {0} reps to start, then {1} more split into short bursts, {2}s rest before each, roughly halving each time.', c.reps || 0, c.intensifier.totalReps, c.intensifier.restSec)}
      </div>}
    </>}
    {/* What a dumbbell weight means, for this routine's slot (cfg.dbLoad). Picking what the
        exercise already means drops the key, so the slot follows the exercise's default again. */}
    {isBellEx(ex) && !bw && mode !== 'cardio' && <>
      <h4 className="sec">{t('Weight means')}</h4>
      <DbLoadPicker ex={ex} cfg={c} value={dbLoadFor(st, { ...c, id: ex.id })}
        onChange={v => setC(x => ({ ...x, dbLoad: v === dbLoadFor(st, ex.id) ? undefined : v }))} />
    </>}
    {/* How the weight is plate-loaded and what the bar weighs — per exercise, not per plan, so
        it sits apart from the config fields above and writes straight to S.barWeights/S.loadKind. */}
    {mode === 'reps' && <>
      <h4 className="sec">{t('Plate loading')}</h4>
      <BarWeightEditor ex={ex} cfg={c} extra={t('Applies to this exercise everywhere, not just this plan.')} />
    </>}
    {pyramid
      ? <div className="small dim" style={{ marginBottom: 18 }}>{t('Weight is up to you: pyramid sets are not progressed automatically.')}</div>
      : <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} perSide={perSide} bw={bw} />}
    <textarea className="input" rows={3} maxLength={500} style={{ marginBottom: 18 }}
      placeholder={t('Note (optional): loading cues, "bar only, then +1 plate/side each set", anything worth remembering')}
      value={c.note || ''} onChange={e => setC(x => ({ ...x, note: e.target.value }))} />
    {/* What saving does, when it is neither of the two usual things: the routine editor's
        Replace (#110) seeds this sheet with the slot it replaces, and saving puts the exercise
        into that slot. */}
    <Button variant="primary" disabled={progressionStepInvalid} onClick={save}>{saveLabel || (existing ? t('Save') : t('Add to routine'))}</Button>
    {isCustomEx(ex) && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {/* The routine editor's counterpart to a workout's Swap (#110): another exercise in this
        slot, with the slot's sets, reps, weight, rule and note kept (lib/routines.js). What was
        changed on this sheet and not saved is left behind, as closing it would. */}
    {onReplace && <><div style={{ height: 8 }} /><Button icon="swap" onClick={() => { close(); onReplace() }}>{t('Replace exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine, initial, onReplace, saveLabel) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} initial={initial} onSave={onSave} onDelete={onDelete} onReplace={onReplace} routine={routine} saveLabel={saveLabel} close={close} />)

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current, onPick) => {
  const cur = glyphOf(current)
  return ui().openSheet(close => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ effort quick picker (RIR / RPE) ============================ */
// Rating a set used to mean walking a +/- stepper up the scale — eleven taps to log "5 reps
// left". This is the one-tap replacement: a colour-coded button per preset, plus a free field
// for the value between two presets. Presets are stored in RIR internally; a profile that logs
// RPE sees the same buttons labelled on its own scale (toScale), coloured identically — the
// colour is the effort, not the number, so 0 RIR and 10 RPE are both the "went to failure" end.
function EffortPicker({ kind, value, onPick, close }) {
  // Local mirror so the ticked preset and the exact field track typing live.
  const [v, setV] = useState(value ?? null)
  // The exact field used to write through on every change, and onPick concludes the set (issue
  // #64): it ticks the set, beeps and starts the rest. Since stepEffort(kind, null, 1) returns
  // the band's minimum, one tap of + — or typing the `1` of `10` — was a committed rating, fired
  // under the sheet you were still typing into, and on the last set of the last exercise it
  // stacked workoutCompleteSheet on top of the picker. So typing moves the mirror only, and the
  // rating is written once, when the sheet goes away: Done, the backdrop, a swipe or Escape all
  // unmount this. A preset row still commits on the spot, which is what makes it one tap.
  const typed = useRef(value ?? null)
  const done = useRef(false)
  const set = nv => { typed.current = nv; setV(nv) }
  useEffect(() => () => {
    if (done.current) return
    if (typed.current !== (value ?? null)) onPick(typed.current)
  }, [])
  // `v` is in the profile's own scale (whatever sits on the set: s.rir or s.rpe). Compare in
  // RIR so the tick lands on the right preset on either scale, and so a typed RPE colours the
  // same as the RIR it equals.
  const curRir = rirOf(kind === 'rpe' ? { rpe: v } : { rir: v })
  const curColor = effortColor(curRir)
  const commit = nv => { done.current = true; close(); onPick(nv) }
  const pick = rir => commit(toScale(kind, rir))
  const hd = EFFORT[kind].hd
  // Same list the ⋯ menus use: a tinted square with the value where the icon goes, the sentence
  // as the row title, a tick on the current one. The exact field is the app's own stepper,
  // tinted like the logged cell in the set row, so the sheet and the row read as one thing.
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('How hard was that set?')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Tap how many reps you had left, or type an exact {0}.', hd)}</div>
    <div className="list menu-list effpick">
      {EFFORT_PRESETS.map(p => {
        const label = fmtNum(toScale(kind, p.rir)) + (p.tail ? '+' : '')
        const on = curRir != null && curRir === p.rir
        return <div key={p.rir} className={'item menu-item' + (on ? ' on' : '')} style={{ '--bc': p.color, '--bi': p.ink }}
          {...tappable(() => pick(p.rir))}>
          <span className="lrow-i effpick-n">{label}</span>
          <div className="grow"><div className="tt">{t(p.feel)}</div></div>
          <span className={'menu-on' + (on ? ' is-on' : '')}><Icon name="check" /></span>
        </div>
      })}
      <div className="item menu-item effpick-free">
        <div className="grow"><div className="tt">{t('Exact {0}', hd)}</div></div>
        <div className="stp effcell-stp"
          style={curColor ? { color: effortInk(curRir), background: `color-mix(in srgb, ${curColor} 20%, var(--surface-2))` } : undefined}>
          <button aria-label={t('Decrease')} onClick={() => set(stepEffort(kind, v, -1))}><Icon name="minus" /></button>
          <span className="val"><NumberField decimal nullable value={v ?? ''} placeholder="–"
            onChange={nv => set(capEffort(kind, nv))} /></span>
          <button aria-label={t('Increase')} onClick={() => set(stepEffort(kind, v, 1))}><Icon name="plus" /></button>
        </div>
      </div>
    </div>
    {v != null && <>
      <div style={{ height: 10 }} />
      {/* Only after the exact field has moved the value off what is stored: the preset rows
          close themselves, so this row exists for the one path that does not. */}
      {v !== (value ?? null) && <Button icon="check" onClick={() => commit(v)}>{t('Done')}</Button>}
      <Button variant="ghost" className="dim" icon="xmark" onClick={() => commit(null)}>{t('Clear rating')}</Button>
    </>}
    <div style={{ height: 4 }} />
  </>
}
// kind is 'rir' | 'rpe'; value is the set's current rating on that scale (or null); onPick
// receives the new value on that same scale (null to clear). The caller stores it exactly as
// weight/reps are stored — a null drops the key rather than writing a zero.
export const effortPickerSheet = (kind, value, onPick) =>
  ui().openSheet(close => <EffortPicker kind={kind} value={value} onPick={onPick} close={close} />)
