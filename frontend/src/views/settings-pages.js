// Settings (v1.3.11): which page each row lives on, and the index the search field reads.
//
// The root holds the account card and a row per page in four groups (ROOT_GROUPS); each opens a page at
// /settings/<page>. Rare things hang one level further down (Workout → Fine-tuning). Titles here
// are the English keys the pages render with t(), so a search hit can find its row on the page
// by the same text and flash it (views/Settings.jsx). settings-pages.test.jsx renders every page
// and checks that each entry below really is a row there.
import { t } from '../lib/i18n.js'
import { ACCENT_NAMES } from '../lib/format.js'
import { MODULES } from '../lib/modules.js'
import { OFFLINE_OFF_MODULES } from '../lib/build-caps.js'
import { available, shownThemes } from '../lib/seasonal.js'

// `mod`: the module (lib/modules.js) a page belongs to; with it off the page and its rows are gone,
// from the root and from the search alike (pageVisible, searchSettings).
export const PAGES = {
  // Settings → Modules (v1.4.4): whole feature areas on and off (views/Modules.jsx).
  modules: { title: 'Modules', icon: 'grid', tint: 'var(--blue)', kw: 'modules features plugins extras enable disable turn on off hide simplify lean minimal clutter just training everything preset' },
  workout: { title: 'Workout', icon: 'play', tint: 'var(--green)' },
  alerts: { title: 'Timer alerts', icon: 'speaker', tint: 'var(--pink)' },
  reminders: { title: 'Reminders', icon: 'bell', tint: 'var(--red)', kw: 'reminder notification sound tone ringtone' },
  plan: { title: 'Plan & schedule', icon: 'calendar', tint: 'var(--orange)' },
  units: { title: 'Units & language', icon: 'ruler', tint: 'var(--teal)' },
  equipment: { title: 'Equipment', icon: 'kettlebell', tint: 'var(--indigo)' },
  look: { title: 'Look & Home', icon: 'palette', tint: 'var(--purple)' },
  coach: { title: 'AI Coach', icon: 'sparkles', tint: 'var(--green)', mod: 'coach' },
  // The phones' watch pages under one row (#1105); the web has Zepp only, so its row stays on the root.
  watches: { title: 'Watches', icon: 'watch', tint: 'var(--grey)', mod: 'watch', kw: 'watch watches apple garmin zepp amazfit wrist pair' },
  watch: { title: 'Apple Watch', icon: 'watch', tint: 'var(--grey)', mod: 'watch', parent: 'watches' },
  // Settings → Integrations (v1.4.4): the directory of what openGym talks to (views/Integrations.jsx).
  integrations: { title: 'Integrations', icon: 'plug', tint: 'var(--indigo)', kw: 'integrations connect apps services webhook webhooks home assistant n8n ntfy node-red zapier automation garmin fitbit strava opennutrition nutrition calories sync api mcp' },
  // The Garmin link (docs/GARMIN.md, views/GarminSettings.jsx): the phone apps only.
  // The Android app: the Wear OS watch app is its own package next to it (views/WearSettings.jsx).
  wear: { title: 'Wear OS watch', icon: 'watch', tint: 'var(--grey)', mod: 'watch', parent: 'watches', kw: 'wear os wearos galaxy watch pixel watch samsung oneplus ticwatch fossil pair pairing connect sync wrist' },
  garmin: { title: 'Garmin', icon: 'watch', tint: 'var(--blue)', mod: 'watch', parent: 'watches', kw: 'garmin connect iq forerunner fenix epix venu vivoactive instinct enduro marq watch pair' },
  zepp: { title: 'Zepp OS watch', icon: 'watch', tint: 'var(--orange)', mod: 'watch' },
  data: { title: 'Data & backup', icon: 'folder', tint: 'var(--blue)' },
  about: { title: 'About & updates', icon: 'info', tint: 'var(--grey)' },
  // The phone app's own list of what it sent where this session (lib/net-log.js, views/NetworkLog.jsx).
  network: { title: 'Network log', icon: 'shield', tint: 'var(--green)', parent: 'about', kw: 'network log requests privacy internet offline connections traffic tracking telemetry data sent who what' },
  account: { title: 'Account', icon: 'personCircle', tint: 'var(--grey)' },
  advanced: { title: 'Fine-tuning', icon: 'wrench', tint: 'var(--grey)', parent: 'workout' },
  // The live workout widget (components/LiveWidgetSettings.jsx, lib/live-glance.js, v1.4.5).
  live: { title: 'Live widget', icon: 'layout', tint: 'var(--green)', parent: 'workout', kw: 'live widget activity live activities lock screen dynamic island notification live update buttons customise customize personalise personalize rir weight reps heart rate calories next exercise rest off not showing try' },
  'live-custom': { title: 'Per exercise type', icon: 'slider', tint: 'var(--grey)', parent: 'live', kw: 'live widget per exercise type strength bands holds cardio carries details buttons' },
  // How the spoken cues sound (components/VoiceSettings.jsx, v1.4.5).
  voice: { title: 'Voice', icon: 'chat', tint: 'var(--teal)', parent: 'alerts', kw: 'voice voices speak speech tts spoken cues style hype drill sergeant calm deadpan lines clip record recording microphone pitch speed speaker person accent male female' },
  // Trainers and gyms (TRAINERS=on on the server, docs/TRAINERS.md): who sees what of your training.
  // Settings → Integrations → API tokens (docs/API_TOKENS.md): scoped tokens for MCP and scripts.
  'api-tokens': { title: 'API tokens', icon: 'key', tint: 'var(--purple)', parent: 'integrations', mod: 'integrations', kw: 'api token tokens key mcp claude chatgpt cursor assistant planner script access revoke' },
  trainer: { title: 'Trainer & gym', icon: 'personCircle', tint: 'var(--acc)', parent: 'account', kw: 'trainer coach personal trainer gym studio share sharing consent privacy disconnect code qr' },
  // Phone app only (#614): the gyms that get you a nudge when you arrive, the search that adds one
  // and the editor for one of them.
  gym: { title: 'Gym reminder', icon: 'mapPin', tint: 'var(--green)', parent: 'reminders', kw: 'gym location arrive geofence remind start' },
  'gym-find': { title: 'Add a gym', icon: 'plusCircle', tint: 'var(--green)', parent: 'gym' },
  'gym-edit': { title: 'Your gym', icon: 'mapPin', tint: 'var(--orange)', parent: 'gym' },
  // Seasonal themes (lib/seasonal.js), one section per theme.
  themes: { title: 'Seasonal themes', icon: 'pumpkin', tint: 'var(--orange)', parent: 'look', mod: 'seasonal' },
  // The phone's health store, one page per platform (until 1.4.4 a section of Data & backup).
  'apple-health': { title: 'Apple Health', icon: 'heart', tint: 'var(--red)', parent: 'integrations', mod: 'health', kw: 'apple health healthkit heart rate weight scale watch sync workouts' },
  'health-connect': { title: 'Health Connect', icon: 'heart', tint: 'var(--red)', parent: 'integrations', mod: 'health', kw: 'health connect google fit samsung fitbit garmin heart rate weight scale watch sync workouts' },
}
export const PAGE_IDS = Object.keys(PAGES)

