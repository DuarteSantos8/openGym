// The route module: every path the app has, which bottom-bar tab owns it, where its back goes on
// a cold entry, and where the paths from before the tabs went. The only source file allowed to
// spell an old path (route-literals.test.js holds the rest of src/ to that).
//
// Four tabs, each with its own stack: Home (/home), Training (/train/*), Nutrition (/food/*) and
// Progress (/progress/*). Pages any tab can open sit on top of the tab that opened them and belong
// to none: Profile (/me/*) and the full-screen workout (/train/workout).
//
// Deep links into Progress (ux-redesign-tabs §5 item 3), each taking ?range=30|90|365|0 too:
//   /progress/body, /progress/body/measurements, /progress/body/photos   the Body page's segments
//   /progress/strength?ex=<exercise id>                                   Strength on that exercise
//   /progress/load?view=activity|muscles|plan|effort                      a Training load segment
// The Body segments are one page, so a cold one's back goes to Progress, not to Weight.

export const TABS = ['home', 'train', 'food', 'progress']
export const TAB_ROOT = { home: '/home', train: '/train', food: '/food', progress: '/progress' }

const under = (pathname, base) => pathname === base || pathname.startsWith(base + '/')

const SHARED = ['/me', '/train/workout']

export function tabOf(pathname = '') {
  if (SHARED.some(p => under(pathname, p))) return null
  return TABS.find(tab => under(pathname, TAB_ROOT[tab])) || null
}

export const isTabRoot = (pathname = '') => TABS.some(tab => TAB_ROOT[tab] === pathname)

// Bar slot of a tab: slot 2 is the centre +, which a tab never occupies.
export const slotOf = i => (i < 2 ? i : i + 1)

// Back on a cold entry (a deep link or a reload with nothing under it in its tab): the page's
// parent, one level up, down to its tab's root. The Coach goes to Training; the workout and
// Profile, which any tab opens, to Home: where they were opened from is not known any more.
export function parentOf(pathname = '') {
  if (under(pathname, '/train/coach')) return TAB_ROOT.train
  if (under(pathname, '/train/workout') || pathname === '/me') return TAB_ROOT.home
  if (under(pathname, '/me')) return '/me'
  if (under(pathname, '/progress/body')) return TAB_ROOT.progress
  const tab = tabOf(pathname)
  if (!tab || pathname === TAB_ROOT[tab]) return TAB_ROOT.home
  return pathname.slice(0, pathname.lastIndexOf('/'))
}

// Profile pages the §5 merge renamed, old id → new id. /me/<old> and /settings/<old> land on the
// new page (views/Settings.jsx SettingsRoute, and LEGACY below). Data & backup lands on Backup, the
// page with its export and import.
export const PROFILE_RENAMED = { look: 'appearance', reminders: 'notifications', plan: 'schedule', data: 'backup' }

// Routes from before the tabs, still reachable from bookmarks, home-screen shortcuts and the links
// already sitting in delivered notifications (the server's Coach push says #/coach). Longest
// prefix first: /plan/r/:id is a routine, /plan the week, /settings/look before /settings.
const LEGACY = [
  ...Object.entries(PROFILE_RENAMED).map(([from, to]) => ['/settings/' + from, '/me/' + to]),
  ['/plan/r', '/train/routines'],
  ['/plan', '/train/schedule'],
  ['/checkin', '/train/checkin'],
  ['/workout', '/train/workout'],
  ['/history', '/train/history'],
  ['/library', '/train/exercises'],
  ['/muscles', '/train/exercises/muscles'],
  ['/coach', '/train/coach'],
  ['/stats', '/progress'],
  ['/structural-balance', '/progress/strength/balance'],
  ['/progress-photos', '/progress/body/photos'],
  ['/measurements', '/progress/body/measurements'],
  ['/body', '/progress/body'],
  ['/settings', '/me'],
  ['/admin', '/me/admin'],
]

// The whole new address for an old one, query and fragment kept. Plan's old "Weekly muscle
// volume" link (/stats?focus=weekly-volume) opens Training load on its Plan segment.
export function legacyPath(pathname = '', search = '', hash = '') {
  if (pathname === '/stats' && /[?&]focus=weekly-volume\b/.test(search)) return '/progress/load?view=plan' + hash
  for (const [from, to] of LEGACY) if (under(pathname, from)) return to + pathname.slice(from.length) + search + hash
  return null
}

// Workout ids are not pages to come back to: once the session is over the address shows the
// Start screen, so it is never kept in a tab's stack (the dock reopens a running one).
export const isWorkoutPath = (path = '') => under(path.split(/[?#]/)[0], '/train/workout')

// A live session: not a past workout being edited or logged after the fact, which has no clock.
export const workoutRunning = S => !!S?.active && !S.active.editingWorkoutId && !S.active.backfill && S.active.start > 0

// Where a launch with no route of its own lands: straight into a running workout, else Home.
export const launchPath = running => (running ? '/train/workout' : TAB_ROOT.home)
