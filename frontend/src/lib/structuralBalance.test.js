import { describe, expect, it } from 'vitest'
import { computeBalance, classify, ratioFor, resolveCurrent, resolveCurrentReps, targetFor, overrideKey, overrideIdOf, withOverride, loadForReps, loadAtReps } from './structuralBalance.js'
import { TEMPLATES, EVALUATION_MODES, BALANCE_STATUSES, BORDERLINE_BAND_PCT } from './structuralBalanceTemplates.js'

const NOW = Date.parse('2026-01-15T00:00:00Z')

const workoutAt = (id, start, sets) => ({
  d: new Date(start).toISOString(),
  start,
  entries: [{ id, sets }],
})
const setDone = (w, r) => ({ done: true, w, r })

const findRole = (template, roleId) => template.roles.find(r => r.id === roleId)

describe('classify', () => {
  it('is balanced at or above target, borderline within the band, weak further below, no-data otherwise', () => {
    expect(classify(75, 75)).toBe(BALANCE_STATUSES.BALANCED)
    expect(classify(80, 75)).toBe(BALANCE_STATUSES.BALANCED)
    expect(classify(70, 75)).toBe(BALANCE_STATUSES.BORDERLINE) // exactly at the 5-point edge
    expect(classify(69.9, 75)).toBe(BALANCE_STATUSES.WEAK)
    expect(classify(50, 75)).toBe(BALANCE_STATUSES.WEAK)
    expect(classify(null, 75)).toBe(BALANCE_STATUSES.NO_DATA)
    expect(classify(NaN, 75)).toBe(BALANCE_STATUSES.NO_DATA)
  })
})

