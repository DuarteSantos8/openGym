// Profile (ia-proposal §5): which page each row lives on, and the index the search field reads.
//
// The root holds the account card, the sync status, then one group per domain (General, Training,
// Data, Admin, About) and Log out; each row opens a page at /me/<page>, or a page that lives in a
// tab (`to`). Every page goes back to Profile (§6). Titles here are the English keys the pages
// render with t(), so a search hit can find its row on the page by the same text and flash it
// (views/Settings.jsx). settings-pages.test.jsx renders every page and checks that each entry
// below really is a row there.
import { t } from '../lib/i18n.js'
import { ACCENT_NAMES } from '../lib/format.js'
import { workoutControls } from '../lib/workout-controls.js'
import { MEAL_NAMES_MAX } from '../lib/nutrition/settings-lists.js'
import { settingOf } from '../lib/nutrition/use-nt-settings.js'

export const PAGES = {
  appearance: { title: 'Appearance', icon: 'palette', tint: 'var(--purple)' },
  units: { title: 'Units & language', icon: 'ruler', tint: 'var(--teal)' },
  notifications: { title: 'Notifications', icon: 'bell', tint: 'var(--red)' },
  coach: { title: 'AI Coach', icon: 'chat', tint: 'var(--green)', to: '/train/coach/setup' },
  features: { title: 'Features', icon: 'slider', tint: 'var(--indigo)' },
  health: { title: 'Connected apps & health', icon: 'heart', tint: 'var(--red)' },
  workout: { title: 'Workout', icon: 'play', tint: 'var(--green)' },
  advanced: { title: 'Fine-tuning', icon: 'wrench', tint: 'var(--grey)' },
  alerts: { title: 'Timer alerts', icon: 'speaker', tint: 'var(--pink)' },
  schedule: { title: 'Schedule defaults', icon: 'calendar', tint: 'var(--orange)' },
  equipment: { title: 'Equipment', icon: 'kettlebell', tint: 'var(--indigo)' },
  // The calorie goal mode, macros and water goal live on Nutrition › Goals (§5): linked, not copied.
  goals: { title: 'Goals', icon: 'target', tint: 'var(--red)', to: '/food/goals', kw: 'calorie goal mode fixed adaptive dynamic factor macros protein target water' },
  diary: { title: 'Diary & meals', icon: 'utensils', tint: 'var(--orange)', kw: 'diary meals meal names breakfast lunch dinner snacks quick calories activity fasting' },
  water: { title: 'Water', icon: 'droplet', tint: 'var(--blue)', kw: 'water drink hydration containers bottle glass unit ml oz' },
  foods: { title: 'Foods & scanning', icon: 'scanBarcode', tint: 'var(--green)', kw: 'foods meals recipes list sort order barcode scanner camera photos' },
  sources: { title: 'Food sources', icon: 'globe', tint: 'var(--teal)', kw: 'open food facts off usda online database search language country' },
  categories: { title: 'Categories', icon: 'list', tint: 'var(--indigo)', kw: 'food categories emoji label groups' },
  customUnits: { title: 'Custom units', icon: 'ruler', tint: 'var(--purple)', kw: 'custom units serving shot scoop stick abbreviation' },
  fields: { title: 'Measurement fields', icon: 'ruler', tint: 'var(--purple)', sheet: true },
  backup: { title: 'Backup', icon: 'folder', tint: 'var(--blue)' },
  import: { title: 'Import', icon: 'download', tint: 'var(--teal)' },
  media: { title: 'Photos & videos', icon: 'image', tint: 'var(--teal)' },
  danger: { title: 'Danger zone', icon: 'trash', tint: 'var(--red)' },
  admin: { title: 'Admin dashboard', icon: 'crown', tint: 'var(--indigo)', to: '/me/admin' },
  about: { title: 'About & updates', icon: 'info', tint: 'var(--grey)' },
  licences: { title: 'Licences', icon: 'shield', tint: 'var(--grey)' },
  account: { title: 'Account', icon: 'personCircle', tint: 'var(--grey)' },
}
export const PAGE_IDS = Object.keys(PAGES)

