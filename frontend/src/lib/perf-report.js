// The written side of "Analyser mes dernières perfs": the summary as text (what the Gemini bilan is
// built from, and what "Copier mon bilan" puts on the clipboard to paste into Claude), the Gemini
// call, and the last bilan kept on the phone.
//
// PRIVACY. Gemini only ever gets the summary lib/perf-analysis.js computed: a few dozen lines of
// figures per exercise and machine, never the workouts themselves. The API key is the user's own,
// kept in the platform's secure storage (lib/coach-secrets.js), never in S, in the code or on GitHub,
// and it travels in a header, never in a URL.
//
// The model is a current Flash one (checked against Google's model list, November 2026):
// `gemini-3.6-flash` is the stable one, `gemini-3.5-flash-lite` the fallback when a key has no
// access to it. Both have a free tier in Google AI Studio.
import { secureGet, secureSet, secureRemove } from './coach-secrets.js'

export const GEMINI_KEY_NAME = 'perf.geminiKey'
export const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite']
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/'
export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey'
export const GEMINI_TIMEOUT_MS = 45000
const REPORT_KEY = 'gym_perf_report'

export const getGeminiKey = () => secureGet(GEMINI_KEY_NAME)
export const setGeminiKey = v => secureSet(GEMINI_KEY_NAME, v)
export const clearGeminiKey = () => secureRemove(GEMINI_KEY_NAME)

/* ------------------------------------------------------------------ the summary as text --- */

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const dateFr = iso => { const [, m, d] = String(iso).split('-').map(Number); return d && m ? `${d} ${MONTHS[m - 1]}` : String(iso) }
const num = n => (Number.isFinite(n) ? String(Math.round(n * 10) / 10).replace('.', ',') : '?')
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n))
const STATUS_FR = { progress: 'progresse', stagnation: 'stagne', regression: 'recule', stable: 'stable', new: 'pas assez de séances' }
const FLAG_FR = {
  'push-heavy': 'beaucoup plus de poussée (pectoraux, épaules, triceps) que de tirage',
  'pull-heavy': 'beaucoup plus de tirage (dos, biceps) que de poussée',
  'upper-heavy': 'haut du corps très au-dessus du bas du corps',
  'lower-heavy': 'bas du corps très au-dessus du haut du corps',
}
// The long tail of an exercise list adds words, not information.
export const MAX_EXERCISE_LINES = 25

/** One exercise + machine as a line of the summary. */
export function exerciseLine(e, unit) {
  const what = e.metric === 'e1rm' ? `1RM estimé ${num(e.first.value)} → ${num(e.last.value)} ${unit}` : `meilleur nombre de reps ${num(e.first.value)} → ${num(e.last.value)}`
  const set = e.metric === 'e1rm' ? `, dernière série ${num(e.last.w)}×${num(e.last.r)}` : ''
  const stall = e.status === 'stagnation' ? ` (${e.stalledFor} séances sans nouveau record)` : ''
  const drop = e.status === 'regression' && e.dropped ? ' (charge ou reps en baisse)' : ''
  return `- ${e.name}${e.machine ? ` [${e.machine}]` : ''} : ${e.sessions} séance${e.sessions > 1 ? 's' : ''}, ${what} (${e.sessions > 1 ? signed(e.changePct) + ' %' : 'une seule séance'})${set}, ${STATUS_FR[e.status]}${stall}${drop}`
}

