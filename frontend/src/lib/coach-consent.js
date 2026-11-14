// Who the Coach may send your training to, as this device remembers it.
//
// The intake's consent (S.coach.consent) says yes to the Coach as an idea. This says yes to one
// particular AI service: the first request that would send training data to a provider asks,
// once, naming the provider and what goes there (components/CoachConsentSheet.jsx), and the
// answer is kept per provider and host. Point the Coach somewhere else and it asks again.
//
// A device fact, not training data, so not in S: it must not sync a yes given on one phone to
// another device that never showed the question, nor ride into an export. On the mobile build
// it is also written to a file, because the WebView may evict localStorage, and an app that
// forgets your answer asks again, which is annoying but never wrong.
//
// A model on your own machine or network (Ollama on the LAN, a box on your tailnet) is not a
// third party, so it is not asked about: see isLocalHost.
import { MOBILE, readJsonFile, writeJsonFile } from './mobile.js'

const KEY = 'gym_coach_ai_consent'
const FILE = 'opengym-coach-consent.json'

// The name a person knows the company by. A compatible endpoint is whatever it was pointed at,
// so it is named by its host; the runtime providers on a server talk to the same companies.
export const PROVIDER_NAMES = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini', claude: 'Anthropic', codex: 'OpenAI' }
// Server providers that send nothing anywhere: the test fixture answers from a file.
const NOWHERE = new Set(['fixture', 'demo'])

/**
 * Whether a host is the user's own machine or network rather than somebody's service: loopback,
 * the private and link-local ranges, CGNAT (where Tailscale lives), and the names only a local
 * resolver answers (a bare `ollama`, `*.local`, `*.lan`, `*.home.arpa`, `*.internal`, `*.ts.net`).
 * A public name that happens to point at a home server cannot be told apart, and is asked about.
 */
export function isLocalHost(host) {
  let h = String(host || '').trim().toLowerCase()
  if (!h) return false
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']'))        // [::1]:11434
  else if ((h.match(/:/g) || []).length === 1) h = h.split(':')[0] // name:port, v4:port
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1') return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  if (h.includes(':')) return /^(fc|fd|fe8|fe9|fea|feb)/.test(h)  // unique-local and link-local v6
  if (!h.includes('.')) return true                                // a single-label name: docker, the LAN
  return /\.(local|lan|home\.arpa|internal|ts\.net)$/.test(h)
}

/**
 * What a disclosure (coach-api.js `disclosure()`) amounts to, for asking and for remembering.
 * `via` is 'server' (the paired or signed-in server runs it with its admin's provider) or
 * 'device' (this phone, with its own key). Null when there is nothing to ask about.
 */
export function consentTarget(info, via) {
  if (!info || !info.provider || NOWHERE.has(info.provider)) return null
  const provider = String(info.provider)
  const host = info.host ? String(info.host).toLowerCase() : null
  const name = (provider !== 'compatible' && PROVIDER_NAMES[provider]) || host || info.providerLabel || provider
  return { key: `${via}|${provider}|${host || ''}`, via, provider, host, name, local: isLocalHost(host) }
}

/* ---------- the remembered answers ---------- */

let cache = null
const listeners = new Set()
const readLocal = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }

async function load() {
  if (cache) return cache
  const saved = (MOBILE && await readJsonFile(FILE)) || readLocal()
  cache = saved && typeof saved === 'object' && saved.list && typeof saved.list === 'object' ? saved : { list: {} }
  return cache
}
async function save(next) {
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* the file, or memory, still has it */ }
  if (MOBILE) await writeJsonFile(FILE, next)
  listeners.forEach(fn => { try { fn() } catch { /* a listener's problem */ } })
}

export async function hasAiConsent(target) {
  if (!target) return false
  return !!(await load()).list[target.key]
}
export async function allowAi(target) {
  const c = await load()
  const { key, via, provider, host, name } = target
  await save({ list: { ...c.list, [key]: { via, provider, host, name, at: new Date().toISOString() } } })
}
export async function withdrawAi(key) {
  const c = await load()
  const list = { ...c.list }
  delete list[key]
  await save({ list })
}
/** Everything allowed on this device, newest first: what the settings list shows. */
export async function aiConsents() {
  return Object.entries((await load()).list).map(([key, v]) => ({ key, ...v })).sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
export function onAiConsentChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Test seam.
export function _resetAiConsent() { cache = null; listeners.clear() }
