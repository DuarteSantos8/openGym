// The words of a circuit (lib/circuit.js): what each mode is called, its one-line plan, what the
// player says out loud and what the history shows. Kept apart so the engine stays free of i18n.
import { t, tn } from './i18n-core.js'
import { RUNWALK } from './circuit.js'

/** A clock face: 0:20, 1:00, 12:30, 1:05:00. Digits stay Western, as everywhere in the app. */
export function fmtClock(sec) {
  const n = Math.max(0, Math.round(Number(sec)) || 0)
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const MODE_NAME = {
  circuit: 'Circuit',
  amrap: 'AMRAP',
  emom: 'EMOM',
  intervals: 'Intervals',
}
export const modeName = cfg => (cfg?.program === 'runwalk' ? t('Run/walk program') : t(MODE_NAME[cfg?.mode] || 'Superset'))

/** The plan in one line: "EMOM · every 1:00, 10 times". */
export function circuitLine(cfg) {
  if (!cfg) return ''
  const name = modeName(cfg)
  if (cfg.mode === 'circuit') return `${name} · ${tn('{0} round', '{0} rounds', cfg.rounds)}`
  if (cfg.mode === 'amrap') return `${name} · ${t('{0} on the clock', fmtClock(cfg.cap))}`
  if (cfg.mode === 'emom') return `${name} · ${t('every {0}, {1} times', fmtClock(cfg.every), cfg.count)}`
  if (cfg.program === 'runwalk') return `${name} · ${t('Level {0} of {1}', cfg.level, RUNWALK.length)}`
  return `${name} · ${t('{0} on, {1} off', fmtClock(cfg.work), fmtClock(cfg.rest))} × ${cfg.rounds}`
}

/** What a mode is for, under its name in the picker. */
export const MODE_HINT = {
  superset: 'Back-to-back, at your own pace. The classic.',
  circuit: 'Rounds over your stations. Tap Done, move on, repeat.',
  amrap: 'As many rounds as you can before the clock says stop.',
  emom: 'A new interval every minute on the minute. Finish early, rest the rest.',
  intervals: 'Work, rest, repeat. Tabata is 20 on, 10 off, 8 times.',
  runwalk: 'Run a bit, walk a bit, run a little more each level. Three finished runs move you up.',
}

/** A saved result in a line: "6 rounds + 4 reps" for AMRAP, "3 rounds · 4:12" otherwise. */
export function resultLine(res) {
  if (!res) return ''
  if (res.mode === 'amrap') return t('{0} rounds + {1} reps', res.rounds, res.extra)
  if (res.mode === 'emom' || res.mode === 'intervals') return `${modeName(res.cfg || res)} · ${fmtClock(res.sec)}`
  return `${tn('{0} round', '{0} rounds', res.rounds)} · ${fmtClock(res.sec)}`
}

/** Today against last time (lib/circuit.js compareResult), or ''. */
export function compareLine(cmp) {
  if (!cmp) return ''
  if (cmp.kind === 'same') return t('Same as last time. Consistency is a superpower.')
  if (cmp.kind === 'rounds') return cmp.delta > 0 ? t('{0} more rounds than last time', cmp.delta) : t('{0} fewer rounds than last time', -cmp.delta)
  if (cmp.kind === 'reps') return cmp.delta > 0 ? t('{0} more reps than last time', cmp.delta) : t('{0} fewer reps than last time', -cmp.delta)
  return cmp.delta < 0 ? t('Round {0} today: {1} s faster than last time', cmp.round, -cmp.delta) : t('Round {0} today: {1} s slower than last time', cmp.round, cmp.delta)
}

/** The player's round counter: "Round 2 of 5", "Interval 4 of 10", AMRAP just "Round 3". */
export function roundLabel(cfg, step, stations) {
  if (!step || step.k === 'prep') return t('Get ready')
  if (step.warm) return t('Warm-up walk')
  if (cfg.mode === 'emom') {
    const i = step.r * stations + step.m + 1
    return t('Interval {0} of {1}', Math.min(i, cfg.count), cfg.count)
  }
  if (cfg.mode === 'amrap') return t('Round {0}', step.r + 1)
  return t('Round {0} of {1}', Math.min(step.r + 1, cfg.rounds), cfg.rounds)
}

/** What the voice and the lock screen say when a step begins. */
export const cueWords = {
  work: (name, step) => (step?.r === 0 || step?.m !== 0 ? t('Go! {0}', name) : t('Round {0}. Go! {1}', step.r + 1, name)),
  rest: (name, step) => (step?.warm ? t('Warm-up walk. Easy does it.') : step?.round ? t('Round done. Breathe. {0} is next', name) : t('Rest. {0} is next', name)),
  end: () => t('Time! That’s the circuit.'),
}