describe('computeBalance — load-ratio mode (Thibaudeau powerlifting)', () => {
  const template = TEMPLATES.thibaudeauPowerlifting

  it('balanced/borderline/weak edges for a non-anchor role', () => {
    const S = (benchW) => ({
      unit: 'kg',
      workouts: [
        workoutAt('0043', NOW - 1000, [setDone(100, 1)]), // squat anchor: 100kg 1RM
        workoutAt('0025', NOW, [setDone(benchW, 1)]),
      ],
    })
    const bench = template.roles.find(r => r.id === 'bench') // targetPct 75

    let results = computeBalance(S(75), template)
    expect(results.find(r => r.roleId === 'bench').status).toBe(BALANCE_STATUSES.BALANCED)
    expect(results.find(r => r.roleId === 'bench').actualPct).toBeCloseTo(75)

    results = computeBalance(S(70), template) // exactly BORDERLINE_BAND_PCT under target
    expect(results.find(r => r.roleId === 'bench').status).toBe(BALANCE_STATUSES.BORDERLINE)

    results = computeBalance(S(69), template)
    expect(results.find(r => r.roleId === 'bench').status).toBe(BALANCE_STATUSES.WEAK)
  })

  it('scores the anchor role itself at 100% whenever it has any data, and no-data when it has none', () => {
    const withSquat = computeBalance({ unit: 'kg', workouts: [workoutAt('0043', NOW, [setDone(120, 1)])] }, template)
    const squat = withSquat.find(r => r.roleId === 'squat')
    expect(squat.actualPct).toBeCloseTo(100)
    expect(squat.status).toBe(BALANCE_STATUSES.BALANCED)

    const withoutSquat = computeBalance({ unit: 'kg', workouts: [] }, template)
    expect(withoutSquat.find(r => r.roleId === 'squat').status).toBe(BALANCE_STATUSES.NO_DATA)
  })

  // Loads exactly at a table's ratio, lifted for the same reps, are exactly that ratio of each
  // other — whatever the reps. Rounded estimates of both could land either side of it.
  it('a lift exactly at its ratio of the anchor is balanced, at any reps', () => {
    const poliquin = TEMPLATES.poliquin
    const deadlift = computeBalance({ unit: 'kg', workouts: [
      workoutAt('1436', NOW - 1000, [setDone(100, 5)]),
      workoutAt('0032', NOW, [setDone(125, 5)]),
    ] }, poliquin).find(r => r.roleId === 'deadlift')
    expect(deadlift.actualPct).toBeCloseTo(125, 9)
    expect(deadlift.status).toBe(BALANCE_STATUSES.BALANCED)

    const missed = []
    for (const tpl of [poliquin, template]) {
      for (const role of tpl.roles.filter(r => r.anchorRoleId && !['dips', 'supinePullups'].includes(r.id))) {
        const anchor = findRole(tpl, role.anchorRoleId)
        for (let anchorKg = 40; anchorKg <= 250; anchorKg += 2.5) {
          for (const reps of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
            for (const unit of ['kg', 'lb']) {
              const S = { unit, workouts: [
                workoutAt(anchor.exerciseIds[0], NOW - 1000, [setDone(anchorKg, reps)]),
                workoutAt(role.exerciseIds[0], NOW, [setDone(anchorKg * role.targetPct / 100, reps)]),
              ] }
              const row = computeBalance(S, tpl).find(r => r.roleId === role.id)
              if (row.status !== BALANCE_STATUSES.BALANCED) missed.push(`${tpl.id} ${role.id} ${anchorKg} ${unit} × ${reps}: ${row.actualPct}`)
            }
          }
        }
      }
    }
    expect(missed).toEqual([])
  })

  it('a non-anchor role is no-data when the anchor itself has no data, even if the role does', () => {
    const S = { unit: 'kg', workouts: [workoutAt('0025', NOW, [setDone(80, 1)])] } // bench logged, squat never
    const results = computeBalance(S, template)
    expect(results.find(r => r.roleId === 'bench').status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(results.find(r => r.roleId === 'bench').actualPct).toBe(null)
  })

  it('no-data when the role itself was never logged', () => {
    const S = { unit: 'kg', workouts: [workoutAt('0043', NOW, [setDone(100, 1)])] } // squat only
    const results = computeBalance(S, template)
    const bench = results.find(r => r.roleId === 'bench')
    expect(bench.status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(bench.current).toBe(null)
  })
})

describe('computeBalance — bodyweight-ratio mode (ATG)', () => {
  const template = TEMPLATES.atg

  const sWithBw = (bwKg, rdlW) => ({
    unit: 'kg',
    body: 'male',
    bodyweight: [{ d: '2026-01-01', w: bwKg }],
    workouts: [workoutAt('0085', NOW, [setDone(rdlW, 12)])], // the standard is a load for 12
  })

  it('balanced/borderline/weak edges against bodyweight (male target 100%)', () => {
    let results = computeBalance(sWithBw(80, 80), template)
    expect(results.find(r => r.roleId === 'romanianDeadlift').status).toBe(BALANCE_STATUSES.BALANCED)

    results = computeBalance(sWithBw(80, 76), template) // 95% -> exactly borderline edge
    expect(results.find(r => r.roleId === 'romanianDeadlift').status).toBe(BALANCE_STATUSES.BORDERLINE)

    results = computeBalance(sWithBw(80, 75), template) // 93.75% -> weak
    expect(results.find(r => r.roleId === 'romanianDeadlift').status).toBe(BALANCE_STATUSES.WEAK)
  })

  it('uses the female target when S.body is female', () => {
    const S = { ...sWithBw(80, 64), body: 'female' } // 80% of 80kg = 64kg -> exactly female target (80%)
    const results = computeBalance(S, template)
    expect(results.find(r => r.roleId === 'romanianDeadlift').status).toBe(BALANCE_STATUSES.BALANCED)
    expect(results.find(r => r.roleId === 'romanianDeadlift').targetPct).toBe(80)
  })

  it('reads the estimate back at the role\'s reps: body weight for 12 is not a body-weight 1RM', () => {
    // 58 kg for 12 at 80 kg estimates an 81.2 kg 1RM — over body weight, but 72.5% of the
    // body-weight-for-12 the standard asks for.
    const rdl = computeBalance(sWithBw(80, 58), template).find(r => r.roleId === 'romanianDeadlift')
    expect(rdl.current.repsKg).toBeCloseTo(58)
    expect(rdl.actualPct).toBeCloseTo(72.5, 1)
    expect(rdl.status).toBe(BALANCE_STATUSES.WEAK)
    // A heavy single is read forward the same way: 100 kg once is about 71 kg for 12.
    const single = { ...sWithBw(80, 0), workouts: [workoutAt('0085', NOW, [setDone(100, 1)])] }
    expect(computeBalance(single, template).find(r => r.roleId === 'romanianDeadlift').actualPct).toBeCloseTo(89.3, 1)
  })

  it('every ATG load standard names its reps, and a set of exactly that many comes back as itself', () => {
    for (const role of template.roles.filter(r => r.evaluationMode === EVALUATION_MODES.BODYWEIGHT_RATIO)) {
      expect(role.reps, role.id).toBeGreaterThan(1)
      expect(role.label).toContain(`${role.reps} reps`)
    }
    expect(loadForReps(112, 12)).toBeCloseTo(80)
    expect(loadForReps(90, 1)).toBe(90)
    expect(loadAtReps(81.3, 12, 12)).toBe(81.3) // exactly, not 81.3 × 1.4 rounded and divided back
    expect(loadAtReps(40, 20, 15)).toBe(40) // more reps prove the load, they do not raise it
    expect(loadAtReps(20, 6, 15)).toBeCloseTo(16) // 24 kg 1RM, read at 15
    expect(loadAtReps(100, 1, 12)).toBeCloseTo(100 / 1.4) // a single is its own 1RM
    expect(loadAtReps(0, 12, 12)).toBe(null)
    expect(loadAtReps(40, 0, 12)).toBe(null)
    expect(loadAtReps('x', 12, 12)).toBe(null)
  })

  // The step-up's standard is half body weight for 15: past the 12-rep cap of a 1RM estimate,
  // which is no reason to leave the test itself unscored.
  it('scores the step-up at its own 15 reps, and a set with more reps at its load', () => {
    const stepUp = (id, sets, bw = 80) => computeBalance({
      unit: 'kg', body: 'male', bodyweight: [{ d: '2026-01-01', w: bw }], workouts: [workoutAt(id, NOW, sets)],
    }, template).find(r => r.roleId === 'stepUp')

    const atStandard = stepUp('0114', [setDone(40, 15)])
    expect(atStandard.actualPct).toBeCloseTo(50)
    expect(atStandard.status).toBe(BALANCE_STATUSES.BALANCED)
    expect(atStandard.current).toMatchObject({ repsKg: 40, w: 40, r: 15 })

    expect(stepUp('0114', [setDone(40, 20)]).actualPct).toBeCloseTo(50)
    expect(stepUp('0114', [setDone(38, 13)]).status).toBe(BALANCE_STATUSES.BORDERLINE) // 38 × (1 + 13/30) / 1.5 = 36.3 kg, 45.4%
  })

  it('reads a unilateral set by its better side, never by the both-sides total', () => {
    const perSide = (L, R) => ({ done: true, w: Math.max(L[0], R[0]), r: L[1] + R[1], sides: {
      L: { w: L[0], r: L[1], done: true }, R: { w: R[0], r: R[1], done: true },
    } })
    const role = (roleId, id, set) => computeBalance({
      unit: 'kg', body: 'male', bodyweight: [{ d: '2026-01-01', w: 80 }], workouts: [workoutAt(id, NOW, [set])],
    }, template).find(r => r.roleId === roleId)

    // 20 kg for 6 a leg: a 24 kg 1RM, 16 kg for 15 — 20% of 80 kg, not the 23.3% the 12-rep total read.
    const sixALeg = role('stepUp', '0431', perSide([20, 6], [20, 6]))
    expect(sixALeg.actualPct).toBeCloseTo(20)
    expect(sixALeg.current).toMatchObject({ w: 20, r: 6 })
    // 7 a leg (14 in total) and the full 15 a leg (30) score instead of reading as no data.
    expect(role('stepUp', '0431', perSide([20, 7], [20, 7])).actualPct).toBeCloseTo(20 * (1 + 7 / 30) / 1.5 / 80 * 100)
    const fifteenALeg = role('stepUp', '0431', perSide([40, 15], [40, 15]))
    expect(fifteenALeg.status).toBe(BALANCE_STATUSES.BALANCED)
    expect(fifteenALeg.actualPct).toBeCloseTo(50)
    // The stronger side is the reading, whichever it is.
    expect(role('stepUp', '0431', perSide([20, 6], [25, 6])).current).toMatchObject({ w: 25, r: 6 })

    // "Each hand, 8 reps" logged per side on a one-arm or alternating press: 8, not 16.
    const shoulder = role('dbShoulderPress', '0361', perSide([26.4, 8], [26.4, 8]))
    expect(shoulder.status).toBe(BALANCE_STATUSES.BALANCED)
    expect(shoulder.actualPct).toBeCloseTo(33)
    expect(role('dbShoulderPress', '0360', perSide([26.4, 8], [26.4, 8])).actualPct).toBeCloseTo(33)
    const incline = role('inclineDbPress', '3545', perSide([32, 8], [32, 8]))
    expect(incline.status).toBe(BALANCE_STATUSES.BALANCED)
    expect(incline.actualPct).toBeCloseTo(40)
  })

  it('reads a unilateral set by side for a 1RM too', () => {
    const S = { unit: 'kg', workouts: [workoutAt('0431', NOW, [
      { done: true, w: 30, r: 10, sides: { L: { w: 30, r: 5, done: true }, R: { w: 30, r: 5, done: true } } },
    ])] }
    expect(resolveCurrent(S, ['0431'], 80).estKg).toBeCloseTo(35) // 30 × (1 + 5/30), not 30 × (1 + 10/30)
    const eightAHand = { unit: 'kg', workouts: [workoutAt('0361', NOW, [
      { done: true, w: 20, r: 16, sides: { L: { w: 20, r: 8, done: true }, R: { w: 20, r: 8, done: true } } },
    ])] }
    expect(resolveCurrent(eightAHand, ['0361'], 80).estKg).toBeCloseTo(20 * (1 + 8 / 30)) // 16 in total is past the rep cap
  })

  // ATG's test is to load the bar to the standard, so a lifter lands exactly on it: that has to
  // read as meeting it, in either unit and at any body weight, not as Borderline next to "100%".
  it('a set of exactly the standard is balanced at any body weight, in kg and in lb', () => {
    expect(computeBalance({ unit: 'lb', body: 'male', bodyweight: [{ d: '2026-01-01', w: 180 }],
      workouts: [workoutAt('0085', NOW, [setDone(180, 12)])] }, template)
      .find(r => r.roleId === 'romanianDeadlift').status).toBe(BALANCE_STATUSES.BALANCED)

    const ratioRoles = template.roles.filter(r => r.evaluationMode === EVALUATION_MODES.BODYWEIGHT_RATIO)
    const weighIns = [
      ...Array.from({ length: 401 }, (_, i) => ['kg', 60 + i / 10]),
      ...Array.from({ length: 121 }, (_, i) => ['lb', 140 + i / 2]),
    ]
    const missed = []
    for (const body of ['male', 'female']) {
      for (const role of ratioRoles) {
        for (const [unit, bw] of weighIns) {
          const S = { ...sWithBw(bw, 0), unit, body }
          const target = targetFor(role, S)
          S.workouts = [workoutAt(role.exerciseIds[0], NOW, [setDone(bw * target / 100, role.reps)])]
          const row = computeBalance(S, template).find(r => r.roleId === role.id)
          if (row.status !== BALANCE_STATUSES.BALANCED) missed.push(`${body} ${role.id} ${bw} ${unit}: ${row.actualPct}`)
        }
      }
    }
    expect(missed).toEqual([])
  })

  it('no-data when bodyweight was never logged', () => {
    const S = { unit: 'kg', workouts: [workoutAt('0085', NOW, [setDone(80, 1)])], bodyweight: [] }
    const results = computeBalance(S, template)
    expect(results.find(r => r.roleId === 'romanianDeadlift').status).toBe(BALANCE_STATUSES.NO_DATA)
  })
})

describe('computeBalance — rep-count mode (ATG)', () => {
  const template = TEMPLATES.atg

  it('scores pure-bodyweight sets (w=0) correctly — the best1RM()-only bug this engine avoids', () => {
    const S = { unit: 'kg', workouts: [workoutAt('0652', NOW, [setDone(0, 10)])] } // 10 strict pull-ups, no added weight
    const results = computeBalance(S, template)
    const pullups = results.find(r => r.roleId === 'pullups')
    expect(pullups.status).toBe(BALANCE_STATUSES.BALANCED)
    expect(pullups.actualPct).toBeCloseTo(100)
  })

  it('uses the female rep target (1 rep) for pull-ups', () => {
    const S = { unit: 'kg', body: 'female', workouts: [workoutAt('0652', NOW, [setDone(0, 1)])] }
    const results = computeBalance(S, template)
    expect(results.find(r => r.roleId === 'pullups').status).toBe(BALANCE_STATUSES.BALANCED)
  })

  it('no-data when the exercise was never logged (glute-ham raise / Nordic curl role)', () => {
    const S = { unit: 'kg', workouts: [] }
    const results = computeBalance(S, template)
    const nordic = results.find(r => r.roleId === 'nordicCurl')
    expect(nordic.status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(nordic.mappedExerciseId).toBe(null)
  })

  it('balanced/borderline/weak edges use a synthetic larger rep target, since real ATG targets (1/10) are too small for a clean 5-point band', () => {
    const role = { id: 'synthetic', evaluationMode: EVALUATION_MODES.REP_COUNT, exerciseIds: ['0652'], repsTarget: 20 }
    const template20 = { id: 'synthetic-template', roles: [role] }
    const build = r => ({ unit: 'kg', workouts: [workoutAt('0652', NOW, [setDone(0, r)])] })

    expect(computeBalance(build(20), template20)[0].status).toBe(BALANCE_STATUSES.BALANCED)
    expect(computeBalance(build(19), template20)[0].status).toBe(BALANCE_STATUSES.BORDERLINE) // 95%
    expect(computeBalance(build(18), template20)[0].status).toBe(BALANCE_STATUSES.WEAK) // 90%
  })
})

describe('resolveCurrent / resolveCurrentReps — best variant among a whitelist wins', () => {
  it('load-ratio: picks the exercise id with the higher estimate, not the first-listed or most recent', () => {
    const S = {
      unit: 'kg',
      workouts: [
        workoutAt('0841', NOW - 1000, [setDone(20, 5)]), // weighted pull-up: higher est
        workoutAt('0841', NOW, [setDone(10, 5)]), // weighted pull-up: lower est, more recent
      ],
    }
    const current = resolveCurrent(S, ['0032', '0841'], 80)
    expect(current.exId).toBe('0841')
    expect(current.w).toBe(20)
  })

  it('rep-count: picks the higher rep count among whitelisted ids', () => {
    const S = {
      unit: 'kg',
      workouts: [
        workoutAt('0652', NOW - 1000, [setDone(0, 8)]),
        workoutAt('0841', NOW, [setDone(5, 6)]),
      ],
    }
    const current = resolveCurrentReps(S, ['0652', '0841'])
    expect(current.r).toBe(8)
    expect(current.exId).toBe('0652')
  })

  it('returns null for an empty whitelist without throwing', () => {
    expect(resolveCurrent({ unit: 'kg', workouts: [] }, [], null)).toBe(null)
    expect(resolveCurrentReps({ unit: 'kg', workouts: [] }, [])).toBe(null)
  })
})

// The bug this whole block exists for: `w` on a bodyweight exercise is what was *added* to the
// lifter, so scoring a dip or a pull-up on `w` alone reported a +10 kg chin-up as a 10 kg lift —
// which turned a lifter who is balanced on Poliquin's table into "weak" by 80 points.
describe('bodyweight exercises count the lifter, not just the belt', () => {
  const template = TEMPLATES.poliquin
  const bwLifter = sets => ({
    unit: 'kg',
    bodyweight: [{ d: '2026-01-01', w: 80 }],
    workouts: [{
      d: '2026-01-10', start: NOW,
      entries: [{ id: '0030', sets: [setDone(100, 1)] }, ...sets], // close-grip bench anchor at 100 kg
    }],
  })

  it('adds bodyweight to the added load on a bodyweight entry', () => {
    // +10 kg on an 80 kg lifter is a 90 kg pull-up — 90% of a 100 kg bench, over the 87% target.
    const S = bwLifter([{ id: '0652', sets: [setDone(10, 1)] }])
    const pullups = computeBalance(S, template).find(r => r.roleId === 'supinePullups')
    expect(pullups.actualPct).toBeCloseTo(90)
    expect(pullups.status).toBe(BALANCE_STATUSES.BALANCED)
  })

  it('scores an unloaded bodyweight set as the lifter’s own mass', () => {
    const S = bwLifter([{ id: '0251', sets: [setDone(0, 1)] }])
    const dips = computeBalance(S, template).find(r => r.roleId === 'dips')
    expect(dips.actualPct).toBeCloseTo(80) // 80 kg of lifter against a 100 kg bench
    expect(dips.status).toBe(BALANCE_STATUSES.WEAK) // target is 117%
  })

  it('prefers the weigh-in stamped on the session over the profile’s current bodyweight', () => {
    const S = bwLifter([{ id: '0652', sets: [setDone(0, 1)] }])
    S.workouts[0].bw = 70 // the lifter weighed 70 kg that day, not the 80 kg on file now
    const pullups = computeBalance(S, template).find(r => r.roleId === 'supinePullups')
    expect(pullups.actualPct).toBeCloseTo(70)
  })

  it('leaves a bodyweight entry unscored when no bodyweight is known, rather than inventing one', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-10', start: NOW, entries: [
      { id: '0030', sets: [setDone(100, 1)] },
      { id: '0652', sets: [setDone(10, 1)] },
    ] }] }
    const pullups = computeBalance(S, template).find(r => r.roleId === 'supinePullups')
    expect(pullups.status).toBe(BALANCE_STATUSES.NO_DATA)
  })

  it('honours the per-exercise bodyweight flag over the equipment default', () => {
    // A barbell lift the user flagged as bodyweight (a dip machine logged under a barbell id, say)
    // counts their mass; the flag turned off on a bodyweight exercise stops it counting.
    const flagged = bwLifter([{ id: '0032', target: { bodyweight: true }, sets: [setDone(20, 1)] }])
    const deadlift = computeBalance(flagged, template).find(r => r.roleId === 'deadlift')
    expect(deadlift.current.estKg).toBeCloseTo(100) // 80 + 20, not 20

    const unflagged = bwLifter([{ id: '0652', target: { bodyweight: false }, sets: [setDone(20, 1)] }])
    const pullups = computeBalance(unflagged, template).find(r => r.roleId === 'supinePullups')
    expect(pullups.current.estKg).toBeCloseTo(20)
  })
})

