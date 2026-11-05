// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  askGemini, GeminiError, summaryToText, requestBody, SYSTEM_PROMPT, SECTIONS, GEMINI_MODELS, GEMINI_ENDPOINT,
  loadReport, saveReport, clearReport,
} from './perf-report.js'
import { analyzePerf } from './perf-analysis.js'

const TODAY = '2026-11-05'
const set = (w, r) => ({ w, r, done: true })
const day = (d, entries) => ({ id: 'w' + d, d, start: Date.parse(d + 'T10:00:00'), entries })
const S = {
  unit: 'kg', routines: [{ id: 'push', name: 'Push', ex: [] }], week: { 1: ['push'] }, dayPlan: {},
  gyms: [{ id: 'bf', name: 'Basic-Fit' }],
  workouts: [
    day('2026-10-05', [{ id: '0025', gym: 'bf', sets: [set(60, 8)] }]),
    day('2026-10-12', [{ id: '0025', gym: 'bf', sets: [set(62.5, 8)] }]),
    day('2026-10-19', [{ id: '0025', gym: 'bf', sets: [set(65, 8)] }]),
    day('2026-11-02', [{ id: '0025', gym: 'bf', sets: [set(70, 8)] }, { id: '0043', sets: [set(100, 5)] }]),
  ],
}

const reply = (status, body) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
const ok = text => reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })
const err = (status, st, message) => reply(status, { error: { code: status, status: st, message } })

describe('summaryToText', () => {
  const a = analyzePerf(S, { today: TODAY })
  const text = summaryToText(a)
  it('is French and names the machine of each exercise', () => {
    expect(text).toContain('Résumé de mes séances de musculation')
    expect(text).toContain('barbell bench press [Basic-Fit]')
    expect(text).toContain('RÉGULARITÉ')
    expect(text).toContain('VOLUME')
  })
  it('gives the 1RM change and the verdict of a line', () => {
    expect(text).toContain('1RM estimé 76 → 88,7 kg (+16,7 %)')
    expect(text).toContain('progresse')
  })
  it('carries figures only: no workout ids, no dates of the raw log beyond the skipped sessions', () => {
    expect(text).not.toContain('w2026')
    expect(text).not.toContain('"')
  })
  it('is deterministic', () => {
    expect(summaryToText(analyzePerf(S, { today: TODAY }))).toBe(text)
  })
  it('says there is nothing to analyse on an empty period', () => {
    expect(summaryToText(analyzePerf({ ...S, workouts: [] }, { today: TODAY }))).toBe('Aucune séance enregistrée sur la période : rien à analyser.')
  })
  it('stays short however long the log is', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: String(1000 + i).padStart(4, '0'), sets: [set(20 + i, 8)] }))
    const big = { ...S, workouts: ['2026-10-12', '2026-10-26'].map(d => day(d, many)) }
    expect(summaryToText(analyzePerf(big, { today: TODAY })).split('\n').length).toBeLessThan(80)
  })
})

describe('the request', () => {
  it('asks for the four sections, in French, from the summary only', () => {
    for (const s of SECTIONS) expect(SYSTEM_PROMPT).toContain(s)
    expect(SYSTEM_PROMPT).toContain('français')
    const body = requestBody('RÉSUMÉ')
    expect(body.contents[0].parts[0].text).toBe('RÉSUMÉ')
    expect(JSON.stringify(body)).not.toMatch(/apiKey|key/i)
  })
})

