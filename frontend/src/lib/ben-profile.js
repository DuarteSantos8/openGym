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
})

export const BEN_GOAL_SHORT = 'Lose fat. Keep strength. Get lighter.'
