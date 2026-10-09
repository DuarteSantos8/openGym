// Deterministic Coach answers built only from the user's saved openGym state.
// No network calls, model, API key, provider config, or generated facts.
import { weeklyReview, progressVerdict } from './ben-coach.js'
import { recommendToday } from './recommendation.js'
import { fmtNum, todayISO } from './format.js'

export const RULE_COACH_QUESTIONS = [
  { id: 'week', title: 'How am I doing this week?', subtitle: 'Workouts, consistency and recent wins', icon: 'calendar' },
  { id: 'next', title: 'What should I train next?', subtitle: 'Use my plan, recent sessions and preferred duration', icon: 'dumbbell' },
  { id: 'strength', title: 'Is my strength progressing?', subtitle: 'Use logged performance and personal records', icon: 'trendingUp' },
  { id: 'goal', title: 'Am I on track for my goal?', subtitle: 'Check the evidence we have so far', icon: 'target' },
  { id: 'improve', title: 'What should I improve?', subtitle: 'One practical next step based on my data', icon: 'wrench' },
]

const asSentence = why => {
  if (!Array.isArray(why) || !why.length) return ''
  return why.slice(1).reduce((sentence, value, i) => sentence.split('{' + i + '}').join(String(value ?? '')), String(why[0]))
}
const hasPlan = S => (S?.routines || []).length > 0
const latestWeight = S => (S?.bodyweight || []).filter(x => Number.isFinite(Number(x?.w)) && x?.d).slice().sort((a, b) => a.d.localeCompare(b.d)).at(-1)

function answerWeek(S, review) {
  const { training, consistency, improvements } = review
  const lines = [
    `You've logged ${training.done} workout${training.done === 1 ? '' : 's'} this calendar week.`,
    consistency.expected > 0
      ? `Your schedule has ${consistency.status === 'baseline' ? 0 : Object.values(S?.week || {}).filter(ids => [].concat(ids ?? []).length).length} training day(s) in a typical week; your last four weeks show ${consistency.done} completed workout(s) against about ${fmtNum(consistency.expected)} expected.`
      : 'No training days are scheduled yet, so consistency against a plan cannot be measured.',
  ]
  if (improvements.length) lines.push(`Recent win: ${improvements.slice(0, 3).map(x => x.name).join(', ')} recorded a personal record in the last 14 days.`)
  else lines.push('No new personal records are recorded in the last 14 days. That alone does not mean progress has stalled.')
  return { title: 'Your week so far', summary: training.planned ? `${training.done} workout(s) logged · ${training.planned} scheduled day(s) per week` : `${training.done} workout(s) logged`, lines }
}

function answerNext(S) {
  const rec = recommendToday(S)
  if (!rec.routine) return {
    title: 'Set up your next session',
    summary: 'There is no routine to recommend yet.',
    lines: [rec.reason || 'Build or load a routine in Plan, then schedule it on a training day.', 'Once you log sessions, recommendations can use your actual history.'],
    action: { label: 'Open Plan', route: '/plan' },
  }
  const n = rec.routine.ex?.length || 0
  return {
    title: rec.routine.name,
    summary: `${rec.duration} minutes · ${n} planned exercise(s)`,
    lines: [
      rec.reason,
      'Keep the planned exercises and use the targets shown when you start the workout; the app’s progression logic sets exercise-level targets from your logged performance.',
    ],
    action: { label: 'Start workout', route: '/start' },
  }
}

function answerStrength(S, review) {
  const lines = []
  if (review.strength.compared > 0) {
    lines.push(`Across ${review.strength.compared} comparable exercise(s), ${review.strength.improved} improved and ${review.strength.declined} declined in the comparison window.`)
    if (review.strength.status === 'holding') lines.push('Overall strength looks broadly maintained in the exercises the app can compare.')
    else if (review.strength.status === 'attention') lines.push('Several compared movements are down. Repeat current loads, check recovery, and avoid forcing increases this week.')
    else lines.push('The signal is mixed. Keep logging comparable sets before making a larger change.')
  } else {
    lines.push('There is not enough comparable logged performance to judge a strength trend yet.')
  }
  if (review.improvements.length) lines.push(`Personal records in the last 14 days: ${review.improvements.slice(0, 4).map(x => x.name).join(', ')}.`)
  else lines.push('No personal records are recorded in the last 14 days.')
  if (!(S?.workouts || []).length) lines.push('Finish and save a workout first; uncompleted sessions do not count as evidence.')
  return { title: 'Strength trend', summary: review.strength.compared ? review.strength.status === 'attention' ? 'Some strength signals need attention' : review.strength.status === 'holding' ? 'Strength is broadly holding' : 'Mixed evidence so far' : 'More logged sessions needed', lines }
}

