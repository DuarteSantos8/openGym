// @vitest-environment happy-dom
/* JOB_ERRORS and BYOK_ERRORS are what a lifter reads when a Coach job fails, and they were English
 * literals that never went through t(): a German or Brazilian lifter read English in the middle of
 * an otherwise translated chat. They are getters over t() now. This reads every line in every
 * locale pack the way the app loads one (setLang), and pins that the text follows a language
 * picked after coach-api.js loaded, which a map translated once at load time would not.
 *
 * setLang sets the page's lang and dir (right-to-left for Arabic), so this runs with a DOM.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ MOBILE: false, coachLocal: null }))
vi.mock('./demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'gym_demo_seeded_v1', REPO: '' }))
vi.mock('./mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('./api.js', () => ({ api: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: {}, coachLocal: mocks.coachLocal }) } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

const { JOB_ERRORS, BYOK_ERRORS, jobErrorText } = await import('./coach-api.js')
const { setLang, getLang } = await import('./i18n.js')

const PACKS = Object.fromEntries(Object.entries(import.meta.glob('../locales/*.js', { eager: true }))
  .map(([path, mod]) => [path.match(/([^/]+)\.js$/)[1], mod.default]))
const MAPS = { JOB_ERRORS, BYOK_ERRORS }
// Read before any pack is loaded. English ships no pack, so these lines are the keys the packs
// translate, and what t() hands back in English.
const EN = Object.fromEntries(Object.entries(MAPS).map(([name, map]) =>
  [name, Object.fromEntries(Object.keys(map).map(cls => [cls, map[cls]]))]))
const LINES = Object.entries(EN).flatMap(([name, lines]) => Object.keys(lines).map(cls => [name, cls]))

afterEach(async () => {
  await setLang('en')
  mocks.MOBILE = false
  mocks.coachLocal = null
})

describe('every failure line, in every pack', () => {
  it('reads all seventeen packs', () => {
    expect(Object.keys(PACKS)).toHaveLength(17)
  })

  it.each(Object.keys(PACKS).sort())('%s translates each one, and the map reads it from the pack', async lang => {
    const pack = PACKS[lang]
    await setLang(lang)
    expect(getLang()).toBe(lang)
    for (const [name, cls] of LINES) {
      const english = EN[name][cls]
      expect(pack[english], `${lang}: ${name}.${cls} has no entry for ${JSON.stringify(english)}`).toBeTruthy()
      expect(pack[english], `${lang}: ${name}.${cls} is still English`).not.toBe(english)
      expect(MAPS[name][cls], `${lang}: ${name}.${cls}`).toBe(pack[english])
    }
  })
})

describe('a language picked after coach-api.js loaded', () => {
  it('changes what the same map says, and switching back restores the English', async () => {
    expect(getLang()).toBe('en')
    expect(JOB_ERRORS.unprivileged).toBe(EN.JOB_ERRORS.unprivileged)

    await setLang('de')
    expect(JOB_ERRORS.unprivileged).toBe(PACKS.de[EN.JOB_ERRORS.unprivileged])
    expect(jobErrorText('timeout', 'gave up after 10 min')).toBe(PACKS.de[EN.JOB_ERRORS.timeout])

    await setLang('pt-BR')
    expect(JOB_ERRORS.unprivileged).toBe(PACKS['pt-BR'][EN.JOB_ERRORS.unprivileged])
    expect(jobErrorText('meteor')).toBe(PACKS['pt-BR'][EN.JOB_ERRORS.internal])
    expect(jobErrorText('meteor')).not.toBe(PACKS.pt[EN.JOB_ERRORS.internal])   // Brazil's own line, not Portugal's

    await setLang('en')
    expect(JOB_ERRORS.unprivileged).toBe(EN.JOB_ERRORS.unprivileged)
    expect(jobErrorText('timeout')).toBe(EN.JOB_ERRORS.timeout)
  })

  it('reaches the own-key phone lines, with the provider detail still attached', async () => {
    mocks.MOBILE = true
    mocks.coachLocal = { mode: 'byok' }
    await setLang('fr')
    expect(jobErrorText('provider', 'quota exceeded')).toBe(PACKS.fr[EN.BYOK_ERRORS.provider] + '\nquota exceeded')
    // A class the phone has no line of its own for falls back to the shared one, translated too.
    expect(jobErrorText('restart')).toBe(PACKS.fr[EN.JOB_ERRORS.restart])
    expect(jobErrorText(undefined)).toBe(PACKS.fr[EN.BYOK_ERRORS.internal])
  })
})

/* The composer, the quick actions and the intake toast a refused request by its class,
 * JOB_ERRORS[e.data?.code], and fall back to the server's English only where there is no line.
 * These read api/coach/routes.js, where the refusals are worded, and pin that every class it
 * sends has a line here. */
describe('every refusal the server sends has a line here', () => {
  // Read by path, like Library.test.jsx reads index.css: under a DOM environment import.meta.url is
  // not a file URL. The suite runs from frontend/.
  const routes = readFileSync(resolve(process.cwd(), '../api/coach/routes.js'), 'utf8')

  // The guard in front of every Coach route answers 503 while the Coach is switched off or has
  // no provider. Its body carried the words and no class, so the app toasted the server's English.
  it('the Coach-off guard in front of every route names a class this map has a line for', () => {
    const guard = routes.match(/const guard = [\s\S]*?\n {2}\};/)?.[0]
    expect(guard).toBeTruthy()
    const body = guard.match(/json\(res, 503, (\{[^}]*\})\)/)?.[1]
    expect(body).toBeTruthy()
    const cls = body.match(/code: '(\w+)'/)?.[1]
    expect(cls, `the 503 guard answers ${body}, with no class`).toBeTruthy()
    expect(body).toContain(`error: USER_ERROR.${cls}`)   // its words are that class's words
    expect(Object.keys(JOB_ERRORS)).toContain(cls)
    expect(JOB_ERRORS[cls]).toBe('The Coach isn’t set up on this instance.')
  })

  // A refusal at enqueue sends { error: USER_ERROR[code], code }. 'shared' is worded verbatim on
  // purpose (it names who can resolve it), so it keeps the server's words; every other class
  // gets the app's line.
  it('every class the enqueue refusal words has a line, except the verbatim shared-account one', () => {
    const block = routes.match(/const USER_ERROR = \{([\s\S]*?)\n\};/)?.[1]
    expect(block).toBeTruthy()
    const classes = [...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1])
    expect(classes).toEqual(expect.arrayContaining(['off', 'busy', 'cap', 'consent', 'shared', 'unprivileged']))
    for (const cls of classes.filter(c => c !== 'shared')) expect(Object.keys(JOB_ERRORS), cls).toContain(cls)
  })

  it('the unprivileged line says what the server says, in the app\'s voice', () => {
    const atEnqueue = routes.match(/^\s*unprivileged: '([^']+)'/m)?.[1]
    expect(atEnqueue).toBeTruthy()
    expect(EN.JOB_ERRORS.unprivileged).toBe(atEnqueue[0].toUpperCase() + atEnqueue.slice(1) + '.')
  })
})
