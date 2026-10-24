/* jobErrorText is what a lifter reads when a Coach job fails. A queued job the server refuses
 * when it comes to start it — the process cannot drop privileges — ends with errorClass
 * 'unprivileged'. JOB_ERRORS had no line for that class, so it fell back on the internal line
 * ("Something went wrong on the server."), which says nothing, while the same refusal at enqueue
 * already answers with words the operator can act on (api/coach/routes.js USER_ERROR). This pins
 * the line, and that it reads the same as the enqueue refusal.
 *
 * coach-api.js pulls the store and the demo/local modules in; they are stubbed so importing it
 * needs no running app. jobErrorText on the server path (not a phone with its own key) is all
 * this file exercises.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ MOBILE: false, coachLocal: null, toast: vi.fn() }))
vi.mock('./demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'gym_demo_seeded_v1', REPO: '' }))
vi.mock('./mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('./api.js', () => ({ api: vi.fn() }))
vi.mock('./coach-demo.js', () => ({}))
vi.mock('./coach-local.js', () => ({ setNotifier: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: { unit: 'kg' }, coachLocal: mocks.coachLocal }) } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: mocks.toast }) } }))

const { jobErrorText, JOB_ERRORS } = await import('./coach-api.js')

beforeEach(() => { mocks.MOBILE = false; mocks.coachLocal = null })

describe('jobErrorText for a job refused at start for safety', () => {
  it('reads as the refusal at enqueue does, not as internal', () => {
    expect(JOB_ERRORS.unprivileged).toBeTruthy()
    expect(jobErrorText('unprivileged')).toBe(JOB_ERRORS.unprivileged)
    expect(jobErrorText('unprivileged')).not.toBe(JOB_ERRORS.internal)
    // The provider detail a real failure would carry is kept off the lifter's screen on the
    // server path, the same as every other class.
    expect(jobErrorText('unprivileged', 'COACH_UID is not set')).toBe(JOB_ERRORS.unprivileged)
  })

  it('says it in the same words the enqueue refusal answers with (api/coach/routes.js)', () => {
    const routes = readFileSync(new URL('../../../api/coach/routes.js', import.meta.url), 'utf8')
    const atEnqueue = routes.match(/^\s*unprivileged: '([^']+)'/m)?.[1]
    expect(atEnqueue).toBeTruthy()
    expect(JOB_ERRORS.unprivileged.toLowerCase()).toBe(atEnqueue.toLowerCase() + '.')
  })
})
