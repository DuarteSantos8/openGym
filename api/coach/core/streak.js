/* The week streak, the one walk: the app (frontend/src/lib/streak.js, lib/streak-rule.js) and the
 * server (trainers/projections.js, the trainer's member list) both count with this file, so a
 * trainer never sees a number the member's own phone does not. It lives in coach/core because
 * that is the folder every build already shares with the frontend. Pure, no node or DOM imports.
 *
 * The rules (lib/streak.js has the long version): a trained week adds one, every 4th trained week
 * of a run earns a freeze up to what the rule keeps, a missed week spends a freeze or starts the
 * run over, and this week, still empty, is open. S.streakRule = { rule, since, history } is not
 * retroactive: each week is judged by the rule in force that week.
 *
 * SICK AND TRAVEL WEEKS (1.4.5). A missed week with a day note tagged sick, travel or injured
 * (frontend lib/day-notes.js, S.dayNotes) is excused: the streak carries on, no freeze is spent,
 * and the week adds nothing to the count, like a freeze would. At most S.streakExcuse such weeks
 * a calendar year (the year the week starts in), EXCUSE_DEFAULT when never set, 0 turns it off.
 * Past the cap the week falls back to the freezes. A note says the week was out of your hands,
 * so it is read for every week, including the ones before this version. */

export const FREEZE_EVERY = 4;
export const FREEZE_MAX = 2;
export const STREAK_BADGES = [4, 12, 26, 52, 104];
export const STREAK_RULES = {
  off: { every: 4, max: 0 },
  gentle: { every: 4, max: 1 },
  generous: { every: 4, max: 2 },
};
export const RULE_IDS = ['off', 'gentle', 'generous'];
export const LEGACY_RULE = 'generous';
export const NEW_PROFILE_RULE = 'gentle';
export const HISTORY_MAX = 24;
// Sick, travel and injured day notes excuse their week; a rest day is a choice, so it does not.
export const EXCUSE_TAGS = ['sick', 'travel', 'injured'];
export const EXCUSE_DEFAULT = 4;
export const EXCUSE_CHOICES = [0, 2, 4, 6];
export const EXCUSE_MAX = 12;
/** How many weeks a year a sick or travel note may excuse, for this profile. */
export const excuseCapOf = S => {
  const n = S?.streakExcuse;
  return Number.isInteger(n) && n >= 0 && n <= EXCUSE_MAX ? n : EXCUSE_DEFAULT;
};
// Far enough back for any real history, short enough that a typo'd year cannot spin the loop.
const MAX_WEEKS = 1500;

const isISO = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const okRule = r => (RULE_IDS.includes(r) ? r : null);
const entry = e => {
  if (!e || typeof e !== 'object' || !okRule(e.rule)) return null;
  return { rule: e.rule, since: isISO(e.since) ? e.since : null };
};

// Calendar maths at UTC noon: no zone or DST edge moves a day. Same answers as lib/format.js.
const DAY = 86400000;
const ms = iso => Date.parse(iso + 'T12:00:00Z');
const isoAt = t => new Date(t).toISOString().slice(0, 10);
export const weekStartOf = S => (S?.weekStart === 0 ? 0 : 1);
/** The first day of the week `iso` falls in, for a week starting on `ws` (0 Sunday, 1 Monday). */
export function weekKeyOf(iso, ws = 1) {
  const t = ms(iso);
  return isoAt(t - ((new Date(t).getUTCDay() - ws + 7) % 7) * DAY);
}
const plusWeek = (iso, n = 1) => isoAt(ms(iso) + 7 * n * DAY);

/** S.streakRule cleaned, or null when the profile never picked one (it counts as `generous`). */
export function streakRuleOf(S) {
  const cur = entry(S?.streakRule);
  if (!cur) return null;
  const hist = (Array.isArray(S.streakRule.history) ? S.streakRule.history : []).map(entry).filter(Boolean)
    // Only what came before the rule in force, in order; a second entry for the same start, the
    // later one.
    .filter(h => cur.since === null ? false : (h.since === null || h.since < cur.since))
    .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
  const byStart = new Map();
  for (const h of hist) byStart.set(h.since ?? '', h);
  return { ...cur, history: [...byStart.values()].slice(-HISTORY_MAX) };
}

/** Every rule with the week it starts, oldest first: [{ rule, since }] (since null = always). */
export function ruleTimeline(S) {
  const r = streakRuleOf(S);
  if (!r) return [{ rule: LEGACY_RULE, since: null }];
  const list = [...r.history, { rule: r.rule, since: r.since }];
  // Before the first known start, the rule a profile had before it ever picked one.
  return list[0].since === null ? list : [{ rule: LEGACY_RULE, since: null }, ...list];
}

/** The rule that judges the week `wk` (a week key), from a timeline with its starts as week keys. */
export function ruleAt(timeline, wk) {
  let rule = LEGACY_RULE;
  for (const e of timeline) if (e.since === null || e.since <= wk) rule = e.rule;
  return rule;
}

