// "Use your subscription" (views/Assistants.jsx, sub-connect-146): openGym as a connector inside
// the assistant apps people already pay for. Not a sign-in to their subscription: Anthropic's
// terms forbid third-party apps from using claude.ai logins, and OpenAI's plan sharing is for
// approved apps. What every one of them does allow is adding a remote MCP server, so the
// assistant comes to openGym (docs/MCP_REMOTE.md), signs in with openGym's own OAuth
// (api/oauth.js) and gets a scoped token the person picks on the consent screen.
//
// The pure half of the screen: the three assistants with their steps and plans, which of the
// profile's tokens are connectors, and whether this server can be reached from the internet at all.
import { t } from './i18n.js'

export const SELF_HOSTING_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/SELF_HOSTING.md'
export const MCP_REMOTE_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/MCP_REMOTE.md'

// Where each app adds a connector, as its makers document it (checked 2026-11-08):
//   Claude   claude.com/docs/connectors/custom/add-unlisted: Customize > Connectors, Free (one
//            custom connector), Pro, Max, Ultra, Team and Enterprise (an Owner adds it there)
//   ChatGPT  developers.openai.com/apps-sdk/deploy/connect-chatgpt: Plugins, +, Add custom MCP
//            server; account and workspace policies decide who may, on the web
//   Gemini   Settings & help, Connected apps, Add a custom app: reported since mid-2026, personal
//            Google accounts on some Google AI plans only, so "where available"
export const ASSISTANTS = [
  {
    id: 'claude', name: 'Claude', tint: 'var(--orange)',
    settingsUrl: 'https://claude.ai/customize/connectors',
    plan: () => t('Any Claude plan. Free has room for one custom connector; on Team and Enterprise an Owner adds it first.'),
    steps: () => [
      t('Open Claude’s connector settings and choose Add custom connector.'),
      t('Name it openGym and paste the server address. Leave the OAuth fields empty.'),
      t('Press Connect. openGym asks what Claude may see and change, you say Allow.'),
    ],
    tryIt: () => t('Ask Claude: “Look at my last month in openGym and plan my next week.”'),
  },
  {
    id: 'chatgpt', name: 'ChatGPT', tint: 'var(--green)',
    settingsUrl: 'https://chatgpt.com/plugins',
    plan: () => t('A paid ChatGPT plan, on the web. Business and Enterprise workspaces decide whether members may add their own.'),
    steps: () => [
      t('Open ChatGPT’s plugins, press the plus and choose Add custom MCP server.'),
      t('Name it openGym, paste the server address and pick OAuth.'),
      t('Sign in when ChatGPT sends you to openGym, choose what it may use, then Allow.'),
    ],
    tryIt: () => t('Ask ChatGPT: “Using openGym, how did my bench press go this month?”'),
  },
  {
    id: 'gemini', name: 'Gemini', tint: 'var(--blue)', limited: true,
    settingsUrl: 'https://gemini.google.com/',
    plan: () => t('Only some Google AI plans, personal accounts and countries so far. If you can’t find custom apps, it hasn’t reached you yet.'),
    steps: () => [
      t('In the Gemini web app open Settings & help, then Connected apps.'),
      t('Choose Add a custom app and paste the server address.'),
      t('Sign in to openGym when Gemini asks, pick what it may use and Allow.'),
    ],
    tryIt: () => t('Ask Gemini: “Make me a 3-day routine in openGym with what I already train.”'),
  },
]
export const assistantById = id => ASSISTANTS.find(a => a.id === id) || null

/** The profile's tokens that an assistant's connector sign-in made, newest use first. */
export function connectorsOf(tokens) {
  return (tokens || []).filter(tok => tok && tok.connector)
    .sort((a, b) => (b.used || b.created || 0) - (a.used || a.created || 0))
}
/** The connection an assistant has, or null: used beats made-but-never-used. */
export function connectionOf(tokens, id) {
  const mine = connectorsOf(tokens).filter(tok => tok.connector.assistant === id)
  return mine.find(tok => tok.used) || mine[0] || null
}

/**
 * Whether an assistant on the internet can reach this address at all. Claude's and ChatGPT's
 * servers call the connector from their own cloud: a LAN address or plain http never answers them.
 * 'public' | 'http' | 'local'
 */
export function reachability(address) {
  let u
  try { u = new URL(address) } catch { return 'local' }
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const local = h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || h.endsWith('.internal')
    || /^(10|127)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
    || /^(fc|fd|fe80)/.test(h) || h === '::1' || !h.includes('.') && !h.includes(':')
  if (local) return 'local'
  return u.protocol === 'https:' ? 'public' : 'http'
}
