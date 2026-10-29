// openGym on Garmin: the session as the watch keeps it, and every change to it, as plain functions
// over one Dictionary. A port of the Wear OS watch's SessionCore.kt (itself a port of the Apple
// Watch's WatchCore), so all three watches handle the phone's snapshot and send the phone the same
// events. The app only calls these, saves the state after each and sends the events they return.
//
// What the phone sends is lib/garmin-snapshot.js's cut-down snapshot (fixture: test/snapshot.json):
// the other watches' JSON with a window of the running workout. Each exercise in the window says
// where it sits in the whole workout (`i`); that is the events' entryIdx. Positions on the watch
// (the `pos` arguments) are places in the window.
//
// The sync, in short (the long version is in ios/App/WatchCore SessionCore.swift):
//   - a tick made here stays pending until a snapshot shows that set done at the tick's time or
//     later; until then the snapshot's copy of the set is replaced by the watch's;
//   - finished here: gone at once, a stale snapshot that still shows it does not bring it back;
//   - started here: kept until the phone reports it back, a snapshot without it does not end it.
//
// State keys (short: the state lives in the watch's small object store):
//   w    the running workout (the snapshot's `active`), or null
//   rd   what can be started (`ready`)      set  the phone's watch settings   u  "kg" or "lb"
//   rs   rest seconds                       stk  the week streak            sy  heard from the phone
//   sh   id of a workout started here the phone has not reported back yet
//   fh   ids of workouts finished here       p    pending ticks, "exId#si[#side]" → [w, r, at, sec]
//   pos  the exercise on screen (window position; entries.size() is the end page)
//   sk   sets passed over here ("exId#si")    rest when the rest ends (ms), or null
//   ob   events not yet handed to the phone  rec  id of the workout Garmin Connect records
import Toybox.Lang;
import Toybox.Math;
import Toybox.Time;

module Core {

    /* ---------- reading what the phone sent, whatever number type it arrived as ---------- */

    function isNum(v) {
        return v instanceof Lang.Number || v instanceof Lang.Float || v instanceof Lang.Double || v instanceof Lang.Long;
    }
    //! A weight, reps or seconds as a Float, or null.
    function toF(v) {
        return isNum(v) ? v.toFloat() : null;
    }
    //! A time in ms since 1970 as a Long (a Float would lose the seconds), or null.
    function toMs(v) {
        return isNum(v) ? v.toLong() : null;
    }
    function toI(v, dflt) {
        return isNum(v) ? v.toNumber() : dflt;
    }
    function dictOf(v) {
        return (v instanceof Lang.Dictionary) ? v : null;
    }
    function arrOf(v) {
        return (v instanceof Lang.Array) ? v : [];
    }
    function strOf(v) {
        if (v instanceof Lang.String) { return v; }
        return v == null ? "" : v.toString();
    }
    function isTrue(v) {
        return (v instanceof Lang.Boolean) && v;
    }
    function same(a, b) {
        return a != null && b != null && (a instanceof Lang.String) && a.equals(b);
    }
    function has(arr, v) {
        for (var i = 0; i < arr.size(); i += 1) {
            if (same(arr[i], v)) { return true; }
        }
        return false;
    }
    function nowMs() {
        return Time.now().value().toLong() * 1000l;
    }
    function newId() {
        return "g" + nowMs().toString() + "-" + (Math.rand() % 1000000).toString();
    }

    /* ---------- the state ---------- */

    function emptyState() {
        return {
            "w" => null, "rd" => null, "set" => {}, "u" => "kg", "rs" => 90, "stk" => null, "sy" => false,
            "sh" => null, "fh" => [], "p" => {}, "pos" => 0, "sk" => [], "rest" => null, "ob" => [], "rec" => null
        };
    }

    //! A state read back from storage, with anything missing filled in (an older app's state).
    function normalize(s) {
        var base = emptyState();
        if (!(s instanceof Lang.Dictionary)) { return base; }
        var keys = base.keys();
        for (var i = 0; i < keys.size(); i += 1) {
            if (!s.hasKey(keys[i])) { s.put(keys[i], base[keys[i]]); }
        }
        return s;
    }

    function key(exId, si, side) {
        return side != null ? exId + "#" + si + "#" + side : exId + "#" + si;
    }