/** The whole summary, in French, as plain text. Deterministic: the same analysis gives the same text. */
export function summaryToText(a) {
  if (!a || !a.hasData) return 'Aucune séance enregistrée sur la période : rien à analyser.'
  const unit = a.unit
  const out = []
  out.push(`Résumé de mes séances de musculation du ${dateFr(a.period.from)} au ${dateFr(a.period.to)} (${a.period.weeks} semaines). Charges en ${unit}.`)
  out.push('Les exercices ne sont comparés que sur la même machine : une charge n’a de sens que sur la machine indiquée entre crochets.')

  const s = a.sessions
  out.push('', 'RÉGULARITÉ')
  out.push(`- ${s.total} séances en ${a.period.weeks} semaines, soit ${num(s.perWeek)} par semaine (${s.plannedPerWeek} jour${s.plannedPerWeek > 1 ? 's' : ''} de séance prévu${s.plannedPerWeek > 1 ? 's' : ''} par semaine).`)
  out.push(`- Séances par semaine civile : ${s.weeks.map(w => w.sessions).join(', ')} (de la plus ancienne à la plus récente ; la première et la dernière peuvent être incomplètes).`)
  out.push(s.skipped.length
    ? `- ${s.skipped.length} séance${s.skipped.length > 1 ? 's' : ''} prévue${s.skipped.length > 1 ? 's' : ''} sautée${s.skipped.length > 1 ? 's' : ''} : ${s.skipped.slice(-8).map(k => `${dateFr(k.d)}${k.names.length ? ' (' + k.names.join(' + ') + ')' : ''}`).join(', ')}.`
    : '- Aucune séance prévue sautée.')

  const shown = [...a.exercises].sort((x, y) => (y.status !== 'stable') - (x.status !== 'stable') || y.sessions - x.sessions).slice(0, MAX_EXERCISE_LINES)
  out.push('', 'EXERCICES (1RM estimé par la formule d’Epley, par exercice et par machine)')
  shown.forEach(e => out.push(exerciseLine(e, unit)))
  if (a.exercises.length > shown.length) out.push(`- … et ${a.exercises.length - shown.length} autres exercices stables ou récents.`)

  if (a.records.length) {
    out.push('', 'RECORDS RÉCENTS')
    a.records.forEach(r => out.push(`- ${r.name}${r.machine ? ` [${r.machine}]` : ''} : ${r.metric === 'e1rm' ? `1RM estimé ${num(r.value)} ${unit} (${num(r.w)}×${num(r.r)})` : `${num(r.value)} reps`}, le ${dateFr(r.d)} (avant : ${num(r.before)})`))
  }

  const v = a.volume
  out.push('', 'VOLUME (séries effectives par semaine, moyenne sur la période)')
  out.push(v.byGroup.map(g => `${g.name} ${num(g.perWeek)}`).join(' ; ') + '.')
  const ratio = (x, y, r) => (r === null ? `${num(x)} contre ${num(y)}` : `${num(x)} contre ${num(y)}, rapport ${num(r)}`)
  out.push(`- Poussée / tirage : ${ratio(v.push, v.pull, v.pushPull)} séries par semaine.`)
  out.push(`- Haut / bas du corps : ${ratio(v.upper, v.lower, v.upperLower)} séries par semaine.`)
  a.flags.forEach(f => out.push(`- Déséquilibre : ${FLAG_FR[f]}.`))
  if (a.lowGroups.length) out.push(`- Moins de 4 séries par semaine : ${a.lowGroups.map(id => v.byGroup.find(g => g.id === id)?.name).filter(Boolean).join(', ')}.`)

  out.push('', `BILAN CHIFFRÉ : ${a.counts.progress} exercice${a.counts.progress > 1 ? 's' : ''} en progression, ${a.counts.stagnation} en stagnation, ${a.counts.regression} en recul.`)
  return out.join('\n')
}

/* ----------------------------------------------------------------------------- the prompt --- */

export const SECTIONS = ['Ce qui marche bien', 'Stagnations et problèmes', 'Exos à changer ou à modifier', 'Conseils pour les prochaines semaines']

export const SYSTEM_PROMPT = [
  'Tu es un coach de musculation expérimenté. Tu reçois le résumé chiffré de mes dernières semaines d’entraînement.',
  'Réponds en français, de façon courte et concrète : 250 mots maximum, des phrases simples, pas d’introduction ni de conclusion.',
  'Utilise exactement ces quatre sections, chacune avec un titre en markdown (## Titre) puis quelques puces :',
  ...SECTIONS.map((s, i) => `${i + 1}. ${s}${i === 2 ? ' (pour chaque exercice, une suggestion précise : changer de variante, de gamme de reps, de fréquence, de progression)' : ''}`),
  'Appuie-toi uniquement sur les chiffres du résumé, n’invente rien. Les charges ne sont comparables que sur la même machine.',
  'Pas de conseil médical : en cas de douleur, renvoie vers un professionnel.',
].join('\n')

