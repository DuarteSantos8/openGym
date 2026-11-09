// Settings → Integrations (v1.4.4): which cards the directory shows on this device, and what each
// one says. Pure, so the rules ("Apple Health lives in the iPhone app", "webhooks need your own
// server") are tested here and the page only draws them.
//
// The directory is meant to stay short: a card shows only where it can do something or where
// knowing it exists helps (a phone-only user learns webhooks need a server). A server
// integration the admin did not switch on is hidden from everyone but an admin, who is told how.
//
// Names of services are names, not translated. Everything else is an English key for t().
import { OFFLINE_OFF_CARDS } from './build-caps.js'

export const CATEGORIES = [
  { id: 'health', title: 'Health & devices' },
  { id: 'training', title: 'Training apps' },
  { id: 'backup', title: 'Backups & calendar' },
  { id: 'automation', title: 'Automation' },
  { id: 'ai', title: 'AI & API' },
  // openGym's own family (gm-hooks, docs/dev/SISTER_APPS.md): read-only links, off until linked.
  { id: 'sister', title: 'Sister apps' },
]

// `syncs`: the lines of "What it does" in the detail sheet.
export const CARDS = [
  {
    id: 'apple-health', cat: 'health', name: 'Apple Health', icon: 'heart', tint: 'var(--red)',
    desc: 'Workouts and weigh-ins out, heart rate and scale readings in.',
    syncs: ['Finished workouts and weigh-ins go to Apple Health.', 'Heart rate from your watch fills in each set.', 'Weigh-ins from your smart scale land here.'],
  },
  {
    id: 'health-connect', cat: 'health', name: 'Health Connect', icon: 'heart', tint: 'var(--red)',
    desc: 'Workouts and weigh-ins out, heart rate and scale readings in.',
    syncs: ['Finished workouts and weigh-ins go to Health Connect.', 'Heart rate from your watch fills in each set.', 'Weigh-ins from your smart scale land here.'],
  },
  {
    id: 'hevy', cat: 'training', name: 'Hevy', icon: 'key', tint: 'var(--teal)',
    desc: 'Bring your Hevy history over with a Pro API key.',
    syncs: ['Workouts, routines and weigh-ins, once.', 'The key is used for this import and then forgotten.'],
  },
  {
    id: 'strava', cat: 'training', name: 'Strava', icon: 'figureRun', tint: 'var(--orange)',
    desc: 'Your runs, rides and rows go up to Strava, strength too if you like.',
    syncs: ['Finished cardio workouts, with their time and distance.', 'Strength sessions as Weight Training, if you switch it on.', 'Sent by your server, from whichever device you logged on.'],
  },
  {
    id: 'files', cat: 'training', name: 'Import a file', translate: true, icon: 'download', tint: 'var(--teal)',
    desc: 'Strong, FitNotes, Hevy CSV, GymMane or an Apple Health export.',
    syncs: ['Reads the export file of another app, once.', 'Exercises are matched to the library, you check the rest.'],
  },
  {
    id: 'csv', cat: 'training', name: 'Spreadsheet (CSV)', translate: true, icon: 'share', tint: 'var(--green)',
    desc: 'Every set, weigh-in and measurement, for Excel and friends.',
    syncs: ['One row per set, plus body weight and measurements.', 'openGym can read it back in later.'],
  },
  {
    id: 'webdav', cat: 'backup', name: 'WebDAV backup', translate: true, icon: 'cloud', tint: 'var(--blue)',
    desc: 'A copy every day in your own Nextcloud or any WebDAV folder.',
    syncs: ['The full backup, once a day while the app is open, and whenever you tap Back up now.', 'Restore it on a new phone in two taps.'],
  },
  {
    id: 'calendar', cat: 'backup', name: 'Calendar feed', translate: true, icon: 'calendar', tint: 'var(--red)',
    desc: 'Your planned sessions in Apple, Google or Outlook calendar.',
    syncs: ['Planned sessions from a week back to eight weeks ahead, as all-day events.', 'Finished workouts too, if you like.'],
  },
  {
    id: 'webhook', cat: 'automation', name: 'Webhooks', translate: true, icon: 'webhook', tint: 'var(--indigo)',
    desc: 'Tell Home Assistant, n8n or ntfy when you finish a workout.',
    syncs: ['A signed JSON message when a workout is finished, a record falls or you weigh in.', 'Sent by your server, from whichever device you logged on.'],
  },
  {
    id: 'coach', cat: 'ai', name: 'AI Coach', translate: true, icon: 'sparkles', tint: 'var(--green)',
    desc: 'Plans and reviews from the model you pick.',
    syncs: ['Reads your plan and the last weeks of training when you ask.', 'Set up on its own page.'],
  },
  {
    id: 'mcp', cat: 'ai', name: 'MCP server', translate: true, icon: 'plug', tint: 'var(--purple)',
    desc: 'Let Claude Desktop, Cursor and friends read your training log.',
    syncs: ['Runs next to your server, or over HTTPS with a token from Settings.', 'Sees and changes only what the token was given.'],
  },
  {
    id: 'opennutrition', cat: 'sister', name: 'openNutrition', icon: 'tree', tint: 'var(--green)',
    desc: 'Calories, protein and your fasting window, next to your training.',
    syncs: ['Reads what you ate, never changes it.', 'Shows in your report, your month story and on Home.', 'The link stays on this device.'],
  },
]
export const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]))

