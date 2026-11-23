import { adminT } from './admin-i18n.js'

export const COACH_GROUP_COPY = [
  ['Paste an API key', 'Plain HTTPS to the provider. Works on the default api image, nothing extra to install.'],
  ['Runs a local AI runtime', 'Needs the bigger api image built with --target coach.'],
  ['Testing', 'A built-in fake that answers instantly, so the whole loop can be tried without an account.'],
  ['Sign in with your plan (preview)', 'Your ChatGPT Plus or Pro plan pays for the Coach. Switched on with COACH_CHATGPT_PLAN=on; for your own instance (OpenAI asks hosted apps to apply first).']
]

export const credentialHint = (auth, meta) => {
  const s = auth?.state
  if (s === 'connected') return adminT('Connected') + (auth.account ? ' ' + adminT('as') + ' ' + auth.account : '')
  if (s === 'not-required') return adminT("Not needed")
  if (s === 'optional') return adminT("Optional for this endpoint")
  if (s === 'unreadable') return adminT("Stored key can't be read. Add it again")
  return meta.signIn === 'chatgpt' ? adminT("Sign-in needed") : meta.setupToken ? adminT("Token or API key needed") : adminT("API key needed")
}

export const credentialLabel = type => ({
  'cli-token': adminT("Claude Code setup token"), 'chatgpt-cli': adminT("ChatGPT CLI login"), oauth: adminT("sign-in"), apikey: adminT("API key")
}[type] || adminT('credential'))

// The failure classes jobs.js emits, in words an operator can act on.
export const failureTitle = cls => ({
  timeout: adminT("The provider took longer than the job budget (COACH_JOB_TIMEOUT_MS, default 10 minutes)"),
  missing: adminT("The provider runtime or key is missing"),
  auth: adminT("The provider rejected the credential"),
  // The four ways a provider call fails that used to be one line, "The provider returned an
  // error", on this card and in the chat. Each has its own fix; naming it is the point.
  quota: adminT("The provider is out of quota, or rate limiting this instance"),
  schema: adminT("The provider would not serve the request shape we send (try another model)"),
  outage: adminT("The provider was having an outage (5xx after its own retries)"),
  cutoff: adminT("The connection dropped while the model was thinking or answering (a NAT, proxy or CDN idle limit)"),
  unreachable: adminT("The provider could not be reached at all (network, DNS or the endpoint)"),
  provider: adminT("The provider returned an error"),
  unusable: adminT("The model answered, but not in a shape the app could use"),
  restart: adminT("The server restarted while a job was running"),
  nostate: adminT("The user's training data could not be read"),
  off: adminT("The Coach was off when the job ran"),
  toolarge: adminT("The user's training data made a request too large to send, so no provider was called"),
  internal: adminT("Something went wrong on the server")
}[cls] || cls || adminT('Failed'))

/* ------------------------------- setup token -------------------------------- */

// The setup token stays on offer (owner decision, sub-connect-146), with the risk said plainly
// where it is pasted: Anthropic's terms allow it in Claude Code only
// (code.claude.com/docs/en/agent-sdk/overview, "Authentication").
export const SETUP_TOKEN_RISK = 'Anthropic\'s terms only allow this token in Claude Code; using it here can get your Claude account limited. An API key, or openGym as a connector inside Claude (Use your subscription), is the safe way.'
