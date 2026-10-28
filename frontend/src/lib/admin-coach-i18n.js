import { adminT } from './admin-i18n.js'

export const COACH_GROUP_COPY = [
  ['Paste an API key', 'Plain HTTPS to the provider. Works on the default api image, nothing extra to install.'],
  ['Runs a local AI runtime', 'Needs the bigger api image built with --target coach.'],
  ['Testing', 'A built-in fake that answers instantly, so the whole loop can be tried without an account.']
]

export const credentialHint = (auth, meta) => {
  const s = auth?.state
  if (s === 'connected') return adminT('Connected') + (auth.account ? ' ' + adminT('as') + ' ' + auth.account : '')
  if (s === 'not-required') return adminT('Not needed')
  if (s === 'optional') return adminT('Optional for this endpoint')
  if (s === 'unreadable') return adminT('Stored key cannot be read. Add it again')
  return meta.setupToken ? adminT('Token or API key needed') : adminT('API key needed')
}

export const credentialLabel = type => adminT({
  'cli-token': 'Claude Code setup token', 'chatgpt-cli': 'ChatGPT CLI login', oauth: 'legacy token', apikey: 'API key', unknown: 'credential'
}[type] || 'credential')

export const failureTitle = cls => adminT(({
  timeout: 'The provider took longer than the job budget (COACH_JOB_TIMEOUT_MS, default 5 minutes)',
  missing: 'The provider runtime or key is missing',
  auth: 'The provider rejected the credential',
  provider: 'The provider returned an error',
  unusable: 'The model answered, but not in a shape the app could use',
  restart: 'The server restarted while a job was running',
  nostate: 'The user\'s training data could not be read',
  off: 'The Coach was off when the job ran',
  toolarge: 'The user\'s training data made a request too large to send, so no provider was called',
  internal: 'Something went wrong on the server'
}[cls] || cls || 'Failed'))
