// The server's half of the sync stamps. Hand-copied (not imported) from
// frontend/src/lib/sync-merge.js, like queue.js: the same rules on both sides, kept as a small
// standalone module so it can be unit-tested without booting the server, and checked against the
// frontend's copy by frontend/src/lib/sync-stamps-parity.test.js.
//
// The app stamps every change itself: `deleted` records what was removed and when, `edited` when
// each setting and plan day was last changed, and every routine, custom exercise, profile, card
// and edited workout carries its own `_ts` (and `_f`, per field). Two kinds of writer do not:
//
//   - an older app (v1.3.9 and before), which knows none of it. It pushed back whatever it had
//     read without the records, so one offline phone wiped every removal on record and the RC's
//     devices brought back what had been deleted; its own deletes and setting changes carried no
//     stamp and lost to older ones made on an updated device.
//   - an API client: a planner that GETs, changes the queue or a routine, and PUTs. Its new week
//     lost to any phone that reconnected with an older, unrelated change.
//
// So PUT /api/data (stampPut):
//   0. for a writer that does not stamp: puts back every field it left out that it cannot have
//      removed on purpose, since it never knew it (keepUnknown): a v1.3.9 phone saving a routine
//      no longer deletes the pyramid sets made on an updated one;
//   1. never lets the records shrink: `deleted` and `edited` are joined with the stored ones (but
//      a reset, which starts the profile over, keeps its own);
//   2. for a writer that does not stamp (no `stamped: true` in the body) and wrote over the
//      revision it read: stamps what it changed against the stored copy, at the server's time —
//      entries removed, settings and plan days changed, entries edited. A setting, plan day or
//      entry field whose stored stamp is later than the one the writer sent back (it never saw
//      that change) keeps the stored value: an older app back from a dead spot no longer sets
//      them back. Only a value the field held before is put back (its old copy coming back, see
//      notePrior): one the field never held is that writer's own new choice and goes through. What
//      remains: such a writer changing a field back to exactly an earlier value after another
//      device changed it loses to that change, one that sends no record of edits at all (it never
//      read a copy from an updated app) still wins as before, and the older app shows its own
//      value until it next reads the profile;
//   3. for every writer: an entry the document holds while a removal on record says it was
//      deleted after its last edit is kept, and marked as added back. An updated app never sends
//      such a document, so this is an older app's merge (or its Coach undo, or a backup it
//      restored) bringing an entry back, and that cannot be told apart from a deliberate re-add:
//      a deleted entry that comes back is one tap to remove again, a wanted one dropped is lost.

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const workoutKey = w => (w?.id != null ? w.id : `${w?.d}|${w?.start}`);
const workoutTime = w => Number(w?._ts) || Number(w?.end) || Number(w?.start) || 0;
export const DEL_LISTS = {
  workouts: workoutKey, routines: x => x?.id, customEx: x => x?.id, bodyweight: e => e?.d,
  gymCards: x => x?.id, equipProfiles: x => x?.id, favEx: x => x,
};
const DEL_TIME = {
  workouts: workoutTime, routines: x => Number(x?._ts) || 0, customEx: x => Number(x?._ts) || 0,
  bodyweight: e => Number(e?.t) || 0, gymCards: x => Number(x?._ts) || 0, equipProfiles: x => Number(x?._ts) || 0,
};
export const DELETED_MAX = 5000;
const capStamps = m => {
  const ks = Object.keys(m);
  if (ks.length <= DELETED_MAX) return m;
  ks.sort((x, y) => Math.abs(m[x]) - Math.abs(m[y]));
  for (const k of ks.slice(0, ks.length - DELETED_MAX)) delete m[k];
  return m;
};
const OWN_MERGE = new Set([
  '_ts', '_rev', '_wid', '_wids', '_unstamped', '_prior', 'active', 'unit', 'unitSet', 'resetAt', 'resetIds', 'deleted', 'edited', 'undone', 'routineOrder',
  'workouts', 'routines', 'customEx', 'equipProfiles', 'gymCards', 'bodyweight', 'favEx',
  'exWeights', 'balanceOverrides', 'loadKind', 'plates',
]);
const PER_KEY = new Set(['week', 'dayPlan', 'exNotes', 'barWeights']);
const ENTRY_META = new Set(['id', '_ts', '_f', '_u']);
const ENTRY_LISTS = ['routines', 'customEx', 'equipProfiles', 'gymCards', 'workouts'];

