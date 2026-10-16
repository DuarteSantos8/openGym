// The pages the global search finds (fitness-eval ux-search.md §5): every routed page of the four
// tabs, with the words people look for it by and the feature it depends on. Profile's own pages
// are the settings source's (views/settings-pages.js), so they are not listed twice.
//
// `gate(ctx)` says whether the page is there: 'on'; 'hidden' (it cannot be had on this device or
// profile, and is not offered); or `{ off: { page, find } }` for a page behind a switch that is off,
// which the search still shows, labelled Off, and opens at that switch (the settings `find`
// contract, views/Settings.jsx). Titles and keywords are English keys, translated when shown.
// page-index.test.js holds every path here to a route in App.jsx.
import { TAB_ROOT } from '../tab-route.js'

const nutrition = c => (c.nutrition ? 'on' : 'hidden')

export const PAGE_INDEX = [
  // Home
  { path: TAB_ROOT.home, tab: 'home', title: 'Home', glyph: 'house', kw: 'today dashboard day start' },
  // Training
  { path: TAB_ROOT.train, tab: 'train', title: 'Training', glyph: 'dumbbell', kw: 'train workout gym' },
  { path: '/train/history', tab: 'train', title: 'History', glyph: 'history', kw: 'past workouts log sessions done calendar' },
  { path: '/train/exercises', tab: 'train', title: 'Exercises', glyph: 'dumbbell', kw: 'library catalogue exercise list movements custom' },
  { path: '/train/exercises/muscles', tab: 'train', title: 'Explore muscles', glyph: 'figureStrength', kw: 'muscle map body anatomy chest back legs' },
  { path: '/train/schedule', tab: 'train', title: 'Schedule', glyph: 'calendarCheck', kw: 'plan week split rotation days program' },
  { path: '/train/routines', tab: 'train', title: 'Routines', glyph: 'clipboard', kw: 'templates plans program workouts' },
  { path: '/train/checkin', tab: 'train', title: 'Check in', glyph: 'qr', kw: 'gym card membership qr barcode',
    gate: c => (c.checkIn ? 'on' : { off: { page: 'appearance', find: 'Gym check-in' } }) },
  { path: '/train/coach', tab: 'train', title: 'Coach', glyph: 'chat', kw: 'ai coach chat assistant advice', gate: c => (c.coach ? 'on' : 'hidden') },
  // Nutrition
  { path: TAB_ROOT.food, tab: 'food', title: 'Nutrition', glyph: 'utensils', kw: 'food diary calories eat', gate: nutrition },
  { path: '/food/foods', tab: 'food', title: 'Foods', glyph: 'apple', kw: 'my foods ingredients products', gate: nutrition },
  { path: '/food/meals', tab: 'food', title: 'Saved meals', glyph: 'utensils', kw: 'meals combos favourites', gate: nutrition },
  { path: '/food/recipes', tab: 'food', title: 'Recipes', glyph: 'cookingPot', kw: 'recipe cooking servings', gate: nutrition },
  { path: '/food/goals', tab: 'food', title: 'Goals', glyph: 'target', kw: 'calorie goal macros protein target water', gate: nutrition },
  { path: '/food/fasting', tab: 'food', title: 'Fasting', glyph: 'timer', kw: 'fast intermittent 16:8 omad',
    gate: c => (!c.nutrition ? 'hidden' : c.fastingOn ? 'on' : { off: { page: 'features', find: 'Fasting' } }) },
  // Progress
  { path: TAB_ROOT.progress, tab: 'progress', title: 'Progress', glyph: 'chart', kw: 'stats statistics charts' },
  { path: '/progress/body', tab: 'progress', title: 'Body', glyph: 'scale', kw: 'weight weigh-ins bodyweight scale' },
  { path: '/progress/body/measurements', tab: 'progress', title: 'Body measurements', glyph: 'ruler', kw: 'measurements waist chest arms circumference body fat' },
  { path: '/progress/body/photos', tab: 'progress', title: 'Progress photos', glyph: 'image', kw: 'photos pictures compare before after' },
  { path: '/progress/strength', tab: 'progress', title: 'Strength', glyph: 'chartLine', kw: 'records pr personal best 1rm one rep max lifts' },
  { path: '/progress/strength/balance', tab: 'progress', title: 'Structural balance', glyph: 'gauge', kw: 'ratios weak link balance' },
  { path: '/progress/load', tab: 'progress', title: 'Training load', glyph: 'flame', kw: 'volume sets muscles activity weekly' },
  { path: '/progress/trends', tab: 'progress', title: 'Nutrition trends', glyph: 'chart', kw: 'calories protein macros over time', gate: nutrition },
  { path: '/progress/recovery', tab: 'progress', title: 'Recovery', glyph: 'heart', kw: 'sleep hrv resting heart rate wearable', gate: nutrition },
]

export const TAB_TITLE = { home: 'Home', train: 'Training', food: 'Nutrition', progress: 'Progress' }
export const TAB_GLYPH = { home: 'house', train: 'dumbbell', food: 'apple', progress: 'chart' }

/** The page's state for this device and profile: 'on', 'hidden' or { off: { page, find } }. */
export const pageGate = (page, ctx) => (page.gate ? page.gate(ctx) : 'on')

/** The pages the search may offer, each with its gate. */
export const searchablePages = ctx => PAGE_INDEX.map(p => ({ ...p, state: pageGate(p, ctx) })).filter(p => p.state !== 'hidden')