    function entries(s) {
        var w = dictOf(s["w"]);
        return w == null ? [] : arrOf(w["entries"]);
    }
    function entryAt(s, pos) {
        var es = entries(s);
        return (pos >= 0 && pos < es.size()) ? dictOf(es[pos]) : null;
    }
    //! Where an exercise sits in the whole workout (its `i`), else its window position.
    function entryIdx(s, pos) {
        var e = entryAt(s, pos);
        return e == null ? pos : toI(e["i"], pos);
    }
    function isTimed(e) { return e != null && same(e["mode"], "time"); }
    function isCardio(e) { return e != null && same(e["mode"], "cardio"); }

    //! The exercise's weight unit: its own when it has one (#657), else the workout's.
    function unitOf(s, e) {
        if (e != null && (e["unit"] instanceof Lang.String)) { return e["unit"]; }
        var w = dictOf(s["w"]);
        if (w != null && (w["unit"] instanceof Lang.String)) { return w["unit"]; }
        return s["u"];
    }
    //! The step the weight moves in: the phone's, else 2.5 kg / 5 lb.
    function stepOf(s, e) {
        var st = e == null ? null : toF(e["step"]);
        if (st != null && st > 0) { return st; }
        return same(unitOf(s, e), "lb") ? 5.0 : 2.5;
    }

    /* ---------- the phone's snapshot ---------- */

    //! A snapshot from the phone, over what the watch has. Returns the summary of a workout the
    //! phone ended (finished there while the watch had it running), else null.
    function applySnapshot(s, snap) {
        s["rd"] = dictOf(snap["ready"]);
        s["sy"] = true;
        if (snap["unit"] instanceof Lang.String) { s["u"] = snap["unit"]; }
        var rs = toF(snap["restSec"]);
        if (rs != null && rs > 0) { s["rs"] = rs; }
        if (snap["settings"] instanceof Lang.Dictionary) { s["set"] = snap["settings"]; }
        if (snap["streak"] instanceof Lang.Dictionary) { s["stk"] = snap["streak"]; }

        var cur = dictOf(s["w"]);
        var wid = cur == null ? null : cur["id"];
        var discarded = arrOf(snap["discarded"]);
        var droppedThere = wid != null && has(discarded, wid);
        if (droppedThere && same(wid, s["sh"])) { s["sh"] = null; }
        var unconfirmed = wid != null && same(wid, s["sh"]);
        var nx = dictOf(snap["active"]);
        var nid = nx == null ? null : nx["id"];

        if (nx == null || (nid != null && has(s["fh"], nid))) {
            // No workout on the phone, or one the watch has finished already.
            if (unconfirmed || cur == null) { return null; }
            var ended = droppedThere ? null : summary(s, cur, true);
            s["w"] = null; s["p"] = {}; s["sk"] = []; s["rest"] = null;
            return ended;
        }
        var sameOne = nid != null && same(nid, wid);
        if (nid != null && same(nid, s["sh"])) { s["sh"] = null; }
        // The phone runs a different workout than the one started here: the watch keeps its own.
        if (!sameOne && unconfirmed) { return null; }

        // The exercise on screen, to find it again in the new window.
        var onScreen = entryAt(s, s["pos"]);
        var onId = onScreen == null ? null : onScreen["id"];
        var atEnd = cur != null && s["pos"] >= entries(s).size();
        if (!sameOne) { s["p"] = {}; s["sk"] = []; s["rest"] = null; }

        var p = s["p"];
        var es = arrOf(nx["entries"]);
        for (var ei = 0; ei < es.size(); ei += 1) {
            var e = dictOf(es[ei]);
            if (e == null) { continue; }
            var sets = arrOf(e["sets"]);
            for (var si = 0; si < sets.size(); si += 1) {
                var row = dictOf(sets[si]);
                if (row == null) { continue; }
                var k = key(e["id"], si, null);
                var t = p[k];
                if (t != null) {
                    var rowAt = toMs(row["at"]);
                    if (isTrue(row["done"]) && (rowAt == null || rowAt >= t[2])) {
                        p.remove(k);
                    } else {
                        row["done"] = true;
                        if (t[0] != null) { row["w"] = t[0]; }
                        if (t[1] != null) { row["r"] = t[1]; }
                        if (t[3] != null) { row["sec"] = t[3]; }
                        row["at"] = t[2];
                    }
                }
                var sides = ["L", "R"];
                for (var j = 0; j < 2; j += 1) {
                    var ks = key(e["id"], si, sides[j]);
                    var ts = p[ks];
                    if (ts == null) { continue; }
                    var sd = dictOf(row["sides"]);
                    var one = sd == null ? null : dictOf(sd[sides[j]]);
                    var rowAt2 = toMs(row["at"]);
                    if (one != null && isTrue(one["done"]) && (rowAt2 == null || rowAt2 >= ts[2])) {
                        p.remove(ks);
                    } else if (sd != null) {
                        markSide(row, sides[j], ts[0], ts[1], ts[2]);
                    } else {
                        p.remove(ks);
                    }
                }
            }
        }
        s["w"] = nx;

        // Where the watch is now: the same exercise when it is still in the window, else where
        // the phone is (its window starts with the exercise up now).
        var pos = 0;
        if (!sameOne) {
            var curIdx = toI(nx["cur"], 0);
            for (var k2 = 0; k2 < es.size(); k2 += 1) {
                var e2 = dictOf(es[k2]);
                if (e2 != null && toI(e2["i"], k2) == curIdx) { pos = k2; break; }
            }
        } else if (atEnd && es.size() > 0 && !hasMore(s)) {
            pos = es.size();
        } else if (onId != null) {
            for (var k3 = 0; k3 < es.size(); k3 += 1) {
                var e3 = dictOf(es[k3]);
                if (e3 != null && same(e3["id"], onId)) { pos = k3; break; }
            }
        }
        s["pos"] = pos;

        // A rest started on the phone runs here as well.
        var rest = dictOf(nx["rest"]);
        var endsAt = rest == null ? null : toMs(rest["endsAt"]);
        if (endsAt != null && endsAt > nowMs()) { s["rest"] = endsAt; }
        return null;
    }

