import { useEffect, useState } from 'react'
import { MUSCLES, INERT, MUSCLE_NAME, levelsOf } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'
import { regionLevel } from '../lib/body-geometry-level.js'

// Front and back views of a body, each muscle shaded by how hard it was worked.
//
// The five shade steps are the same ones the activity heatmap uses (.hm-c.l0…l4), so
// "more accent = more training" means one thing everywhere in the app rather than two.
//
// The geometry is ~90 KB and only some screens show a map, so it is fetched on first
// render instead of riding along in the main bundle. Until it lands the component
// renders nothing but keeps its height, so nothing below it jumps on arrival.

let CACHE = null                                  // shared across every mounted map
let PENDING = null

function useBodyPaths() {
  const [paths, setPaths] = useState(CACHE)
  useEffect(() => {
    if (CACHE) return
    let alive = true
    PENDING = PENDING || import('../lib/body-geometry.js').then(m => (CACHE = m.default))
    PENDING.then(p => { if (alive) setPaths(p) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return paths
}

// `selected`: one muscle, or several (the explorer's filter, #885).
const isSel = (selected, slug) => (Array.isArray(selected) ? selected.includes(slug) : selected === slug)
// A muscle is drawn as several shapes (two forearms, six serratus slips, and again on the back):
// every one takes a tap, but only one of them is the button a keyboard and a screen reader meet,
// so the map has one "Forearms" and not fourteen (P4). `silent`: muscles the other view names.
// With no tap handler there is no button to name, so `label` names the whole picture instead and
// `hide` takes the view out of the accessibility tree; either way the shapes themselves are never
// announced, which is what left 116 unnamed symbols where one sentence belongs.
function View({ view, levels, onMuscle, selected, silent, label, hide }) {
  const heard = (slug, i) => !!onMuscle && i === 0 && !silent?.(slug)
  const activate = (event, slug) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (event.key === ' ') event.preventDefault()
    onMuscle(slug)
  }
  return (
    <svg className="bm-v" viewBox={view.vb} role={onMuscle ? 'group' : 'img'}
      aria-label={label} aria-hidden={hide ? 'true' : undefined}>
      {INERT.map(slug => (view.p[slug] || []).map((d, i) =>
        <path key={slug + i} className="bm-sil" d={d} />))}
      {MUSCLES.map(slug => (view.p[slug] || []).map((d, i) =>
        <path
          key={slug + i}
          className={'bm-m l' + regionLevel(levels, slug, view) + (isSel(selected, slug) ? ' sel' : '')}
          d={d}
          onClick={onMuscle ? () => onMuscle(slug) : undefined}
          onKeyDown={heard(slug, i) ? event => activate(event, slug) : undefined}
          role={heard(slug, i) ? 'button' : undefined}
          tabIndex={heard(slug, i) ? 0 : undefined}
          aria-label={heard(slug, i) ? t(MUSCLE_NAME[slug]) : undefined}
          aria-pressed={heard(slug, i) ? isSel(selected, slug) : undefined}
          aria-hidden={heard(slug, i) ? undefined : 'true'}
        >
          <title>{t(MUSCLE_NAME[slug])}</title>
        </path>))}
    </svg>
  )
}

/**
 * <BodyMap load={{ chest: 12, … }} body="male" />
 * `load` is effective sets per muscle (see lib/muscles.js); shading is relative to
 * the hardest-worked muscle in that same load, so it always reads as a balance. Pass ordered
 * `{ at, level, exclusive? }` `thresholds` for a fixed absolute scale (recovery views use this
 * to keep their semantic bands stable); omitting it preserves the balance behavior. `levels`
 * hands over ready-made steps instead (the live session map, lib/muscles.js sessionLevels).
 * `hits` is the muscle list the picture stands for, most-worked first (`rankOf(load).worked`).
 * Only a read-only map reads it out; a tappable one already names every muscle as its own button.
 */
export default function BodyMap({ load = {}, thresholds, levels: given, body = 'male', onMuscle, selected, hits, className = '' }) {
  const paths = useBodyPaths()
  const levels = given || levelsOf(load, thresholds)
  const g = paths && (paths[body] || paths.male)
  // The order the caller gave is the message (most worked first), so it is kept, but a key that
  // is not a muscle is dropped rather than read out as "undefined".
  const named = onMuscle ? '' : (hits || []).filter(m => MUSCLES.includes(m)).map(m => t(MUSCLE_NAME[m])).join(', ')
  return (
    <div className={'bodymap ' + className}>
      {g ? <>
        <View view={g.front} levels={levels} onMuscle={onMuscle} selected={selected} label={named || undefined} hide={!onMuscle && !named} />
        {/* One body, not two loads: the back view adds shapes, never muscles the front lacks. */}
        <View view={g.back} levels={levels} onMuscle={onMuscle} selected={selected} silent={slug => !!g.front.p[slug]?.length} hide={!onMuscle} />
      </> : <div className="bm-ph" aria-hidden="true" />}
    </div>
  )
}

export function BodyMapLegend() {
  return <div className="hm-legend" aria-label={`${t('Less')} ${t('More')}`}>
    {t('Less')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" />
    <div className="hm-c l3" /><div className="hm-c l4" /> {t('More')}
  </div>
}
