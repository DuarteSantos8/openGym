// The parts of openGym a user would name, and which files belong to each. Used by
// test-report.mjs to count tests and coverage per area, for test files and source files alike
// (frontend/src/lib/plates.js and plates.test.js both land in "Plates & equipment").
//
// First match wins, so the narrow areas come before the broad ones. A file that matches
// nothing is "Other UI" for the frontend's views/components and "Other" elsewhere; if an
// important file shows up there, add a pattern rather than leave the table vague.
export const AREAS = [
  { name: 'Sync & no data loss', re: /sync|undo-merge|merge-state|stamps|durable|data-rev|data-wid|data-reset|data-safety|state-cache|state-read|legacy|undo-concurrent|offline|outbox|conflict|backoff|_rev|remote\.|presence/ },
  { name: 'Coach (AI)', re: /^parse\.|^validate\.|coach|cadence|cohort|adapters|payload|prompt|review-repair|refine-change|jobs\.|warmup\.test|fixture-cli|e2e-apikey|config-migration|categories/ },
  { name: 'Accounts, auth & security', re: /passkey|password|auth|login|csrf|cors|token|pairing|device-link|account|admin|first-user|rate-limit|anon-flood|credential|cf-access|email|guest|verify-error|recover|csp|audit/ },
  { name: 'Import, export & backup', re: /import|export|fit-|csv|hevy|backup|zip|plan-share|qr|scan|clipboard/ },
  { name: 'Plates & equipment', re: /plate|dumbbell|bar\.|bar-|equipment|incline|kg-change/ },
  { name: 'Rest timer & alerts', re: /rest-|rest\.|resttimer|timer|sound|wakelock|live-activity|nudge|reminder|push|notification|sw\.|sw-/ },
  { name: 'Progression, 1RM & stats', re: /progress|onerm|1rm|e1rm|effort|fatigue|recovery|strength|structural|stats|history|finish-compare|pyramid|rep-range|heatmap|linechart|measurements|bodyweight|check-?in/ },
  { name: 'Workout logging', re: /workout|session|set|superset|queue|rotation|routine|plan|week|day-|starter|focusview|home|active-|swap|per-set|duration|speed|backfill|swipe/ },
  { name: 'Exercise catalogue & media', re: /exercise|catalogue|muscle|anim|media|library|similar|favour|glyph|body-paths|bodymap|instr/ },
  { name: 'Phone, watch & health apps', re: /native|android|ios|mobile|channel|capacitor|watch|health|widget|system-bars|keyboard|edge-swipe|onboarding|platform|heart-rate|update\./ },
  { name: 'App state & API server', re: /^usestore|^useui|^server\.js$|^store\.|^api\.js$|^boot\.js$/ },
  { name: 'Languages', re: /i18n|locale|lang|plural|pt-br|translat|exercise-names|source-strings|empty-placeholder/ },
]

export function areaOf(path) {
  const p = String(path || '').toLowerCase()
  const base = p.split('/').pop()
  for (const a of AREAS) if (a.re.test(base)) return a.name
  for (const a of AREAS) if (a.re.test(p)) return a.name
  if (/(^|\/)(views|components)\//.test(p) || /\.jsx$/.test(p)) return 'Other UI'
  return 'Other'
}
