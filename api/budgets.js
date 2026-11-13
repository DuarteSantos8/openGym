/* Per-account budgets for the trainer, gym and library routes, in one place (rate-limit.js does
 * the counting). A budget is per profile id, so a whole gym behind one address never shares one.
 * Over budget the route answers 429 with Retry-After and code 'rate-limited'. */
import { createBackoff, createWindow } from './rate-limit.js';

const H = 3600000;
export const BUDGETS = {
  // Trainer side (design 8.3)
  'trainer.code': { max: 20, windowMs: 24 * H },      // new invite codes per trainer per day
  'trainer.list': { max: 120, windowMs: H },          // member list and requests
  'trainer.detail': { max: 600, windowMs: H },        // one member's projection (dashboard, later)
  'trainer.ops': { max: 300, windowMs: H },           // writes into members' plans (later)
  'trainer.comment': { max: 100, windowMs: H },
  'trainer.photo': { max: 1200, windowMs: H },        // progress photos, one file per call
  'trainer.answer': { max: 300, windowMs: H },        // confirm, decline, disconnect
  // Member side
  'sharing.read': { max: 600, windowMs: H },          // the sharing page, the log, the export
  'sharing.write': { max: 60, windowMs: H },          // connect, change, disconnect, leave
  // Admin
  'admin.gyms': { max: 300, windowMs: H },
  'data.admin': { max: 300, windowMs: H },            // ADMIN_DATA_VIEW reads
  // Shared library (docs/dev/SHARED-LIBRARY-API.md)
  'library.list': { max: 600, windowMs: H },
  'library.publish': { max: 20, windowMs: H },
  'library.edit': { max: 60, windowMs: H },
  'library.report': { max: 10, windowMs: H },
  'library.import': { max: 120, windowMs: H },
};

/** One window per budget. `take(name, key)` is 0 within budget, else the seconds to wait. */
export function createBudgets({ budgets = BUDGETS, now } = {}) {
  const wins = Object.fromEntries(Object.entries(budgets).map(([k, b]) => [k, createWindow({ ...b, ...(now ? { now } : {}) })]));
  const sweep = setInterval(() => { for (const w of Object.values(wins)) w.sweep(); }, 60000);
  sweep.unref?.();
  return {
    take(name, key) {
      const w = wins[name];
      if (!w) throw new Error('unknown budget ' + name);
      return w.take(String(key));
    },
    stop: () => clearInterval(sweep)
  };
}

/** Guessing codes: per address and per account, 10 wrong ones free, then a pause that doubles. */
export const createCodeGuard = ({ now } = {}) => ({
  addr: createBackoff({ free: 10, baseMs: 60000, maxMs: H, forgetMs: 24 * H, ...(now ? { now } : {}) }),
  acct: createBackoff({ free: 10, baseMs: 60000, maxMs: H, forgetMs: 24 * H, ...(now ? { now } : {}) })
});