    //! Whether the workout has exercises after the window (the phone sends them later).
    function hasMore(s) {
        var w = dictOf(s["w"]);
        if (w == null) { return false; }
        var es = entries(s);
        if (es.size() == 0) { return toI(w["count"], 0) > 0; }
        var last = dictOf(es[es.size() - 1]);
        var lastIdx = last == null ? es.size() - 1 : toI(last["i"], es.size() - 1);
        return toI(w["count"], es.size()) > lastIdx + 1;
    }

    /* ---------- sets ---------- */

    //! One side of a per-side set done, the row following both sides (the phone's syncSideAggregate).
    function markSide(row, side, w, r, at) {
        var sd = dictOf(row["sides"]);
        if (sd == null) { return; }
        var one = dictOf(sd[side]);
        if (one == null) { one = {}; sd[side] = one; }
        one["done"] = true;
        if (w != null) { one["w"] = w; }
        if (r != null) { one["r"] = r; }
        var l = dictOf(sd["L"]);
        var rr = dictOf(sd["R"]);
        var lDone = l != null && isTrue(l["done"]);
        var rDone = rr != null && isTrue(rr["done"]);
        row["done"] = lDone && rDone;
        var lr = l == null ? null : toF(l["r"]);
        var rrr = rr == null ? null : toF(rr["r"]);
        row["r"] = (lr == null ? 0.0 : lr) + (rrr == null ? 0.0 : rrr);
        var lw = l == null ? null : toF(l["w"]);
        var rw = rr == null ? null : toF(rr["w"]);
        lw = lw == null ? 0.0 : lw;
        rw = rw == null ? 0.0 : rw;
        row["w"] = lw > rw ? lw : rw;
        var was = toMs(row["at"]);
        row["at"] = (was != null && was > at) ? was : at;
    }

    //! The side up next on a per-side set ("L", then "R"), or null.
    function sideUp(row) {
        var sd = row == null ? null : dictOf(row["sides"]);
        if (sd == null) { return null; }
        var l = dictOf(sd["L"]);
        var r = dictOf(sd["R"]);
        if (l == null || !isTrue(l["done"])) { return "L"; }
        if (r == null || !isTrue(r["done"])) { return "R"; }
        return null;
    }

    function isSkipped(s, exId, si) {
        return has(s["sk"], key(exId, si, null));
    }

    //! The set to do next in an exercise: the first not done and not skipped, or null.
    function setIndex(s, pos) {
        var e = entryAt(s, pos);
        if (e == null) { return null; }
        var sets = arrOf(e["sets"]);
        for (var si = 0; si < sets.size(); si += 1) {
            var row = dictOf(sets[si]);
            if (row != null && !isTrue(row["done"]) && !isSkipped(s, e["id"], si)) { return si; }
        }
        return null;
    }

