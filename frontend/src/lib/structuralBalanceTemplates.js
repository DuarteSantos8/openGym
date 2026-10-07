// Structural-balance ratio tables, sourced from
// https://anticulturista.substack.com/p/30-equilibrio-estructural-tu-proximo (Poliquin /
// Thibaudeau / ATG). Numbers are transcribed verbatim from the article. Each table is trimmed
// to its compound/anchor lifts (see SPEC-structural-balance-core.md open question #1) — minor
// isolation/shoulder-health accessories (Powell raise, trap raises, external rotation, french
// press, scott curl) and Thibaudeau's general-strength/weightlifting sub-tables (different
// anchor lifts) are out of scope.

export const EVALUATION_MODES = Object.freeze({
  LOAD_RATIO: 'load-ratio',
  BODYWEIGHT_RATIO: 'bodyweight-ratio',
  REP_COUNT: 'rep-count',
})

export const BALANCE_STATUSES = Object.freeze({
  BALANCED: 'balanced',
  BORDERLINE: 'borderline',
  WEAK: 'weak',
  NO_DATA: 'no-data',
})

// Percentage points below target that still count as 'borderline' rather than 'weak'.
export const BORDERLINE_BAND_PCT = 5

// Role shape:
//   id             stable string, unique within its template
//   label          i18n key (english source string)
//   evaluationMode 'load-ratio' | 'bodyweight-ratio' | 'rep-count'
//   exerciseIds    curated whitelist, most-preferred variant first — resolveCurrent() picks the
//                  user's best-data variant among these (overridable per-role via
//                  S.balanceOverrides, see structuralBalance.js)
//   anchorRoleId   load-ratio only: the role this one is compared against, within the same
//                  template. The anchor role itself has no anchorRoleId and targetPct: 100.
//   targetPct      load-ratio (% of anchor's 1RM) / bodyweight-ratio (% of bodyweight)
//   targetPctFemale  bodyweight-ratio only, when the source gives a distinct female figure for
//                    the same exercise — picked when S.body === 'female'
//   reps             bodyweight-ratio only: how many reps the source's load is for ("body
//                    weight for 12"). A set is read as the load it shows for that many reps
//                    before it is compared (structuralBalance.js loadAtReps)
//   repsTarget       rep-count only: target rep count at bodyweight
//   repsTargetFemale rep-count only, when the source gives a distinct female rep target

