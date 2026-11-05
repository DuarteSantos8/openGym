/* What a member can share with a trainer or a gym lead, and how far (docs/TRAINERS.md).
 * Pure data and helpers, no node imports: frontend/src/lib/sharing-scopes.js keeps a hand copy
 * and a parity test compares the two. */

// Levels in order: each one includes the ones before it.
export const LEVELS = ['off', 'view', 'suggest', 'apply'];
export const rank = level => Math.max(0, LEVELS.indexOf(level));

// `max` is the highest level a category can ever reach. Photos, notes, metrics and nutrition are
// read only: a trainer never uploads a member's photos or writes their notes.
export const CATEGORIES = [
  { id: 'metrics', max: 'view' },
  { id: 'workouts', max: 'apply' },
  { id: 'plans', max: 'apply' },
  { id: 'bodyweight', max: 'apply' },
  { id: 'measurements', max: 'apply' },
  { id: 'photos', max: 'view' },
  { id: 'notes', max: 'view' },
  { id: 'nutrition', max: 'view' },
];
export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
const MAX = Object.fromEntries(CATEGORIES.map(c => [c.id, c.max]));

// What the consent screen starts with (design 3.2). The member sees and can change all of it.
export const TRAINER_DEFAULTS = { metrics: 'view', workouts: 'view', plans: 'suggest', bodyweight: 'view', measurements: 'off', photos: 'off', notes: 'off', nutrition: 'off' };

/** A clean scope map: every category present, unknown keys dropped, each level capped at what
 *  the category allows and at `cap` (the lead row never goes past view). */
export function cleanScopes(input, cap = 'apply') {
  const out = {};
  for (const id of CATEGORY_IDS) {
    const want = input && typeof input === 'object' && LEVELS.includes(input[id]) ? input[id] : 'off';
    const top = Math.min(rank(MAX[id]), rank(cap));
    out[id] = LEVELS[Math.min(rank(want), top)];
  }
  return out;
}

/* How the gym lead gets to see a member (owner decision E3). One switch, three answers:
 *   row     its own consent row, pre-filled with the trainer's read levels, never more than
 *           view, and the member can untick any category (the design's recommendation)
 *   mirror  the lead always sees what the trainer sees, capped at view, no separate choice
 *   none    the lead sees names only, never content */
export const LEAD_MODES = ['row', 'mirror', 'none'];
export const leadModeOf = v => (LEAD_MODES.includes(v) ? v : 'row');

/** The lead's scopes for a member, from the trainer scopes and what the member picked for the lead row. */
export function leadScopes(mode, trainerScopes, picked) {
  if (mode === 'none') return cleanScopes({}, 'view');
  // Joined a gym without a trainer: there is nothing to pre-fill from but the member's own pick.
  if (!trainerScopes) return cleanScopes(picked || TRAINER_DEFAULTS, 'view');
  const fromTrainer = cleanScopes(trainerScopes, 'view');
  if (mode === 'mirror') return fromTrainer;
  // row: the member may only take away from the pre-fill, never add beyond it.
  if (!picked) return fromTrainer;
  const mine = cleanScopes(picked, 'view');
  const out = {};
  for (const id of CATEGORY_IDS) out[id] = LEVELS[Math.min(rank(mine[id]), rank(fromTrainer[id]))];
  return out;
}

/** True when nothing at all is shared. */
export const sharesNothing = scopes => CATEGORY_IDS.every(id => rank(scopes?.[id]) === 0);
