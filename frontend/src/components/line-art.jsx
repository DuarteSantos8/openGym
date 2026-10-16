import { useId } from 'react'
import { cx, oneOf } from '../lib/ui-kit.js'
import { useDrawIn } from '../lib/use-draw-in.js'

// Line art in place of photos, in the onboarding's one language (fitness-eval
// ui-onboarding-round2 §1, ui-redesign-components §3): two strokes (--il-w, --il-w-d), three inks
// (structure --label-2, data --acc-graphic, context --label-3), the floor in --sep, --surface to
// occlude and --acc-soft for the one lit area. Flat views, no figures or faces, no text in the
// svg (an HTML caption says the number), at most 8 paths and 3 accent ones. Each scene is a pure
// function of its state, drawn in once a session (lib/use-draw-in.js). Sized for the 96×72 art
// slot (--art-w × --art-h), 1:1.

// A path that draws in: its order in the scene, back to front, accent last.
const at = i => ({ pathLength: 1, style: { '--i': i } })
const FLOOR = <path className="il-floor" d="M8 64H88" {...at(0)} />

// The week's routine as a plan card: a row per day (three at most), the next one lit. No routine:
// a dashed card with a +. Not scheduled: the rows muted.
function routine({ days = 0, next = null, scheduled = true }) {
  if (!days) {
    return <>
      {FLOOR}
      <rect className="il il-mute il-dash" x="24" y="8" width="48" height="52" rx="6" />
      <path className="il-acc" d="M48 26v16M40 34h16" {...at(1)} />
    </>
  }
  const rows = Math.min(3, days)
  return <>
    {FLOOR}
    <rect className="il il-occ" x="24" y="8" width="48" height="52" rx="6" {...at(1)} />
    {next != null && next < rows && <rect className="il-lit" x="28" y={14 + 12 * next} width="40" height="12" rx="3" {...at(2)} />}
    {Array.from({ length: rows }, (_, i) => {
      const y = 20 + 12 * i
      return <path key={i} className={i === next ? 'il-acc' : cx('il-d', !scheduled && 'il-mute')}
        d={`M32 ${y}h8M33 ${y - 3}v6M39 ${y - 3}v6M44 ${y}h20`} {...at(3 + i)} />
    })}
  </>
}

// Mobility without a figure: a mat on the floor and a stopwatch whose accent arc is the session's
// length out of an hour.
function mobility({ minutes = 0 }) {
  const m = Math.max(0, Math.min(60, minutes))
  return <>
    {FLOOR}
    <rect className="il" x="12" y="56" width="56" height="6" rx="3" {...at(1)} />
    <circle className="il il-lit" cx="64" cy="32" r="18" {...at(2)} />
    <path className="il" d="M64 10v4M60 10h8" {...at(3)} />
    {m > 0 && <path className="il-acc il-data" d="M64 14a18 18 0 1 1 0 36a18 18 0 1 1 0-36" pathLength="60" strokeDasharray={`${m} 60`} />}
  </>
}

// The weighing scale from above: a tape behind a fixed accent needle, moved to the latest weight.
// No weigh-in: the tape muted, no needle.
const KG_FROM = 30, KG_TO = 250, U = 2   // the tape: 2 units a kilo, a tall tick every 5
const TAPE = Array.from({ length: KG_TO - KG_FROM + 1 }, (_, i) => `M${i * U} ${i % 5 ? 24 : 20}V28`).join('')
function scale({ kg = null }, clip) {
  const x = kg == null ? 48 : 48 - U * (Math.max(KG_FROM, Math.min(KG_TO, kg)) - KG_FROM)
  return <>
    {FLOOR}
    <rect className="il il-occ" x="20" y="8" width="56" height="56" rx="14" {...at(1)} />
    <clipPath id={clip}><rect x="32" y="16" width="32" height="14" rx="4" /></clipPath>
    <rect className="il-d il-lit" x="32" y="16" width="32" height="14" rx="4" {...at(2)} />
    <g clipPath={`url(#${clip})`}>
      <path className={cx('il-d', kg == null && 'il-mute')} d={TAPE} transform={`translate(${x} 0)`} />
    </g>
    {kg != null && <path className="il-acc" d="M48 17v12" {...at(3)} />}
  </>
}