// The root, top to bottom, under headings (#1105): what you change week to week, what you set once,
// what openGym talks to, then housekeeping. Whether a row shows is onRoot's call.
export const ROOT_GROUPS = [
  { title: 'Training', ids: ['workout', 'alerts', 'plan', 'reminders'] },
  { title: 'Set once', ids: ['units', 'equipment', 'look', 'modules'] },
  { title: 'Connections', ids: ['watches', 'zepp', 'integrations', 'coach'] },
  { ids: ['data', 'about'] },
]

export const WATCH_PAGES = ['watch', 'wear', 'garmin', 'zepp']

/** Whether a page has its own row on the root: Zepp sits inside Watches wherever Watches is. */
export const onRoot = (page, ctx) => pageVisible(page, ctx) && !(page === 'zepp' && pageVisible('watches', ctx))

/**
 * Whether a page exists for this device and profile. Reminders need a push server (signed in) or
 * the phone's own notifications; the Coach page is the phone's Coach setup (the web app's Coach
 * runs on the server, set up by its admin).
 */
export function pageVisible(page, ctx) {
  // A page of a module that is off (ctx.mod answers isOn for this profile; absent: all on).
  if (PAGES[page]?.mod && ctx.mod && !ctx.mod(PAGES[page].mod)) return false
  if (page === 'reminders') return !!(ctx.user || ctx.mobile)
  if (page === 'coach') return !!ctx.mobile && !ctx.offline
  // The phone app's network log: there only (a browser has its own developer tools for that).
  if (page === 'network') return !!ctx.mobile
  // openGym Offline (lib/build-caps.js) has no network: nothing that needs a server or a connection.
  if (ctx.offline && (page === 'zepp' || page === 'api-tokens' || page === 'trainer')) return false
  // Only on a server that offers trainers, signed in: there is nobody to share with otherwise.
  if (page === 'trainer') return !!ctx.trainers && !!ctx.user && !ctx.demo
  // Signed in to a server that offers scoped tokens (API_TOKENS, on unless switched off).
  if (page === 'api-tokens') return !!ctx.apiTokens && !!ctx.user && !ctx.demo
  // The phone apps' watch pages, together: there whenever one of them is.
  if (page === 'watches') return !!ctx.mobile && WATCH_PAGES.some(p => pageVisible(p, ctx))
  // The iPhone app only: the watch app ships inside it.
  if (page === 'watch') return !!ctx.ios
  // The Android app only. Every build has the page: the F-Droid one says why it has no watch link.
  if (page === 'wear') return !!ctx.mobile && !!ctx.android && !ctx.demo
  // The Garmin link lives in the phone apps (Connect IQ Mobile SDK); the page says when a build has none.
  if (page === 'garmin') return !!ctx.mobile && !ctx.demo
  // A Zepp OS watch reaches openGym through a server (lib/watch-relay.js). Signed in, the page pairs
  // one; a phone on its own gets the page too, saying why it needs a server and how to connect
  // (Discord, ravk_: on three Android phones the page was simply not there).
  if (page === 'zepp') return !ctx.demo && (!!ctx.user || !!ctx.mobile)
  // The phone app only: a browser cannot watch where you are with the page closed.
  if (page === 'gym' || page === 'gym-find' || page === 'gym-edit') return !!ctx.mobile && ctx.gymReminder !== false
  // The health store of the phone this runs on (unknown counts as yes, as for the watch).
  if (page === 'apple-health') return !!ctx.ios
  if (page === 'health-connect') return !!ctx.mobile && !!ctx.android
  return page in PAGES
}