// Apps people asked about that reach openGym through the phone's health store. `reads` is what
// openGym gets from them that way: heart rate, weigh-ins or both. No fake Connect buttons.
export const WORKS_WITH = [
  { name: 'Garmin', glyph: 'watch', reads: 'hr' },
  { name: 'COROS', glyph: 'watch', reads: 'hr' },
  { name: 'Polar', glyph: 'watch', reads: 'hr' },
  { name: 'Fitbit', glyph: 'watch', reads: 'hr' },
  { name: 'Samsung Health', glyph: 'watch', reads: 'both' },
  { name: 'Oura', glyph: 'ring', reads: 'hr' },
  { name: 'Withings', glyph: 'scale', reads: 'weight' },
  { name: 'Renpho', glyph: 'scale', reads: 'weight' },
]

// The status pill, in the words the card shows.
export const PILL = {
  connected: 'Connected',
  off: 'Off',
  attention: 'Needs attention',
  device: 'Not available on this device',
  server: 'Needs your server',
}

// Every read counts: a phone that only reads vitals or sport is connected too.
const healthOn = h => !!(h && (h.on || h.readHr || h.readWeight || h.readBody || h.readVitals || h.readSport))
const healthTrouble = h => !!(h && ((h.on && h.error === 'permission') || (healthOn(h) && h.readError === 'permission')))

/**
 * What a card shows here, or null when it does not show at all.
 * ctx: { mobile, platform ('ios' | 'android' | null), user, demo, admin,
 *        health: { status, on, readHr, readWeight, error, readError } | null  (this phone's store)
 *        server: { providers: [id], connections: [..] } | null  (GET /api/integrations)
 *        offered: [provider ids] (config.integrations.providers), coach: bool, coachMode,
 *        webdav: this device's WebDAV backup settings (lib/webdav.js loadConfig) | null,
 *        tokens: whether the server has scoped tokens (the calendar feed is one), calendar: GET /api/calendar | null,
 *        nutrition: this device's openNutrition link (lib/sister-nutrition.js loadLink) | null }
 * Answers { status: key of PILL | null, action: 'connect' | 'manage' | 'import' | 'export' | 'open' | null }.
 */