// Whether removal record `v` replaces `cur`: the later stamp, and on a tie the add-back.
const laterDel = (v, cur) => {
  const x = Number(v) || 0, y = Number(cur) || 0;
  return Math.abs(x) > Math.abs(y) || (Math.abs(x) === Math.abs(y) && x < y);
};
/** Both records of removals: per entry, the later stamp. */
export function mergeDeletions(a, b) {
  const out = {};
  for (const f of Object.keys(DEL_LISTS)) {
    const x = isMap(a?.[f]) ? a[f] : {}, y = isMap(b?.[f]) ? b[f] : {};
    const m = { ...x };
    // On equal stamps the add-back (negative) wins, whichever copy is first (as the app's).
    for (const [k, v] of Object.entries(y)) if (!(k in m) || laterDel(v, m[k])) m[k] = v;
    if (Object.keys(m).length) out[f] = capStamps(m);
  }
  return Object.keys(out).length ? out : null;
}

/** Both records of edits: per key, the later stamp. */
export function mergeEdits(a, b) {
  const x = isMap(a) ? a : {}, y = isMap(b) ? b : {};
  const out = { ...x };
  for (const [k, v] of Object.entries(y)) if (!((Number(out[k]) || 0) >= (Number(v) || 0))) out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** The latest stamp a copy carries (sync-merge.js highestStamp). */
export function highestStamp(S) {
  let m = 0;
  const see = v => { const n = Math.abs(Number(v) || 0); if (n > m) m = n; };
  if (!S || typeof S !== 'object') return 0;
  see(S._ts); see(S.unitSet?.at); see(S.resetAt);
  if (isMap(S.edited)) for (const v of Object.values(S.edited)) see(v);
  if (isMap(S.deleted)) for (const f of Object.values(S.deleted)) if (isMap(f)) for (const v of Object.values(f)) see(v);
  for (const f of ENTRY_LISTS) {
    for (const x of list(S[f])) {
      if (!x || typeof x !== 'object') continue;
      see(x._ts);
      if (isMap(x._f)) for (const v of Object.values(x._f)) see(v);
    }
  }
  for (const f of ['balanceOverrides', 'loadKind', 'plates']) {
    if (isMap(S[f])) for (const v of Object.values(S[f])) see(isMap(v) ? v._ts : 0);
  }
  return m;
}

/** `x` stamped as an edit of `old` at `now`, per field (sync-merge.js stampEntry). Mutates `x`. */
export function stampEntry(old, x, now) {
  if (!x || typeof x !== 'object') return x;
  x._ts = now;
  if (!old || typeof old !== 'object') return x;
  const f = isMap(old._f) ? { ...old._f } : {};
  for (const k of new Set([...Object.keys(old), ...Object.keys(x)])) {
    if (ENTRY_META.has(k)) continue;
    if ((k in old) !== (k in x) || !same(old[k], x[k])) f[k] = now;
  }
  if (Object.keys(f).length) x._f = f; else delete x._f;
  const u = settleMarks(x._u, f, now);
  if (u) x._u = u; else delete x._u;
  return x;
}
// An Undo's markers (`_u`, sync-merge.js "Undo"): completed with this edit's stamp, or dropped
// once their field moved on.
function settleMarks(marks, stamps, now) {
  if (!isMap(marks)) return null;
  const out = {};
  for (const [k, m] of Object.entries(marks)) {
    if (!Array.isArray(m)) continue;
    const at = Number(stamps?.[k]) || 0;
    if (m.length === 2 && at === now) out[k] = [Number(m[0]) || 0, Number(m[1]) || 0, now];
    else if (m.length === 3 && at > 0 && Number(m[2]) === at) out[k] = m;
  }
  return Object.keys(out).length ? out : null;
}
const sameEntry = (a, b) => same({ ...a, _ts: 0, _f: 0, _u: 0 }, { ...b, _ts: 0, _f: 0, _u: 0 });

// What the server stamped for the last push of a writer that does not stamp (`_unstamped` on the
// stored document): an older app takes the revision it is told for its own push and reads the
// profile again only once that moves, so the stamps given to its change never reach it, and its
// next push still carries the record from before. Without this, its second change of the same
// setting, plan day or routine field looked like a stale copy of the first and was set back to it
// (RC verify 2026-10-07). `fp` is that writer's record of edits as sent: the same writer pushing
// again over the revision its push made sends the same one. `ed` and `f` hold the stamps it was
// given, per setting and per entry field, as long as they are still the stored ones.
const ownStamp = (m, k, v) => isMap(m) && Number(m[k]) > 0 && Number(m[k]) === Number(v);
function fingerprint(sent) {
  if (!isMap(sent)) return 'none';
  const str = JSON.stringify(Object.keys(sent).sort().map(k => [k, sent[k]]));
  let a = 0x811c9dc5, b = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `${str.length}.${a.toString(36)}.${b.toString(36)}`;
}
function ownRecord(next, now, own, fp) {
  const ed = {}, f = {};
  for (const [k, v] of Object.entries(isMap(next.edited) ? next.edited : {})) {
    if (Number(v) === now || ownStamp(own?.ed, k, v)) ed[k] = Number(v);
  }
  for (const l of ENTRY_LISTS) {
    for (const x of list(next[l])) {
      if (!isMap(x) || x.id == null || !isMap(x._f)) continue;
      const key = `${l}|${x.id}`, m = {};
      for (const [k, v] of Object.entries(x._f)) if (Number(v) === now || ownStamp(own?.f?.[key], k, v)) m[k] = Number(v);
      if (Object.keys(m).length) f[key] = m;
    }
  }
  if (!Object.keys(ed).length && !Object.keys(f).length) return null;
  return { fp, ...(Object.keys(ed).length ? { ed } : {}), ...(Object.keys(f).length ? { f } : {}) };
}

// What each setting, plan day and entry field held before (`_prior` on the stored document, never
// sent to a client): per field, short hashes of its last PRIOR_KEEP values before each change. A
// writer that does not stamp keeps the record of edits it last read and never gets the stamps the
// server gave its own pushes (it reads the profile again only once the revision moves, and its
// whole-document merge after a 409 keeps its own older record), so "a later stamp than the one it
// sent" alone also caught its own next change of that field, and put back a workout set it had just
// logged (RC item-3 analysis 2026-10-07). With this, a field changed after the writer's copy is put
// back only when what it sends is a value the field held before: its old copy coming back. A value
// the field never held is its own new choice and goes through, stamped. A field with no history yet
// (stamped before `_prior` was kept) is put back as before.
// The limit: an older app changing a field back to exactly a value it held before, after another
// device changed it, looks like its old copy and loses to that change.
const PRIOR_KEEP = 6;
const PRIOR_MAX = 5000;
function valueHash(v) {
  const str = v === undefined ? 'u' : JSON.stringify(v);
  let a = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) a = Math.imul(a ^ str.charCodeAt(i), 0x01000193) >>> 0;
  return `${str.length}.${a.toString(36)}`;
}
// `next._prior`: the stored one, with every field this write changes noted, for every writer.
function notePrior(cur, next) {
  const pr = isMap(cur?._prior) ? clone(cur._prior) : {};
  const note = (key, b, a) => {
    if (same(b, a)) return;
    const h = valueHash(b);
    delete pr[key];                                   // re-added last: the most recently changed go last
    pr[key] = [...list(cur?._prior?.[key]).filter(x => x !== h), h].slice(-PRIOR_KEEP);
  };
  for (const k of new Set([...Object.keys(cur || {}), ...Object.keys(next)])) {
    if (OWN_MERGE.has(k)) continue;
    if (PER_KEY.has(k)) {
      const pm = isMap(cur[k]) ? cur[k] : {}, nm = isMap(next[k]) ? next[k] : {};
      for (const s of new Set([...Object.keys(pm), ...Object.keys(nm)])) note(`${k}.${s}`, pm[s], nm[s]);
    } else if (k in next) note(k, cur[k], next[k]);
  }
  const live = new Set();
  for (const f of ENTRY_LISTS) {
    const before = new Map(list(cur?.[f]).filter(x => isMap(x) && x.id != null).map(x => [x.id, x]));
    for (const x of list(next[f])) {
      if (!isMap(x) || x.id == null) continue;
      live.add(`${f}|${x.id}`);
      const o = before.get(x.id);
      if (!o || sameEntry(o, x)) continue;
      for (const k of new Set([...Object.keys(o), ...Object.keys(x)])) if (!ENTRY_META.has(k)) note(`${f}|${x.id}|${k}`, o[k], x[k]);
    }
  }
  // An entry that is gone takes its history with it; the oldest changed fields go past PRIOR_MAX.
  for (const key of Object.keys(pr)) {
    if (!ENTRY_LISTS.some(f => key.startsWith(`${f}|`))) continue;
    if (!live.has(key.slice(0, key.lastIndexOf('|')))) delete pr[key];
  }
  const ks = Object.keys(pr);
  for (const key of ks.slice(0, Math.max(0, ks.length - PRIOR_MAX))) delete pr[key];
  if (Object.keys(pr).length) next._prior = pr; else delete next._prior;
}
// Step 2: what a writer that does not stamp changed against the copy it read, stamped at `now`.
function stampUnstamped(cur, next, sent, now, own = null) {
  // Whether `v` is a value the field held before (see notePrior); a field with no history: yes.
  const pr = isMap(cur?._prior) ? cur._prior : {};
  const wasBefore = (key, v) => !Array.isArray(pr[key]) || pr[key].includes(valueHash(v));
  // Removals: every entry the stored copy had and this one lacks, unless already on record.
  const del = isMap(next.deleted) ? next.deleted : {};
  for (const [f, key] of Object.entries(DEL_LISTS)) {
    const time = DEL_TIME[f] || (() => 0);
    const have = new Set(list(next[f]).filter(x => x != null).map(x => String(key(x))));
    for (const x of list(cur[f])) {
      if (x == null) continue;
      const k = String(key(x));
      if (have.has(k)) continue;
      const m = isMap(del[f]) ? del[f] : (del[f] = {});
      if (!(Number(m[k]) > 0 && Number(m[k]) >= time(x))) m[k] = Math.max(now, time(x) + 1);
    }
    if (isMap(del[f])) capStamps(del[f]);
  }
  if (Object.keys(del).length) next.deleted = del;
  // Settings and plan days changed, whose stamp the writer did not move past the stored one.
  //
  // Unless the stored value was changed, by its own stamp, after the copy this writer worked on:
  // the stamps it sends back are the ones it last read (v1.3.9 keeps the record it does not know),
  // so a stamp of the stored copy later than the writer's own means it never saw that change.
  // Then what it sends is the value from before (a phone back from a dead spot, whose merge kept
  // its whole older copy) or a change made at the same time without seeing the other: the stamped
  // change stays. A writer that sends no record at all cannot be placed and goes through as before.
  const ed = isMap(next.edited) ? next.edited : {};
  const mine = isMap(sent) ? sent : {}, theirs = isMap(cur.edited) ? cur.edited : {};
  const moved = k => (Number(mine[k]) || 0) > (Number(theirs[k]) || 0);
  // A stamp the server gave this same writer's previous push is its own change, not one it missed.
  const stale = k => isMap(sent) && (Number(theirs[k]) || 0) > (Number(mine[k]) || 0) && !ownStamp(own?.ed, k, theirs[k]);
  for (const k of new Set([...Object.keys(cur), ...Object.keys(next)])) {
    if (OWN_MERGE.has(k)) continue;
    const p = cur[k], n = next[k];
    if (PER_KEY.has(k)) {
      const pm = isMap(p) ? p : {}, nm = isMap(n) ? n : {};
      for (const s of new Set([...Object.keys(pm), ...Object.keys(nm)])) {
        const sk = `${k}.${s}`;
        if ((s in pm) === (s in nm) && same(pm[s], nm[s])) continue;
        if (stale(sk) && wasBefore(sk, nm[s])) {
          const into = isMap(next[k]) ? next[k] : (next[k] = {});
          if (s in pm) into[s] = clone(pm[s]); else delete into[s];
        } else if (!moved(sk)) ed[sk] = now;
      }
    } else if (n !== undefined && !same(p, n)) {   // absent: a field the writer does not know
      if (stale(k) && wasBefore(k, n)) { if (k in cur) next[k] = clone(p); else delete next[k]; }
      else if (!moved(k)) ed[k] = now;
    }
  }
  // The order of the routines (sync-merge.js ORDER_KEY), the same way: a reorder is stamped, an
  // older copy's order of routines another device reordered since is put back as stored.
  if (Array.isArray(next.routines) && orderMoved(cur.routines, next.routines)) {
    if (stale(ORDER_KEY)) next.routines = inOrderOf(cur.routines, next.routines);
    else if (!moved(ORDER_KEY)) ed[ORDER_KEY] = now;
  }
  if (Object.keys(ed).length) next.edited = ed;
  // Entries edited without stamps of their own: a routine, a custom exercise, a profile, a card,
  // a workout whose content changed. The same rule per field: one the stored entry changed (`_f`)
  // after the version this writer worked on (its `_f`, as last read) keeps the stored value. An
  // older app keeps the version of an entry edited last as a whole, so its edit of the name used to
  // bring back the sets as they were before another device changed them.
  for (const f of ENTRY_LISTS) {
    const before = new Map(list(cur[f]).filter(x => x && x.id != null).map(x => [x.id, x]));
    for (const x of list(next[f])) {
      if (!x || typeof x !== 'object' || x.id == null) continue;
      const old = before.get(x.id);
      if (!old) { if (f !== 'workouts' && x._ts == null) x._ts = now; continue; }
      if (sameEntry(old, x)) continue;
      if (isMap(sent) || isMap(x._f)) {
        const base = isMap(x._f) ? x._f : {}, of = isMap(old._f) ? old._f : {};
        for (const k of new Set([...Object.keys(old), ...Object.keys(x)])) {
          if (ENTRY_META.has(k) || !((Number(of[k]) || 0) > (Number(base[k]) || 0))) continue;
          if (ownStamp(own?.f?.[`${f}|${x.id}`], k, of[k])) continue;
          if ((k in old) === (k in x) && same(old[k], x[k])) continue;
          if (!wasBefore(`${f}|${x.id}|${k}`, x[k])) continue;
          if (k in old) x[k] = clone(old[k]); else delete x[k];
        }
        const fx = { ...base };
        for (const [k, v] of Object.entries(of)) if (!((Number(fx[k]) || 0) >= (Number(v) || 0))) fx[k] = v;
        if (Object.keys(fx).length) x._f = fx; else delete x._f;
        if (sameEntry(old, x)) { x._ts = Math.max(Number(x._ts) || 0, Number(old._ts) || 0); continue; }
      }
      stampEntry(old, x, now);
    }
  }
}