/**
 * The streak as of `today` (an ISO date). Returns lib/streak.js streakInfo's shape. `log`, a
 * Map, gets what the walk decided per week. `weekKey(iso, ws)` can be swapped for a memoised
 * one with the same answers (the app does, it asks for every workout on every render).
 */
export function streakWalk(S, today, { log = null, weekKey = weekKeyOf } = {}) {
  const ws = weekStartOf(S);
  const cur = weekKey(today, ws);
  const trained = new Set();
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    if (!w || !isISO(w.d)) continue;
    const k = weekKey(w.d, ws);
    if (k <= cur) trained.add(k);
  }
  // Recovery sessions (frontend/src/lib/recovery-sessions.js) count only when the profile opted in:
  // a sauna week is a week you showed up for yourself, but not everyone wants it to keep a streak.
  if (S?.recoveryStreak === true && S.recoverySessions && typeof S.recoverySessions === 'object') {
    for (const r of Object.values(S.recoverySessions)) {
      if (!r || !isISO(r.d) || !(Number(r.min) >= 1)) continue;
      const k = weekKey(r.d, ws);
      if (k <= cur) trained.add(k);
    }
  }
  // Activities (frontend/src/lib/activities.js: a run, a football match, read from the health store
  // or an import) count the same way, only when the profile opted in (S.activityStreak).
  if (S?.activityStreak === true && S.activities && typeof S.activities === 'object') {
    for (const a of Object.values(S.activities)) {
      if (!a || !isISO(a.d) || !(Number(a.min) >= 1)) continue;
      const k = weekKey(a.d, ws);
      if (k <= cur) trained.add(k);
    }
  }
  // The weeks a sick, travel or injured note sits in (a cleared note is `{ _ts }`, no tag).
  const excusable = new Map();
  if (S?.dayNotes && typeof S.dayNotes === 'object' && !Array.isArray(S.dayNotes)) {
    for (const [iso, n] of Object.entries(S.dayNotes)) {
      if (!isISO(iso) || !n || typeof n !== 'object' || !EXCUSE_TAGS.includes(n.tag)) continue;
      const k = weekKey(iso, ws);
      if (k <= cur && !excusable.has(k)) excusable.set(k, n.tag);
    }
  }
  const excuseCap = excuseCapOf(S);
  const usedIn = new Map();
  // The rules and the weeks they start, in this profile's weeks.
  const timeline = ruleTimeline(S).map(e => ({ rule: e.rule, since: e.since === null ? null : weekKey(e.since, ws) }));
  const nowRule = ruleAt(timeline, cur);
  const max = STREAK_RULES[nowRule].max;
  const empty = { current: 0, best: 0, freezes: 0, frozen: [], excused: [], excuseCap, excuseLeft: excuseCap, thisWeekDone: false, badges: [], next: STREAK_BADGES[0], toNextFreeze: max ? FREEZE_EVERY : 0, weekKey: cur, rule: nowRule, max };
  if (!trained.size) return empty;
  let wk = [...trained].sort()[0];
  const floor = plusWeek(cur, -MAX_WEEKS);
  if (wk < floor) wk = floor;
  let run = 0, best = 0, freezes = 0, earned = 0, frozen = [], excused = [];
  for (let i = 0; i <= MAX_WEEKS && wk <= cur; i++, wk = plusWeek(wk)) {
    let s = 'open', got = false, why = null;
    const rule = ruleAt(timeline, wk), cap = STREAK_RULES[rule].max;
    // A rule that keeps fewer: the bank shrinks to it, the streak stays as counted.
    if (freezes > cap) freezes = cap;
    if (trained.has(wk)) {
      run++;
      earned++;
      if (earned % FREEZE_EVERY === 0 && freezes < cap) { freezes++; got = true; }
      s = 'on';
    } else if (wk !== cur) {
      const year = wk.slice(0, 4), used = usedIn.get(year) || 0;
      if (run > 0 && excusable.has(wk) && used < excuseCap) {
        // Out of your hands: carried, nothing spent, nothing added.
        usedIn.set(year, used + 1); excused.push(wk); s = 'excused'; why = excusable.get(wk);
      } else if (freezes > 0) { freezes--; frozen.push(wk); s = 'frozen'; } else { s = run > 0 ? 'broke' : 'missed'; run = 0; earned = 0; freezes = 0; frozen = []; excused = []; }
    }
    if (run > best) best = run;
    if (log) log.set(wk, why ? { s, run, bank: freezes, earned: got, rule, tag: why } : { s, run, bank: freezes, earned: got, rule });
  }
  return {
    current: run,
    best,
    freezes,
    frozen,
    excused,
    excuseCap,
    excuseLeft: Math.max(0, excuseCap - (usedIn.get(cur.slice(0, 4)) || 0)),
    thisWeekDone: trained.has(cur),
    badges: STREAK_BADGES.filter(b => best >= b),
    next: STREAK_BADGES.find(b => best < b) ?? null,
    toNextFreeze: freezes >= max ? 0 : FREEZE_EVERY - (earned % FREEZE_EVERY),
    weekKey: cur,
    rule: nowRule,
    max,
  };
}