// The pages that are NutriTrace's settings, read and written through the hub (lib/nutrition):
// the web app, signed in. Goals is one too, but lives in the Nutrition tab.
const NUTRITION_PAGES = ['diary', 'water', 'foods', 'sources', 'categories', 'customUnits']

// The root, top to bottom. Whether a row shows is pageVisible's call.
export const ROOT_GROUPS = [
  { title: 'General', ids: ['appearance', 'units', 'notifications', 'coach', 'features', 'health'] },
  { title: 'Training', ids: ['workout', 'advanced', 'alerts', 'schedule', 'equipment'] },
  { title: 'Nutrition', ids: ['goals', 'diary', 'water', 'foods', 'sources', 'categories', 'customUnits'] },
  { title: 'Body & progress', ids: ['fields'] },
  { title: 'Data', ids: ['backup', 'import', 'media', 'danger'] },
  { title: 'Admin', ids: ['admin'] },
  { title: 'About', ids: ['about', 'licences'] },
]

/**
 * Whether a page has a route on this device and profile. Notifications need a push server
 * (signed in) or the phone's own notifications; Health Connect is the phone app's.
 */
export function pageExists(page, ctx) {
  if (!(page in PAGES) || PAGES[page].to || PAGES[page].sheet) return false
  if (page === 'notifications') return !!(ctx.user || ctx.mobile)
  if (page === 'health') return !!ctx.mobile
  if (NUTRITION_PAGES.includes(page)) return !ctx.mobile && !!ctx.user
  return true
}

/**
 * Whether the root shows a page's row. The Coach page is the phone's Coach setup (the web app's
 * Coach runs on the server, set up by its admin); Health Connect is Android's; the photos row
 * only shows once a custom exercise has one; Admin is the admin's. Nutrition is NutriTrace's,
 * reached through the hub: the web app, signed in (`ctx.nutrition`).
 */
export function pageVisible(page, ctx) {
  if (page == null) return true
  if (page === 'goals' || NUTRITION_PAGES.includes(page)) return !!ctx.nutrition
  if (page === 'notifications') return !!(ctx.user || ctx.mobile)
  if (page === 'coach') return !!ctx.mobile
  if (page === 'health') return !!(ctx.mobile && ctx.android)
  if (page === 'media') return !!ctx.hasMedia
  if (page === 'admin') return !!ctx.user?.admin && !ctx.demo
  return page in PAGES
}