// The catalogue's weighted pull-up (0841, in Poliquin's supine pull-up role) is 'weighted'
// equipment, not body weight — but what is logged on it is still the belt.
describe('a belt on a pull-up or a dip counts the lifter too', () => {
  const bw80 = ids => ({ unit: 'kg', workouts: ids.map(([id, w, r], i) => workoutAt(id, NOW + i, [setDone(w, r)])) })

  it('scores the weighted pull-up as body weight plus the belt', () => {
    const S = { ...bw80([['0030', 100, 1], ['0841', 20, 1]]), bodyweight: [{ d: '2026-01-01', w: 80 }] }
    const pullups = computeBalance(S, TEMPLATES.poliquin).find(r => r.roleId === 'supinePullups')
    expect(pullups.mappedExerciseId).toBe('0841')
    expect(pullups.current.estKg).toBeCloseTo(100) // 80 + 20, not 20
    expect(pullups.status).toBe(BALANCE_STATUSES.BALANCED)
  })

  it('does the same for the other belt variants of pull-ups, chin-ups, muscle-ups and dips', () => {
    for (const id of ['0841', '2987', '3290', '3286', '3313', '1767']) {
      expect(resolveCurrent(bw80([[id, 10, 1]]), [id], 80).estKg).toBeCloseTo(90)
    }
  })

  it('leaves bench dips, push-ups and the rest of the weighted catalogue as plain load', () => {
    // 1755 "weighted tricep dips" is a bench dip by its instructions, though its name does not say so.
    for (const id of ['0830', '1754', '1755', '1310', '0852', '0832']) {
      expect(resolveCurrent(bw80([[id, 10, 1]]), [id], 80).estKg).toBeCloseTo(10)
    }
  })

  it('follows the per-exercise bodyweight flag when it is set, and needs a body weight', () => {
    const off = { unit: 'kg', workouts: [{ d: '2026-01-10', start: NOW, entries: [{ id: '0841', target: { bodyweight: false }, sets: [setDone(20, 1)] }] }] }
    expect(resolveCurrent(off, ['0841'], 80).estKg).toBeCloseTo(20)
    expect(resolveCurrent(bw80([['0841', 20, 1]]), ['0841'], null)).toBe(null)
  })
})

