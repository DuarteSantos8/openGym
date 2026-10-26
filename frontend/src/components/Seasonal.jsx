import { Suspense, lazy, useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { activeSeason, seasonInWorkout } from '../lib/seasonal.js'

/* The main bundle's side of the seasonal themes (lib/seasonal.js): two tiny components that render
   nothing at all unless a theme is showing, and only then fetch its module (seasonal/<id>.jsx,
   its art, CSS and timers). Out of season or switched off, nothing is downloaded, parsed or
   scheduled. seasonal.lazy.test.js keeps it that way: no file but this one names that folder,
   and only through import(). */
const LOADERS = {
  halloween: () => import('../seasonal/halloween.jsx'),
}
const mods = {}
const modOf = id => (mods[id] ||= {
  Layer: lazy(() => LOADERS[id]().then(m => ({ default: m.Layer }))),
  Deco: lazy(() => LOADERS[id]().then(m => ({ default: m.Deco }))),
})

const useSeason = () => useStore(s => activeSeason(s.S))

// Whether the first screen this session drew was one the theme may decorate. The spider's
// "first open of the day" is an app start, so a start straight into a running workout skips it.
let firstVisible = null

/** The screen-wide layer (the spider, the witch). `hidden` on the workout screen: no theme there. */
export function SeasonalLayer({ hidden = false }) {
  const id = useSeason()
  if (id && firstVisible === null) firstVisible = !hidden
  // The CSS of a theme is scoped to html[data-season], so a theme switched off mid-session
  // leaves nothing styled behind even though its stylesheet stays loaded.
  useEffect(() => {
    const de = document.documentElement
    if (id) de.dataset.season = id
    else delete de.dataset.season
  }, [id])
  if (!id || !LOADERS[id]) return null
  const { Layer } = modOf(id)
  return <Suspense fallback={null}><Layer hidden={hidden} fresh={firstVisible} /></Suspense>
}

/** One piece of decoration in a view: `spot` names where ('home-hero', 'home-streak', ...).
    `workout` marks a spot on the workout screen or its sheets: those follow the theme's own
    "Also during workouts" switch as well. */
export function SeasonDeco({ spot, workout = false }) {
  const season = useSeason()
  const inWorkout = useStore(s => seasonInWorkout(s.S))
  const id = workout && !inWorkout ? null : season
  if (!id || !LOADERS[id]) return null
  const { Deco } = modOf(id)
  return <Suspense fallback={null}><Deco spot={spot} /></Suspense>
}
