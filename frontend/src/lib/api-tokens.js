// Settings → API tokens (docs/API_TOKENS.md): the profile's side of /api/tokens, plus the pure
// helpers the page renders with. The categories mirror api/tokens.js TOKEN_CATEGORIES.
import { api, appBase, remoteAuth } from './api.js'
import { t } from './i18n.js'
import { fmtDate } from './format.js'
import { categoryLabel } from './sharing-api.js'

export const TOKEN_CATEGORIES = [
  { id: 'workouts', max: 'apply' }, { id: 'plans', max: 'apply' }, { id: 'bodyweight', max: 'apply' },
  { id: 'measurements', max: 'apply' }, { id: 'notes', max: 'view' },
]
export const TOKEN_DAYS = [7, 30, 90, 365, 0]

export const tokensOn = (config, user, demo) => !!config?.api_tokens && !!user && !demo
export const listTokens = () => api('/api/tokens')
export const createToken = ({ name, scopes, days }) => api('/api/tokens', { method: 'POST', body: JSON.stringify({ name, scopes, days }) })
export const revokeToken = id => api('/api/tokens/revoke', { method: 'POST', body: JSON.stringify(id ? { id } : {}) })

/** Where the MCP endpoint is: the server's address plus /mcp (a paired phone's server, else the
 *  address this page is served at). */
export function mcpAddress(remote = remoteAuth(), loc = typeof location !== 'undefined' ? location : null) {
  const base = remote?.base || ((loc?.origin || '') + appBase(loc))
  return String(base).replace(/\/+$/, '') + '/mcp'
}

/** "Sees: Workouts, Plans & routines. May change: Plans & routines" for a token's scopes. */
export function tokenLine(scopes) {
  const at = lv => TOKEN_CATEGORIES.filter(c => (lv === 'view' ? ['view', 'apply'].includes(scopes?.[c.id]) : scopes?.[c.id] === lv)).map(c => categoryLabel(c.id)).join(', ')
  const parts = []
  const sees = at('view'), changes = at('apply')
  if (sees) parts.push(t('Sees: {0}', sees))
  if (changes) parts.push(t('May change: {0}', changes))
  return parts.join('. ') || t('Sees nothing right now')
}

/** When a token stops working, in words. */
export const endsLabel = (exp, now = Date.now()) => {
  if (!exp) return t('When you revoke it')
  const d = new Date(exp)
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  return fmtDate(iso, false, d.getFullYear() !== new Date(now).getFullYear())
}

// The calendar feed (api/integrations/calendar.js, docs/CALENDAR.md): a private ICS address of the
// plan, made of a token of its own kind. Settings → Integrations → Calendar feed.
export const getCalendar = () => api('/api/calendar')
export const setCalendar = ({ done, renew = false }) => api('/api/calendar', { method: 'POST', body: JSON.stringify({ done: !!done, ...(renew ? { renew: true } : {}) }) })
export const stopCalendar = () => api('/api/calendar/revoke', { method: 'POST', body: '{}' })
/** The address a calendar app opens straight away: the same feed as webcal://. */
export const webcalUrl = url => String(url || '').replace(/^https?:\/\//, 'webcal://')
