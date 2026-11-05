/* The week streak, the one walk: the app (frontend/src/lib/streak.js, lib/streak-rule.js) and the
 * server (trainers/projections.js, the trainer's member list) both count with this file, so a
 * trainer never sees a number the member's own phone does not. It lives in coach/core because
 * that is the folder every build already shares with the frontend. Pure, no node or DOM imports.
 *
 * The rules (lib/streak.js has the long version): a trained week adds one, every 4th trained week
 * of a run earns a freeze up to what the rule keeps, a missed week spends a freeze or starts the
 * run over, and this week, still empty, is open. S.streakRule = { rule, since, history } is not
 * retroactive: each week is judged by the rule in force that week. */

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
  // The rules and the weeks they start, in this profile's weeks.
  const timeline = ruleTimeline(S).map(e => ({ rule: e.rule, since: e.since === null ? null : weekKey(e.since, ws) }));
  const nowRule = ruleAt(timeline, cur);
  const max = STREAK_RULES[nowRule].max;
  const empty = { current: 0, best: 0, freezes: 0, frozen: [], thisWeekDone: false, badges: [], next: STREAK_BADGES[0], toNextFreeze: max ? FREEZE_EVERY : 0, weekKey: cur, rule: nowRule, max };
  if (!trained.size) return empty;
  let wk = [...trained].sort()[0];
  const floor = plusWeek(cur, -MAX_WEEKS);
  if (wk < floor) wk = floor;
  let run = 0, best = 0, freezes = 0, earned = 0, frozen = [];
  for (let i = 0; i <= MAX_WEEKS && wk <= cur; i++, wk = plusWeek(wk)) {
    let s = 'open', got = false;
    const rule = ruleAt(timeline, wk), cap = STREAK_RULES[rule].max;
    // A rule that keeps fewer: the bank shrinks to it, the streak stays as counted.
    if (freezes > cap) freezes = cap;
    if (trained.has(wk)) {
      run++;
      earned++;
      if (earned % FREEZE_EVERY === 0 && freezes < cap) { freezes++; got = true; }
      s = 'on';
    } else if (wk !== cur) {
      if (freezes > 0) { freezes--; frozen.push(wk); s = 'frozen'; } else { s = run > 0 ? 'broke' : 'missed'; run = 0; earned = 0; freezes = 0; frozen = []; }
    }
    if (run > best) best = run;
    if (log) log.set(wk, { s, run, bank: freezes, earned: got, rule });
  }
  return {
    current: run,
    best,
    freezes,
    frozen,
    thisWeekDone: trained.has(cur),
    badges: STREAK_BADGES.filter(b => best >= b),
    next: STREAK_BADGES.find(b => best < b) ?? null,
    toNextFreeze: freezes >= max ? 0 : FREEZE_EVERY - (earned % FREEZE_EVERY),
    weekKey: cur,
    rule: nowRule,
    max,
  };
}
