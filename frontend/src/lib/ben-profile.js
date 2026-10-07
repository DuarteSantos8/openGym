// Benjamin-specific training profile. This repository is intentionally a single-person build:
// these values shape the default experience without changing OpenGym's reusable workout engine.
export const BEN_PROFILE = Object.freeze({
  name: 'Benjamin',
  goal: 'Lose body fat while keeping and building strength',
  secondaryGoal: 'Build useful strength and muscle without unnecessary training volume',
  frequency: 3,
  optionalFourthSession: true,
  environment: 'Home training',
  priority: 'Consistency + strength retention + gradual progression',
  sessions: Object.freeze({
    'Full Body A': Object.freeze({ role: 'Strength foundation', focus: 'Push, pull, squat and trunk', priority: 'Main session' }),
    'Full Body B': Object.freeze({ role: 'Strength + single-leg', focus: 'Upper-body strength and unilateral legs', priority: 'Main session' }),
    'Full Body C': Object.freeze({ role: 'Full-body progression', focus: 'Repeat key patterns with a small conditioning finish', priority: 'Main session' }),
    'Short Full Body': Object.freeze({ role: 'Optional short session', focus: 'Keep the habit and cover the basics with low volume', priority: 'Optional' }),
  }),
  lengths: Object.freeze({
    short: '15–25 min',
    normal: '25–40 min',
    long: '40–55 min',
  }),
  fourthSession: Object.freeze({
    name: 'Short Full Body',
    rule: 'Only suggest it after the three main sessions are done and recovery looks reasonable.',
  }),
})

export const BEN_GOAL_SHORT = 'Lose fat. Keep strength. Get lighter.'

// The role each of the three main weekly sessions plays in the fat-loss + strength-retention
// program. Routines named to match these prefixes (see lib/starter.js) are identified by role,
// so the coach and the Plan screen can talk about what a session is *for* rather than A/B/C.
export const SESSION_ROLES = Object.freeze({
  strength: { key: 'strength', label: 'Strength', detail: 'Compound work, lower reps — protect your lifts on a deficit.' },
  volume: { key: 'volume', label: 'Volume', detail: 'More movements, pump-range reps — hold muscle while losing fat.' },
  conditioning: { key: 'conditioning', label: 'Conditioning', detail: 'Dynamic work and a cardio finisher — raise daily burn.' },
})

// The three roles in weekly order, so callers can iterate without a magic array.
export const PROGRAM_ROLES = ['strength', 'volume', 'conditioning']