const ORDER_KEY = 'routineOrder';
/** Whether two lists hold the routines both have in a different order (sync-merge.js orderMoved). */
export function orderMoved(a, b) {
  const ida = list(a).map(r => r?.id).filter(id => id != null), idb = list(b).map(r => r?.id).filter(id => id != null);
  const inA = new Set(ida), inB = new Set(idb);
  return JSON.stringify(ida.filter(id => inB.has(id))) !== JSON.stringify(idb.filter(id => inA.has(id)));
}
// `xs` with the routines `order` also has in its order, each other one after its nearest earlier
// neighbour in `xs` (sync-merge.js unionByNeighbours).
function inOrderOf(order, xs) {
  const by = new Map(list(xs).filter(x => x?.id != null).map(x => [x.id, x]));
  const out = list(order).filter(x => x?.id != null && by.has(x.id)).map(x => by.get(x.id));
  const at = new Set(out.map(x => x.id));
  let prev = null;
  for (const x of list(xs)) {
    if (x?.id == null) { out.push(x); continue; }
    if (!at.has(x.id)) {
      const i = prev == null ? -1 : out.findIndex(y => y?.id === prev);
      out.splice(i + 1, 0, x);
      at.add(x.id);
    }
    prev = x.id;
  }
  return out;
}

// Step 0, for a writer that does not stamp: what it left out because it does not know it comes
// back from the stored copy. An app from before a field existed rebuilds what it edits from the
// fields it knows: v1.3.9's exercise sheet saved a routine's exercise as sets, reps and weight,
// and the pyramid built on an updated phone (`pyramid`, `pyramidRest`) was gone on every device.
// The same for a setting, a routine, a workout, a custom exercise, card or profile, an exercise
// of a routine, an exercise and a set of a logged workout.
//
// What such a writer can drop on purpose is what it knows: `V139_DROPS` lists, per place, every
// key v1.3.9 (the last app that does not stamp) removes or rebuilds itself. A missing key there
// is a removal and goes through; any other missing key is one it never knew and is put back.
// A key put back that it had in fact cleared is one tap to clear again; a dropped one was lost.
// API planners send back what they read, so for them this changes nothing.
const V139_DROPS = {
  state: new Set(['showRir']),
  routines: new Set(['excludeFromProgression']),
  'routines.ex': new Set(['id', 'sg', 'sets', 'min', 'speed', 'mode', 'sec', 'weight', 'bodyweight', 'prog',
    'inc', 'deloadFactor', 'note', 'warmupSets', 'restSec', 'reps', 'side', 'repsMin', 'repsMax', 'intensifier']),
  customEx: new Set(['media', 'url']),
  equipProfiles: new Set(),
  gymCards: new Set(),
  workouts: new Set(['media', 'note', 'name', 'bw', 'prs', 'vol', 'routineIds']),
  'workouts.entries': new Set(['sg', 'note', 'notePin', 'noProg', 'topW']),
  'workouts.entries.sets': new Set(['w', 'r', 'sec', 'min', 'km', 'dist', 'speed', 'rir', 'rpe', 'planSec', 'note',
    'done', 'weightOrigin', 'at', 'sides', 'type', 'drops', 'clusters', 'warmup']),
};
// The lists inside an entry that are walked too, and how their items are matched.
const NESTED = { routines: ['ex'], workouts: ['entries'], 'workouts.entries': ['sets'] };
// Server bookkeeping and the records merged on their own: never put back from the stored copy.
const NOT_KEPT = new Set(['_rev', '_wid', '_wids', '_unstamped', '_prior', 'active', 'resetAt', 'resetIds', 'deleted', 'edited']);

