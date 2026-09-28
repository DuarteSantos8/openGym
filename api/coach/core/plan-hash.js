/**
 * Fingerprint of the plan a proposal was computed against (FR-32). Takes the output of
 * `canonicalPlan`, so both runtimes hash the same normalised shape; the client mirrors this
 * function exactly. A mismatch therefore means the plan genuinely moved — not that two
 * implementations disagree about key order or about what "no weight" looks like.
 *
 * The field list must stay in step with `canonicalPlan`. It did not: that function learned
 * `repsMax`, `bodyweight` and `side` when the payload did, and this one kept hashing the
 * pre-1.2.4 list, so a plan whose rep ceiling had been raised by hand fingerprinted as
 * untouched — which is exactly the edit a proposal about bodyweight progression is stalest
 * against.
 */
export function hashPlan(plan) {
  const canon = JSON.stringify({
    routines: (plan?.routines || []).map(r => [r.id, r.name, r.prog, (r.ex || []).map(e =>
      [e.id, e.mode, e.sets, e.reps, e.sec, e.min, e.speed, e.weight, e.prog, e.inc,
        e.repsMin, e.repsMax, e.bodyweight, e.side, e.sg].join(':')
    )]),
    // `plan` is a canonicalPlan output, so each day is already a routine-id list. `{1:['r1']}`
    // → "1=r1", byte-identical to the pre-upgrade fingerprint; `{3:['r2','r3']}` → "3=r2+r3".
    // Weekday keys still sorted; the routine list within a day never is (it is the merge order).
    week: Object.keys(plan?.week || {}).sort().map(k => k + '=' + [].concat(plan.week[k]).join('+'))
  });
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < canon.length; i++) {
    const c = canon.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 3) | i & 7), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