export function cardState(id, ctx) {
  const phone = ctx.mobile ? ctx.platform : null
  switch (id) {
    case 'apple-health':
    case 'health-connect': {
      const mine = id === 'apple-health' ? 'ios' : 'android'
      // The other platform's store is no use here: not shown at all on a phone.
      if (ctx.mobile && phone && phone !== mine) return null
      if (!ctx.mobile) return { status: 'device', action: null }
      const h = ctx.health
      if (!h || h.status === 'unsupported') return { status: 'device', action: null }
      if (h.status === 'missing' || h.status === 'update') return { status: 'off', action: 'connect' }
      if (healthTrouble(h)) return { status: 'attention', action: 'manage' }
      return healthOn(h) ? { status: 'connected', action: 'manage' } : { status: 'off', action: 'connect' }
    }
    case 'hevy':
    case 'files':
      return ctx.demo && id === 'hevy' ? null : { status: null, action: 'import' }
    case 'csv':
      return { status: null, action: 'export' }
    case 'webhook': {
      if (ctx.demo || !ctx.user) return { status: 'server', action: null }
      const offered = (ctx.offered || []).includes('webhook')
      if (!offered) return ctx.admin ? { status: 'off', action: 'open' } : null
      const mine = (ctx.server?.connections || []).filter(c => c.provider === 'webhook')
      if (!mine.length) return { status: 'off', action: 'connect' }
      if (mine.some(c => c.status === 'attention')) return { status: 'attention', action: 'manage' }
      return mine.every(c => c.paused) ? { status: 'off', action: 'manage' } : { status: 'connected', action: 'manage' }
    }
    case 'strava': {
      // Strava (#478): the server uploads, with the Strava app its admin registered.
      if (ctx.demo || !ctx.user) return { status: 'server', action: null }
      if (!(ctx.offered || []).includes('strava')) return ctx.admin ? { status: 'off', action: 'open' } : null
      const mine = (ctx.server?.connections || []).filter(c => c.provider === 'strava')
      if (!mine.length) return { status: 'off', action: 'connect' }
      if (mine.some(c => c.status === 'attention')) return { status: 'attention', action: 'manage' }
      return mine.every(c => c.paused) ? { status: 'off', action: 'manage' } : { status: 'connected', action: 'manage' }
    }
    case 'webdav': {
      // This device talks to your WebDAV server itself: no openGym server needed (#582).
      if (ctx.demo) return null
      const w = ctx.webdav
      if (!w) return { status: 'off', action: 'connect' }
      // Set up by another account on this device: paused, the sheet only offers Disconnect.
      if (w.foreign) return { status: 'attention', action: 'manage' }
      if (w.last && w.last.ok === false) return { status: 'attention', action: 'manage' }
      return { status: 'connected', action: 'manage' }
    }
    case 'calendar':
      // A private address your server serves (api/integrations/calendar.js), on its token system.
      if (ctx.demo || !ctx.user) return { status: 'server', action: null }
      if (!ctx.tokens) return null
      return ctx.calendar?.on ? { status: 'connected', action: 'manage' } : { status: 'off', action: 'connect' }
    case 'coach':
      if (ctx.mobile) return { status: ctx.coachMode ? 'connected' : 'off', action: ctx.coachMode ? 'manage' : 'connect' }
      return ctx.coach ? { status: 'connected', action: 'open' } : null
    case 'mcp':
      if (ctx.demo || !ctx.user) return { status: 'server', action: null }
      return { status: null, action: 'open' }
    case 'opennutrition': {
      // This device talks to openNutrition itself (lib/sister-nutrition.js): no openGym server needed.
      if (ctx.demo) return null
      const l = ctx.nutrition
      if (!l) return { status: 'off', action: 'connect' }
      return l.error ? { status: 'attention', action: 'manage' } : { status: 'connected', action: 'manage' }
    }
    default:
      return null
  }
}

// The module (lib/modules.js) a card belongs to: with it off, the card is not in the directory.
export const CARD_MODULE = { 'apple-health': 'health', 'health-connect': 'health', webhook: 'integrations', mcp: 'integrations', calendar: 'integrations', strava: 'integrations', coach: 'coach', opennutrition: 'integrations' }

/** The directory for this device: categories with their visible cards, empty ones left out.
 *  `ctx.mod(id)` says whether a module is on (absent: all on). */
export function directory(ctx) {
  // openGym Offline (lib/build-caps.js): only what works without a network (the health store, files).
  const net = new Set(ctx.offline ? OFFLINE_OFF_CARDS : [])
  return CATEGORIES.map(cat => ({
    ...cat,
    cards: CARDS.filter(c => c.cat === cat.id && !net.has(c.id) && !(CARD_MODULE[c.id] && ctx.mod && !ctx.mod(CARD_MODULE[c.id]))).map(c => ({ ...c, state: cardState(c.id, ctx) })).filter(c => c.state),
  })).filter(cat => cat.cards.length)
}

// Webhook events, in the order the form offers them.
export const WEBHOOK_EVENTS = [
  { id: 'workout.finished', label: 'Workout finished' },
  { id: 'workout.pr', label: 'New personal record' },
  { id: 'weighin.logged', label: 'Weigh-in logged' },
]

/** The client's own check of a webhook URL before it asks the server, which has the last word. */
/** What the person pasted, with https:// in front when it came without a scheme
 *  ("ha.example.com/api/webhook/x" is what a lot of tools show). Anything with a scheme of its own,
 *  right or wrong, is left for webhookUrlProblem to judge. */
export function normalizeWebhookUrl(raw) {
  const s = String(raw || '').trim()
  if (!s || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s) || /\s/.test(s) || !/^[^/?#]+\.[^/?#]/.test(s) && !/^[^/?#]+:\d/.test(s)) return s
  return 'https://' + s
}

export function webhookUrlProblem(raw, { lan = false } = {}) {
  const s = String(raw || '').trim()
  if (!s) return 'Paste the URL your tool gave you.'
  let u
  try { u = new URL(s) } catch { return 'That does not look like a URL.' }
  if (u.protocol === 'https:') return null
  if (u.protocol === 'http:' && lan) return null
  return lan ? 'It has to start with https:// or http://.' : 'It has to start with https://.'
}