// One entry per row. `page` null is a row on the root itself. `kw` is extra words people search
// for (English; the translated title and page name are searched too). `opts` are the English
// labels of a segmented or picker row's choices, searched in both languages, so "Dunkel" finds
// Theme; `tkw` is a word in the app's own language for a row whose title does not say it
// ("Wochenstart"). `when` repeats the row's own visibility rule, so a search never offers a row
// the page would not show. The one rule a search cannot know in advance is whether this browser's
// push subscription is on (the server is asked when the page opens): those rows name `via`, the
// row the hit flashes instead when they turn out not to be there.
//
// `feature` marks a switch that is off in a new profile (§5 Features, §9 q12): it says whether the
// switch is on now, or null where only the page can know (asked of the browser or the phone when
// it opens). Features lists exactly these, so a new off-by-default switch is listed by giving its
// entry a `feature`; settings-pages.test.jsx renders every page of a new profile to check none is
// missing.
const signedInWeb = c => !!c.user && !c.mobile && !c.demo
// The reminder rows: the phone's own notifications, or web push where the browser has it.
const remind = c => !!c.mobile || !!c.pushOK
const PUSH = 'Push notifications'
// NutriTrace's settings rows: reachable on the web app, signed in. A switch that starts off says
// whether it is on once the settings are here, and null until then (like the push rows, only the
// settings can tell).
const ntOn = c => !!c.nutrition
const ntValue = (c, key) => settingOf(c.ntSettings, key)
const ntFeature = key => (S, c) => (c.ntSettings ? c.ntSettings[key] === true : null)
export const SEARCH = [
  // Root
  { page: null, title: 'Sync now', icon: 'reset', tint: 'var(--acc)', kw: 'server sync upload refresh status connection nutrition', when: c => !!c.user && !c.demo && c.synced },
  { page: null, title: 'Sign out', icon: 'signOut', tint: 'var(--red)', kw: 'log out logout sign out', when: signedInWeb },
  { page: null, title: 'Disconnect', icon: 'signOut', tint: 'var(--red)', kw: 'disconnect server local log out', when: c => c.mobile && !!c.user },
  // Appearance
  { page: 'appearance', title: 'Theme', icon: 'moon', tint: 'var(--indigo)', kw: 'dark mode light mode theme appearance night look', opts: ['Dark', 'Light', 'System'] },
  { page: 'appearance', title: 'Accent color', icon: 'palette', tint: 'var(--purple)', kw: 'color colour accent tint custom own picker hex rgb', opts: [...Object.values(ACCENT_NAMES), 'Your own color'], tkw: () => t('custom color picker') },
  { page: 'appearance', title: 'Body diagram', icon: 'figureStrength', tint: 'var(--teal)', kw: 'muscle map body male female', opts: ['Male', 'Female'] },
  { page: 'appearance', title: 'Exercise drawings', icon: 'figureStrength', tint: 'var(--teal)', kw: 'figure male female woman man picture', opts: ['Male', 'Female'] },
  { page: 'appearance', title: 'Reduce motion', icon: 'minimize', tint: 'var(--blue)', kw: 'animation motion transitions accessibility calm', feature: (S, c) => !!c.systemMotion || S.reduceMotion === true },
  { page: 'appearance', title: 'Gym check-in', icon: 'qr', tint: 'var(--blue)', kw: 'qr code membership card check in barcode' },
  { page: 'appearance', title: 'Body weight', icon: 'scale', tint: 'var(--green)', kw: 'weight card home' },
  { page: 'appearance', title: 'Show connection status', icon: 'cloud', tint: 'var(--blue)', kw: 'sync offline banner bar connection', when: c => !c.demo },
  // Features (the NutriTrace switches whose only home is here)
  { page: 'features', title: 'Fasting', icon: 'timer', tint: 'var(--indigo)', kw: 'fast fasting intermittent 16:8 omad', when: c => !!c.nutrition, feature: (S, c) => !!c.fastingOn },
  // Diary & meals
  { page: 'diary', title: 'Show macro summary', icon: 'chart', tint: 'var(--teal)', kw: 'protein carbs fat bar meal card diary home', when: ntOn },
  { page: 'diary', title: 'Show brand names', icon: 'apple', tint: 'var(--green)', kw: 'brand diary food row home', when: ntOn },
  { page: 'diary', title: 'Show time logged', icon: 'clock', tint: 'var(--purple)', kw: 'timestamp time diary food row home', when: ntOn, feature: ntFeature('diaryShowTimestamps') },
  { page: 'diary', title: 'Ask for quantity when adding', icon: 'plusCircle', tint: 'var(--green)', kw: 'prompt portion quantity servings add food diary', when: ntOn },
  { page: 'diary', title: 'Quantity starts in', icon: 'pencil', tint: 'var(--blue)', kw: 'default field cursor servings portion add food', opts: ['Number of servings', 'Serving size'], when: ntOn },
  { page: 'diary', title: 'Show quick calories', icon: 'bolt', tint: 'var(--yellow)', kw: 'quick calories kcal calorie only entry bolt', when: ntOn },
  { page: 'diary', title: 'Quick calories shown', icon: 'list', tint: 'var(--indigo)', kw: 'quick calories summed separate rows', opts: ['Added into one row', 'One row each'], when: ntOn },
  { page: 'diary', title: 'Show activity under meals', icon: 'flame', tint: 'var(--orange)', kw: 'activity workouts burned exercise calories diary', when: ntOn, feature: ntFeature('diaryShowActivity') },
  { page: 'diary', title: 'Wearable and manual entries', icon: 'swap', tint: 'var(--indigo)', kw: 'activity policy wearable manual fitbit garmin both additive', opts: ['Wearable wins', 'Manual wins', 'Add them'], when: c => ntOn(c) && ntValue(c, 'diaryShowActivity') === true && c.ntSettings?.calorieAdjustFromActivity === true },
  { page: 'diary', title: 'Default fasting plan', icon: 'timer', tint: 'var(--indigo)', kw: 'fasting default plan goal hours', opts: ['14:10', '16:8', '18:6', '20:4', 'OMAD'], when: c => !!c.nutrition && !!c.fastingOn },
  { page: 'diary', title: 'Add a meal', icon: 'plusCircle', tint: 'var(--green)', kw: 'meal names rename reorder breakfast lunch dinner snacks', when: c => ntOn(c) && (c.ntSettings?.mealNames?.length ?? 4) < MEAL_NAMES_MAX },
  // Water
  { page: 'water', title: 'Water unit', icon: 'droplet', tint: 'var(--blue)', kw: 'water unit ml oz liters gallons', opts: ['Milliliters (ml)', 'Fluid ounces (fl oz)', 'Liters (L)', 'Gallons (G)'], when: ntOn },
  { page: 'water', title: 'Show water in the diary', icon: 'utensils', tint: 'var(--orange)', kw: 'water card diary hide', when: ntOn },
  { page: 'water', title: 'Show water in statistics', icon: 'chart', tint: 'var(--teal)', kw: 'water statistics trends hide', when: ntOn },
  { page: 'water', title: 'Add a container', icon: 'plusCircle', tint: 'var(--green)', kw: 'water container bottle glass cup quick add volume', when: ntOn },
  // Foods & scanning
  { page: 'foods', title: 'Show categories', icon: 'list', tint: 'var(--indigo)', kw: 'foods list category row', when: ntOn },
  { page: 'foods', title: 'Show category labels', icon: 'flag', tint: 'var(--orange)', kw: 'foods list category emoji label row', when: ntOn },
  { page: 'foods', title: 'Show notes', icon: 'note', tint: 'var(--blue)', kw: 'foods list notes row', when: ntOn },
  { page: 'foods', title: 'Search in', icon: 'magnifier', tint: 'var(--blue)', kw: 'default source search foods open food facts usda', opts: ['All sources', 'Your foods', 'Open Food Facts'], when: ntOn },
  { page: 'foods', title: 'Foods order', icon: 'apple', tint: 'var(--green)', kw: 'sort order foods favorites alphabetical recent most used', opts: ['A to Z', 'Most recent', 'Most used'], when: ntOn },
  { page: 'foods', title: 'Meals order', icon: 'utensils', tint: 'var(--orange)', kw: 'sort order meals alphabetical recent most used', opts: ['A to Z', 'Most recent', 'Most used'], when: ntOn },
  { page: 'foods', title: 'Recipes order', icon: 'cookingPot', tint: 'var(--red)', kw: 'sort order recipes alphabetical recent most used', opts: ['A to Z', 'Most recent', 'Most used'], when: ntOn },
  { page: 'foods', title: 'Beep when a barcode scans', icon: 'speaker', tint: 'var(--pink)', kw: 'barcode scanner sound beep camera scan', when: ntOn, feature: ntFeature('barcodeBeep') },
  // Food sources
  { page: 'sources', title: 'Search Open Food Facts', icon: 'globe', tint: 'var(--teal)', kw: 'off open food facts online database barcode lookup source', when: ntOn },
  { page: 'sources', title: 'Search language', icon: 'chat', tint: 'var(--blue)', kw: 'open food facts language results', when: c => ntOn(c) && ntValue(c, 'offEnabled') === true },
  { page: 'sources', title: 'Search country', icon: 'flag', tint: 'var(--orange)', kw: 'open food facts country region results', when: c => ntOn(c) && ntValue(c, 'offEnabled') === true },
  // Categories, units
  { page: 'categories', title: 'Add a category', icon: 'plusCircle', tint: 'var(--green)', kw: 'food category emoji label dairy proteins', when: ntOn },
  { page: 'customUnits', title: 'Add a custom unit', icon: 'plusCircle', tint: 'var(--green)', kw: 'custom unit shot scoop stick serving abbreviation', when: ntOn },
  // Units & language
  { page: 'units', title: 'Language', icon: 'globe', tint: 'var(--blue)', kw: 'language translation idioma sprache langue lingua' },
  { page: 'units', title: 'English exercise names', icon: 'globe', tint: 'var(--purple)', kw: 'exercise names english translation', when: c => c.nameLang },
  { page: 'units', title: 'English names only', icon: 'globe', tint: 'var(--purple)', kw: 'exercise names english translation', when: c => c.nameLang, feature: (S, c) => S.enOnly?.[c.baseLang] === true },
  { page: 'units', title: 'Weight unit', icon: 'scale', tint: 'var(--teal)', kw: 'kg lb lbs pounds kilos kilograms unit' },
  { page: 'units', title: 'Weight decimals', icon: 'ruler', tint: 'var(--teal)', kw: 'decimals precision microplates rounding' },
  { page: 'units', title: 'Speed unit', icon: 'figureRun', tint: 'var(--teal)', kw: 'speed mph kmh km/h miles cardio' },
  { page: 'units', title: '1RM formula', icon: 'chart', tint: 'var(--teal)', kw: '1rm one rep max epley brzycki lombardi formula estimate' },
  // Notifications
  { page: 'notifications', title: PUSH, icon: 'bell', tint: 'var(--red)', kw: 'push notification alerts delivery', when: c => !c.mobile && !!c.user && c.pushOK, feature: () => null },
  { page: 'notifications', title: 'Workout day reminder', icon: 'calendar', tint: 'var(--orange)', kw: 'reminder notification remind', when: remind, via: PUSH, feature: S => !!S.reminder?.on },
  { page: 'notifications', title: 'Reminder time', icon: 'clock', tint: 'var(--purple)', kw: 'reminder time clock hour when', when: c => remind(c) && c.reminderOn, via: PUSH },
  { page: 'notifications', title: 'Nudge me when I skip a planned workout', icon: 'bell', tint: 'var(--red)', kw: 'nudge skip missed motivation', when: c => remind(c) && c.reminderOn, via: PUSH, feature: S => !!S.reminder?.nudge },
  { page: 'notifications', title: 'Nudge tone', icon: 'chat', tint: 'var(--blue)', kw: 'nudge tone friendly guilt drill sergeant', opts: ['Friendly', 'Guilt trip', 'Drill sergeant'], when: c => remind(c) && c.reminderOn && c.nudge, via: PUSH },
  { page: 'notifications', title: 'Send test notification', icon: 'bell', tint: 'var(--red)', kw: 'test push notification try', when: c => !c.mobile && c.pushOK, via: PUSH },
  // Workout
  { page: 'workout', title: 'Rest timer', icon: 'timer', tint: 'var(--orange)', kw: 'rest pause break seconds minutes timer countdown' },
  { page: 'workout', title: 'Rest-pause rest', icon: 'bolt', tint: 'var(--orange)', kw: 'burst cluster rest pause' },
  { page: 'workout', title: 'Effort per set', icon: 'gauge', tint: 'var(--purple)', kw: 'rir rpe effort reps in reserve difficulty', opts: ['RIR', 'RPE'] },
  { page: 'workout', title: 'Shown under each exercise', icon: 'history', tint: 'var(--blue)', kw: 'last time best set reference previous', opts: ['Last time', 'Best set'] },
  { page: 'workout', title: 'Layout', icon: 'layout', tint: 'var(--blue)', kw: 'workout view cards list compact', opts: ['Cards', 'List', 'Compact'] },
  { page: 'workout', title: 'Collapse completed exercises', icon: 'minimize', tint: 'var(--teal)', kw: 'collapse fold minimize hide done finished completed exercises list compact remaining left to do', feature: S => !!S.collapseCompleted },
  { page: 'workout', title: 'Weigh in before workouts', icon: 'scale', tint: 'var(--green)', kw: 'body weight weigh scale start', feature: S => S.weighIn !== false },
  { page: 'workout', title: 'Keep screen awake', icon: 'phoneScreen', tint: 'var(--yellow)', kw: 'wake lock screen sleep display on', when: c => c.wakeOK || !c.mobile },
  { page: 'workout', title: 'Exercise animations', icon: 'image', tint: 'var(--teal)', kw: 'gif animation video media pictures images', opts: ['Full', 'Small', 'Hidden'] },
  // Fine-tuning
  { page: 'advanced', title: 'Planned sessions start from', icon: 'clipboard', tint: 'var(--green)', kw: 'start from plan last session reps carry over', opts: ['Your plan', 'Your last session'] },
  { page: 'advanced', title: 'Keep timing after target', icon: 'stopwatch', tint: 'var(--orange)', kw: 'timed set overtime hold duration', feature: S => !!S.timedSetOvertime },
  { page: 'advanced', title: 'Weight and reps buttons', icon: 'plusCircle', tint: 'var(--green)', kw: 'steppers plus minus buttons workout controls' },
  { page: 'advanced', title: 'Drop and burst shortcuts on every set', icon: 'bolt', tint: 'var(--orange)', kw: 'drop set burst shortcuts workout controls', feature: S => workoutControls(S).setShortcuts },
  { page: 'advanced', title: 'Swipe actions', icon: 'swap', tint: 'var(--indigo)', kw: 'swipe gesture slide delete remove copy duplicate set routine loop plan workout controls', tkw: () => t('swipe gesture') },
  { page: 'advanced', title: 'Exercise chips at the top', icon: 'more', tint: 'var(--mint)', kw: 'chips dots overview progress jump navigate exercise list workout controls' },
  { page: 'advanced', title: 'Superset buttons in the exercise header', icon: 'link', tint: 'var(--blue)', kw: 'superset pair workout controls', feature: S => workoutControls(S).pairButtons },
  { page: 'advanced', title: 'Move, swap and remove buttons below the exercise', icon: 'swap', tint: 'var(--teal)', kw: 'move swap remove replace workout controls', feature: S => workoutControls(S).exerciseButtons },
  // Timer alerts
  { page: 'alerts', title: 'Play a sound', icon: 'speaker', tint: 'var(--pink)', kw: 'sound sounds audio beep chime volume' },
  { page: 'alerts', title: 'Sound', icon: 'bell', tint: 'var(--pink)', kw: 'classic timer sound beep chime tone bell whistle soft ringtone custom rest end', opts: ['Chime (louder)', 'Classic beeps', 'Bell', 'Beep-beep', 'Whistle', 'Soft'], when: c => c.sound },
  { page: 'alerts', title: 'Play even on silent', icon: 'speaker', tint: 'var(--orange)', kw: 'silent mute ring switch iphone music', when: c => c.sound && c.playOnSilent, feature: S => !!S.soundOnSilent },
  { page: 'alerts', title: 'Vibrate', icon: 'vibrate', tint: 'var(--indigo)', kw: 'vibrate vibration haptic haptics buzz' },
  { page: 'alerts', title: 'Vibrate on silent too', icon: 'vibrate', tint: 'var(--indigo)', kw: 'alarm silent vibrate android', when: c => c.mobile && c.android && c.canVibrate && c.vibrate, feature: S => !!S.vibrateOnSilent },
  { page: 'alerts', title: 'Flash the screen', icon: 'sun', tint: 'var(--yellow)', kw: 'flash light blink screen', feature: S => !!S.timerFlash },
  // Schedule defaults
  { page: 'schedule', title: 'How you train', icon: 'repeat', tint: 'var(--orange)', kw: 'scheduling schedule rotation fixed week split loop round cycle plan', opts: ['Fixed Week', 'Rotation'] },
  { page: 'schedule', title: 'Week starts on', icon: 'calendar', tint: 'var(--orange)', kw: 'monday sunday first day week', opts: ['Monday', 'Sunday'], tkw: () => t('week start') },
  { page: 'schedule', title: 'Load starter plan', icon: 'clipboard', tint: 'var(--green)', kw: 'starter template beginner program routine' },
  // Equipment
  { page: 'equipment', title: 'Plates', icon: 'plate', tint: 'var(--orange)', kw: 'plates bar plate math barbell' },
  { page: 'equipment', title: 'Dumbbells', icon: 'dumbbell', tint: 'var(--teal)', kw: 'dumbbells dumbbell rack inventory adjustable weights own home gym' },
  { page: 'equipment', title: 'Filter by equipment', icon: 'kettlebell', tint: 'var(--green)', kw: 'equipment filter home gym', when: c => c.profiles, feature: S => !!S.equipFilterOn },
  { page: 'equipment', title: 'Active profile', icon: 'house', tint: 'var(--blue)', kw: 'equipment profile home gym', when: c => c.profiles },
  { page: 'equipment', title: 'Add equipment profile', icon: 'plusCircle', tint: 'var(--green)', kw: 'equipment profile home gym hotel' },
  // Backup
  { page: 'backup', title: 'Export backup (JSON)', icon: 'share', tint: 'var(--blue)', kw: 'export backup json download save data' },
  { page: 'backup', title: 'Export with photos & videos (.zip)', icon: 'share', tint: 'var(--blue)', kw: 'zip media export backup', when: c => c.hasMedia },
  { page: 'backup', title: 'Auto-backup on changes', icon: 'folder', tint: 'var(--blue)', kw: 'auto backup automatic', when: c => c.mobile, feature: S => !!S.autoBackup },
  { page: 'backup', title: 'Backup folder', icon: 'folder', tint: 'var(--blue)', kw: 'auto backup folder location directory', when: c => c.mobile && c.android && c.autoBackup },
  { page: 'backup', title: 'Import backup', icon: 'download', tint: 'var(--teal)', kw: 'import restore backup json zip' },
  // Import
  { page: 'import', title: 'Import from another app', icon: 'download', tint: 'var(--teal)', kw: 'strong hevy fitnotes apple health csv import' },
  { page: 'import', title: 'Import from Hevy', icon: 'key', tint: 'var(--teal)', kw: 'hevy api import' },
  // Connected apps & health
  { page: 'health', title: 'Write to Health Connect', icon: 'heart', tint: 'var(--red)', kw: 'health connect android google fit share workouts weigh-ins', feature: () => null },
  // Danger zone
  { page: 'danger', title: 'Reset training data', icon: 'trash', tint: 'var(--red)', kw: 'delete wipe reset erase clear everything' },
  // About & updates
  { page: 'about', title: 'Check for updates', icon: 'download', tint: 'var(--green)', kw: 'update apk android version', when: c => c.mobile && c.android },
  { page: 'about', title: 'Version', icon: 'info', tint: 'var(--grey)', kw: 'version about licence license source code open source' },
  { page: 'about', title: 'In Chrome: ⋮ menu → Add to Home screen', icon: 'share', tint: 'var(--blue)', kw: 'install app home screen tip pwa', when: c => c.installTip && c.androidWeb },
  { page: 'about', title: 'In Safari: Share → Add to Home Screen', icon: 'share', tint: 'var(--blue)', kw: 'install app home screen tip pwa', when: c => c.installTip && !c.androidWeb },
  // Licences
  { page: 'licences', title: 'Full licence text', icon: 'bookOpen', tint: 'var(--grey)', kw: 'licence license agpl copyright warranty notices open source credits' },
  // Account
  { page: 'account', title: 'Passkeys', icon: 'fingerprint', tint: 'var(--acc)', kw: 'passkey security login', when: signedInWeb },
  { page: 'account', title: 'Add another device', icon: 'qr', tint: 'var(--blue)', kw: 'device link code phone computer', when: signedInWeb },
  { page: 'account', title: 'Pair the mobile app', icon: 'qr', tint: 'var(--blue)', kw: 'pair phone app android iphone', when: signedInWeb },
  { page: 'account', title: 'Password', icon: 'key', tint: 'var(--orange)', kw: 'password login', when: c => signedInWeb(c) && c.pwOn },
  { page: 'account', title: 'Sign out everywhere', icon: 'shield', tint: 'var(--red)', kw: 'log out all devices sessions', when: signedInWeb },
  { page: 'account', title: 'Account ID', icon: 'personCircle', tint: 'var(--grey)', kw: 'id uid admin account', when: c => !!c.user && !c.demo },
  { page: 'account', title: 'Connect to my server', icon: 'cloud', tint: 'var(--indigo)', kw: 'server sync self-hosted connect', when: c => c.mobile && !c.user },
  { page: 'account', title: 'Sign in with passkey', icon: 'fingerprint', tint: 'var(--blue)', kw: 'login sign in log in passkey', when: c => !c.mobile && !c.demo && !c.user && c.webauthn },
  { page: 'account', title: 'Sign in with password', icon: 'key', tint: 'var(--orange)', kw: 'login sign in log in password', when: c => !c.mobile && !c.demo && !c.user && c.pwOn },
  { page: 'account', title: 'Create passkey profile', icon: 'plusCircle', tint: 'var(--acc)', kw: 'register account sign up create profile', when: c => !c.mobile && !c.demo && !c.user && c.webauthn },
  { page: 'account', title: 'Reset demo data', icon: 'reset', tint: 'var(--blue)', kw: 'demo reset example', when: c => c.demo },
]

