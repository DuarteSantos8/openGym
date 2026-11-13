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
//   pre  the phone's rest end the watch last followed (ms): the same end again does not undo a
//        +15 / -15 / Skip pressed here (restFollows, the other watches' RestMath.follows)
//   eo   id of the last tick made here until a snapshot names it applied (its rest is ours)
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
    //! A yes from the phone. A bridge may hand a JSON true over as the number 1 (the iPhone's
    //! goes through NSNumber): that counts as well, and 0 as a no (isOff).
    function isTrue(v) {
        if (v instanceof Lang.Boolean) { return v; }
        return (v instanceof Lang.Number || v instanceof Lang.Char) && v.toNumber() == 1;
    }
    //! A setting the phone turned off (missing is not off).
    function isOff(v) {
        if (v instanceof Lang.Boolean) { return !v; }
        return (v instanceof Lang.Number || v instanceof Lang.Char) && v.toNumber() == 0;
    }
    function same(a, b) {
        return a != null && b != null && (a instanceof Lang.String) && a.equals(b);
    }
    function inArr(arr, v) {
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
            "sh" => null, "fh" => [], "p" => {}, "pos" => 0, "sk" => [], "rest" => null, "ob" => [], "obn" => 0, "rec" => null, "pre" => null
        };
    }

    //! A state read back from storage, with anything missing filled in (an older app's state).
    function normalize(s) {
        var base = emptyState();
        if (!(s instanceof Lang.Dictionary)) { return base; }
        var keys = base.keys();
        for (var i = 0; i < keys.size(); i += 1) {
            if (!s.hasKey(keys[i]) || (s[keys[i]] == null && base[keys[i]] != null)) { s.put(keys[i], base[keys[i]]); }
        }
        if (toI(s["obn"], 0) > s["ob"].size()) { s["obn"] = s["ob"].size(); }
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

    /* ---------- the outbox ---------- */

    // An event waits in the outbox as a plain array of its values in this order (a Dictionary costs
    // a watch with 92 KB about twice the memory, and a workout logged with the phone away can leave
    // dozens there). hr { avg, max } is kept as [avg, max]. Unpacked again only to be sent.
    const EV_KEYS = ["id", "type", "at", "wid", "exId", "entryIdx", "setIdx", "w", "r", "sec", "side", "hr", "rir", "rpe", "routineIds"];

    function pack(ev) {
        var out = [];
        var last = 0;
        for (var i = 0; i < EV_KEYS.size(); i += 1) {
            var v = ev[EV_KEYS[i]];
            if (v instanceof Lang.Dictionary) { v = [v["avg"], v["max"]]; }
            out.add(v);
            if (v != null) { last = i + 1; }
        }
        return out.slice(0, last);
    }

    function unpack(ev) {
        if (ev instanceof Lang.Dictionary) { return ev; }
        var out = {};
        for (var i = 0; i < ev.size() && i < EV_KEYS.size(); i += 1) {
            var v = ev[i];
            if (v == null) { continue; }
            if (i == 11) { v = { "avg" => v[0], "max" => v[1] }; }
            out[EV_KEYS[i]] = v;
        }
        return out;
    }

    //! An outbox entry's id or type, packed or (stored by an older app) a dictionary.
    function evField(ev, k) {
        if (ev instanceof Lang.Dictionary) { return ev[EV_KEYS[k]]; }
        return (ev instanceof Lang.Array && ev.size() > k) ? ev[k] : null;
    }

    //! The events the phone has applied (the snapshot's `acked`) leave the outbox. Until then each
    //! stays, sent or not: one the phone app missed (it was not running) goes again. `obn` counts
    //! the ones at the front already sent; it shrinks with those taken out.
    function ackOutbox(s, acked) {
        if (acked.size() == 0) { return; }
        var ob = s["ob"];
        var sent = toI(s["obn"], 0);
        var kept = [];
        var n = 0;
        for (var i = 0; i < ob.size(); i += 1) {
            if (inArr(acked, evField(ob[i], 0))) { continue; }
            kept.add(ob[i]);
            if (i < sent) { n += 1; }
        }
        s["ob"] = kept;
        s["obn"] = n;
    }

    //! Room for one more event: with `max` in the outbox the oldest one already sent goes. With
    //! none sent (the phone away the whole time) it grows on to `hard`, then the oldest goes
    //! anyway, a workout's start last: an outbox without end would run the watch out of memory,
    //! and it is loaded again at every start.
    function room(s, max, hard) {
        var ob = s["ob"];
        var sent = toI(s["obn"], 0);
        if (ob.size() < max || (sent == 0 && ob.size() < hard)) { return; }
        var k = 0;
        if (sent == 0) {
            while (k < ob.size() - 1 && same(evField(ob[k], 1), "start")) { k += 1; }
        } else {
            s["obn"] = sent - 1;
        }
        var kept = [];
        for (var i = 0; i < ob.size(); i += 1) {
            if (i != k) { kept.add(ob[i]); }
        }
        s["ob"] = kept;
    }

    //! Events not sent yet (the rest wait for the phone to say it has them).
    function unsent(s) {
        return s["ob"].size() - toI(s["obn"], 0);
    }

    /* ---------- the phone's snapshot ---------- */

    //! A snapshot from the phone, over what the watch has. Returns the summary of a workout the
    //! phone ended (finished there while the watch had it running), else null.
    function applySnapshot(s, snap) {
        ackOutbox(s, arrOf(snap["acked"]));
        s["rd"] = dictOf(snap["ready"]);
        trimToday(s["rd"]);
        s["sy"] = true;
        if (snap["unit"] instanceof Lang.String) { s["u"] = snap["unit"]; }
        var rs = toF(snap["restSec"]);
        if (rs != null && rs > 0) { s["rs"] = rs; }
        if (snap["settings"] instanceof Lang.Dictionary) { s["set"] = snap["settings"]; }
        if (snap["streak"] instanceof Lang.Dictionary) { s["stk"] = snap["streak"]; }

        var cur = dictOf(s["w"]);
        var wid = cur == null ? null : cur["id"];
        var discarded = arrOf(snap["discarded"]);
        var droppedThere = wid != null && inArr(discarded, wid);
        if (droppedThere && same(wid, s["sh"])) { s["sh"] = null; }
        var unconfirmed = wid != null && same(wid, s["sh"]);
        var nx = dictOf(snap["active"]);
        var nid = nx == null ? null : nx["id"];

        if (nx == null || (nid != null && inArr(s["fh"], nid))) {
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
        var atEnd = cur != null && entries(s).size() > 0 && s["pos"] >= entries(s).size();
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
        // Ticks of exercises the window has moved past: the phone has them (it moved the window).
        var inWindow = {};
        for (var k1 = 0; k1 < es.size(); k1 += 1) {
            var e1 = dictOf(es[k1]);
            if (e1 != null) { inWindow[strOf(e1["id"])] = true; }
        }
        var pk = p.keys();
        for (var k4 = 0; k4 < pk.size(); k4 += 1) {
            var cut = pk[k4].find("#");
            if (cut == null || !inWindow.hasKey(pk[k4].substring(0, cut))) { p.remove(pk[k4]); }
        }

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

        // A rest started on the phone runs here as well, but only a new one: the same end sent
        // again (with some other change) must not undo a +15 / -15 / Skip pressed here.
        // The first snapshot that applied the last tick made here brings the rest the phone started
        // for it: the watch's own rest, already running, so a +15 / Skip pressed since stands.
        var echo = s["eo"] != null && inArr(arrOf(snap["acked"]), s["eo"]);
        if (echo) { s["eo"] = null; }
        var rest = dictOf(nx["rest"]);
        var endsAt = rest == null ? null : toMs(rest["endsAt"]);
        if (endsAt == null) {
            s["pre"] = null;
        } else if (restFollows(endsAt, s["pre"])) {
            s["pre"] = endsAt;
            if (!echo && endsAt > nowMs()) { s["rest"] = endsAt; }
        }
        return null;
    }

    //! Whether the watch follows a rest end from the phone: only one it has not followed before.
    function restFollows(phoneEnd, last) {
        return last == null || phoneEnd != last;
    }

    //! The rest's end after -15 s, or null when that is the end of it (a Skip, as on the phone).
    function restMinus(end, now, by) {
        var to = end - by;
        return to - now >= 1000 ? to : null;
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
        return inArr(s["sk"], key(exId, si, null));
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
        return tickAt(s, pos, si, side, w, r, sec, hr, [nowMs(), null]);
    }

    //! tick at a given time, with an effort or none: when = [at, [kind, value] or null], the kind
    //! "rir" or "rpe" (older watches allow 9 arguments at most).
    function tickAt(s, pos, si, side, w, r, sec, hr, when) {
        var at = when[0];
        var eff = when[1];
        var wk = dictOf(s["w"]);
        var e = entryAt(s, pos);
        if (wk == null || e == null) { return null; }
        var sets = arrOf(e["sets"]);
        if (si < 0 || si >= sets.size()) { return null; }
        var row = dictOf(sets[si]);
        if (row == null) { return null; }
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
        if (eff != null) { ev[eff[0]] = eff[1]; }
        s["eo"] = ev["id"];
        return ev;
    }

    /* ---------- fixing a logged set (the other watches' SetFix) ---------- */

    //! What was logged on a done set (one side's numbers on a per-side set) as [w, r, sec], or null.
    (:fixui)
    function logged(s, pos, si, side) {
        var e = entryAt(s, pos);
        var sets = e == null ? [] : arrOf(e["sets"]);
        if (si < 0 || si >= sets.size() || isCardio(e)) { return null; }
        var row = dictOf(sets[si]);
        if (row == null) { return null; }
        var sd = dictOf(row["sides"]);
        if (side != null && sd != null) {
            var one = dictOf(sd[side]);
            return (one != null && isTrue(one["done"])) ? [toF(one["w"]), toF(one["r"]), null] : null;
        }
        return isTrue(row["done"]) ? [toF(row["w"]), toF(row["r"]), toF(row["sec"])] : null;
    }

    //! A done set with new numbers (or an effort): the setDone the phone already knows, a moment
    //! later than the set's own tick so it wins there (Workout.jsx setDone: the later tick wins),
    //! and without `hr`, so the phone keeps the set's own heart rate. Null for a set not done.
    (:fixui)
    function fix(s, pos, si, side, w, r, sec, eff) {
        var e = entryAt(s, pos);
        var was = logged(s, pos, si, side);
        if (was == null) { return null; }
        var row = dictOf(arrOf(e["sets"])[si]);
        var oneSide = dictOf(row["sides"]) != null ? side : null;
        var rowAt = toMs(row["at"]);
        var at = nowMs();
        if (rowAt != null && rowAt + 1 > at) { at = rowAt + 1; }
        if (isTimed(e)) {
            r = null;
            if (was[0] == null || was[0] <= 0) { w = null; }
        } else {
            sec = null;
        }
        var k = key(e["id"], si, oneSide);
        var had = s["p"][k];
        // a tick the phone has not confirmed yet stays one set; a fix of a confirmed set is none
        var newTick = had != null && had.size() == 4;
        var ev = tickAt(s, pos, si, oneSide, w, r, sec, null, [at, eff]);
        if (!newTick) { s["p"][k].add(true); }
        return ev;
    }

    //! Every set done in the window, in order, as [pos, si, side]: what ‹ and › step through.
    (:fixui)
    function fixList(s) {
        var out = [];
        var es = entries(s);
        for (var pos = 0; pos < es.size(); pos += 1) {
            var e = dictOf(es[pos]);
            if (e == null || isCardio(e)) { continue; }
            var sets = arrOf(e["sets"]);
            for (var si = 0; si < sets.size(); si += 1) {
                var row = dictOf(sets[si]);
                var sd = row == null ? null : dictOf(row["sides"]);
                if (sd != null) {
                    if (logged(s, pos, si, "L") != null) { out.add([pos, si, "L"]); }
                    if (logged(s, pos, si, "R") != null) { out.add([pos, si, "R"]); }
                } else if (row != null && isTrue(row["done"])) {
                    out.add([pos, si, null]);
                }
            }
        }
        return out;
    }

    //! The done set `by` steps from [pos, si, side] in fixList (from null: the last one), or null.
    (:fixui)
    function fixStep(s, from, by) {
        var all = fixList(s);
        if (all.size() == 0) { return null; }
        if (from == null) { return by < 0 ? all[all.size() - 1] : null; }
        for (var i = 0; i < all.size(); i += 1) {
            var a = all[i];
            if (a[0] == from[0] && a[1] == from[1] && (a[2] == null ? from[2] == null : same(a[2], from[2]))) {
                var j = i + by;
                return (j >= 0 && j < all.size()) ? all[j] : null;
            }
        }
        return null;
    }

    //! Where an exercise is in the window now, by its id, or null (the window moved on).
    (:fixui)
    function posOf(s, exId) {
        var es = entries(s);
        for (var i = 0; i < es.size(); i += 1) {
            var e = dictOf(es[i]);
            if (e != null && same(e["id"], exId)) { return i; }
        }
        return null;
    }

    /* ---------- what the screens say ---------- */

    //! "Set 2 of 4": a work set among the work sets, a warm-up among the warm-ups, as [n, of].
    function place(e, si) {
        var sets = arrOf(e["sets"]);
        if (si < 0 || si >= sets.size()) { return [0, 0]; }
        var warm = isTrue(dictOf(sets[si])["warmup"]);
        var n = 0;
        var of = 0;
        for (var i = 0; i < sets.size(); i += 1) {
            var row = dictOf(sets[i]);
            if (row != null && isTrue(row["warmup"]) == warm) {
                of += 1;
                if (i <= si) { n = of; }
            }
        }
        return [n, of];
    }

    //! What the start screen says about a routine: [exercises, work sets] (warm-ups don't count).
    function planSize(entries) {
        var ex = 0;
        var sets = 0;
        for (var i = 0; i < entries.size(); i += 1) {
            var rows = arrOf(dictOf(entries[i])["sets"]);
            if (rows.size() == 0) { continue; }
            ex += 1;
            for (var j = 0; j < rows.size(); j += 1) {
                if (!isTrue(dictOf(rows[j])["warmup"])) { sets += 1; }
            }
        }
        return [ex, sets];
    }

    //! The other exercises of pos's superset in the window, by name (a group of one is none).
    function partners(s, pos) {
        var es = entries(s);
        var e = entryAt(s, pos);
        var out = [];
        var g = e == null ? null : e["group"];
        if (g == null) { return out; }
        for (var i = 0; i < es.size(); i += 1) {
            var o = dictOf(es[i]);
            if (i != pos && o != null && same(o["group"], g)) { out.add(strOf(o["name"])); }
        }
        return out;
    }

    //! Sets logged here the phone has not stored yet: setDone events still in the outbox (a hello
    //! or the workout's start is not a set the lifter would miss). The other watches' waitingSets.
    function waiting(s) {
        var ob = s["ob"];
        // (asked at every draw: counted again only when the outbox changed)
        if (ob != wOb || ob.size() != wSize) {
            wOb = ob;
            wSize = ob.size();
            wCount = 0;
            for (var i = 0; i < wSize; i += 1) {
                if (same(evField(ob[i], 1), "setDone") && !again(ob, i)) { wCount += 1; }
            }
        }
        var n = wCount;
        // Ticks kept only as pending (the outbox was full, refill): waiting as well.
        if (isTrue(s["of"]) && s["p"].size() > n) { n = s["p"].size(); }
        return n;
    }
    var wOb = null;
    var wSize = 0;
    var wCount = 0;

    //! Whether a set's event is that set once more: fixed or rated here after its tick, which is
    //! one of the few events before it. "Waiting to sync 3" counts sets, as the lifter does, not
    //! messages (three sets, each rated, used to read as six).
    (:fixui)
    function again(ob, i) {
        var a = ob[i];
        for (var j = i - 1; j >= 0 && j >= i - 8; j -= 1) {
            var b = ob[j];
            if (same(evField(b, 1), "setDone") && same(evField(b, 4), evField(a, 4)) && evField(b, 6) == evField(a, 6)
                && same(evField(b, 3), evField(a, 3)) && (evField(b, 10) == null ? evField(a, 10) == null : same(evField(b, 10), evField(a, 10)))) {
                return true;
            }
        }
        return false;
    }
    (:nofixui)
    function again(ob, i) {
        return false;
    }

    //! The Instinct 2 family (96 KB) holds at most 6 sets in the outbox while the phone is away: a
    //! set past that waits as a pending tick only (no heart rate) and goes out once there is room
    //! (refill). Every event but a set always goes in. The other watches have room for all.
    (:nofixui)
    function full(s, ev) {
        if (!same(ev["type"], "setDone") || waiting(s) < 6) { return false; }
        s["of"] = true;
        return true;
    }
    (:fixui)
    function full(s, ev) {
        return false;
    }

    //! The pending ticks the outbox had no room for become setDone events again, as room allows
    //! (`all`: every one, at the workout's end, before its ticks are let go of).
    (:nofixui)
    function refill(s, all) {
        if (!isTrue(s["of"])) { return; }
        var w = dictOf(s["w"]);
        var p = s["p"];
        if (w == null || p.size() == 0) { s["of"] = false; return; }
        var ob = s["ob"];
        var have = {};
        var n = 0;
        for (var i = 0; i < ob.size(); i += 1) {
            if (!same(evField(ob[i], 1), "setDone")) { continue; }
            n += 1;
            have[strOf(evField(ob[i], 4)) + "#" + evField(ob[i], 6) + (evField(ob[i], 10) == null ? "" : "#" + evField(ob[i], 10))] = true;
        }
        var es = entries(s);
        var left = false;
        var sides = [null, "L", "R"];
        for (var pos = 0; pos < es.size(); pos += 1) {
            var e = dictOf(es[pos]);
            if (e == null) { continue; }
            for (var si = 0; si < arrOf(e["sets"]).size(); si += 1) {
                for (var j = 0; j < 3; j += 1) {
                    var k = key(e["id"], si, sides[j]);
                    var t = p[k];
                    if (t == null || have.hasKey(k)) { continue; }
                    if (n >= 6 && !all) { left = true; continue; }
                    var ev = { "id" => newId(), "type" => "setDone", "wid" => strOf(w["id"]), "exId" => strOf(e["id"]),
                        "entryIdx" => entryIdx(s, pos), "setIdx" => si, "at" => t[2], "w" => t[0], "r" => t[1], "sec" => t[3], "side" => sides[j] };
                    ob.add(pack(ev));
                    n += 1;
                }
            }
        }
        s["of"] = left;
    }
    (:fixui)
    function refill(s, all) {
    }

    //! The last sign of life in a workout (ms): its newest set, the phone's last use, else its start.
    (:big)
    function lastSet(w) {
        var best = toMs(w["activeAt"]);
        var es = arrOf(w["entries"]);
        for (var i = 0; i < es.size(); i += 1) {
            var rows = arrOf(dictOf(es[i])["sets"]);
            for (var j = 0; j < rows.size(); j += 1) {
                var at = toMs(dictOf(rows[j])["at"]);
                if (at != null && (best == null || at > best)) { best = at; }
            }
        }
        return best != null ? best : toMs(w["start"]);
    }

    //! "Still training?" after the phone's forgotten-workout minutes without a set (`askMin`,
    //! 20 when the phone does not say, 0 never), since the last set or the last "Keep going".
    //! What only some builds use is annotated like them ((:big), (:fixui), monkey.jungle).
    (:big)
    function asks(last, snooze, now, askMin) {
        var after = (askMin == null ? 20 : askMin) * 60000;
        var since = last;
        if (snooze != null && (since == null || snooze > since)) { since = snooze; }
        return after > 0 && since != null && now - since >= after;
    }

    //! The number up `ms` into the 3-2-1: 3, 2, 1, then 0 (Go!).
    (:big)
    function countNumber(ms) {
        var n = 3 - (ms < 0 ? 0 : ms / 1000);
        return n < 0 ? 0 : n;
    }

    //! The quick effort ratings during the rest, hardest first: RIR 0/1/2/3+ or RPE 10/9/8/<8.
    (:big)
    function chips(kind) {
        return same(kind, "rpe") ? [10, 9, 8, 7] : [0, 1, 2, 3];
    }
    (:big)
    function chipLabel(kind, v) {
        if (same(kind, "rpe") && v <= 7) { return "<8"; }
        if (!same(kind, "rpe") && v >= 3) { return "3+"; }
        return v.toString();
    }

    //! A set passed over here: not done, the next one comes up.
    function skip(s, pos, si) {
        var e = entryAt(s, pos);
        if (e == null) { return; }
        var k = key(e["id"], si, null);
        if (!inArr(s["sk"], k)) { s["sk"].add(k); }
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

    //! The Instinct 2 family (96 KB) keeps today's routine to its first exercises, up to 16 sets: a
    //! long routine started there ran the watch out of memory. The rest comes from the phone once
    //! it has the workout (`count` says there is more). The other watches keep it whole.
    (:nofixui)
    function trimToday(rd) {
        var t = rd == null ? null : dictOf(rd["today"]);
        if (t == null) { return; }
        var es = arrOf(t["entries"]);
        var keep = [];
        var n = 0;
        for (var i = 0; i < es.size(); i += 1) {
            var e = dictOf(es[i]);
            var k = e == null ? 0 : arrOf(e["sets"]).size();
            if (keep.size() > 0 && n + k > 16) { break; }
            keep.add(es[i]);
            n += k;
        }
        if (keep.size() < es.size()) {
            t["count"] = es.size();
            t["entries"] = keep;
        }
    }
    (:fixui)
    function trimToday(rd) {
    }

    //! A ready session started here (watch-sync.js start). With its exercises (today's, when they
    //! fit in the message) it runs here at once; by name only, the watch waits for the phone to
    //! start it and send it back.
    function start(s, session) {
        var at = nowMs();
        var wid = "watch-" + at.toString();
        var es = arrOf(session["entries"]);
        s["w"] = {
            "id" => wid, "name" => strOf(session["name"]), "unit" => s["u"], "cur" => 0, "restSec" => s["rs"],
            "entries" => es, "start" => at, "count" => toI(session["count"], es.size())
        };
        s["sh"] = wid;
        // Today's routine lets go of its exercises: the workout has them now (and ticks them), and a
        // second copy would only cost memory. The phone sends it whole again.
        var rd = dictOf(s["rd"]);
        if (rd != null && rd["today"] == session) {
            rd["today"] = { "name" => strOf(session["name"]), "routineIds" => arrOf(session["routineIds"]), "entries" => [] };
        }
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
        // Sets still waiting as pending ticks (the outbox was full) go in first, or they would be lost.
        if (!discard) { refill(s, true); }
        s["of"] = false;
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
            var ticks = 0;
            var pv = s["p"].values();
            for (var k = 0; k < pv.size(); k += 1) {
                if (pv[k].size() == 4) { ticks += 1; }
            }
            return [toI(pr[0], 0) + ticks, toI(pr[1], all)];
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