// One entry per row. `kw` is extra words people search for (English; the translated title and
// page name are searched too). `opts` are the English labels of a segmented or picker row's
// choices, searched in both languages, so "Dunkel" finds Theme; `tkw` is a word in the app's own
// language for a row whose title does not say it ("Wochenstart"). `when` repeats the row's own visibility rule, so a search never
// offers a row the page would not show. The one rule a search cannot know in advance is whether
// this browser's push subscription is on (the server is asked when the page opens): those rows
// name `via`, the row the hit flashes instead when they turn out not to be there.
const signedInWeb = c => !!c.user && !c.mobile && !c.demo
// The reminder rows: the phone's own notifications, or web push where the browser has it.
const remind = c => !!c.mobile || !!c.pushOK
const PUSH = 'Push notifications'
// The words people use for each module (its row on Settings → Modules).
const MODULE_KW = {
  community: 'community library share shared server people upload others copy import',
  effort: 'effort rir rpe reps in reserve rating difficulty hard',
  plates: 'plates plate math calculator barbell load warm-up warmup ramp automatic',
  strength: 'strength level standards beginner intermediate advanced elite',
  videos: 'form video film record camera technique set',
  watch: 'watch apple watch wear os zepp amazfit garmin wrist',
  checkin: 'check in check-in qr code membership card barcode nfc sticker gym',
  body: 'body weight weigh-in weigh in scale measurements photos progress goal',
  health: 'health apple health healthkit health connect heart rate recovery sync',
  motivation: 'motivation streak challenges badges trophies recap wrapped year share gamification',
  coach: 'ai coach llm assistant review suggestions',
  integrations: 'integrations webhook webhooks home assistant n8n mcp automation',
  seasonal: 'seasonal season halloween theme decoration',
}
// The words for a theme that only exists in its own weeks (lib/seasonal.js `hidden`): outside
// December "christmas" or "advent" finds nothing at all.
const SEASON_KW = { christmas: 'christmas xmas advent calendar snow santa december' }
const seasonKw = () => shownThemes().map(th => SEASON_KW[th.id] || '').join(' ')
export const SEARCH = [
  // Modules
  ...MODULES.map(m => ({ page: 'modules', title: m.title, icon: m.icon, tint: m.tint,
    // Community is a row only where the server has a library (views/Modules.jsx).
    ...(m.id === 'community' ? { when: c => !!c.library } : {}),
    // Not built into openGym Offline at all (lib/build-caps.js).
    ...(OFFLINE_OFF_MODULES.includes(m.id) ? { net: true } : {}),
    get kw() { return MODULE_KW[m.id] + (m.id === 'seasonal' ? ' ' + seasonKw() : '') + ' module turn on off hide' } })),
  { page: 'modules', title: 'Start from', icon: 'slider', tint: 'var(--blue)', kw: 'preset just training body everything custom modules' },
  // Workout
  { page: 'workout', title: 'Automatic warm-ups', icon: 'sunrise', tint: 'var(--orange)', mod: 'plates', kw: 'warm-up warmup ramp automatic generator compounds' },
  { page: 'workout', title: 'Rest timer', icon: 'timer', tint: 'var(--orange)', kw: 'rest pause break seconds minutes timer countdown' },
  { page: 'workout', title: 'Rest-pause rest', icon: 'bolt', tint: 'var(--orange)', kw: 'burst cluster rest pause' },
  { page: 'workout', title: 'Rest between warm-ups', icon: 'timer', tint: 'var(--yellow)', kw: 'warm-up warmup ramp rest break timer shorter no rest' },
  { page: 'workout', title: 'Rest before the next exercise', icon: 'timer', tint: 'var(--teal)', kw: 'rest break next exercise transition machine walk switch change longer between exercises timer' },
  { page: 'workout', title: 'Effort per set', icon: 'gauge', tint: 'var(--purple)', mod: 'effort', kw: 'rir rpe effort reps in reserve difficulty', opts: ['RIR', 'RPE'] },
  { page: 'workout', title: 'Shown under each exercise', icon: 'history', tint: 'var(--blue)', kw: 'last time best set reference previous', opts: ['Last time', 'Best set'] },
  { page: 'workout', title: 'Compare sets with last time', icon: 'arrowUp', tint: 'var(--green)', kw: 'arrow trend last time previous better worse same set compare up down' },
  { page: 'workout', title: 'Record trophies', icon: 'trophy', tint: 'var(--yellow)', kw: 'record pr personal best trophy heaviest e1rm volume' },
  { page: 'workout', title: 'Cheer on a record', icon: 'bell', tint: 'var(--orange)', kw: 'record sound beep notes pr' },
  { page: 'workout', title: 'How close to a record', icon: 'target', tint: 'var(--blue)', kw: 'record hint percent e1rm reps close pr' },
  { page: 'workout', title: 'New exercises start with', icon: 'plus', tint: 'var(--green)', kw: 'new exercise default sets reps weight start added 3x10 2x8' },
  { page: 'workout', title: 'Live widget', icon: 'layout', tint: 'var(--green)', kw: 'live activity live activities lock screen dynamic island notification live update widget buttons heart rate next exercise rest customise customize personalise personalize off not showing try' },
  // The phone apps only: the help sheet of the live widget's page (components/LiveWidgetSettings.jsx).
  { page: 'live', title: 'Not showing up?', icon: 'info', tint: 'var(--grey)', kw: 'live widget live activities off not showing missing gone disappeared lock screen dynamic island notification permission allow help try', when: c => c.mobile },
  { page: 'workout', title: 'Layout', icon: 'layout', tint: 'var(--blue)', kw: 'workout view cards list compact', opts: ['Cards', 'List', 'Compact', 'Focus'] },
  { page: 'workout', title: 'Collapse completed exercises', icon: 'minimize', tint: 'var(--teal)', kw: 'collapse fold minimize hide done finished completed exercises list compact remaining left to do' },
  { page: 'workout', title: 'Skip completed exercises', icon: 'skipForward', tint: 'var(--teal)', kw: 'skip jump done finished completed exercises cards focus next previous' },
  { page: 'workout', title: 'Next exercise when the rest ends', icon: 'chevronRight', tint: 'var(--teal)', kw: 'auto advance next exercise automatically rest ends over hands free move on cards focus' },
  { page: 'workout', title: 'Start button', icon: 'play', tint: 'var(--green)', kw: 'start button pick choose routine workout long press today plan which', opts: ['Today’s plan', 'Let me pick'] },
  { page: 'workout', title: 'Preview before starting', icon: 'list', tint: 'var(--blue)', kw: 'preview look first before start routine exercises weights confirm' },
  { page: 'workout', title: 'Daily check-in', icon: 'moon', tint: 'var(--indigo)', mod: 'health', kw: 'check in checkin daily form readiness sleep energy soreness sore stress mood lighter deload tired how do you feel' },
  { page: 'workout', title: 'Weigh in before workouts', icon: 'scale', tint: 'var(--green)', mod: 'body', kw: 'body weight weigh scale start' },
  { page: 'workout', title: 'Keep screen awake', icon: 'phoneScreen', tint: 'var(--yellow)', kw: 'wake lock screen sleep display on', when: c => c.wakeOK || !c.mobile },
  { page: 'workout', title: 'Screen orientation', icon: 'phoneScreen', tint: 'var(--indigo)', kw: 'orientation rotate rotation portrait landscape lock auto-rotate sideways upright turn', opts: ['Follow phone', 'Portrait', 'Landscape'], when: c => c.android },
  { page: 'workout', title: 'Exercise animations', icon: 'image', tint: 'var(--teal)', kw: 'gif animation video media pictures images', opts: ['Full', 'Small', 'Hidden'] },
  { page: 'workout', title: 'Animation quality', icon: 'image', tint: 'var(--indigo)', kw: 'animation quality resolution sharp hd download pack still px', when: c => c.mobile },
  // Forgotten workouts (lib/forgotten-workout.js), the phone apps only.
  { page: 'workout', title: 'Ask “Still training?”', icon: 'clock', tint: 'var(--orange)', kw: 'forgotten forgot workout left running idle still training auto finish end automatically by itself stop timeout minutes', when: c => c.mobile, tkw: () => t('forgotten workout auto finish') },
  { page: 'workout', title: 'End by itself when I leave the gym', icon: 'mapPin', tint: 'var(--green)', kw: 'forgotten leave left gym geofence location auto finish end automatically', when: c => c.mobile },
  { page: 'workout', title: 'Time to answer', icon: 'timer', tint: 'var(--yellow)', kw: 'forgotten grace minutes answer auto finish', when: c => c.mobile },
  { page: 'workout', title: 'Fine-tuning', icon: 'wrench', tint: 'var(--grey)', kw: 'advanced more options' },
  // Fine-tuning
  { page: 'advanced', title: 'Deload weeks', icon: 'battery', tint: 'var(--indigo)', kw: 'deload deloading lighter easy week recover rhythm every weeks cycle' },
  { page: 'advanced', title: 'Suggest a deload when I need one', icon: 'sparkles', tint: 'var(--indigo)', kw: 'deload automatic suggest tired fatigue check-in performance' },
  { page: 'advanced', title: 'Default progression', icon: 'chartLine', tint: 'var(--blue)', kw: 'progression rule default linear off automatic weight increase', opts: ['No automatic progression', 'Linear progression', 'Greyskull LP', 'Double progression', 'Triple progression'] },
  { page: 'advanced', title: 'Planned sessions start from', icon: 'clipboard', tint: 'var(--green)', kw: 'start from plan last session reps carry over', opts: ['Your plan', 'Your last session'] },
  { page: 'advanced', title: 'Last time means', icon: 'history', tint: 'var(--indigo)', kw: 'last time previous session history routine workout across every any', opts: ['This routine', 'Any workout'] },
  { page: 'advanced', title: 'Keep timing after target', icon: 'stopwatch', tint: 'var(--orange)', kw: 'timed set overtime hold duration' },
  { page: 'advanced', title: 'Timed holds start by themselves', icon: 'timer', tint: 'var(--teal)', kw: 'timed hold plank automatic auto start countdown 3 2 1 hands free rounds' },
  { page: 'advanced', title: 'Weight and reps buttons', icon: 'plusCircle', tint: 'var(--green)', kw: 'steppers plus minus buttons workout controls' },
  { page: 'advanced', title: 'Drop and burst shortcuts on every set', icon: 'bolt', tint: 'var(--orange)', kw: 'drop set burst shortcuts workout controls' },
  { page: 'advanced', title: 'Swipe actions', icon: 'swap', tint: 'var(--indigo)', kw: 'swipe gesture slide delete remove copy duplicate set routine loop plan workout controls', tkw: () => t('swipe gesture') },
  { page: 'advanced', title: 'Exercise chips at the top', icon: 'more', tint: 'var(--mint)', kw: 'chips dots overview progress jump navigate exercise list workout controls' },
  { page: 'advanced', title: 'Muscle map at the top', icon: 'figureStrength', tint: 'var(--orange)', kw: 'muscle map body figure diagram workout header lights up workout controls' },
  { page: 'advanced', title: 'Superset buttons in the exercise header', icon: 'link', tint: 'var(--blue)', kw: 'superset pair workout controls' },
  { page: 'advanced', title: 'Move, swap and remove buttons below the exercise', icon: 'swap', tint: 'var(--teal)', kw: 'move swap remove replace workout controls' },
  // Timer alerts
  { page: 'alerts', title: 'Play a sound', icon: 'speaker', tint: 'var(--pink)', kw: 'sound sounds audio beep chime volume' },
  { page: 'alerts', title: 'Sound', icon: 'bell', tint: 'var(--pink)', kw: 'classic timer sound beep chime tone bell whistle soft ringtone custom rest end', opts: ['Chime (louder)', 'Classic beeps', 'Bell', 'Beep-beep', 'Whistle', 'Soft'], when: c => c.sound },
  { page: 'alerts', title: 'Play even on silent', icon: 'speaker', tint: 'var(--orange)', kw: 'silent mute ring switch iphone music', when: c => c.sound && c.playOnSilent },
  { page: 'alerts', title: 'Vibrate', icon: 'vibrate', tint: 'var(--indigo)', kw: 'vibrate vibration haptic haptics buzz' },
  { page: 'alerts', title: 'Vibrate on silent too', icon: 'vibrate', tint: 'var(--indigo)', kw: 'alarm silent vibrate android', when: c => c.mobile && c.android && c.canVibrate && c.vibrate },
  { page: 'alerts', title: 'Flash the screen', icon: 'sun', tint: 'var(--yellow)', kw: 'flash light blink screen' },
  { page: 'alerts', title: 'Spoken cues', icon: 'chat', tint: 'var(--teal)', kw: 'voice speak speech talk tts announce next set countdown read aloud audio' },
  { page: 'alerts', title: 'Voice', icon: 'chat', tint: 'var(--teal)', kw: 'voice voices speech style lines clips', when: c => c.spokenCues },
  // Timer alerts → Voice
  { page: 'voice', title: 'Speed', icon: 'gauge', tint: 'var(--teal)', kw: 'voice speed speech rate slow fast speaking rate' },
  { page: 'voice', title: 'Pitch', icon: 'speaker', tint: 'var(--teal)', kw: 'voice pitch high low deep' },
  { page: 'voice', title: 'Hype man', icon: 'chat', tint: 'var(--teal)', kw: 'style personality calm drill sergeant deadpan your own lines motivation shout' },
  { page: 'voice', title: 'Just the facts', icon: 'chat', tint: 'var(--teal)', kw: 'style plain short facts only' },
  { page: 'voice', title: 'Calm coach', icon: 'chat', tint: 'var(--teal)', kw: 'style calm gentle coach' },
  { page: 'voice', title: 'Drill sergeant', icon: 'chat', tint: 'var(--teal)', kw: 'style drill sergeant shout tough' },
  { page: 'voice', title: 'Deadpan', icon: 'chat', tint: 'var(--teal)', kw: 'style deadpan dry funny humour humor' },
  { page: 'voice', title: 'Your own lines', icon: 'chat', tint: 'var(--teal)', kw: 'style own lines custom write words' },
  { page: 'voice', title: 'When the rest is over', icon: 'bell', tint: 'var(--orange)', kw: 'moment lines clip record recording microphone own voice friend' },
  { page: 'voice', title: 'When a rest starts', icon: 'bell', tint: 'var(--orange)', kw: 'moment rest start lines clip recording own voice' },
  { page: 'voice', title: '10 seconds left', icon: 'bell', tint: 'var(--orange)', kw: 'moment countdown ten seconds left rest lines clip recording' },
  { page: 'voice', title: 'Before the last set', icon: 'bell', tint: 'var(--orange)', kw: 'moment last set final lines clip recording' },
  { page: 'voice', title: 'New record', icon: 'bell', tint: 'var(--orange)', kw: 'moment record pr personal best lines clip recording' },
  // Reminders
  { page: 'reminders', title: PUSH, icon: 'bell', tint: 'var(--red)', kw: 'push notification alerts', when: c => !c.mobile && !!c.user && c.pushOK },
  { page: 'reminders', title: 'Workout day reminder', icon: 'calendar', tint: 'var(--orange)', kw: 'reminder notification remind', when: remind, via: PUSH },
  { page: 'reminders', title: 'Reminder time', icon: 'clock', tint: 'var(--purple)', kw: 'reminder time clock hour when', when: c => remind(c) && c.reminderOn, via: PUSH },
  { page: 'reminders', title: 'Nudge me when I skip a planned workout', icon: 'bell', tint: 'var(--red)', kw: 'nudge skip missed motivation', when: c => remind(c) && c.reminderOn, via: PUSH },
  { page: 'reminders', title: 'Nudge tone', icon: 'chat', tint: 'var(--blue)', kw: 'nudge tone friendly guilt drill sergeant', opts: ['Friendly', 'Guilt trip', 'Drill sergeant'], when: c => remind(c) && c.reminderOn && c.nudge, via: PUSH },
  { page: 'reminders', title: 'Check-in reminders', icon: 'ruler', tint: 'var(--teal)', kw: 'measurement measure tape photo progress picture weigh weight blood pressure remind every two weeks', when: remind, via: PUSH },
  { page: 'reminders', title: 'Your year in openGym', icon: 'sparkles', tint: 'var(--acc)', mod: 'motivation', kw: 'year recap wrapped review december notification', when: remind, via: PUSH },
  { page: 'reminders', title: 'Gym reminder', icon: 'mapPin', tint: 'var(--green)', kw: 'gym location arrive arrival geofence place map nearby', when: c => !!c.mobile && c.gymReminder !== false },
  { page: 'reminders', title: 'Send test notification', icon: 'bell', tint: 'var(--red)', kw: 'test push notification try', when: c => !c.mobile && c.pushOK, via: PUSH },
  // Plan & schedule
  { page: 'plan', title: 'How you train', icon: 'repeat', tint: 'var(--orange)', kw: 'scheduling schedule rotation fixed week split loop round cycle', opts: ['Fixed Week', 'Rotation'] },
  { page: 'plan', title: 'Workouts per week', icon: 'target', tint: 'var(--green)', kw: 'target goal sessions per week rotation left countdown remaining', when: c => c.rotation },
  { page: 'plan', title: 'Week starts on', icon: 'calendar', tint: 'var(--orange)', kw: 'monday sunday first day week', opts: ['Monday', 'Sunday'], tkw: () => t('week start') },
  { page: 'plan', title: 'Weekly sets per muscle', icon: 'slider', tint: 'var(--teal)', kw: 'volume sets per week muscle target range mev mrv hypertrophy landmarks' },
  { page: 'plan', title: 'Load starter plan', icon: 'clipboard', tint: 'var(--green)', kw: 'starter template beginner program routine' },
  // Units & language
  { page: 'units', title: 'Language', icon: 'globe', tint: 'var(--blue)', kw: 'language translation idioma sprache langue lingua' },
  { page: 'units', title: 'English exercise names', icon: 'globe', tint: 'var(--purple)', kw: 'exercise names english translation', when: c => c.nameLang },
  { page: 'units', title: 'English names only', icon: 'globe', tint: 'var(--purple)', kw: 'exercise names english translation', when: c => c.nameLang },
  { page: 'units', title: 'Weight unit', icon: 'scale', tint: 'var(--teal)', kw: 'kg lb lbs pounds kilos kilograms unit' },
  { page: 'units', title: 'Weight decimals', icon: 'ruler', tint: 'var(--teal)', kw: 'decimals precision microplates rounding' },
  { page: 'units', title: 'Weight step', icon: 'steps', tint: 'var(--teal)', kw: 'step increment microplates 0.1 0.25 every exercise all exercises at once' },
  { page: 'units', title: 'Speed unit', icon: 'figureRun', tint: 'var(--teal)', kw: 'speed mph kmh km/h miles cardio' },
  { page: 'units', title: '1RM formula', icon: 'chart', tint: 'var(--teal)', kw: '1rm one rep max epley brzycki lombardi formula estimate' },
  { page: 'units', title: 'Daily weigh-in value', icon: 'scale', tint: 'var(--teal)', mod: 'body', kw: 'weigh-in body weight morning first average last several day trend chart', opts: ['Morning (first)', 'Average', 'Last'] },
  { page: 'units', title: 'About you', icon: 'person', tint: 'var(--teal)', mod: 'strength', kw: 'sex gender age year of birth born strength level standards' },
  { page: 'units', title: 'Count warm-ups in volume', icon: 'sunrise', tint: 'var(--teal)', kw: 'warm-up warmup volume tonnage total gross work sets' },
  { page: 'units', title: 'Count body weight in bodyweight lifts', icon: 'scale', tint: 'var(--teal)', kw: 'body weight bodyweight volume pull-up pullup dip push-up tonnage total' },
  // Equipment
  { page: 'equipment', title: 'Plates', icon: 'plate', tint: 'var(--orange)', kw: 'plates bar plate math barbell' },
  { page: 'equipment', title: 'Dumbbells', icon: 'dumbbell', tint: 'var(--teal)', kw: 'dumbbells dumbbell rack inventory adjustable weights own home gym' },
  { page: 'equipment', title: 'Your bars', icon: 'barbell', tint: 'var(--blue)', kw: 'bar barbell weight olympic short women 15 kg 35 lb ez trap smith plate math' },
  { page: 'equipment', title: 'Bench', icon: 'bench', tint: 'var(--purple)', kw: 'bench flat adjustable incline decline tilt' },
  { page: 'equipment', title: 'Resistance bands', icon: 'kettlebell', tint: 'var(--pink)', kw: 'band bands resistance colour color loop mini elastic red yellow green' },
  { page: 'equipment', title: 'Filter by equipment', icon: 'kettlebell', tint: 'var(--green)', kw: 'equipment filter home gym', when: c => c.profiles },
  { page: 'equipment', title: 'Active gym', icon: 'house', tint: 'var(--blue)', kw: 'equipment profile home gym switch plates dumbbells bars per gym location', when: c => c.profiles },
  { page: 'equipment', title: 'Add equipment profile', icon: 'plusCircle', tint: 'var(--green)', kw: 'equipment profile home gym hotel' },
  // Look & Home
  { page: 'look', title: 'Theme', icon: 'moon', tint: 'var(--indigo)', kw: 'dark mode light mode theme appearance night', opts: ['Dark', 'Light', 'System'] },
  { page: 'look', title: 'Accent color', icon: 'palette', tint: 'var(--purple)', kw: 'color colour accent tint custom own picker hex rgb', opts: [...Object.values(ACCENT_NAMES), 'Your own color'], tkw: () => t('custom color picker') },
  { page: 'look', title: 'Icons', icon: 'sparkles', tint: 'var(--orange)', kw: 'emoji icons flame medal snowflake pictures' },
  { page: 'look', title: 'Streak flame', icon: 'flame', tint: 'var(--orange)', mod: 'motivation', kw: 'streak flame fire icon emoji custom own symbol colour color' },
  { page: 'look', title: 'Sick and travel weeks', icon: 'cloud', tint: 'var(--indigo)', mod: 'motivation', kw: 'streak sick ill travel travelling holiday vacation injured excuse day note week' },
  { page: 'look', title: 'Streak freezes', icon: 'snowflake', tint: 'var(--teal)', mod: 'motivation', kw: 'streak freeze freezes rule strict gentle generous off missed week forgiving', opts: ['No freezes', 'Gentle', 'Generous'] },
  { page: 'look', title: 'Recovery counts for the streak', icon: 'sparkles', tint: 'var(--teal)', mod: 'motivation', kw: 'recovery sauna ice bath cold massage mobility streak count' },
  { page: 'look', title: 'Sport counts for the streak', icon: 'figureRun', tint: 'var(--blue)', mod: 'motivation', kw: 'sport activity run ride football tennis climbing match other streak count counts' },
  { page: 'look', title: 'Streak freeze', icon: 'snowflake', tint: 'var(--teal)', mod: 'motivation', kw: 'streak freeze snowflake icon emoji custom own symbol colour color' },
  { page: 'look', title: 'App icon', icon: 'grid', tint: 'var(--indigo)', kw: 'app icon home screen launcher logo dark light', when: c => !!c.appIcons },
  { page: 'look', title: 'Body diagram', icon: 'figureStrength', tint: 'var(--teal)', kw: 'muscle map body male female', opts: ['Male', 'Female'] },
  { page: 'look', title: 'Exercise drawings', icon: 'figureStrength', tint: 'var(--teal)', kw: 'figure male female woman man picture', opts: ['Male', 'Female'] },
  { page: 'look', title: 'Set up an NFC sticker', icon: 'nfc', tint: 'var(--blue)', mod: 'checkin', kw: 'nfc sticker tag tap check in start workout locker machine', when: c => !!c.nfc },
  { page: 'look', title: 'Body weight', icon: 'scale', tint: 'var(--green)', mod: 'body', kw: 'weight card home' },
  { page: 'look', title: 'Recovery tips', icon: 'figureStrength', tint: 'var(--green)', mod: 'health', kw: 'recovery recovering rest muscle fatigue hint tip card home sore' },
  { page: 'look', title: 'Week and month recap', icon: 'chart', tint: 'var(--purple)', mod: 'motivation', kw: 'recap summary weekly monthly report your week your month card home share' },
  { page: 'look', title: 'Weekly sets on Home', icon: 'figureStrength', tint: 'var(--teal)', kw: 'weekly sets muscle volume range home card line' },
  { page: 'look', title: 'Monthly challenges', icon: 'target', tint: 'var(--orange)', mod: 'motivation', kw: 'challenge challenges monthly month goal goals badge badges trophy motivation' },
  { page: 'look', title: 'Seasonal themes', icon: 'pumpkin', tint: 'var(--orange)', mod: 'seasonal', get kw() { return 'seasonal season holiday halloween theme decoration ' + seasonKw() } },
  // Seasonal themes
  { page: 'themes', title: 'Halloween', icon: 'pumpkin', tint: 'var(--orange)', kw: 'halloween seasonal theme spooky spider pumpkin bats witch october decoration', opts: ['Auto', 'On', 'Off'] },
  { page: 'themes', title: 'Also during workouts', icon: 'play', tint: 'var(--green)', kw: 'halloween seasonal workout training decoration' },
  { page: 'themes', title: 'Spooky colors', icon: 'palette', tint: 'var(--purple)', kw: 'halloween orange purple accent color colour seasonal' },
  { page: 'themes', title: 'Christmas', icon: 'gift', tint: 'var(--red)', kw: 'christmas xmas seasonal theme snow santa sleigh reindeer advent calendar december decoration on off', when: () => available('christmas') },
  { page: 'themes', title: 'Festive colors', icon: 'palette', tint: 'var(--purple)', kw: 'christmas red green accent color colour seasonal', when: () => available('christmas') },
  { page: 'look', title: 'Motion', icon: 'sparkles', tint: 'var(--teal)', kw: 'reduce motion animation animations accessibility calm still vestibular', opts: ['Like the phone', 'Less'] },
  { page: 'look', title: 'Text size', icon: 'note', tint: 'var(--blue)', kw: 'text size font fonts letters type typeface bigger larger smaller tiny huge big small scale dynamic accessibility zoom read reading eyes glasses', opts: ['Smallest', 'Small', 'Default', 'Large', 'Larger', 'Largest'], tkw: () => t('font text size bigger smaller letters') },
  { page: 'look', title: 'Show connection status', icon: 'cloud', tint: 'var(--blue)', kw: 'sync offline banner bar connection', when: c => !c.demo },
  // Data & backup
  { page: 'data', title: 'Export backup (JSON)', icon: 'share', tint: 'var(--blue)', kw: 'export backup json download save' },
  { page: 'data', title: 'Export with photos & videos (.zip)', icon: 'share', tint: 'var(--blue)', kw: 'zip media export backup', when: c => c.hasMedia },
  { page: 'data', title: 'Performance report (PDF)', icon: 'note', tint: 'var(--green)', kw: 'pdf print report performance progress summary charts export paper' },
  { page: 'data', title: 'Export as spreadsheet (CSV)', icon: 'share', tint: 'var(--green)', kw: 'csv spreadsheet excel sheets export workouts sets body weight measurements' },
  { page: 'data', title: 'Auto-backup on changes', icon: 'folder', tint: 'var(--blue)', kw: 'auto backup automatic', when: c => c.mobile },
  { page: 'data', title: 'Backup folder', icon: 'folder', tint: 'var(--blue)', kw: 'auto backup folder location directory', when: c => c.mobile && c.android && c.autoBackup },
  // The daily WebDAV backup (1.4.5, components/WebDavBackup.jsx): a row on the page, not in demo or Offline.
  { page: 'data', title: 'Back up to WebDAV', net: true, icon: 'cloud', tint: 'var(--blue)', kw: 'webdav nextcloud owncloud cloud backup daily automatic remote server', when: c => !c.demo },
  { page: 'data', title: 'Import backup', icon: 'download', tint: 'var(--teal)', kw: 'import restore backup json zip' },
  { page: 'data', title: 'Import from another app', icon: 'download', tint: 'var(--teal)', kw: 'strong hevy fitnotes gymmane apple health csv import' },
  { page: 'data', title: 'Import from Hevy', net: true, icon: 'key', tint: 'var(--teal)', kw: 'hevy api import' },
  { page: 'data', title: 'Photos & videos', icon: 'image', tint: 'var(--teal)', kw: 'media storage photos videos upload', when: c => c.hasMedia },
  { page: 'data', title: 'Delete workouts only', icon: 'trash', tint: 'var(--orange)', kw: 'delete workouts history log clear fresh start keep routines' },
  { page: 'data', title: 'Reset everything', icon: 'trash', tint: 'var(--red)', kw: 'delete wipe reset erase' },
  // Integrations: the cards (lib/integrations.js cardState says where each shows)
  { page: 'integrations', title: 'Apple Health', icon: 'heart', tint: 'var(--red)', mod: 'health', kw: 'apple health healthkit iphone heart rate watch', when: c => !c.mobile },
  { page: 'integrations', title: 'Health Connect', icon: 'heart', tint: 'var(--red)', mod: 'health', kw: 'health connect android google fit heart rate watch', when: c => !c.mobile },
  // The Apple Watch's Zones page takes the max heart rate from the age (#1108): on the iPhone, with the Watch module on.
  { page: 'apple-health', title: 'Birth date, for heart-rate zones', icon: 'heart', tint: 'var(--orange)', mod: 'watch', kw: 'birth date age zones heart rate max watch', when: c => c.ios },
  { page: 'integrations', title: 'Webhooks', net: true, icon: 'webhook', tint: 'var(--indigo)', mod: 'integrations', kw: 'webhook webhooks home assistant n8n ntfy node-red zapier ifttt automation notify', when: c => c.demo || !c.user || (c.integrations || []).includes('webhook') || !!c.user?.admin },
  { page: 'integrations', title: 'Hevy', net: true, icon: 'key', tint: 'var(--teal)', kw: 'hevy api key import', when: c => !c.demo },
  { page: 'integrations', title: 'Import a file', icon: 'download', tint: 'var(--teal)', kw: 'import strong fitnotes hevy csv gymmane apple health export file' },
  { page: 'integrations', title: 'Spreadsheet (CSV)', icon: 'share', tint: 'var(--green)', kw: 'csv spreadsheet excel export' },
  { page: 'integrations', title: 'MCP server', net: true, icon: 'plug', tint: 'var(--purple)', mod: 'integrations', kw: 'mcp claude desktop cursor llm agent ai model context protocol api' },
  { page: 'integrations', title: 'WebDAV backup', net: true, icon: 'cloud', tint: 'var(--blue)', kw: 'webdav nextcloud owncloud cloud backup daily automatic', when: c => !c.demo },
  { page: 'integrations', title: 'Calendar feed', net: true, icon: 'calendar', tint: 'var(--red)', mod: 'integrations', kw: 'calendar ics ical google outlook apple planned sessions feed subscribe', when: c => c.demo || !c.user || c.apiTokens },
  { page: 'integrations', title: 'AI Coach', net: true, icon: 'sparkles', tint: 'var(--green)', mod: 'coach', kw: 'ai coach model llm plan review', when: c => c.mobile },
  { page: 'integrations', mod: 'health', title: 'Garmin', icon: 'watch', tint: 'var(--grey)', kw: 'garmin fenix forerunner venu watch heart rate' },
  { page: 'integrations', mod: 'health', title: 'COROS', icon: 'watch', tint: 'var(--grey)', kw: 'coros watch heart rate' },
  { page: 'integrations', mod: 'health', title: 'Polar', icon: 'watch', tint: 'var(--grey)', kw: 'polar watch heart rate strap' },
  { page: 'integrations', mod: 'health', title: 'Fitbit', icon: 'watch', tint: 'var(--grey)', kw: 'fitbit pixel watch heart rate' },
  { page: 'integrations', mod: 'health', title: 'Samsung Health', icon: 'watch', tint: 'var(--grey)', kw: 'samsung galaxy watch health heart rate weight' },
  { page: 'integrations', mod: 'health', title: 'Oura', icon: 'ring', tint: 'var(--grey)', kw: 'oura ring heart rate' },
  { page: 'integrations', mod: 'health', title: 'Withings', icon: 'scale', tint: 'var(--grey)', kw: 'withings scale weight body' },
  { page: 'integrations', mod: 'health', title: 'Renpho', icon: 'scale', tint: 'var(--grey)', kw: 'renpho scale weight body' },
  // About & updates
  { page: 'about', title: 'Check for updates', net: true, icon: 'download', tint: 'var(--green)', kw: 'update apk android version', when: c => c.mobile && c.android },
  { page: 'about', title: 'Get the Android app', icon: 'download', tint: 'var(--green)', kw: 'apk android download app', when: c => !c.mobile },
  { page: 'about', title: 'Show the tour again', icon: 'lightbulb', tint: 'var(--yellow)', kw: 'tour tutorials intro introduction tutorial walkthrough guide help onboarding how to start' },
  { page: 'about', title: 'Build your first plan', icon: 'calendar', tint: 'var(--yellow)', kw: 'tutorial guide routine plan create first help how to' },
  { page: 'about', title: 'Create your own exercise', icon: 'plusCircle', tint: 'var(--yellow)', kw: 'tutorial guide custom exercise own new help how to' },
  { page: 'about', title: 'Edit your data', icon: 'pencil', tint: 'var(--yellow)', kw: 'tutorial guide edit fix change workout weigh-in history correct help how to' },
  { page: 'about', title: 'Export & import', icon: 'folder', tint: 'var(--yellow)', kw: 'tutorial guide export import backup restore csv strong hevy sync help how to' },
  { page: 'about', title: 'Version', icon: 'info', tint: 'var(--grey)', kw: 'version about licence license source code open source' },
  { page: 'about', title: 'In Chrome: ⋮ menu → Add to Home screen', icon: 'share', tint: 'var(--blue)', kw: 'install app home screen tip pwa', when: c => c.installTip && c.androidWeb },
  { page: 'about', title: 'In Safari: Share → Add to Home Screen', icon: 'share', tint: 'var(--blue)', kw: 'install app home screen tip pwa', when: c => c.installTip && !c.androidWeb && !c.desktopWeb },
  { page: 'about', title: 'In Chrome or Edge: the install icon in the address bar', icon: 'share', tint: 'var(--blue)', kw: 'install app home screen tip pwa desktop', when: c => c.installTip && c.desktopWeb },
  // Account
  { page: 'account', title: 'Sync now', net: true, icon: 'reset', tint: 'var(--acc)', kw: 'server sync upload refresh status connection', when: c => !!c.user && !c.demo && c.synced },
  { page: 'account', title: 'Cloudflare Access', net: true, icon: 'key', tint: 'var(--orange)', kw: 'cloudflare access zero trust service token header proxy', when: c => c.mobile && !!c.user && !c.demo && c.synced },
  { page: 'account', title: 'Passkeys', icon: 'fingerprint', tint: 'var(--acc)', kw: 'passkey security login', when: signedInWeb },
  { page: 'zepp', title: 'Pair a watch', net: true, icon: 'watch', tint: 'var(--orange)', kw: 'zepp amazfit watch pair balance gtr gts active t-rex bip cheetah falcon', when: c => !!c.user && !c.demo },
  { page: 'zepp', title: 'Connect to my server', net: true, icon: 'cloud', tint: 'var(--indigo)', kw: 'zepp server connect', when: c => !c.user },
  // Garmin
  { page: 'garmin', title: 'Send workouts to the watch', icon: 'watch', tint: 'var(--grey)', kw: 'garmin send workouts watch' },
  // Gym reminder: the page's own rule (pageVisible), since the search only asks about the parent.
  { page: 'gym', title: 'Only between certain hours', icon: 'clock', tint: 'var(--purple)', kw: 'gym reminder hours window quiet', when: c => c.mobile && c.gymReminder !== false },
  // Live widget (Lock Screen, Dynamic Island, Android notification, the strip in the workout)
  { page: 'live', title: 'Heart rate', icon: 'heart', tint: 'var(--red)', kw: 'live widget lock screen dynamic island notification heart rate bpm' },
  { page: 'live', title: 'What’s next', icon: 'chevronRight', tint: 'var(--blue)', kw: 'live widget lock screen dynamic island notification next set up coming' },
  { page: 'live', title: 'Time since start', icon: 'stopwatch', tint: 'var(--orange)', kw: 'live widget lock screen dynamic island notification clock elapsed time' },
  { page: 'live', title: 'Record hints', icon: 'trophy', tint: 'var(--yellow)', kw: 'live widget lock screen dynamic island notification record pr hint', when: c => c.recordHints !== false },
  { page: 'live', title: 'Calories', icon: 'flame', tint: 'var(--orange)', kw: 'live widget lock screen dynamic island notification calories kcal energy' },
  { page: 'live', title: 'Exercise picture', icon: 'image', tint: 'var(--teal)', kw: 'live widget lock screen dynamic island notification picture still image' },
  { page: 'live', title: 'Weight and reps', icon: 'slider', tint: 'var(--blue)', kw: 'live widget lock screen dynamic island notification buttons plus minus weight reps' },
  { page: 'live', title: '+15 s on rests', icon: 'timer', tint: 'var(--green)', kw: 'live widget lock screen dynamic island notification buttons rest longer add time', when: c => !c.android },
  { page: 'live', title: 'Next exercise', icon: 'skipForward', tint: 'var(--blue)', kw: 'live widget lock screen dynamic island notification buttons next exercise skip' },
  { page: 'live', title: 'Pause', icon: 'pause', tint: 'var(--grey)', kw: 'live widget lock screen dynamic island notification buttons pause workout' },
  { page: 'live', title: 'Show a strip in the workout', icon: 'phoneScreen', tint: 'var(--green)', kw: 'live widget lock screen dynamic island notification strip card in app workout' },
  { page: 'account', title: 'Add another device', net: true, icon: 'qr', tint: 'var(--blue)', kw: 'device link code phone computer', when: c => !!c.user && !c.demo },
  { page: 'account', title: 'Pair the mobile app', icon: 'qr', tint: 'var(--blue)', kw: 'pair phone app android iphone', when: signedInWeb },
  { page: 'account', title: 'Password', icon: 'key', tint: 'var(--orange)', kw: 'password login', when: c => signedInWeb(c) && c.pwOn },
  { page: 'account', title: 'Sign out', icon: 'signOut', tint: 'var(--red)', kw: 'log out logout sign out', when: signedInWeb },
  { page: 'account', title: 'Sign out everywhere', icon: 'shield', tint: 'var(--red)', kw: 'log out all devices sessions', when: signedInWeb },
  { page: 'account', title: 'Delete my account', icon: 'trash', tint: 'var(--red)', kw: 'delete remove close erase account profile gdpr', when: c => !!c.user && !c.demo },
  { page: 'account', title: 'Choose a photo', icon: 'image', tint: 'var(--acc)', kw: 'profile picture avatar photo icon face', when: c => !c.demo },
  { page: 'account', title: 'Pick an icon', icon: 'smile', tint: 'var(--orange)', kw: 'profile picture avatar icon emoji face', when: c => !c.demo },
  { page: 'account', title: 'Badges on your profile', icon: 'medal', tint: 'var(--yellow)', mod: 'motivation', kw: 'badges pin profile medals', when: c => !c.demo },
  { page: 'account', title: 'Account ID', icon: 'personCircle', tint: 'var(--grey)', kw: 'id uid admin account', when: c => !!c.user && !c.demo },
  { page: 'account', title: 'Admin dashboard', icon: 'crown', tint: 'var(--indigo)', kw: 'admin users dashboard', when: c => !!c.user?.admin && !c.demo },
  { page: 'account', title: 'Disconnect', net: true, icon: 'signOut', tint: 'var(--red)', kw: 'disconnect server local', when: c => c.mobile && !!c.user },
  { page: 'account', title: 'Connect to my server', net: true, icon: 'cloud', tint: 'var(--indigo)', kw: 'server sync self-hosted connect', when: c => c.mobile && !c.user },
  { page: 'account', title: 'Sign in with passkey', icon: 'fingerprint', tint: 'var(--blue)', kw: 'login sign in log in passkey', when: c => !c.mobile && !c.demo && !c.user && c.webauthn },
  { page: 'account', title: 'Sign in with password', icon: 'key', tint: 'var(--orange)', kw: 'login sign in log in password', when: c => !c.mobile && !c.demo && !c.user && c.pwOn },
  { page: 'account', title: 'Create passkey profile', icon: 'plusCircle', tint: 'var(--acc)', kw: 'register account sign up create profile', when: c => !c.mobile && !c.demo && !c.user && c.webauthn },
  { page: 'account', title: 'Reset demo data', icon: 'reset', tint: 'var(--blue)', kw: 'demo reset example', when: c => c.demo },
]

