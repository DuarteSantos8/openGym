/* The nutrition hook (docs/TRAINERS.md, "Nutrition"): where a trainer's "nutrition" category gets
 * its numbers from. An interface with one built-in source that knows nothing, so the category is
 * wired through consent, permissions and the dashboard today, and openNutrition (or Apple Health,
 * Health Connect) can plug in later without touching any of that.
 *
 *   source.status(memberId)                  -> 'not-linked' | 'ok' | 'error'
 *   source.getSummary(memberId, { from, to }) -> null | {
 *     source: 'opennutrition', days: [{ date, kcal, protein, carbs, fat, fibre?, target?: { kcal, protein }, logged }],
 *     checkin?: { trend, expenditure, note } }
 *
 * The member's token for the outside app never reaches a trainer: the server asks on the member's
 * behalf, only when a trainer with nutrition at "See" opens the member, and caches the answer.
 * openNutrition already speaks scoped tokens (`summary:read`, `coach:read`); this side asks for
 * `summary:read` and nothing else. */

/** The default: nobody is linked, every summary is empty. */
export const nullSource = Object.freeze({
  id: 'none',
  status: () => 'not-linked',
  getSummary: async () => null,
});

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
// A missing value stays missing: +null is 0, which read an unlogged macro as zero.
const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(+v) ? Math.round(+v * 10) / 10 : null);

/** One day of whatever an outside app answered, in the shape above (unknown fields dropped).
 *  openNutrition's own contract (opennutrition.summary.v1, its docs/integration-opengym.md) names
 *  them energy / carbohydrate / targets.energy; both spellings are read, so a linked member's days
 *  are not all nulls (before 1.4.5 only kcal / carbs / target were looked at). */
export function cleanDay(d) {
  if (!d || typeof d !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) return null;
  const src = d.target && typeof d.target === 'object' ? d.target : d.targets && typeof d.targets === 'object' ? d.targets : null;
  const t = src ? { kcal: num(src.kcal ?? src.energy), protein: num(src.protein) } : null;
  return { date: d.date, kcal: num(d.kcal ?? d.energy), protein: num(d.protein), carbs: num(d.carbs ?? d.carbohydrate), fat: num(d.fat),
    ...(d.fibre != null ? { fibre: num(d.fibre) } : {}), ...(t ? { target: t } : {}), logged: d.logged !== false,
    ...(Number.isInteger(d.proteinMeals) && d.proteinMeals >= 0 && d.proteinMeals <= 12 ? { proteinMeals: d.proteinMeals } : {}) };
}

/**
 * openNutrition, for when it is public: `url` is the instance (NUTRITION_URL), `tokenFor(memberId)`
 * the member's sealed `summary:read` token or null (not linked). Answers are cached `cacheMs`.
 */
export function openNutritionSource({ url, tokenFor = () => null, fetchImpl = globalThis.fetch, cacheMs = 15 * 60000, now = Date.now } = {}) {
  const cache = new Map();
  const errors = new Map();
  const base = String(url || '').replace(/\/+$/, '');
  return {
    id: 'opennutrition',
    status(memberId) {
      if (!base || !tokenFor(memberId)) return 'not-linked';
      return errors.get(memberId) > now() - cacheMs ? 'error' : 'ok';
    },
    async getSummary(memberId, { from, to } = {}) {
      const token = base ? tokenFor(memberId) : null;
      if (!token) return null;
      const f = from || iso(now() - 13 * DAY), t2 = to || iso(now());
      const key = `${memberId}|${f}|${t2}`;
      const hit = cache.get(key);
      if (hit && hit.at > now() - cacheMs) return hit.v;
      try {
        const r = await fetchImpl(`${base}/api/v1/integration/summary?from=${f}&to=${t2}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout?.(5000)
        });
        if (!r.ok) throw new Error('status ' + r.status);
        const body = await r.json();
        const v = { source: 'opennutrition', days: (Array.isArray(body?.days) ? body.days : []).map(cleanDay).filter(Boolean).slice(0, 62),
          ...(body?.checkin && typeof body.checkin === 'object' ? { checkin: { trend: num(body.checkin.trend), expenditure: num(body.checkin.expenditure), note: String(body.checkin.note || '').slice(0, 300) } } : {}) };
        cache.set(key, { at: now(), v });
        errors.delete(memberId);
        return v;
      } catch {
        errors.set(memberId, now());
        return null;
      }
    }
  };
}

/** The source this server uses (NUTRITION_SOURCE). Without one, or an unknown one, nullSource. */
export function nutritionSourceFrom(env = process.env, deps = {}) {
  if (env.NUTRITION_SOURCE === 'opennutrition' && env.NUTRITION_URL) return openNutritionSource({ url: env.NUTRITION_URL, ...deps });
  return nullSource;
}