// `x` with every key of `old` it lacks and the writer cannot have dropped on purpose. Mutates `x`.
function keepKeys(old, x, place) {
  if (!isMap(old) || !isMap(x)) return;
  const drops = V139_DROPS[place] || new Set();
  for (const k of Object.keys(old)) {
    if (k in x || drops.has(k) || ENTRY_META.has(k) || (place === 'state' && NOT_KEPT.has(k))) continue;
    x[k] = clone(old[k]);
  }
  for (const f of NESTED[place] || []) {
    const a = old[f], b = x[f];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    for (const [o, n] of pairItems(a, b)) keepKeys(o, n, `${place}.${f}`);
  }
}
// Which item of `a` each item of `b` is: by `id` when every id is there and once per list; with
// ids that repeat (the same exercise twice in a routine), along the longest run of ids both lists
// share in order, so an exercise added, taken out or moved leaves the others paired; without ids
// (the sets of an exercise), by position only when the lists are as long as each other. Anything
// else (a set taken out of the middle) is not guessed at.
function pairItems(a, b) {
  const ids = xs => xs.map(x => (isMap(x) ? x.id : undefined));
  const ia = ids(a), ib = ids(b);
  const unique = xs => xs.every(k => k != null) && new Set(xs).size === xs.length;
  if (unique(ia) && unique(ib)) {
    const by = new Map(a.map(x => [x.id, x]));
    return b.filter(x => by.has(x.id)).map(x => [by.get(x.id), x]);
  }
  if (ia.every(k => k != null) && ib.every(k => k != null) && a.length * b.length <= 40000) {
    const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) L[i][j] = same(ia[i], ib[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const out = [];
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
      if (same(ia[i], ib[j])) { out.push([a[i], b[j]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
    return out;
  }
  if (a.length !== b.length || ia.some((k, i) => k !== ib[i])) return [];
  return b.map((x, i) => [a[i], x]);
}
/** Step 0 (above): put back into `next` what a writer that does not stamp left out of `cur`. */
export function keepUnknown(cur, next) {
  if (!isMap(cur) || !isMap(next)) return next;
  keepKeys(cur, next, 'state');
  for (const f of ENTRY_LISTS) {
    if (!Array.isArray(cur[f]) || !Array.isArray(next[f])) continue;
    const before = new Map(cur[f].filter(x => isMap(x) && x.id != null).map(x => [x.id, x]));
    for (const x of next[f]) if (isMap(x) && x.id != null && before.has(x.id)) keepKeys(before.get(x.id), x, f);
  }
  return next;
}

// Step 3: an entry held while a removal on record says it was deleted after its last edit is
// kept, and marked as added back.
function keepHeld(next, now) {
  const del = next.deleted;
  if (!isMap(del)) return;
  for (const [f, key] of Object.entries(DEL_LISTS)) {
    const m = del[f];
    if (!isMap(m)) continue;
    const time = DEL_TIME[f] || (() => 0);
    for (const x of list(next[f])) {
      if (x == null) continue;
      const k = String(key(x));
      const at = Number(m[k]) || 0;
      if (at > 0 && at >= time(x)) m[k] = -Math.max(now, at + 1);
    }
  }
}

/**
 * PUT /api/data's stamping (see the top of this file). With `report`, `report.changed` says whether
 * the document stored differs from what a writer that does not stamp sent, beyond stamps: a field
 * it did not know or a newer value was put back (server.js then makes sure it reads the result).
 * `cur` is the stored document (or null),
 * `next` the one being written (mutated in place), `opts.overRead` true when the writer sent the
 * revision it read and it is the current one, `opts.stamped` true for a writer that stamps its own
 * changes (the app), `opts.now` the server's clock.
 */
// What a document says, without its stamps and the server's bookkeeping: whether the server put
// back anything of what a writer sent (stampPut's `report`).
const BOOKKEEPING = new Set(['_ts', '_f', '_u', '_rev', '_wid', '_wids', '_unstamped', '_prior', 'edited', 'deleted', 'undone']);
const content = S => JSON.stringify(S, (k, v) => (BOOKKEEPING.has(k) ? undefined : v));

export function stampPut(cur, next, { overRead = false, stamped = false, now = Date.now(), report = null } = {}) {
  if (!next || typeof next !== 'object') return next;
  const t = Math.max(Number(now) || 0, highestStamp(cur) + 1, highestStamp(next) + 1);
  const reset = (Number(next.resetAt) || 0) > (Number(cur?.resetAt) || 0);
  const sent = isMap(next.edited) ? { ...next.edited } : null;
  // The note of what the server stamped for an older app outlives the writes in between (an updated
  // app's, or one not over the revision it read), for as long as each stamp is still the stored one:
  // the older app's merge after the 409 such a write causes keeps its own record of edits, so its
  // next push still matches the fingerprint, and its own change is still its own.
  const prevOwn = isMap(cur?._unstamped) ? cur._unstamped : null;
  delete next._unstamped;
  delete next._prior;
  if (cur && !reset) {
    const d = mergeDeletions(cur.deleted, next.deleted);
    if (d) next.deleted = d; else delete next.deleted;
    const e = mergeEdits(cur.edited, next.edited);
    // The write ids are the server's bookkeeping, never a setting: an older app's push used to get
    // them stamped as one it changed (QA 2026-10-07), and such a stamp is dropped here.
    if (e) { delete e._wid; delete e._wids; }
    if (e && Object.keys(e).length) next.edited = e; else delete next.edited;
    const before = !stamped && report ? content(next) : null;
    if (!stamped) keepUnknown(cur, next);
    if (!stamped && overRead) {
      const fp = fingerprint(sent);
      const own = isMap(cur._unstamped) && cur._unstamped.fp === fp ? cur._unstamped : null;
      stampUnstamped(cur, next, sent, t, own);
      const rec = ownRecord(next, t, own, fp);
      if (rec) next._unstamped = rec;
    } else if (prevOwn && !reset) {
      const rec = ownRecord(next, NaN, prevOwn, prevOwn.fp);
      if (rec) next._unstamped = rec;
    }
    if (before != null && content(next) !== before) report.changed = true;
  }
  keepHeld(next, t);
  if (cur && !reset) notePrior(cur, next);
  return next;
}
