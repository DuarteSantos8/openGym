// Settings (v1.3.11): which page each row lives on, and the index the search field reads.
//
// The root holds eleven rows in four groups plus the account card; each opens a page at
// /settings/<page>. Rare things hang one level further down (Workout → Fine-tuning). Titles here
// are the English keys the pages render with t(), so a search hit can find its row on the page
// by the same text and flash it (views/Settings.jsx). settings-pages.test.jsx renders every page
// and checks that each entry below really is a row there.
import { t } from '../lib/i18n.js'
import { ACCENT_NAMES } from '../lib/format.js'

export const PAGES = {
  workout: { title: 'Workout', icon: 'play', tint: 'var(--green)' },
  alerts: { title: 'Timer alerts', icon: 'speaker', tint: 'var(--pink)' },
  reminders: { title: 'Reminders', icon: 'bell', tint: 'var(--red)' },
  plan: { title: 'Plan & schedule', icon: 'calendar', tint: 'var(--orange)' },
  units: { title: 'Units & language', icon: 'ruler', tint: 'var(--teal)' },
  equipment: { title: 'Equipment', icon: 'kettlebell', tint: 'var(--indigo)' },
  look: { title: 'Look & Home', icon: 'palette', tint: 'var(--purple)' },
  coach: { title: 'AI Coach', icon: 'sparkles', tint: 'var(--green)' },
  data: { title: 'Data & backup', icon: 'folder', tint: 'var(--blue)' },
  about: { title: 'About & updates', icon: 'info', tint: 'var(--grey)' },
  account: { title: 'Account', icon: 'personCircle', tint: 'var(--grey)' },
  advanced: { title: 'Fine-tuning', icon: 'wrench', tint: 'var(--grey)', parent: 'workout' },
}
export const PAGE_IDS = Object.keys(PAGES)

// The root, top to bottom. Whether a row shows is pageVisible's call.
export const ROOT_GROUPS = [['workout', 'alerts', 'reminders'], ['plan', 'units', 'equipment'], ['look', 'coach'], ['data', 'about']]

/**
 * Whether a page exists for this device and profile. Reminders need a push server (signed in) or
 * the phone's own notifications; the Coach page is the phone's Coach setup (the web app's Coach
 * runs on the server, set up by its admin).
 */