/** Features (§5, §9 q12): the off-by-default switches this device and profile have, each where
 *  its own row would show. A switch whose home is the Features page itself (Fasting) is left out:
 *  Features draws it as a switch of its own. */
export function featuresFor(ctx) {
  return SEARCH.filter(e => e.feature && e.page !== 'features' && pageVisible(e.page, ctx) && (!e.when || e.when(ctx)))
}

// Lower case, accents and other marks dropped, so "théme", "Thème" and "theme" meet.
export const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const WORD_CHAR = /[\p{L}\p{N}]/u
const atWordStart = (hay, w) => {
  for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + 1)) if (i === 0 || !WORD_CHAR.test(hay[i - 1])) return true
  return false
}

/** The trail a hit names under its title: the page, or Profile for a row on the root. */
export function pageTrail(page, tr = t) {
  if (page == null) return tr('Profile')
  return PAGES[page] ? tr(PAGES[page].title) : ''
}

/**
 * Settings rows matching a query, best first: every word of the query has to appear in the
 * row's title, its page, or its extra words (in English and in the app's language). A title
 * that starts with the query ranks first, then a title containing it, then the rest. Pages
 * themselves are hits too ("units" finds Units & language).
 */
export function searchSettings(query, ctx, tr = t) {
  const words = fold(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const q = words.join(' ')
  const hits = []
  const consider = (entry, isPage) => {
    const title = tr(entry.title)
    const opts = entry.opts || []
    // What the screen says, in the app's language: anywhere in a word, since German and others
    // build long compounds ("Wochenstart", "Pausentimer").
    const own = fold([title, ...opts.map(o => tr(o)), entry.tkw ? entry.tkw() : '', isPage ? '' : pageTrail(entry.page, tr)].join(' '))
    // The English words behind it: only from the start of a word, so a "ton" typed in German
    // does not find "buttons".
    const en = fold([entry.title, entry.kw || '', ...opts, isPage || entry.page == null ? '' : PAGES[entry.page].title].join(' '))
    if (!words.every(w => own.includes(w) || atWordStart(en, w))) return
    const ft = fold(title)
    const rank = ft.startsWith(q) ? 0 : ft.includes(q) ? 1 : isPage ? 2 : 3
    hits.push({ ...entry, label: title, trail: isPage ? tr('Profile') : pageTrail(entry.page, tr), isPage, rank })
  }
  for (const id of PAGE_IDS) {
    if (!pageVisible(id, ctx)) continue
    consider({ page: id, title: PAGES[id].title, icon: PAGES[id].icon, tint: PAGES[id].tint, kw: PAGES[id].kw }, true)
  }
  for (const e of SEARCH) {
    if (!pageVisible(e.page, ctx)) continue
    if (e.when && !e.when(ctx)) continue
    consider(e, false)
  }
  return hits.sort((a, b) => a.rank - b.rank)
}