/** The request body for generateContent. */
export function requestBody(summaryText) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: summaryText }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  }
}

/* ------------------------------------------------------------------------------ the call --- */

/** An error the screen can say something useful about: `kind` is what happened. */
export class GeminiError extends Error {
  constructor(kind, detail) { super(kind + (detail ? ': ' + detail : '')); this.name = 'GeminiError'; this.kind = kind; this.detail = detail || '' }
}
// kind: 'nokey' no key saved · 'badkey' refused (wrong, revoked, or no access) · 'offline' no connection
// · 'rate' quota or rate limit reached · 'busy' Google is overloaded or down · 'timeout' no answer in time
// · 'empty' an answer with no text (blocked or cut) · 'error' anything else

const textOf = json => (json?.candidates?.[0]?.content?.parts || []).map(p => (typeof p?.text === 'string' ? p.text : '')).join('').trim()

/**
 * Asks Gemini for the bilan of `summaryText`. Resolves `{ text, model }`; rejects with a GeminiError.
 * `fetchImpl`, `models` and `timeoutMs` are parameters so tests need no network and no clock.
 */
export async function askGemini(apiKey, summaryText, { fetchImpl = globalThis.fetch, models = GEMINI_MODELS, timeoutMs = GEMINI_TIMEOUT_MS } = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new GeminiError('nokey')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new GeminiError('offline')
  let last = null
  for (const model of models) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
    let res
    try {
      res = await fetchImpl(`${GEMINI_ENDPOINT}${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(requestBody(summaryText)),
        ...(ctl ? { signal: ctl.signal } : {}),
      })
    } catch (e) {
      if (timer) clearTimeout(timer)
      if (e?.name === 'AbortError') throw new GeminiError('timeout')
      throw new GeminiError('offline', e?.message)
    }
    if (timer) clearTimeout(timer)
    let json = null
    try { json = await res.json() } catch { /* not JSON: the status says enough */ }
    const status = String(json?.error?.status || '')
    const message = String(json?.error?.message || '')
    if (res.ok) {
      const text = textOf(json)
      if (text) return { text, model }
      throw new GeminiError('empty', json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || '')
    }
    // a model this key cannot use (or that no longer exists): try the next one
    if (res.status === 404 || (res.status === 400 && /model/i.test(message) && !/api key/i.test(message))) { last = new GeminiError('error', `${model}: ${message || res.status}`); continue }
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') throw new GeminiError('rate', message)
    if (res.status === 401 || res.status === 403 || /API_KEY|API key/i.test(message) || status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') throw new GeminiError('badkey', message)
    if (res.status >= 500) throw new GeminiError('busy', message)
    throw new GeminiError('error', message || String(res.status))
  }
  throw last || new GeminiError('error')
}

/* -------------------------------------------------------------------- the last bilan kept --- */

/** { at, text, model, period } of the last bilan, or null. Device only: not synced, not exported. */
export function loadReport() {
  try {
    const r = JSON.parse(localStorage.getItem(REPORT_KEY))
    return r && typeof r.text === 'string' && r.text ? r : null
  } catch { return null }
}
export function saveReport(report) {
  try { localStorage.setItem(REPORT_KEY, JSON.stringify(report)) } catch { /* storage full or private mode: the bilan is shown, just not kept */ }
}
export function clearReport() {
  try { localStorage.removeItem(REPORT_KEY) } catch { /* nothing to clear */ }
}

/* --------------------------------------------------------------- for pasting into Claude --- */

/** What "Copier mon bilan" puts on the clipboard: a short ask, then the summary, ready to paste in Claude. */
export function copyableBilan(a) {
  return [
    'Voici le résumé chiffré de mes dernières semaines de musculation. Fais-moi un bilan court et concret, en français, avec ces sections :',
    SECTIONS.map(s => `- ${s}`).join('\n'),
    'Appuie-toi uniquement sur ces chiffres. Les charges ne sont comparables que sur la même machine.',
    '',
    summaryToText(a),
  ].join('\n')
}