export function pageVisible(page, ctx) {
  if (page === 'reminders') return !!(ctx.user || ctx.mobile)
  if (page === 'coach') return !!ctx.mobile
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
export const SEARCH = [
  // Workout
  { page: 'workout', title: 'Rest timer', icon: 'timer', tint: 'var(--orange)', kw: 'rest pause break seconds minutes timer countdown' },
  { page: 'workout', title: 'Rest-pause rest', icon: 'bolt', tint: 'var(--orange)', kw: 'burst cluster rest pause' },
  { page: 'workout', title: 'Effort per set', icon: 'gauge', tint: 'var(--purple)', kw: 'rir rpe effort reps in reserve difficulty', opts: ['RIR', 'RPE'] },
  { page: 'workout', title: 'Shown under each exercise', icon: 'history', tint: 'var(--blue)', kw: 'last time best set reference previous', opts: ['Last time', 'Best set'] },
  { page: 'workout', title: 'Layout', icon: 'layout', tint: 'var(--blue)', kw: 'workout view cards list compact', opts: ['Cards', 'List', 'Compact'] },
  { page: 'workout', title: 'Weigh in before workouts', icon: 'scale', tint: 'var(--green)', kw: 'body weight weigh scale start' },
  { page: 'workout', title: 'Keep screen awake', icon: 'phoneScreen', tint: 'var(--yellow)', kw: 'wake lock screen sleep display on', when: c => c.wakeOK || !c.mobile },
  { page: 'workout', title: 'Exercise animations', icon: 'image', tint: 'var(--teal)', kw: 'gif animation video media pictures images', opts: ['Full', 'Small', 'Hidden'] },
  { page: 'workout', title: 'Fine-tuning', icon: 'wrench', tint: 'var(--grey)', kw: 'advanced more options' },
  // Fine-tuning
  { page: 'advanced', title: 'Planned sessions start from', icon: 'clipboard', tint: 'var(--green)', kw: 'start from plan last session reps carry over', opts: ['Your plan', 'Your last session'] },
  { page: 'advanced', title: 'Keep timing after target', icon: 'stopwatch', tint: 'var(--orange)', kw: 'timed set overtime hold duration' },
  { page: 'advanced', title: 'Weight and reps buttons', icon: 'plusCircle', tint: 'var(--green)', kw: 'steppers plus minus buttons workout controls' },
  { page: 'advanced', title: 'Drop and burst shortcuts on every set', icon: 'bolt', tint: 'var(--orange)', kw: 'drop set burst shortcuts workout controls' },
  { page: 'advanced', title: 'Swipe actions', icon: 'swap', tint: 'var(--indigo)', kw: 'swipe gesture slide delete remove copy duplicate set routine loop plan workout controls', tkw: () => t('swipe gesture') },
  { page: 'advanced', title: 'Superset buttons in the exercise header', icon: 'link', tint: 'var(--blue)', kw: 'superset pair workout controls' },
  { page: 'advanced', title: 'Move, swap and remove buttons below the exercise', icon: 'swap', tint: 'var(--teal)', kw: 'move swap remove replace workout controls' },
  // Timer alerts
  { page: 'alerts', title: 'Play a sound', icon: 'speaker', tint: 'var(--pink)', kw: 'sound sounds audio beep chime volume' },
  { page: 'alerts', title: 'Sound', icon: 'bell', tint: 'var(--pink)', kw: 'classic timer sound beep chime tone', opts: ['Chime (louder)', 'Classic beeps'], when: c => c.sound },
  { page: 'alerts', title: 'Play even on silent', icon: 'speaker', tint: 'var(--orange)', kw: 'silent mute ring switch iphone music', when: c => c.sound && c.playOnSilent },
  { page: 'alerts', title: 'Vibrate', icon: 'vibrate', tint: 'var(--indigo)', kw: 'vibrate vibration haptic haptics buzz' },
  { page: 'alerts', title: 'Vibrate on silent too', icon: 'vibrate', tint: 'var(--indigo)', kw: 'alarm silent vibrate android', when: c => c.mobile && c.android && c.canVibrate && c.vibrate },
  { page: 'alerts', title: 'Flash the screen', icon: 'sun', tint: 'var(--yellow)', kw: 'flash light blink screen' },
  // Reminders
  { page: 'reminders', title: PUSH, icon: 'bell', tint: 'var(--red)', kw: 'push notification alerts', when: c => !c.mobile && !!c.user && c.pushOK },
  { page: 'reminders', title: 'Workout day reminder', icon: 'calendar', tint: 'var(--orange)', kw: 'reminder notification remind', when: remind, via: PUSH },
  { page: 'reminders', title: 'Reminder time', icon: 'clock', tint: 'var(--purple)', kw: 'reminder time clock hour when', when: c => remind(c) && c.reminderOn, via: PUSH },
  { page: 'reminders', title: 'Nudge me when I skip a planned workout', icon: 'bell', tint: 'var(--red)', kw: 'nudge skip missed motivation', when: c => remind(c) && c.reminderOn, via: PUSH },
  { page: 'reminders', title: 'Nudge tone', icon: 'chat', tint: 'var(--blue)', kw: 'nudge tone friendly guilt drill sergeant', opts: ['Friendly', 'Guilt trip', 'Drill sergeant'], when: c => remind(c) && c.reminderOn && c.nudge, via: PUSH },
  { page: 'reminders', title: 'Send test notification', icon: 'bell', tint: 'var(--red)', kw: 'test push notification try', when: c => !c.mobile && c.pushOK, via: PUSH },
  // Plan & schedule
  { page: 'plan', title: 'How you train', icon: 'repeat', tint: 'var(--orange)', kw: 'scheduling schedule rotation fixed week split loop round cycle', opts: ['Fixed Week', 'Rotation'] },
  { page: 'plan', title: 'Week starts on', icon: 'calendar', tint: 'var(--orange)', kw: 'monday sunday first day week', opts: ['Monday', 'Sunday'], tkw: () => t('week start') },
  { page: 'plan', title: 'Load starter plan', icon: 'clipboard', tint: 'var(--green)', kw: 'starter template beginner program routine' },
  // Units & language
  { page: 'units', title: 'Language', icon: 'globe', tint: 'var(--blue)', kw: 'language translation idioma sprache langue lingua' },
  { page: 'units', title: 'English exercise names', icon: 'globe', tint: 'var(--purple)', kw: 'exercise names english translation', when: c => c.nameLang },
  { page: 'units', title: 'English names only', icon: 'globe', tint: 'var(--purple)', kw: 'exercise names english translation', when: c => c.nameLang },
  { page: 'units', title: 'Weight unit', icon: 'scale', tint: 'var(--teal)', kw: 'kg lb lbs pounds kilos kilograms unit' },
  { page: 'units', title: 'Weight decimals', icon: 'ruler', tint: 'var(--teal)', kw: 'decimals precision microplates rounding' },
  { page: 'units', title: 'Speed unit', icon: 'figureRun', tint: 'var(--teal)', kw: 'speed mph kmh km/h miles cardio' },
  // Equipment
  { page: 'equipment', title: 'Plates', icon: 'plate', tint: 'var(--orange)', kw: 'plates bar plate math barbell' },
  { page: 'equipment', title: 'Filter by equipment', icon: 'kettlebell', tint: 'var(--green)', kw: 'equipment filter home gym', when: c => c.profiles },
  { page: 'equipment', title: 'Active profile', icon: 'house', tint: 'var(--blue)', kw: 'equipment profile home gym', when: c => c.profiles },
  { page: 'equipment', title: 'Add equipment profile', icon: 'plusCircle', tint: 'var(--green)', kw: 'equipment profile home gym hotel' },
  // Look & Home
  { page: 'look', title: 'Theme', icon: 'moon', tint: 'var(--indigo)', kw: 'dark mode light mode theme appearance night', opts: ['Dark', 'Light', 'System'] },
  { page: 'look', title: 'Accent color', icon: 'palette', tint: 'var(--purple)', kw: 'color colour accent tint custom own picker hex rgb', opts: [...Object.values(ACCENT_NAMES), 'Your own color'], tkw: () => t('custom color picker') },
  { page: 'look', title: 'Body diagram', icon: 'figureStrength', tint: 'var(--teal)', kw: 'muscle map body male female', opts: ['Male', 'Female'] },
  { page: 'look', title: 'Gym check-in', icon: 'qr', tint: 'var(--blue)', kw: 'qr code membership card check in barcode' },
  { page: 'look', title: 'Body weight', icon: 'scale', tint: 'var(--green)', kw: 'weight card home' },
  { page: 'look', title: 'Show connection status', icon: 'cloud', tint: 'var(--blue)', kw: 'sync offline banner bar connection', when: c => !c.demo },
  // Data & backup
  { page: 'data', title: 'Sync with Apple Health', icon: 'heart', tint: 'var(--red)', kw: 'apple health healthkit weight workouts sync', when: c => !!c.healthAvailable },
  { page: 'data', title: 'Export backup (JSON)', icon: 'share', tint: 'var(--blue)', kw: 'export backup json download save' },
  { page: 'data', title: 'Export with photos & videos (.zip)', icon: 'share', tint: 'var(--blue)', kw: 'zip media export backup', when: c => c.hasMedia },
  { page: 'data', title: 'Auto-backup on changes', icon: 'folder', tint: 'var(--blue)', kw: 'auto backup automatic', when: c => c.mobile },
  { page: 'data', title: 'Backup folder', icon: 'folder', tint: 'var(--blue)', kw: 'auto backup folder location directory', when: c => c.mobile && c.android && c.autoBackup },
  { page: 'data', title: 'Import backup', icon: 'download', tint: 'var(--teal)', kw: 'import restore backup json zip' },
  { page: 'data', title: 'Import from another app', icon: 'download', tint: 'var(--teal)', kw: 'strong hevy fitnotes apple health csv import' },
  { page: 'data', title: 'Import from Hevy', icon: 'key', tint: 'var(--teal)', kw: 'hevy api import' },
  { page: 'data', title: 'Photos & videos', icon: 'image', tint: 'var(--teal)', kw: 'media storage photos videos upload', when: c => c.hasMedia },
  { page: 'data', title: 'Reset everything', icon: 'trash', tint: 'var(--red)', kw: 'delete wipe reset erase' },
  // About & updates
  { page: 'about', title: 'Check for updates', icon: 'download', tint: 'var(--green)', kw: 'update apk android version', when: c => c.mobile && c.android },
  { page: 'about', title: 'Get the Android app', icon: 'download', tint: 'var(--green)', kw: 'apk android download app', when: c => !c.mobile },
  { page: 'about', title: 'Version', icon: 'info', tint: 'var(--grey)', kw: 'version about licence license source code open source' },
  { page: 'about', title: 'In Chrome: ⋮ menu → Add to Home screen', icon: 'share', tint: 'var(--blue)', kw: 'install app home screen tip pwa', when: c => c.installTip && c.androidWeb },
  { page: 'about', title: 'In Safari: Share → Add to Home Screen', icon: 'share', tint: 'var(--blue)', kw: 'install app home screen tip pwa', when: c => c.installTip && !c.androidWeb },
  // Account
  { page: 'account', title: 'Sync now', icon: 'reset', tint: 'var(--acc)', kw: 'server sync upload refresh status connection', when: c => !!c.user && !c.demo && c.synced },
  { page: 'account', title: 'Passkeys', icon: 'fingerprint', tint: 'var(--acc)', kw: 'passkey security login', when: signedInWeb },
  { page: 'account', title: 'Add another device', icon: 'qr', tint: 'var(--blue)', kw: 'device link code phone computer', when: signedInWeb },
  { page: 'account', title: 'Pair the mobile app', icon: 'qr', tint: 'var(--blue)', kw: 'pair phone app android iphone', when: signedInWeb },
  { page: 'account', title: 'Password', icon: 'key', tint: 'var(--orange)', kw: 'password login', when: c => signedInWeb(c) && c.pwOn },
  { page: 'account', title: 'Sign out', icon: 'signOut', tint: 'var(--red)', kw: 'log out logout sign out', when: signedInWeb },
  { page: 'account', title: 'Sign out everywhere', icon: 'shield', tint: 'var(--red)', kw: 'log out all devices sessions', when: signedInWeb },
  { page: 'account', title: 'Account ID', icon: 'personCircle', tint: 'var(--grey)', kw: 'id uid admin account', when: c => !!c.user && !c.demo },
  { page: 'account', title: 'Admin dashboard', icon: 'crown', tint: 'var(--indigo)', kw: 'admin users dashboard', when: c => !!c.user?.admin && !c.demo },
  { page: 'account', title: 'Disconnect', icon: 'signOut', tint: 'var(--red)', kw: 'disconnect server local', when: c => c.mobile && !!c.user },
  { page: 'account', title: 'Connect to my server', icon: 'cloud', tint: 'var(--indigo)', kw: 'server sync self-hosted connect', when: c => c.mobile && !c.user },
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
    const top = PAGES[id].parent ? PAGES[id].parent : id
    if (!pageVisible(top, ctx) || id === 'advanced') continue
    consider({ page: id, title: PAGES[id].title, icon: PAGES[id].icon, tint: PAGES[id].tint }, true)
  }
  for (const e of SEARCH) {
    if (!pageVisible(PAGES[e.page].parent || e.page, ctx)) continue
    if (e.when && !e.when(ctx)) continue
    consider(e, false)
  }
  return hits.sort((a, b) => a.rank - b.rank)
}