// A role pointed at an assistance machine through the exercise picker (0017 assisted pull-up):
// the logged number is the help, so it comes off the lifter instead of going on top.
describe('an assistance machine counts the help against the lifter', () => {
  const ASSISTED = '0017' // assisted pull-up, a leverage machine
  const poliquin = TEMPLATES.poliquin
  const pullRole = findRole(poliquin, 'supinePullups')
  const lifter = (entry, extra = {}) => ({
    unit: 'kg',
    bodyweight: [{ d: '2026-01-01', w: 80 }],
    balanceOverrides: { [overrideKey(poliquin, pullRole)]: ASSISTED },
    workouts: [{ d: '2026-01-10', start: NOW, entries: [{ id: '0030', sets: [setDone(100, 1)] }, entry] }],
    ...extra,
  })
  const pullups = S => computeBalance(S, poliquin).find(r => r.roleId === 'supinePullups')

  it('scores body weight minus the help', () => {
    const row = pullups(lifter({ id: ASSISTED, sets: [setDone(20, 1)] }))
    expect(row.mappedExerciseId).toBe(ASSISTED)
    expect(row.current.estKg).toBeCloseTo(60) // 80 kg lifter, 20 kg of help
    expect(row.actualPct).toBeCloseTo(60)
    expect(row.status).toBe(BALANCE_STATUSES.WEAK) // 87% target
  })

  it('reads less help as the stronger set, not more', () => {
    const row = pullups(lifter({ id: ASSISTED, sets: [setDone(40, 1), setDone(10, 1)] }))
    expect(row.current.estKg).toBeCloseTo(70)
    expect(row.current.w).toBe(10)
  })

  it('still subtracts when the entry is flagged bodyweight', () => {
    const row = pullups(lifter({ id: ASSISTED, target: { bodyweight: true }, sets: [setDone(20, 1)] }))
    expect(row.current.estKg).toBeCloseTo(60) // not 80 + 20
  })

  it('uses the weigh-in stamped on the session, and converts a lb profile', () => {
    const stamped = lifter({ id: ASSISTED, sets: [setDone(20, 1)] })
    stamped.workouts[0].bw = 70
    expect(pullups(stamped).current.estKg).toBeCloseTo(50)

    const lb = lifter({ id: ASSISTED, sets: [setDone(44.09, 1)] }, { unit: 'lb', bodyweight: [{ d: '2026-01-01', w: 176.37 }] })
    lb.workouts[0].entries[0].sets = [setDone(220.46, 1)] // the 100 kg anchor in lb
    expect(pullups(lb).actualPct).toBeCloseTo(60, 0)
  })

  it('leaves a set unscored with no help entered, help at or above body weight, or no body weight', () => {
    expect(pullups(lifter({ id: ASSISTED, sets: [setDone(0, 5)] })).status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(pullups(lifter({ id: ASSISTED, sets: [setDone(80, 5)] })).status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(pullups(lifter({ id: ASSISTED, sets: [setDone(20, 1)] }, { bodyweight: [] })).status).toBe(BALANCE_STATUSES.NO_DATA)
  })

  it('does not count helped reps toward a body-weight rep target', () => {
    const atg = TEMPLATES.atg
    const key = overrideKey(atg, findRole(atg, 'pullups'))
    const S = { unit: 'kg', balanceOverrides: { [key]: ASSISTED }, workouts: [workoutAt(ASSISTED, NOW, [setDone(30, 12)])] }
    const row = computeBalance(S, atg).find(r => r.roleId === 'pullups')
    expect(row.isOverridden).toBe(true)
    expect(row.status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(resolveCurrentReps(S, [ASSISTED])).toBe(null)
  })
})

describe('rep-count on a unilateral set', () => {
  it('reads the better side, not the both-sides total', () => {
    // workout-model.js keeps `r` as L.r + R.r on a per-side row; a "10 reps" target is per limb.
    const S = { unit: 'kg', workouts: [workoutAt('0652', NOW, [
      { done: true, w: 0, r: 12, sides: { L: { r: 5, done: true }, R: { r: 7, done: true } } },
    ])] }
    const current = resolveCurrentReps(S, ['0652'])
    expect(current.r).toBe(7)
  })
})

describe('unit consistency (lb profile)', () => {
  it('bodyweight-ratio gives the same result in lb as in kg', () => {
    const kgResult = computeBalance({
      unit: 'kg', body: 'male',
      bodyweight: [{ d: '2026-01-01', w: 80 }],
      workouts: [workoutAt('0085', NOW, [setDone(80, 1)])],
    }, TEMPLATES.atg).find(r => r.roleId === 'romanianDeadlift')

    const lbResult = computeBalance({
      unit: 'lb', body: 'male',
      bodyweight: [{ d: '2026-01-01', w: 176.37 }], // ~80kg in lb
      workouts: [workoutAt('0085', NOW, [setDone(176.37, 1)])],
    }, TEMPLATES.atg).find(r => r.roleId === 'romanianDeadlift')

    expect(lbResult.actualPct).toBeCloseTo(kgResult.actualPct, 0)
  })
})

describe('exercise override', () => {
  const template = TEMPLATES.atg
  const nordicRole = findRole(template, 'nordicCurl')

  it('reads from the overridden exercise instead of the curated whitelist, and flags isOverridden', () => {
    const key = overrideKey(template, nordicRole)
    const S = {
      unit: 'kg',
      balanceOverrides: { [key]: '0599' }, // a machine leg curl instead of the default glute-ham raise
      workouts: [workoutAt('0599', NOW, [setDone(40, 1)])],
    }
    const results = computeBalance(S, template)
    const nordic = results.find(r => r.roleId === 'nordicCurl')
    expect(nordic.isOverridden).toBe(true)
    expect(nordic.mappedExerciseId).toBe('0599')
  })

  it('is not overridden and uses the curated whitelist when no override is set', () => {
    const results = computeBalance({ unit: 'kg', workouts: [] }, template)
    expect(results.find(r => r.roleId === 'nordicCurl').isOverridden).toBe(false)
  })

  it('clearing the override reverts to the curated whitelist', () => {
    const key = overrideKey(template, nordicRole)
    const withOverride = { unit: 'kg', balanceOverrides: { [key]: '0599' }, workouts: [workoutAt('3193', NOW, [setDone(0, 1)])] }
    const overridden = computeBalance(withOverride, template).find(r => r.roleId === 'nordicCurl')
    expect(overridden.status).toBe(BALANCE_STATUSES.NO_DATA) // logged the default exercise, but override points elsewhere

    const { balanceOverrides, ...withoutOverride } = withOverride
    const reverted = computeBalance(withoutOverride, template).find(r => r.roleId === 'nordicCurl')
    expect(reverted.isOverridden).toBe(false)
    expect(reverted.status).toBe(BALANCE_STATUSES.BALANCED) // now reads the logged glute-ham raise set again
  })
})

// How an override is stored: `{ id, _ts }`, a clear as `id: null` (see sync-merge.js).
describe('stored overrides', () => {
  const template = TEMPLATES.atg
  const key = overrideKey(template, findRole(template, 'nordicCurl'))
  const logged = { unit: 'kg', workouts: [workoutAt('3193', NOW, [setDone(0, 1)]), workoutAt('0599', NOW, [setDone(40, 1)])] }
  const nordic = overrides => computeBalance({ ...logged, balanceOverrides: overrides }, template).find(r => r.roleId === 'nordicCurl')

  it('withOverride stamps a choice and a clear, leaving the other roles alone', () => {
    const set = withOverride({ other: { id: '0001', _ts: 1 } }, key, '0599', 1234)
    expect(set).toEqual({ other: { id: '0001', _ts: 1 }, [key]: { id: '0599', _ts: 1234 } })
    expect(withOverride(set, key, null, 2000)[key]).toEqual({ id: null, _ts: 2000 })
    expect(withOverride(undefined, key, '0599', 5)).toEqual({ [key]: { id: '0599', _ts: 5 } })
  })

  it('reads a stamped choice, a cleared one as the default, and the first builds\' bare id', () => {
    expect(overrideIdOf({ id: '0599', _ts: 3 })).toBe('0599')
    expect(overrideIdOf({ id: null, _ts: 3 })).toBe(null)
    expect(overrideIdOf('0599')).toBe('0599')
    expect(overrideIdOf(undefined)).toBe(null)
    expect(overrideIdOf('')).toBe(null)

    expect(nordic({ [key]: { id: '0599', _ts: 3 } })).toMatchObject({ isOverridden: true, mappedExerciseId: '0599' })
    const cleared = nordic({ [key]: { id: null, _ts: 9 } })
    expect(cleared).toMatchObject({ isOverridden: false, configuredExerciseId: '3193', mappedExerciseId: '3193' })
    expect(nordic({ [key]: '0599' })).toMatchObject({ isOverridden: true, mappedExerciseId: '0599' })
  })
})

// Without a weigh-in these rows can only read "No data", next to sets the user can see they
// logged; the result says when a body weight is all that is missing, so the screen can ask.
describe('a role waiting on a weigh-in says so', () => {
  const role = (S, template, roleId) => computeBalance(S, template).find(r => r.roleId === roleId)

  it('flags an ATG load standard with a lift logged and no body weight', () => {
    const S = { unit: 'kg', workouts: [workoutAt('0085', NOW, [setDone(80, 12)])] }
    expect(role(S, TEMPLATES.atg, 'romanianDeadlift')).toMatchObject({ status: BALANCE_STATUSES.NO_DATA, needsBodyweight: true })
    expect(role(S, TEMPLATES.atg, 'goodMorning').needsBodyweight).toBe(false) // nothing logged
    expect(role({ ...S, bodyweight: [{ d: '2026-01-01', w: 80 }] }, TEMPLATES.atg, 'romanianDeadlift'))
      .toMatchObject({ status: BALANCE_STATUSES.BALANCED, needsBodyweight: false })
  })

  it('flags a dip or pull-up on the load table, not a lift that is plain load', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-10', start: NOW, entries: [
      { id: '0030', sets: [setDone(100, 1)] }, { id: '0251', sets: [setDone(10, 5)] },
      { id: '0841', sets: [setDone(20, 5)] }, { id: '0031', sets: [setDone(35, 5)] },
    ] }] }
    expect(role(S, TEMPLATES.poliquin, 'dips')).toMatchObject({ status: BALANCE_STATUSES.NO_DATA, needsBodyweight: true })
    expect(role(S, TEMPLATES.poliquin, 'supinePullups').needsBodyweight).toBe(true)
    expect(role(S, TEMPLATES.poliquin, 'barbellCurl').needsBodyweight).toBe(false)
    expect(role(S, TEMPLATES.poliquin, 'deadlift').needsBodyweight).toBe(false)
    // A session with its own weigh-in scores without the profile's.
    S.workouts[0].bw = 80
    expect(role(S, TEMPLATES.poliquin, 'dips')).toMatchObject({ status: BALANCE_STATUSES.WEAK, needsBodyweight: false })
  })

  it('leaves out rep targets and an assistance machine with no help entered', () => {
    const S = { unit: 'kg', workouts: [workoutAt('0652', NOW, [setDone(0, 4)])] }
    expect(role(S, TEMPLATES.atg, 'pullups').needsBodyweight).toBe(false)
    const poliquin = TEMPLATES.poliquin
    const key = overrideKey(poliquin, findRole(poliquin, 'supinePullups'))
    const assisted = w => ({ unit: 'kg', balanceOverrides: { [key]: '0017' }, workouts: [workoutAt('0017', NOW, [setDone(w, 5)])] })
    expect(role(assisted(0), poliquin, 'supinePullups').needsBodyweight).toBe(false)
    expect(role(assisted(20), poliquin, 'supinePullups').needsBodyweight).toBe(true)
  })
})