function answerGoal(S, review) {
  const target = Number(S?.targetW)
  const weighIns = (S?.bodyweight || []).filter(x => Number.isFinite(Number(x?.w)) && x?.d)
  if (!Number.isFinite(target) || target <= 0) {
    return {
      title: 'Your goal needs a target',
      summary: 'No target body weight is set.',
      lines: [
        'Set a target in the Progress screen if body-weight change is part of your goal.',
        review.consistency.status === 'on-track'
          ? 'Your last four weeks of training are on schedule.'
          : review.consistency.status === 'close'
            ? 'Training is somewhat below the planned frequency over the last four weeks.'
            : review.consistency.status === 'behind'
              ? 'Training frequency is below half of the planned rate over the last four weeks. Start with the next scheduled session before changing the plan.'
              : 'Schedule training days in Plan to measure consistency.',
      ],
      action: { label: 'Open Progress', route: '/progress' },
    }
  }
  if (weighIns.length < 2) {
    return {
      title: 'Keep collecting evidence',
      summary: `Target: ${fmtNum(target)} ${S?.unit || 'kg'}`,
      lines: ['At least two weigh-ins are needed to compare a trend. Record body weight under Progress, preferably under similar conditions.', 'One measurement is a starting point, not a trend.'],
      action: { label: 'Open Progress', route: '/progress' },
    }
  }
  const verdict = progressVerdict(review)
  const latest = latestWeight(S)
  return {
    title: verdict.title,
    summary: `Latest weigh-in: ${fmtNum(Number(latest.w))} ${S?.unit || 'kg'} · target: ${fmtNum(target)} ${S?.unit || 'kg'}`,
    lines: [
      verdict.detail,
      review.consistency.status === 'behind'
        ? 'The clearest next step is to resume the planned sessions consistently before changing multiple variables.'
        : review.consistency.status === 'on-track'
          ? 'Training frequency is on schedule over the last four weeks.'
          : review.consistency.status === 'close'
            ? 'Training frequency is below the planned rate. Improve consistency before drawing a strong conclusion.'
            : 'A weekly schedule is not set, so training consistency cannot be compared with a target.',
      review.bodyweight.meaningful && review.bodyweight.rate != null
        ? `The measured trend is ${review.bodyweight.rate > 0 ? '+' : ''}${fmtNum(review.bodyweight.rate)} ${S?.unit || 'kg'} per week over ${review.bodyweight.weeksUsed} week(s).`
        : 'The recorded weight trend is not strong enough yet to call meaningful.',
    ],
  }
}

function answerImprove(S, review) {
  const recommendation = asSentence(review.recommendation?.why)
  const lines = [recommendation || 'Log a few more sessions so the Coach has enough evidence to find the most useful adjustment.']
  const flags = (review.attention || []).slice(0, 3)
  if (flags.length) lines.push('Also worth checking: ' + flags.map(x => x.name + (x.kind === 'stalling' ? ' (repeated missed targets)' : x.kind === 'skipped' ? ' (no completed sets recently)' : x.kind === 'equipment' ? ' (equipment mismatch)' : '')).join('; ') + '.')
  if (review.recommendation?.kind === 'setup') lines.push('The plan or schedule needs attention before exercise-level changes will help.')
  if (review.recommendation?.kind === 'progress') lines.push('Use the next workout’s displayed targets rather than adding extra load by guesswork.')
  return {
    title: 'Your next improvement',
    summary: review.recommendation?.kind === 'progress' ? 'Keep the current approach' : 'One evidence-based next step',
    lines,
    action: !hasPlan(S) ? { label: 'Open Plan', route: '/plan' } : null,
  }
}

export function answerRuleCoach(S, questionId) {
  const question = RULE_COACH_QUESTIONS.find(q => q.id === questionId)
  if (!question) return null
  const review = weeklyReview(S || {})
  const answer = questionId === 'week' ? answerWeek(S, review)
    : questionId === 'next' ? answerNext(S || {})
      : questionId === 'strength' ? answerStrength(S || {}, review)
        : questionId === 'goal' ? answerGoal(S || {}, review)
          : answerImprove(S || {}, review)
  return { ...answer, questionId, updatedAt: todayISO() }
}