// Lower case, accents and other marks dropped, so "théme", "Thème" and "theme" meet.
export const fold = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const WORD_CHAR = /[\p{L}\p{N}]/u
const atWordStart = (hay, w) => {
  for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + 1)) if (i === 0 || !WORD_CHAR.test(hay[i - 1])) return true
  return false
}

/** The trail a hit names under its title: "Workout" or "Workout › Fine-tuning". */
export function pageTrail(page, tr = t) {
  const p = PAGES[page]
  if (!p) return ''
  return p.parent ? tr(PAGES[p.parent].title) + ' › ' + tr(p.title) : tr(p.title)
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
    const en = fold([entry.title, entry.kw || '', ...opts, isPage ? '' : PAGES[entry.page]?.title].join(' '))
    if (!words.every(w => own.includes(w) || atWordStart(en, w))) return
    const ft = fold(title)
    const rank = ft.startsWith(q) ? 0 : ft.includes(q) ? 1 : isPage ? 2 : 3
    hits.push({ ...entry, label: title, trail: isPage ? tr('Settings') : pageTrail(entry.page, tr), isPage, rank })
  }
  for (const id of PAGE_IDS) {
    // The page itself too: Gym reminder hangs under Reminders, which the web has, but is the phone's.
    const top = PAGES[id].parent ? PAGES[id].parent : id
    if (!pageVisible(top, ctx) || !pageVisible(id, ctx) || id === 'advanced') continue
    consider({ page: id, title: PAGES[id].title, icon: PAGES[id].icon, tint: PAGES[id].tint, kw: PAGES[id].kw }, true)
  }
  for (const e of SEARCH) {
    if (!pageVisible(PAGES[e.page].parent || e.page, ctx)) continue
    // A page under another that its own module hides (Look & Home → Seasonal themes).
    if (PAGES[e.page].mod && !pageVisible(e.page, ctx)) continue
    if (e.when && !e.when(ctx)) continue
    // A row that needs the network is not there in openGym Offline (lib/build-caps.js).
    if (e.net && ctx.offline) continue
    if (e.mod && ctx.mod && !ctx.mod(e.mod)) continue
    consider(e, false)
  }
  // The root's "Use your subscription" row (Connections) opens a screen of its own (views/Assistants.jsx), not a
  // settings page; it is found like one. Not in openGym Offline or the demo, as on the root.
  if (!ctx.offline && !ctx.demo) {
    consider({ page: 'look', route: '/assistants', title: 'Use your subscription', icon: 'chat', tint: 'var(--acc)',
      kw: 'claude chatgpt gemini mcp connector assistant ai plan subscription' }, true)   // a root row: its trail is Settings
  }
  return hits.sort((a, b) => a.rank - b.rank)
}
