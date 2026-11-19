// The test lifters: made-up people, each with one known problem and the answer we expect.
// `expect` is checked by plain code (run.mjs); `story` is what the judge reads to mark the reasons.
//
// Exercise ids: 0025 bench press, 0047 incline bench, 0027 bent over row, 0652 pull-up,
// 0043 squat, 0085 romanian deadlift, 1457 military press, 0294 dumbbell curl,
// 0035 close-grip skull press.

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);

// Eight weeks of sessions that follow the plan. `stall` names exercises that stop hitting
// their reps over the last four sessions they appear in.
function history(S, { now, weeks = 8, stall = [] }) {
  const byId = new Map(S.routines.map(r => [r.id, r]));
  const days = [];
  for (let t = now - weeks * 7 * DAY; t < now; t += DAY) {
    const wd = new Date(t).getUTCDay() || 7; // 1 = Monday ... 7 = Sunday, as S.week
    for (const rid of S.week[wd] || []) days.push({ t, r: byId.get(rid) });
  }
  const seen = new Map();
  const count = new Map();
  days.forEach(({ r }) => r.ex.forEach(e => count.set(e.id, (count.get(e.id) || 0) + 1)));
  return days.map(({ t, r }, i) => ({
    id: `w${i}`, d: iso(t), rid: r.id, start: t + 17 * 3600000, end: t + 17 * 3600000 + 55 * 60000,
    entries: r.ex.map(e => {
      const n = (seen.get(e.id) || 0) + 1; seen.set(e.id, n);
      const stalled = stall.includes(e.id) && n > count.get(e.id) - 4;
      const w = stalled ? e.weight : Math.max(0, e.weight - 2.5 * Math.ceil((count.get(e.id) - n) / 2));
      return {
        id: e.id, target: { sets: e.sets, reps: e.reps },
        sets: Array.from({ length: e.sets }, (_, k) => ({ w, r: stalled && k > 0 ? e.reps - 2 : e.reps, done: true }))
      };
    })
  }));
}

// Each lifter's own ranges (Settings): wide, so only the problem under test shows as a check.
const WIDE = Object.fromEntries(['chest', 'lats', 'upper-back', 'front-delts', 'side-delts', 'rear-delts', 'biceps', 'triceps', 'quadriceps', 'hamstring', 'gluteal', 'calves', 'abs'].map(m => [m, [0, 30]]));
const ranges = (own = {}) => ({ ...WIDE, ...own });

const ex = (id, sets, reps, weight) => ({ id, sets, reps, weight });

function lifter(name, { routines, week, profile, muscleTargets, stall, story, expect }) {
  return {
    name, story, expect,
    state(now) {
      const S = { unit: 'kg', lang: 'en', routines, week, muscleTargets: ranges(muscleTargets), coach: { profile } };
      S.workouts = history(S, { now, stall });
      return S;
    }
  };
}

const UPPER = { id: 'up', name: 'Upper', ex: [ex('0025', 3, 8, 70), ex('0027', 3, 8, 60), ex('1457', 3, 8, 40), ex('0294', 3, 10, 12), ex('0035', 3, 10, 25)] };
const LOWER = { id: 'lo', name: 'Lower', ex: [ex('0043', 3, 6, 90), ex('0085', 3, 8, 70)] };

export const LIFTERS = [
  lifter('low-back', {
    routines: [
      { id: 'push', name: 'Push', ex: [ex('0025', 4, 8, 70), ex('0047', 3, 10, 55), ex('1457', 3, 8, 40), ex('0035', 3, 10, 25)] },
      { id: 'pull', name: 'Pull', ex: [ex('0027', 2, 8, 60), ex('0294', 3, 10, 12)] },
      { id: 'legs', name: 'Legs', ex: [ex('0043', 3, 6, 90), ex('0085', 3, 8, 70)] }
    ],
    week: { 1: ['push'], 3: ['pull'], 5: ['legs'] },
    profile: { goal: 'muscle', experience: 'intermediate' },
    muscleTargets: { lats: [10, 20], 'upper-back': [6, 16] },
    story: 'Wants size. Lots of pressing, only two sets of rows a week, so the back is far under its range. Everything else progresses.',
    expect: { cite: ['volume-low:lats'], adds: ['back'] }
  }),
  lifter('balanced', {
    routines: [UPPER, LOWER],
    week: { 1: ['up'], 2: ['lo'], 4: ['up'], 5: ['lo'] },
    profile: { goal: 'muscle', experience: 'intermediate' },
    story: 'Upper/lower four days a week, every lift progressing, every muscle inside the ranges they set. Nothing needs fixing.',
    expect: { calm: true }
  }),
  lifter('strength-once', {
    routines: [
      { id: 'chest', name: 'Chest day', ex: [ex('0025', 4, 5, 90), ex('0047', 3, 6, 70)] },
      { id: 'back', name: 'Back day', ex: [ex('0027', 4, 5, 80), ex('0652', 3, 6, 0)] },
      { id: 'legs', name: 'Leg day', ex: [ex('0043', 4, 5, 120), ex('0085', 3, 6, 100)] }
    ],
    week: { 1: ['chest'], 3: ['back'], 5: ['legs'] },
    profile: { goal: 'strength', experience: 'intermediate' },
    story: 'Wants strength, runs a body-part split: each main muscle gets one session a week.',
    expect: { cite: ['frequency:'] }
  }),
  lifter('six-sets', {
    routines: [{ ...UPPER, ex: [ex('0025', 6, 8, 70), ...UPPER.ex.slice(1)] }, LOWER],
    week: { 1: ['up'], 2: ['lo'], 4: ['up'], 5: ['lo'] },
    profile: { goal: 'muscle', experience: 'intermediate' },
    story: 'Does six sets of bench press in one go, twice a week. More than four on one exercise adds little.',
    expect: { cite: ['sets-per-exercise:up:0025'], touches: ['0025'] }
  }),
  lifter('chest-heavy', {
    routines: [
      { id: 'a', name: 'Chest and arms', ex: [ex('0025', 4, 8, 70), ex('0047', 4, 10, 55), ex('0294', 3, 10, 12)] },
      { id: 'b', name: 'Chest and legs', ex: [ex('0025', 4, 8, 70), ex('0047', 4, 10, 55), ex('0043', 3, 6, 90), ex('0027', 4, 8, 60)] }
    ],
    week: { 1: ['a'], 3: ['b'], 5: ['a'] },
    profile: { goal: 'muscle', experience: 'intermediate' },
    muscleTargets: { chest: [10, 20] },
    story: 'Loves chest: well over the top of the chest range. That is a note, never a fault: the Coach may suggest moving a few sets elsewhere, never scold.',
    expect: { cite: ['volume-high:chest', 'volume-cap'] }
  }),
  lifter('bench-stall', {
    routines: [UPPER, LOWER],
    week: { 1: ['up'], 2: ['lo'], 4: ['up'], 5: ['lo'] },
    profile: { goal: 'strength', experience: 'intermediate' },
    stall: ['0025'],
    story: 'Bench press has missed its reps four sessions running at the same weight. Everything else progresses. The Coach should do something about the bench, not the rest.',
    expect: { touches: ['0025'] }
  })
];
