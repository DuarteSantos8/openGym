/* In-memory throttling for the password routes (#118).
 *
 * Until password sign-in there was nothing worth guessing: a passkey assertion cannot be
 * brute-forced, invite codes are 64 random bits and pairing codes live five minutes — which is
 * why the passkey and pairing routes are still not counted here. A password is the first secret
 * a person chooses, so the API now has to say no after enough wrong answers instead of leaving
 * that to whatever proxy the self-hoster did or did not put in front.
 *
 * Two shapes, both small enough to read in one sitting:
 *
 *   backoff  counts failures per key (an address, an account name). The first `free` cost
 *            nothing; every one after that locks the key for `baseMs`, doubling each time up
 *            to `maxMs`. A key forgets after `forgetMs` without a failure, or when the caller
 *            reports a success. This is what stands between an attacker and a password.
 *   window   counts every request per key in a fixed window — a plain budget, so one address
 *            cannot make the server run scrypt as fast as it can send.
 *
 * A failure can be counted before its answer is known (backoff.attempt), and taken back once
 * it turns out not to be one. A password check takes a tenth of a second; counted only when it
 * came back, a burst sent all at once was checked in full before the first failure landed.
 *
 * Both live in a Map that never grows past `maxKeys`: a key that is not locked and has gone
 * quiet is swept every minute, and when the Map is full anyway the key with the least to lose
 * makes room — for a backoff, the unlocked one with the fewest failures. Evicting a *locked*
 * key, or one halfway to its lock, would hand an attacker a way to reset a count by flooding
 * fresh keys that cost one failure each, so those go last, and a key the caller marks with
 * `keep` never goes at all. Everything is lost on a restart, which is the accepted cost of not
 * having a store — a restart is loud, and the lockouts are minutes long.
 *
 * `now` is injectable so the tests can walk the clock instead of sleeping. */

const MINUTE = 60000;

// `rank(entry)` says what a key has to lose: the lowest is evicted first, the least recently used
// among equals. 0 is as low as it goes, so the scan stops at the first. `keep(key)` is never
// evicted; it is asked only of a key that would otherwise be the one, because it may be slow.
function boundedMap(maxKeys, rank, keep = () => false) {
  const m = new Map();
  return {
    get: k => m.get(k),
    // Re-inserted on every touch, so iteration order is least recently used first.
    set(k, v) {
      m.delete(k);
      if (m.size >= maxKeys) {
        let victim, best = Infinity;
        for (const [key, e] of m) {
          const r = rank(e);
          if (r < best && !keep(key)) { best = r; victim = key; if (r <= 0) break; }
        }
        // Nothing but kept keys: the Map grows past maxKeys by those, which the caller bounds.
        if (victim !== undefined) m.delete(victim);
      }
      m.set(k, v);
    },
    delete: k => m.delete(k),
    entries: () => m.entries(),
    get size() { return m.size; }
  };
}

export function createBackoff({ free = 5, baseMs = MINUTE, maxMs = 60 * MINUTE, forgetMs = 24 * 60 * MINUTE, maxKeys = 10000, keep = () => false, now = Date.now } = {}) {
  const locked = e => e.until > now();
  // Unlocked keys by their count, then locked ones: a flood of keys with one failure each only
  // ever pushes out its own kind.
  const map = boundedMap(maxKeys, e => (locked(e) ? 1e9 : 0) + Math.max(0, e.n - 1), keep);
  const fresh = e => e && now() - Math.max(e.last, e.until) <= forgetMs;
  function bump(key) {
    const prev = map.get(key);
    const e = fresh(prev) ? prev : { n: 0, until: 0, last: 0 };
    const wasUntil = e.until;
    e.n += 1;
    e.last = now();
    let lock = 0;
    if (e.n > free) {
      lock = Math.min(maxMs, baseMs * 2 ** Math.min(30, e.n - free - 1));
      e.until = e.last + lock;
    }
    map.set(key, e);
    return { e, wasUntil, lock: Math.ceil(lock / 1000) };
  }
  return {
    /** Seconds the key still has to wait, 0 when it may try. */
    retryAfter(key) {
      const e = map.get(key);
      return e && locked(e) ? Math.ceil((e.until - now()) / 1000) : 0;
    },
    /** One more failure. Returns the lock in seconds this failure caused, 0 for none. */
    fail: key => bump(key).lock,
    /** An attempt whose answer is not known yet, counted as a failure from the moment it starts,
     *  so that attempts running side by side are all counted before any of them is answered.
     *  Returns the lock in seconds it started (0 for none) and `undo()`, which takes the attempt
     *  back once it turns out not to have been a failure after all. */
    attempt(key) {
      const { e, wasUntil, lock } = bump(key);
      let open = true;
      return {
        lock,
        undo() {
          if (!open) return;
          open = false;
          // Cleared, forgotten or evicted since: nothing of this attempt is left to take back.
          if (map.get(key) !== e) return;
          e.n -= 1;
          // The pause this attempt started goes with it, unless the failures left still earn one.
          if (lock && e.n <= free) e.until = wasUntil;
          if (e.n <= 0 && !locked(e)) map.delete(key);
        }
      };
    },
    /** A success: the key starts over. */
    clear(key) { map.delete(key); },
    sweep() {
      for (const [k, e] of map.entries()) if (!locked(e) && !fresh(e)) map.delete(k);
    },
    get size() { return map.size; }
  };
}

export function createWindow({ max = 60, windowMs = MINUTE, maxKeys = 10000, now = Date.now } = {}) {
  const over = e => e.count > max && now() - e.start < windowMs;
  const map = boundedMap(maxKeys, e => (over(e) ? 1 : 0));
  return {
    /** Counts this request. Returns 0 when it is within budget, else seconds to wait. */
    take(key) {
      let e = map.get(key);
      if (!e || now() - e.start >= windowMs) e = { start: now(), count: 0 };
      e.count += 1;
      map.set(key, e);
      return e.count > max ? Math.max(1, Math.ceil((e.start + windowMs - now()) / 1000)) : 0;
    },
    sweep() {
      for (const [k, e] of map.entries()) if (now() - e.start >= windowMs) map.delete(k);
    },
    get size() { return map.size; }
  };
}
