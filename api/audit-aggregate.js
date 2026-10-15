/* Repeats of one audit event, folded into a count.
 *
 * A misconfigured hub (a wrong key, a skewed clock) fails every sync call it makes, all from one
 * address, for as long as nobody notices. Per-address throttling (auditFail in server.js) still
 * let ten rows a minute through, and the log keeps only the newest AUDIT_MAX rows: at 5,000 that
 * pushed every sign-in, admin action and deletion out of it in about eight hours.
 *
 * Here each key (the event and its reason) gets one window at a time. The first occurrence is
 * written at once, so the log says promptly that something is wrong; the rest of the window only
 * counts. When the window is over (the next occurrence after it, or a sweep), the repeats are
 * written as one row carrying their number. A storm of one reason is then at most two rows a
 * window, whatever its rate.
 *
 * Pure: the caller hands in the clock and the writer.
 */
export function createAggregator({ windowMs, now = Date.now, write, maxKeys = 64 }) {
  const open = new Map(); // key -> { since, repeats, entry }

  function close(key, w) {
    open.delete(key);
    if (w.repeats > 0) write({ ...w.entry, repeats: w.repeats, since: w.since });
  }

  /** Close every window that is over (all of them with `force`). */
  function sweep(force = false) {
    const t = now();
    for (const [key, w] of open) if (force || t - w.since >= windowMs) close(key, w);
  }

  /** Count one occurrence; `entry` is what to write, the first time and in the summary. */
  function record(key, entry) {
    const t = now();
    const w = open.get(key);
    if (w && t - w.since < windowMs) { w.repeats++; return; }
    if (w) close(key, w);
    // The keys are reason codes, a short fixed list; a cap all the same, so nothing can grow
    // without limit.
    while (open.size >= maxKeys) { const [k, oldest] = open.entries().next().value; close(k, oldest); }
    open.set(key, { since: t, repeats: 0, entry });
    write({ ...entry });
  }

  return { record, sweep, size: () => open.size };
}
