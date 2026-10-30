/* What a Coach review costs in provider tokens, averaged over the last few reviews.
 *
 * Each job records the usage the provider reported for its calls: input tokens (everything sent,
 * including cached prompt tokens the provider billed separately), output tokens, and how many
 * provider calls the job took (one, or two when the repair round ran). A job whose provider
 * reported nothing, such as the runtime-backed CLIs, records nothing, and is left out of the
 * average rather than counted as zero.
 *
 * Pure: the server (jobs.js) and the phone (coach-local.js) each keep their own list of entries
 * and ask this for the average, so both show the same number for the same history. */

export const USAGE_WINDOW = 10;

/** One call's usage as the adapters report it, or null when the provider said nothing usable.
 *  Only real numbers count: a missing or non-numeric count is absent, never zero. */
export function usageOf(input, output, calls = 1) {
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const i = num(input), o = num(output);
  if (i == null && o == null) return null;
  return { input: Math.max(0, i || 0), output: Math.max(0, o || 0), calls: Math.max(1, calls | 0) };
}

/** Sum of several calls' usage (the repair round adds a second), or null when none reported. */
export function sumUsage(list) {
  const got = (list || []).filter(Boolean);
  if (!got.length) return null;
  return got.reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output, calls: a.calls + u.calls }), { input: 0, output: 0, calls: 0 });
}

/**
 * The average over the last `window` entries that carry usage.
 * `entries` are history records ({ usage?: {input, output, calls} }), oldest first.
 * Returns { reviews, input, output, calls } with rounded per-review averages, or null when no
 * entry reported usage yet.
 */
export function averageUsage(entries, window = USAGE_WINDOW) {
  const withUsage = (entries || []).filter(e => e && e.usage && Number.isFinite(e.usage.input)).slice(-window);
  if (!withUsage.length) return null;
  const n = withUsage.length;
  const sum = withUsage.reduce((a, e) => ({
    input: a.input + e.usage.input, output: a.output + e.usage.output, calls: a.calls + (e.usage.calls || 1)
  }), { input: 0, output: 0, calls: 0 });
  return {
    reviews: n,
    input: Math.round(sum.input / n),
    output: Math.round(sum.output / n),
    calls: Math.round((sum.calls / n) * 10) / 10
  };
}