    //! A set ticked here: the state with it done, and the event for the phone (watch-sync.js
    //! setDone), or null when there is no such set. `hr` is [avg, max] or null.
    function tick(s, pos, si, side, w, r, sec, hr) {
        var wk = dictOf(s["w"]);
        var e = entryAt(s, pos);
        if (wk == null || e == null) { return null; }
        var sets = arrOf(e["sets"]);
        if (si < 0 || si >= sets.size()) { return null; }
        var row = dictOf(sets[si]);
        if (row == null) { return null; }
        var at = nowMs();
        var oneSide = (side != null && (row["sides"] instanceof Lang.Dictionary)) ? side : null;
        if (oneSide != null) {
            markSide(row, oneSide, w, r, at);
        } else {
            row["done"] = true;
            if (w != null) { row["w"] = w; }
            if (r != null) { row["r"] = r; }
            if (sec != null) { row["sec"] = sec; }
            row["at"] = at;
        }
        s["p"][key(e["id"], si, oneSide)] = [w, r, at, sec];
        var ev = {
            "id" => newId(), "type" => "setDone", "wid" => strOf(wk["id"]), "exId" => strOf(e["id"]),
            "entryIdx" => entryIdx(s, pos), "setIdx" => si, "at" => at
        };
        if (w != null) { ev["w"] = w; }
        if (r != null) { ev["r"] = r; }
        if (sec != null) { ev["sec"] = sec; }
        if (oneSide != null) { ev["side"] = oneSide; }
        if (hr != null) { ev["hr"] = { "avg" => hr[0], "max" => hr[1] }; }
        return ev;
    }

    //! A set passed over here: not done, the next one comes up.
    function skip(s, pos, si) {
        var e = entryAt(s, pos);
        if (e == null) { return; }
        var k = key(e["id"], si, null);
        if (!has(s["sk"], k)) { s["sk"].add(k); }
    }

    //! Where to go after set `si` of the exercise at `pos`, and whether a rest comes first, as
    //! [pos, rest]:
    //!   per-side set with a side to go   the same exercise, no rest
    //!   superset                          the next exercise of the group in turn; rest after a round
    //!   otherwise                         this exercise while it has sets, then the next that has;
    //!                                     after the last, the end page (pos = count)
    function next(s, pos, si) {
        var es = entries(s);
        var count = es.size();
        var e = entryAt(s, pos);
        if (e == null) { return [s["pos"], false]; }
        var sets = arrOf(e["sets"]);
        if (si >= 0 && si < sets.size() && sideUp(dictOf(sets[si])) != null) { return [pos, false]; }
        var g = e["group"];
        if (g != null) {
            var lo = pos;
            var hi = pos;
            while (lo > 0 && same(dictOf(es[lo - 1])["group"], g)) { lo -= 1; }
            while (hi + 1 < count && same(dictOf(es[hi + 1])["group"], g)) { hi += 1; }
            if (hi > lo) {
                // the members after this one first, then from the top of the group (a new round)
                for (var k = pos + 1; k <= hi; k += 1) {
                    if (setIndex(s, k) != null) { return [k, false]; }
                }
                for (var k2 = lo; k2 <= pos; k2 += 1) {
                    if (setIndex(s, k2) != null) { return [k2, true]; }
                }
                for (var k3 = hi + 1; k3 < count; k3 += 1) {
                    if (setIndex(s, k3) != null) { return [k3, true]; }
                }
                for (var k4 = 0; k4 < lo; k4 += 1) {
                    if (setIndex(s, k4) != null) { return [k4, true]; }
                }
                return [count, true];
            }
        }
        if (setIndex(s, pos) != null) { return [pos, true]; }
        for (var k5 = pos + 1; k5 < count; k5 += 1) {
            if (setIndex(s, k5) != null) { return [k5, true]; }
        }
        for (var k6 = 0; k6 < pos; k6 += 1) {
            if (setIndex(s, k6) != null) { return [k6, true]; }
        }
        return [count, true];
    }

    /* ---------- the workout ---------- */

    //! A ready session started here (watch-sync.js start). With its exercises (today's, when they
    //! fit in the message) it runs here at once; by name only, the watch waits for the phone to
    //! start it and send it back.
    function start(s, session) {
        var at = nowMs();
        var wid = "watch-" + at.toString();
        var es = arrOf(session["entries"]);
        s["w"] = {
            "id" => wid, "name" => strOf(session["name"]), "unit" => s["u"], "cur" => 0, "restSec" => s["rs"],
            "entries" => es, "start" => at, "count" => es.size()
        };
        s["sh"] = wid;
        s["p"] = {};
        s["sk"] = [];
        s["pos"] = 0;
        s["rest"] = null;
        return { "id" => newId(), "type" => "start", "routineIds" => arrOf(session["routineIds"]), "wid" => wid, "at" => at };
    }

