import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'

afterEach(() => vi.unstubAllEnvs())

async function load(locale) {
  vi.resetModules()
  if (locale !== undefined) vi.stubEnv('OPENGYM_LOCALE', locale)
  else vi.stubEnv('OPENGYM_LOCALE', '')
  return Promise.all([
    import('../src/i18n.js'),
    import('../src/labels.js'),
    import('../src/tools.js'),
    import('../src/state.js')
  ])
}

describe('MCP localization', () => {
  test('Italian locale tags localize tool help and human-readable labels', async () => {
    const [{ localeCode, t }, { policyName, muscleName }, { TOOLS }, state] = await load('it-IT')

    expect(localeCode()).toBe('it')
    expect(TOOLS.find(tool => tool.name === 'list_routines').description).toContain('Elenca le schede')
    expect(TOOLS.find(tool => tool.name === 'list_workouts').schema.from.description).toContain('Data iniziale')
    expect(TOOLS.find(tool => tool.name === 'get_week_plan').name).toBe('get_week_plan')
    const weekDescription = TOOLS.find(tool => tool.name === 'get_week_plan').description
    for (const semantic of ['IN ORDINE', 'prima sessione non completata', '`starts_on`', '`pinned_to`', 'insieme alla sessione del coach']) {
      expect(weekDescription).toContain(semantic)
    }
    expect(t('weekday_names')).toEqual(['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'])
    expect(policyName('linear')).toBe('Progressione lineare')
    expect(muscleName('quadriceps')).toBe('Quadricipiti')
    expect(t('no_state')).toContain('Non ci sono ancora dati sincronizzati')

    state._seedStateForTests(buildDemoState())
    const plan = TOOLS.find(tool => tool.name === 'get_week_plan').handler({})
    expect(plan.weekdays[0]).toMatchObject({ weekday: 0, weekday_name: 'Domenica' })
    expect(['coach', 'pinned', 'override', 'rest_override', 'weekday', 'rest']).toContain(plan.days[0].planned_by)

    state._seedStateForTests(null)
    const empty = TOOLS.find(tool => tool.name === 'list_routines').handler({})
    expect(empty).toEqual({ error: t('no_state'), unit: 'kg' })
  })

  test.each([undefined, '', 'fr-FR', 'not-a-locale'])('%s falls back to the English output contract', async locale => {
    const [{ localeCode, t }, , { TOOLS }] = await load(locale)

    expect(localeCode()).toBe('en')
    expect(TOOLS.map(tool => tool.name)).toEqual([
      'list_routines', 'get_routine', 'preview_session', 'get_week_plan', 'list_workouts',
      'get_workout', 'get_bodyweight', 'estimate_1rm', 'muscle_balance'
    ])
    expect(TOOLS.find(tool => tool.name === 'list_routines').description).toBe(
      "List the workout routines saved in the user's openGym profile (the same list the Plan screen shows). Each routine is a named set of exercises with set/rep targets. Use this to discover the plan structure before diving into a specific routine or today's workout."
    )
    expect(TOOLS.find(tool => tool.name === 'get_week_plan').description).toContain('the first undone one is today')
    expect(Object.keys(TOOLS.find(tool => tool.name === 'list_workouts').schema)).toEqual(['from', 'to', 'limit'])
    expect(t('no_state')).toContain('no synced state yet')
  })
})