describe('an override of the role\'s own default exercise', () => {
  it('is not custom, and reads the whole whitelist like the default', () => {
    const template = TEMPLATES.atg
    const stepUp = findRole(template, 'stepUp') // 0114 barbell step-up, then 0431 dumbbell step-up
    const S = {
      unit: 'kg', body: 'male', bodyweight: [{ d: '2026-01-01', w: 80 }],
      balanceOverrides: { [overrideKey(template, stepUp)]: { id: '0114', _ts: 5 } },
      workouts: [workoutAt('0431', NOW, [setDone(40, 15)])],
    }
    const row = computeBalance(S, template).find(r => r.roleId === 'stepUp')
    expect(row).toMatchObject({ isOverridden: false, configuredExerciseId: '0114', mappedExerciseId: '0431' })
    expect(row.status).toBe(BALANCE_STATUSES.BALANCED)

    S.balanceOverrides = { [overrideKey(template, stepUp)]: { id: '0431', _ts: 6 } } // the fallback is a real choice
    expect(computeBalance(S, template).find(r => r.roleId === 'stepUp')).toMatchObject({ isOverridden: true, configuredExerciseId: '0431' })
  })
})

describe('computeBalance — full template end-to-end (Poliquin)', () => {
  it('resolves every role in order, mixing logged and unlogged roles', () => {
    const template = TEMPLATES.poliquin
    const S = {
      unit: 'kg',
      bodyweight: [{ d: '2026-01-01', w: 80 }],
      workouts: [
        workoutAt('0030', NOW - 5000, [setDone(100, 1)]), // narrowBench anchor: 100kg
        workoutAt('0047', NOW - 4000, [setDone(91, 1)]), // inclineBench: exactly 91% -> balanced
        workoutAt('0251', NOW - 3000, [setDone(37, 1)]), // dips: 80kg lifter + 37 = 117% -> balanced
        // supinePullups: deliberately never logged
        workoutAt('0031', NOW - 2000, [setDone(30, 1)]), // barbellCurl: 30% -> weak (target 40)
        workoutAt('1436', NOW - 1000, [setDone(150, 1)]), // highBarSquat anchor: 150kg
        workoutAt('0042', NOW, [setDone(127.5, 1)]), // frontSquat: 85% -> balanced
      ],
    }
    const results = computeBalance(S, template)

    expect(results.map(r => r.roleId)).toEqual(template.roles.map(r => r.id))
    expect(results.find(r => r.roleId === 'narrowBench').status).toBe(BALANCE_STATUSES.BALANCED)
    expect(results.find(r => r.roleId === 'inclineBench').status).toBe(BALANCE_STATUSES.BALANCED)
    expect(results.find(r => r.roleId === 'dips').status).toBe(BALANCE_STATUSES.BALANCED)
    expect(results.find(r => r.roleId === 'supinePullups').status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(results.find(r => r.roleId === 'barbellCurl').status).toBe(BALANCE_STATUSES.WEAK)
    expect(results.find(r => r.roleId === 'highBarSquat').status).toBe(BALANCE_STATUSES.BALANCED)
    expect(results.find(r => r.roleId === 'frontSquat').status).toBe(BALANCE_STATUSES.BALANCED)
    expect(results.find(r => r.roleId === 'deadlift').status).toBe(BALANCE_STATUSES.NO_DATA)
    expect(results.find(r => r.roleId === 'powerClean').status).toBe(BALANCE_STATUSES.NO_DATA)
  })

  it('names the exercise a role is set to even when it has no data, so the view can show it', () => {
    const template = TEMPLATES.poliquin
    const deadlift = findRole(template, 'deadlift')
    const S = { unit: 'kg', workouts: [], balanceOverrides: { [overrideKey(template, deadlift)]: '0085' } }
    const results = computeBalance(S, template)

    const unlogged = results.find(r => r.roleId === 'powerClean')
    expect(unlogged.mappedExerciseId).toBe(null)
    expect(unlogged.configuredExerciseId).toBe('0648') // the whitelist's first choice

    const overridden = results.find(r => r.roleId === 'deadlift')
    expect(overridden.configuredExerciseId).toBe('0085') // the exercise the user picked
    expect(overridden.isOverridden).toBe(true)
  })
})

describe('targetFor', () => {
  it('falls back to the male/default figure when S.body is not female or no female figure exists', () => {
    const role = findRole(TEMPLATES.atg, 'romanianDeadlift')
    expect(targetFor(role, { body: 'male' })).toBe(100)
    expect(targetFor(role, {})).toBe(100)
    expect(targetFor(role, { body: 'female' })).toBe(80)
  })

  it('load-ratio roles have no female figure and are unaffected by S.body', () => {
    const role = findRole(TEMPLATES.thibaudeauPowerlifting, 'bench')
    expect(targetFor(role, { body: 'female' })).toBe(75)
  })
})

describe('ratioFor', () => {
  it('returns null for a load-ratio role when the anchor has no reading', () => {
    const role = findRole(TEMPLATES.thibaudeauPowerlifting, 'bench')
    expect(ratioFor(role, { estKg: 80 }, { anchorCurrent: null })).toBe(null)
  })

  it('returns null for a bodyweight-ratio role when bodyweight is unknown', () => {
    const role = findRole(TEMPLATES.atg, 'romanianDeadlift')
    expect(ratioFor(role, { estKg: 80 }, { bodyweightKg: null })).toBe(null)
  })
})

// A lift logged for months next to an anchor never logged read "No data", with nothing saying the
// anchor was the reason. The result says so, like a missing weigh-in.
describe('a role waiting on its anchor says so', () => {
  const role = (S, template, roleId) => computeBalance(S, template).find(r => r.roleId === roleId)
  const logged = { unit: 'kg', workouts: [workoutAt('0047', NOW - 1000, [setDone(57.5, 10)]), workoutAt('0031', NOW, [setDone(35, 8)])] }

  it('flags a logged load-ratio lift whose anchor has no reading, and nothing else', () => {
    expect(role(logged, TEMPLATES.poliquin, 'inclineBench')).toMatchObject({ status: BALANCE_STATUSES.NO_DATA, needsAnchor: true, mappedExerciseId: '0047' })
    expect(role(logged, TEMPLATES.poliquin, 'barbellCurl')).toMatchObject({ status: BALANCE_STATUSES.NO_DATA, needsAnchor: true })
    expect(role(logged, TEMPLATES.poliquin, 'frontSquat').needsAnchor).toBe(false)   // not logged: plain no data
    expect(role(logged, TEMPLATES.poliquin, 'narrowBench').needsAnchor).toBe(false)  // the anchor itself
  })

  it('stops once the anchor is logged', () => {
    const S = { ...logged, workouts: [...logged.workouts, workoutAt('0030', NOW, [setDone(100, 1)])] }
    const incline = role(S, TEMPLATES.poliquin, 'inclineBench')
    expect(incline.needsAnchor).toBe(false)
    expect(incline.status).not.toBe(BALANCE_STATUSES.NO_DATA)
  })
})