    //! The session finished here, or discarded here (the phone drops it unsaved). Returns the event.
    function finish(s, discard) {
        var w = dictOf(s["w"]);
        if (w == null) { return null; }
        var at = nowMs();
        var wid = strOf(w["id"]);
        s["w"] = null; s["p"] = {}; s["sk"] = []; s["sh"] = null; s["rest"] = null; s["pos"] = 0;
        var fh = s["fh"];
        fh.add(wid);
        if (fh.size() > 5) { s["fh"] = fh.slice(fh.size() - 5, null); }
        return { "id" => newId(), "type" => discard ? "discard" : "finish", "wid" => wid, "at" => at };
    }

    //! Work sets done and in all, over the whole workout: the phone's count plus what was ticked
    //! here since, or (a workout started here, not heard back) the watch's own count.
    function progress(s) {
        var w = dictOf(s["w"]);
        if (w == null) { return [0, 0]; }
        var done = 0;
        var all = 0;
        var es = entries(s);
        for (var i = 0; i < es.size(); i += 1) {
            var sets = arrOf(dictOf(es[i])["sets"]);
            for (var j = 0; j < sets.size(); j += 1) {
                var row = dictOf(sets[j]);
                if (row == null || isTrue(row["warmup"])) { continue; }
                all += 1;
                if (isTrue(row["done"])) { done += 1; }
            }
        }
        var pr = arrOf(w["progress"]);
        if (pr.size() == 2) {
            return [toI(pr[0], 0) + s["p"].size(), toI(pr[1], all)];
        }
        return [done, all];
    }

    //! The workout as the summary shows it at its end: name, seconds, sets, volume, unit.
    function summary(s, w, endedOnPhone) {
        var sets = 0;
        var volume = 0.0;
        var es = arrOf(w["entries"]);
        var unit = strOf(w["unit"]);
        for (var i = 0; i < es.size(); i += 1) {
            var e = dictOf(es[i]);
            if (e == null) { continue; }
            var rows = arrOf(e["sets"]);
            var f = 1.0;
            if ((e["unit"] instanceof Lang.String) && !same(e["unit"], unit)) {
                f = same(e["unit"], "lb") ? 0.45359237 : 1 / 0.45359237;
            }
            for (var j = 0; j < rows.size(); j += 1) {
                var row = dictOf(rows[j]);
                if (row == null || isTrue(row["warmup"]) || !isTrue(row["done"])) { continue; }
                sets += 1;
                if (!isTimed(e) && !isCardio(e)) {
                    var ww = toF(row["w"]);
                    var rr = toF(row["r"]);
                    volume += (ww == null ? 0.0 : ww) * (rr == null ? 0.0 : rr) * f;
                }
            }
        }
        // A window holds only part of the workout: the phone's totals count the rest.
        var pr = arrOf(w["progress"]);
        if (pr.size() == 2 && toI(pr[0], 0) > sets) { sets = toI(pr[0], 0); }
        var vol = toF(w["volume"]);
        if (vol != null && vol > volume) { volume = vol; }
        var startMs = toMs(w["start"]);
        var dur = startMs == null ? null : ((nowMs() - startMs) / 1000l).toNumber();
        return {
            "name" => strOf(w["name"]), "unit" => unit, "dur" => dur, "sets" => sets, "vol" => volume,
            "ended" => endedOnPhone
        };
    }

    /* ---------- numbers ---------- */

    //! A weight moved by `steps` on the exercise's grid (an off-grid weight lands on it first),
    //! never below zero.
    function stepWeight(w, step, steps) {
        var base = w == null ? 0.0 : w.toFloat();
        if (steps == 0 || step <= 0) { return base; }
        var k = base / step;
        // floor and ceiling, k never negative; a hair of slack so 62.4999 counts as 62.5's grid
        var fl = (k + 0.001).toNumber();
        var dn = k - 0.001;
        var ce = dn <= 0 ? 0 : dn.toNumber();
        if (dn > ce) { ce += 1; }
        var idx = steps > 0 ? fl + steps : ce + steps;
        var out = idx * step;
        if (out < 0) { return 0.0; }
        return Math.round(out * 100) / 100.0;
    }

    function stepReps(r, steps) {
        var v = (r == null ? 0.0 : r.toFloat()) + steps;
        if (v < 0) { return 0.0; }
        return v > 999 ? 999.0 : v;
    }
}