// What an exercise is done with, for a thumbnail that has no picture: barbell, dumbbell, cable,
// machine or the mat for bodyweight. Never a figure.
export const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight']
/** The equipment scene for an exercise's `eq` ('body weight', 'smith machine', 'kettlebell'…). */
export function equipmentOf(eq = '') {
  const e = String(eq).toLowerCase()
  if (/barbell|landmine|smith|trap bar|ez/.test(e)) return 'barbell'
  if (/dumbbell|kettlebell|macebell|clubbell/.test(e)) return 'dumbbell'
  if (/cable|band|rope/.test(e)) return 'cable'
  if (/machine|lever|sled/.test(e)) return 'machine'
  return 'bodyweight'
}
function equipment({ eq = 'bodyweight' }) {
  const kind = oneOf('LineArt', 'eq', eq, EQUIPMENT)
  return <>
    {FLOOR}
    {kind === 'barbell' && <>
      <path className="il" d="M10 40H86" {...at(1)} />
      <rect className="il il-occ" x="18" y="26" width="6" height="28" rx="2" {...at(2)} />
      <rect className="il il-occ" x="72" y="26" width="6" height="28" rx="2" {...at(3)} />
    </>}
    {kind === 'dumbbell' && <>
      <path className="il" d="M32 40H64" {...at(1)} />
      <rect className="il il-occ" x="24" y="30" width="8" height="20" rx="2" {...at(2)} />
      <rect className="il il-occ" x="64" y="30" width="8" height="20" rx="2" {...at(3)} />
    </>}
    {kind === 'cable' && <>
      <path className="il" d="M20 8H76M48 8v2" {...at(1)} />
      <circle className="il il-occ" cx="48" cy="16" r="6" {...at(2)} />
      <path className="il-d" d="M48 22V50M38 50H58" {...at(3)} />
    </>}
    {kind === 'machine' && <>
      <path className="il" d="M24 64V12H72V64" {...at(1)} />
      <rect className="il il-occ" x="36" y="40" width="24" height="6" rx="2" {...at(2)} />
      <path className="il-d" d="M40 40V22M24 28H72" {...at(3)} />
    </>}
    {kind === 'bodyweight' && <rect className="il" x="12" y="56" width="72" height="6" rx="3" {...at(1)} />}
  </>
}

// A plate from above between a fork and a knife, a quarter of it lit in the accent: Nutrition
// with nothing to show (the phone build, a guest).
function plate() {
  return <>
    {FLOOR}
    <circle className="il il-occ" cx="48" cy="36" r="22" {...at(1)} />
    <circle className="il-d il-lit" cx="48" cy="36" r="14" {...at(2)} />
    <path className="il" d="M12 12v10M16 12v10M20 12v10M12 22a4 4 0 0 0 8 0M16 26v32" {...at(3)} />
    <path className="il" d="M80 12v46M80 12c5 5 5 14 0 18" {...at(4)} />
    <path className="il-acc" d="M48 22a14 14 0 0 1 14 14" {...at(5)} />
  </>
}

const SCENES = { routine, mobility, scale, equipment, plate }
export const LINE_ART_SCENES = Object.keys(SCENES)

export function LineArt({ scene, state = {}, className }) {
  oneOf('LineArt', 'scene', scene, LINE_ART_SCENES)
  const clip = useId()
  const draw = useDrawIn('line-art:' + scene)
  return (
    <svg className={cx('lineart', draw, className)} viewBox="0 0 96 72" aria-hidden="true" focusable="false" data-scene={scene}>
      {SCENES[scene](state, clip)}
    </svg>
  )
}