export const TEMPLATES = {
  poliquin: {
    id: 'poliquin',
    label: 'Poliquin',
    roles: [
      {
        id: 'narrowBench',
        label: 'Close-grip bench press (anchor)',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        exerciseIds: ['0030', '1719'], // barbell close-grip bench press, incline close-grip variant
        targetPct: 100,
      },
      {
        id: 'inclineBench',
        label: 'Incline bench press',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'narrowBench',
        exerciseIds: ['0047'], // barbell incline bench press
        targetPct: 91,
      },
      {
        id: 'dips',
        label: 'Dips (bodyweight + load)',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'narrowBench',
        exerciseIds: ['0251'], // chest dip
        targetPct: 117,
      },
      {
        id: 'supinePullups',
        label: 'Supine pull-ups (bodyweight + load)',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'narrowBench',
        exerciseIds: ['0652', '0841'], // pull-up, weighted pull-up
        targetPct: 87,
      },
      {
        id: 'barbellCurl',
        label: 'Standing barbell curl',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'narrowBench',
        exerciseIds: ['0031'], // barbell curl
        targetPct: 40,
      },
      {
        id: 'highBarSquat',
        label: 'High-bar back squat (anchor)',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        exerciseIds: ['1436', '0043'], // barbell high bar squat, fallback to full squat
        targetPct: 100,
      },
      {
        id: 'frontSquat',
        label: 'Front squat',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'highBarSquat',
        exerciseIds: ['0042'],
        targetPct: 85,
      },
      {
        id: 'deadlift',
        label: 'Deadlift',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'highBarSquat',
        exerciseIds: ['0032'],
        targetPct: 125,
      },
      {
        id: 'powerClean',
        label: 'Power clean',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'highBarSquat',
        exerciseIds: ['0648'],
        targetPct: 61,
      },
    ],
  },

  thibaudeauPowerlifting: {
    id: 'thibaudeauPowerlifting',
    label: 'Thibaudeau (Powerlifting)',
    roles: [
      {
        id: 'squat',
        label: 'Squat (anchor)',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        exerciseIds: ['0043', '1436'],
        targetPct: 100,
      },
      {
        id: 'bench',
        label: 'Bench press',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'squat',
        exerciseIds: ['0025'],
        targetPct: 75,
      },
      {
        id: 'deadlift',
        label: 'Deadlift',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'squat',
        exerciseIds: ['0032'],
        targetPct: 120,
      },
      {
        id: 'militaryPress',
        label: 'Military press',
        evaluationMode: EVALUATION_MODES.LOAD_RATIO,
        anchorRoleId: 'squat',
        exerciseIds: ['0091', '1456', '1457', '0086'],
        targetPct: 45,
      },
    ],
  },

  atg: {
    id: 'atg',
    label: 'ATG',
    roles: [
      {
        id: 'romanianDeadlift',
        label: 'Romanian deadlift (12 reps)',
        evaluationMode: EVALUATION_MODES.BODYWEIGHT_RATIO,
        exerciseIds: ['0085'],
        targetPct: 100,
        targetPctFemale: 80,
        reps: 12,
      },
      {
        id: 'goodMorning',
        label: 'Seated good morning (10 reps)',
        evaluationMode: EVALUATION_MODES.BODYWEIGHT_RATIO,
        exerciseIds: ['0090'],
        targetPct: 66,
        targetPctFemale: 40,
        reps: 10,
      },
      {
        id: 'stepUp',
        label: 'Poliquin step-up (15 reps)',
        evaluationMode: EVALUATION_MODES.BODYWEIGHT_RATIO,
        exerciseIds: ['0114', '0431'],
        targetPct: 50,
        targetPctFemale: 40,
        reps: 15,
      },
      {
        id: 'nordicCurl',
        label: 'Nordic curl (1 rep)',
        evaluationMode: EVALUATION_MODES.REP_COUNT,
        // No exercise literally named "Nordic curl" exists in EXDB. Glute-ham raise is the
        // closest mechanical relative (eccentric knee flexion, foot anchored) — an
        // approximation, not the same exercise. The 1-rep target is the Nordic curl's own,
        // not recalibrated for the substitute. Users can override this via the exercise
        // picker (see structuralBalance.js's exerciseIdsFor) if they'd rather map it elsewhere.
        exerciseIds: ['3193'], // glute-ham raise
        repsTarget: 1,
      },
      {
        id: 'pullups',
        label: 'Pull-ups (10 reps, bodyweight)',
        evaluationMode: EVALUATION_MODES.REP_COUNT,
        exerciseIds: ['0652'],
        repsTarget: 10,
        repsTargetFemale: 1,
      },
      {
        id: 'atgDips',
        label: 'Dips (10 reps, bodyweight)',
        evaluationMode: EVALUATION_MODES.REP_COUNT,
        exerciseIds: ['0251'],
        repsTarget: 10,
      },
      {
        id: 'inclineDbPress',
        label: 'Incline DB press (each hand, 8 reps)',
        evaluationMode: EVALUATION_MODES.BODYWEIGHT_RATIO,
        exerciseIds: ['0314', '3545'],
        targetPct: 40,
        targetPctFemale: 20,
        reps: 8,
      },
      {
        id: 'dbShoulderPress',
        label: 'DB shoulder press (each hand, 8 reps)',
        evaluationMode: EVALUATION_MODES.BODYWEIGHT_RATIO,
        exerciseIds: ['0405', '0404', '0361', '0360'],
        targetPct: 33,
        targetPctFemale: 15,
        reps: 8,
      },
    ],
  },
}

export const TEMPLATE_LIST = Object.values(TEMPLATES)
export const DEFAULT_TEMPLATE_ID = 'poliquin'