describe('askGemini', () => {
  it('sends the key in a header, never in the URL, and returns the text', async () => {
    const f = ok('## Ce qui marche bien\n- Bien')
    const res = await askGemini('  AIzaTEST  ', 'résumé', { fetchImpl: f })
    expect(res).toEqual({ text: '## Ce qui marche bien\n- Bien', model: GEMINI_MODELS[0] })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(`${GEMINI_ENDPOINT}${GEMINI_MODELS[0]}:generateContent`)
    expect(url).not.toContain('AIzaTEST')
    expect(init.headers['x-goog-api-key']).toBe('AIzaTEST')
    expect(JSON.parse(init.body).contents[0].parts[0].text).toBe('résumé')
  })

  it('joins the parts of an answer', async () => {
    const f = reply(200, { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] })
    expect((await askGemini('k', 'x', { fetchImpl: f })).text).toBe('ab')
  })

  it('has no key: says so before any request', async () => {
    const f = ok('x')
    await expect(askGemini('  ', 'x', { fetchImpl: f })).rejects.toMatchObject({ kind: 'nokey' })
    expect(f).not.toHaveBeenCalled()
  })

  it('a key Google refuses', async () => {
    await expect(askGemini('k', 'x', { fetchImpl: err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.') })).rejects.toMatchObject({ kind: 'badkey' })
    await expect(askGemini('k', 'x', { fetchImpl: err(403, 'PERMISSION_DENIED', 'nope') })).rejects.toMatchObject({ kind: 'badkey' })
  })

  it('the free limit is reached', async () => {
    await expect(askGemini('k', 'x', { fetchImpl: err(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded') })).rejects.toMatchObject({ kind: 'rate' })
  })

  it('no connection', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(askGemini('k', 'x', { fetchImpl: f })).rejects.toMatchObject({ kind: 'offline' })
  })

  it('Google overloaded', async () => {
    await expect(askGemini('k', 'x', { fetchImpl: err(503, 'UNAVAILABLE', 'overloaded') })).rejects.toMatchObject({ kind: 'busy' })
  })

  it('no answer in time', async () => {
    const f = vi.fn((url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
    await expect(askGemini('k', 'x', { fetchImpl: f, timeoutMs: 5 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('an answer with no text (blocked or cut) is not shown as a bilan', async () => {
    const f = reply(200, { candidates: [{ finishReason: 'SAFETY' }] })
    await expect(askGemini('k', 'x', { fetchImpl: f })).rejects.toMatchObject({ kind: 'empty', detail: 'SAFETY' })
  })

  it('falls back to the next model when the first is unknown to this key', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', message: 'model not found' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) })
    const res = await askGemini('k', 'x', { fetchImpl: f })
    expect(res.model).toBe(GEMINI_MODELS[1])
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('does not retry a wrong key on another model', async () => {
    const f = err(400, 'INVALID_ARGUMENT', 'API key not valid')
    await askGemini('k', 'x', { fetchImpl: f }).catch(() => {})
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('is a GeminiError the screen can read', async () => {
    const e = await askGemini('k', 'x', { fetchImpl: err(429, 'RESOURCE_EXHAUSTED', 'q') }).catch(x => x)
    expect(e).toBeInstanceOf(GeminiError)
  })
})

describe('the kept bilan', () => {
  beforeEach(() => localStorage.clear())
  it('is read back as it was saved', () => {
    saveReport({ at: 123, text: 'bilan', model: 'm', period: { from: 'a', to: 'b' } })
    expect(loadReport()).toMatchObject({ at: 123, text: 'bilan' })
  })
  it('is null when nothing was saved, after clearing, or when the stored value is junk', () => {
    expect(loadReport()).toBeNull()
    saveReport({ at: 1, text: 'x' }); clearReport()
    expect(loadReport()).toBeNull()
    localStorage.setItem('gym_perf_report', '{nope')
    expect(loadReport()).toBeNull()
    localStorage.setItem('gym_perf_report', JSON.stringify({ at: 1, text: '' }))
    expect(loadReport()).toBeNull()
  })
})

describe('copyableBilan', () => {
  it('asks for the four sections, then gives the summary', async () => {
    const { copyableBilan } = await import('./perf-report.js')
    const a = analyzePerf(S, { today: TODAY })
    const text = copyableBilan(a)
    for (const s of SECTIONS) expect(text).toContain(s)
    expect(text.endsWith(summaryToText(a))).toBe(true)
  })
})
