import { Suspense, lazy, useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { activeSeason, seasonInWorkout } from '../lib/seasonal.js'
import { useTourRunning } from '../lib/tour.js'

/* The main bundle's side of the seasonal themes (lib/seasonal.js): two tiny components that render
   nothing at all unless a theme is showing, and only then fetch its module (seasonal/<id>.jsx,
   its art, CSS and timers). Out of season or switched off, nothing is downloaded, parsed or
   scheduled. seasonal.lazy.test.js keeps it that way: no file but this one names that folder,
   and only through import(). */
const LOADERS = {
  halloween: () => import('../seasonal/halloween.jsx'),
  christmas: () => import('../seasonal/christmas.jsx'),
}
const mods = {}
const modOf = id => (mods[id] ||= {
  Layer: lazy(() => LOADERS[id]().then(m => ({ default: m.Layer }))),
  Deco: lazy(() => LOADERS[id]().then(m => ({ default: m.Deco }))),
})

// The app tour pauses the theme while it runs: nothing crawls across a spotlight.
const useSeason = () => {
  const id = useStore(s => activeSeason(s.S))
  return useTourRunning() ? null : id
}

// Whether the first screen this session drew was one the theme may decorate. The spider's
// "first open of the day" is an app start, so a start straight into a running workout skips it.
let firstVisible = null

/** The screen-wide layer (the spider, the witch, the snow). `hidden` on the workout screen, where a
    theme draws only what its "Also during workouts" switch allows (`workout`), if anything. */
export function SeasonalLayer({ hidden = false }) {
  const id = useSeason()
  const inWorkout = useStore(s => seasonInWorkout(s.S))
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
  return <Suspense fallback={null}><Layer hidden={hidden} fresh={firstVisible} workout={hidden && inWorkout} /></Suspense>
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

/** Opens something of a theme's from outside it (Settings → Seasonal themes → Advent calendar):
    fetches the theme's module first. Only offered while that theme shows. */
export function openSeasonal(id, what) {
  if (!LOADERS[id]) return Promise.resolve(false)
  return LOADERS[id]().then(m => (m.open ? m.open(what) : false))
}
