// Unit tests for Core.mc, the cases of the other watches' SessionCoreTest, run in the simulator:
//   monkeyc -t -f monkey.jungle -d fr265 -y <key> -o bin/test.prg && monkeydo bin/test.prg fr265 -t
// The snapshot below is test/snapshot.json (lib/garmin-snapshot.test.js builds that file), the
// part these tests need, as Monkey C reads it.
import Toybox.Lang;
import Toybox.Test;

// A test module: left out of every build but monkeyc -t, helpers and all.
(:test)
module CoreTest {

    function coreSnap() {
        return {
            "v" => 1, "unit" => "kg", "restSec" => 90,
            "settings" => { "restHaptics" => true, "lang" => "de", "show" => { "hr" => true, "last" => true, "next" => true } },
            "streak" => { "weeks" => 1, "thisWeekDone" => false },
            "active" => {
                "id" => "w-1", "name" => "Push day", "start" => 1761742800000l, "unit" => "kg", "cur" => 0, "restSec" => 90,
                "count" => 2, "progress" => [1, 3], "volume" => 480,
                "entries" => [
                    {
                        "id" => "0025", "name" => "Barbell Bench Press", "mode" => "reps", "restSec" => 120, "last" => "55×8, 57.5×6",
                        "step" => 2.5, "i" => 0,
                        "sets" => [
                            { "w" => 60, "r" => 8, "sec" => null, "done" => true, "warmup" => false, "at" => 1761742900000l },
                            { "w" => 60, "r" => 8, "sec" => null, "done" => false, "warmup" => false }
                        ]
                    },
                    {
                        "id" => "0001", "name" => "3/4 Sit-Up", "mode" => "reps", "restSec" => null, "last" => null,
                        "bodyweight" => true, "step" => 2.5, "i" => 1,
                        "sets" => [
                            { "w" => 20, "r" => 10, "sec" => null, "done" => false, "warmup" => true },
                            { "w" => 30, "r" => 10, "sec" => null, "done" => false, "warmup" => false }
                        ]
                    }
                ]
            },
            "ready" => null
        };
    }

    function coreRow(s, pos, si) {
        return Core.entryAt(s, pos)["sets"][si];
    }

    (:test)
    function readsTheSnapshot(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        Test.assert(Core.same(s["w"]["id"], "w-1"));
        Test.assertEqual(s["pos"], 0);
        Test.assertEqual(Core.setIndex(s, 0), 1);
        Test.assertEqual(Core.entryIdx(s, 1), 1);
        Test.assert(!Core.hasMore(s));
        Test.assert(Core.isTrue(s["sy"]));
        return true;
    }

    //! The event is events.json's first: setDone with wid, exId, entryIdx, setIdx, w, r, at, hr.
    (:test)
    function tickSendsSetDone(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var ev = Core.tick(s, 0, 1, null, 62.5, 7.0, null, [128, 141]);
        Test.assert(Core.same(ev["type"], "setDone"));
        Test.assert(Core.same(ev["wid"], "w-1"));
        Test.assert(Core.same(ev["exId"], "0025"));
        Test.assertEqual(ev["entryIdx"], 0);
        Test.assertEqual(ev["setIdx"], 1);
        Test.assertEqual(ev["w"], 62.5);
        Test.assertEqual(ev["r"], 7.0);
        Test.assertEqual(ev["hr"]["avg"], 128);
        Test.assertEqual(ev["hr"]["max"], 141);
        Test.assert(ev["at"] instanceof Lang.Long);
        Test.assert(Core.isTrue(coreRow(s, 0, 1)["done"]));
        return true;
    }

    //! A snapshot from before the tick does not undo it; one that shows it done clears it.
    (:test)
    function pendingTickSurvivesAStaleSnapshot(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        Core.tick(s, 0, 1, null, 62.5, 7.0, null, null);
        Core.applySnapshot(s, coreSnap());
        Test.assert(Core.isTrue(coreRow(s, 0, 1)["done"]));
        Test.assertEqual(coreRow(s, 0, 1)["w"], 62.5);
        Test.assertEqual(s["p"].size(), 1);
        var later = coreSnap();
        later["active"]["entries"][0]["sets"][1] = { "w" => 62.5, "r" => 7, "done" => true, "warmup" => false, "at" => Core.nowMs() + 1000l };
        Core.applySnapshot(s, later);
        Test.assertEqual(s["p"].size(), 0);
        return true;
    }

    //! Finished here: a stale snapshot that still shows it does not bring it back.
    (:test)
    function finishedStaysFinished(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var ev = Core.finish(s, false);
        Test.assert(Core.same(ev["type"], "finish"));
        Test.assert(s["w"] == null);
        Core.applySnapshot(s, coreSnap());
        Test.assert(s["w"] == null);
        return true;
    }

    //! Ended on the phone while running here: gone, with a summary that says so.
    (:test)
    function endedOnThePhone(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var none = coreSnap();
        none["active"] = null;
        var sm = Core.applySnapshot(s, none);
        Test.assert(s["w"] == null);
        Test.assert(sm != null && Core.isTrue(sm["ended"]));
        Test.assertEqual(sm["sets"], 1);
        return true;
    }

    //! Started here: kept until the phone reports it, a snapshot without it does not end it.
    (:test)
    function startedHereIsKept(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var ev = Core.start(s, { "routineIds" => ["r-push"], "name" => "Push", "entries" => [] });
        Test.assert(Core.same(ev["type"], "start"));
        Test.assert(Core.same(ev["routineIds"][0], "r-push"));
        var wid = ev["wid"];
        var none = coreSnap();
        none["active"] = null;
        Core.applySnapshot(s, none);
        Test.assert(Core.same(s["w"]["id"], wid));
        var back = coreSnap();
        back["active"]["id"] = wid;
        Core.applySnapshot(s, back);
        Test.assert(s["sh"] == null);
        Test.assertEqual(Core.entries(s).size(), 2);
        return true;
    }

    //! After the last set of an exercise: the next one with a set to do, with a rest first.
    (:test)
    function nextGoesOn(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        Core.tick(s, 0, 1, null, 60.0, 8.0, null, null);
        var nx = Core.next(s, 0, 1);
        Test.assertEqual(nx[0], 1);
        Test.assert(nx[1]);
        Core.skip(s, 1, 0);
        Test.assertEqual(Core.setIndex(s, 1), 1);
        return true;
    }

    //! A superset goes round its members, the rest after each round.
    (:test)
    function supersetGoesRound(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var sn = coreSnap();
        sn["active"]["entries"][0]["group"] = "g";
        sn["active"]["entries"][1]["group"] = "g";
        Core.applySnapshot(s, sn);
        var nx = Core.next(s, 0, 1);
        Test.assertEqual(nx[0], 1);
        Test.assert(!nx[1]);
        return true;
    }

    (:test)
    function weightsStayOnTheGrid(logger as Test.Logger) as Boolean {
        Test.assertEqual(Core.stepWeight(60.0, 2.5, 1), 62.5);
        Test.assertEqual(Core.stepWeight(61.0, 2.5, 1), 62.5);
        Test.assertEqual(Core.stepWeight(61.0, 2.5, -1), 60.0);
        Test.assertEqual(Core.stepWeight(0.0, 2.5, -1), 0.0);
        Test.assertEqual(Core.stepReps(0.0, -1), 0.0);
        Test.assertEqual(Ui.fmtW(62.5), "62.5");
        Test.assertEqual(Ui.fmtW(60.0), "60");
        return true;
    }

    //! The outbox lets go of what the phone named in `acked`, sent or not, and nothing else.
    (:test)
    function outboxKeepsWhatThePhoneHasNotConfirmed(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        s["ob"] = [{ "id" => "a" }, { "id" => "b" }, { "id" => "c" }, { "id" => "d" }];
        s["obn"] = 3;
        Test.assertEqual(Core.unsent(s), 1);
        var sn = coreSnap();
        sn["acked"] = ["a", "c", "zz"];
        Core.applySnapshot(s, sn);
        Test.assertEqual(s["ob"].size(), 2);
        Test.assert(Core.same(s["ob"][0]["id"], "b"));
        Test.assert(Core.same(s["ob"][1]["id"], "d"));
        // b was sent and waits for its confirmation; d was never sent
        Test.assertEqual(s["obn"], 1);
        Test.assertEqual(Core.unsent(s), 1);
        // a snapshot without acked changes nothing
        Core.applySnapshot(s, coreSnap());
        Test.assertEqual(s["ob"].size(), 2);
        return true;
    }

    /* ---------- the 1.4.5 redesign ---------- */

    //! "Set 2 of 4" counts work sets among work sets, warm-ups among warm-ups; the start screen's
    //! "2 Exercises · 3 Sets" leaves warm-ups out.
    (:test)
    function setNavCountsPlaces(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var e1 = Core.entryAt(s, 1);
        Test.assertEqual(Core.place(e1, 0)[0], 1);
        Test.assertEqual(Core.place(e1, 0)[1], 1);
        Test.assertEqual(Core.place(e1, 1)[0], 1);
        Test.assertEqual(Core.place(Core.entryAt(s, 0), 1)[0], 2);
        Test.assertEqual(Core.place(Core.entryAt(s, 0), 1)[1], 2);
        var size = Core.planSize(Core.entries(s));
        Test.assertEqual(size[0], 2);
        Test.assertEqual(size[1], 3);
        return true;
    }

    //! ‹ and › step through the sets done, in order; past the newest there is nothing (the set up
    //! now again).
    (:test, :fixui)
    function setNavStepsThroughDoneSets(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        Test.assertEqual(Core.fixList(s).size(), 1);
        Core.tick(s, 0, 1, null, 62.5, 7.0, null, null);
        var all = Core.fixList(s);
        Test.assertEqual(all.size(), 2);
        var last = Core.fixStep(s, null, -1);
        Test.assertEqual(last[0], 0);
        Test.assertEqual(last[1], 1);
        var before = Core.fixStep(s, last, -1);
        Test.assertEqual(before[1], 0);
        Test.assert(Core.fixStep(s, before, -1) == null);
        Test.assertEqual(Core.fixStep(s, before, 1)[1], 1);
        Test.assert(Core.fixStep(s, last, 1) == null);
        Test.assert(Core.fixStep(s, null, 1) == null);
        return true;
    }

    //! A fix is the setDone the phone knows, later than the set's own tick, without hr (the phone
    //! keeps the set's heart rate), and it does not count as one more set.
    (:test, :fixui)
    function fixSendsALaterSetDoneWithoutHr(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var sn = coreSnap();
        var t0 = Core.nowMs() + 60000l;
        sn["active"]["entries"][0]["sets"][0]["at"] = t0;
        Core.applySnapshot(s, sn);
        var before = Core.progress(s)[0];
        var ev = Core.fix(s, 0, 0, null, 65.0, 6.0, null, null);
        Test.assert(Core.same(ev["type"], "setDone"));
        Test.assertEqual(ev["setIdx"], 0);
        Test.assertEqual(ev["w"], 65.0);
        Test.assertEqual(ev["r"], 6.0);
        Test.assert(!ev.hasKey("hr"));
        Test.assert(ev["at"] > 1761742900000l);
        Test.assert(ev["at"] > t0);
        Test.assertEqual(Core.logged(s, 0, 0, null)[0], 65.0);
        Test.assertEqual(Core.progress(s)[0], before);
        // a set not done cannot be fixed
        Test.assert(Core.fix(s, 1, 1, null, 1.0, 1.0, null, null) == null);
        return true;
    }

    //! The rest's effort chip: the set just done again with rir (or rpe), its numbers as logged.
    (:test, :big)
    function effortRatesTheSetJustDone(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        Core.tick(s, 0, 1, null, 62.5, 7.0, null, [120, 130]);
        var n = Core.logged(s, 0, 1, null);
        var ev = Core.fix(s, 0, 1, null, n[0], n[1], n[2], ["rir", 2]);
        Test.assertEqual(ev["rir"], 2);
        Test.assertEqual(ev["w"], 62.5);
        Test.assert(!ev.hasKey("hr"));
        Test.assert(!ev.hasKey("rpe"));
        // the tick the phone has not confirmed yet is still one set, not two and not none
        Test.assertEqual(Core.progress(s)[0], 2);
        Test.assertEqual(Core.chipLabel("rir", 3), "3+");
        Test.assertEqual(Core.chipLabel("rpe", 7), "<8");
        Test.assertEqual(Core.chips("rpe")[0], 10);
        return true;
    }

    //! -15 at 15 s or less is a Skip, as on the phone.
    (:test)
    function restMath(logger as Test.Logger) as Boolean {
        Test.assertEqual(Core.restMinus(100000l, 50000l, 15000l), 85000l);
        Test.assert(Core.restMinus(64000l, 50000l, 15000l) == null);
        Test.assert(Core.restMinus(65000l, 50000l, 15000l) == null);
        Test.assertEqual(Core.restMinus(66000l, 50000l, 15000l), 51000l);
        Test.assert(Core.restFollows(5l, null));
        Test.assert(Core.restFollows(5l, 4l));
        Test.assert(!Core.restFollows(5l, 5l));
        return true;
    }

    //! The 3-2-1: 3, 2, 1, then Go! (0).
    (:test, :big)
    function countdownCounts(logger as Test.Logger) as Boolean {
        Test.assertEqual(Core.countNumber(0), 3);
        Test.assertEqual(Core.countNumber(2999), 1);
        Test.assertEqual(Core.countNumber(3000), 0);
        Test.assertEqual(Core.countNumber(-50), 3);
        return true;
    }

    //! A snapshot that sends the same rest end again does not undo +15 or a Skip pressed here; a
    //! new end from the phone (its own +15) is followed.
    (:test)
    function snapshotDoesNotUndoTheWatchsRest(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var end = Core.nowMs() + 60000l;
        var sn = coreSnap();
        sn["active"]["rest"] = { "endsAt" => end };
        Core.applySnapshot(s, sn);
        Test.assertEqual(s["rest"], end);
        // +15 here, then the phone's next snapshot with the old end
        s["rest"] = end + 15000l;
        var again = coreSnap();
        again["active"]["rest"] = { "endsAt" => end };
        Core.applySnapshot(s, again);
        Test.assertEqual(s["rest"], end + 15000l);
        // Skip here: the same end does not bring it back
        s["rest"] = null;
        var third = coreSnap();
        third["active"]["rest"] = { "endsAt" => end };
        Core.applySnapshot(s, third);
        Test.assert(s["rest"] == null);
        // the phone's own change is followed
        var moved = coreSnap();
        moved["active"]["rest"] = { "endsAt" => end + 30000l };
        Core.applySnapshot(s, moved);
        Test.assertEqual(s["rest"], end + 30000l);
        return true;
    }

    //! The rest the phone starts for a set ticked here is the watch's own: +15 pressed before that
    //! snapshot came stands. A later rest from the phone is followed.
    (:test)
    function phonesEchoOfTheRestDoesNotUndoPlus15(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var ev = Core.tick(s, 0, 1, null, 62.5, 7.0, null, null);
        var mine = Core.nowMs() + 75000l;
        s["rest"] = mine;
        var echo = coreSnap();
        echo["acked"] = [ev["id"]];
        echo["active"]["rest"] = { "endsAt" => Core.nowMs() + 62000l };
        Core.applySnapshot(s, echo);
        Test.assertEqual(s["rest"], mine);
        var later = coreSnap();
        later["acked"] = [ev["id"]];
        later["active"]["rest"] = { "endsAt" => Core.nowMs() + 90000l };
        Core.applySnapshot(s, later);
        Test.assert(s["rest"] != mine);
        return true;
    }

    //! The Instinct 2 family: a long routine is kept to its first 16 sets, and past 6 sets waiting
    //! a tick stays pending until the phone makes room, then goes out as a setDone again.
    (:test, :nofixui)
    function smallestKeepsItsMemory(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var es = [];
        for (var i = 0; i < 10; i += 1) {
            es.add({ "id" => "x" + i, "name" => "X", "mode" => "reps", "sets" => [{ "w" => 60, "r" => 8 }, { "w" => 60, "r" => 8 }, { "w" => 60, "r" => 8 }, { "w" => 60, "r" => 8 }] });
        }
        var sn = coreSnap();
        sn["active"] = null;
        sn["ready"] = { "today" => { "name" => "Long", "routineIds" => ["r"], "entries" => es }, "others" => [] };
        Core.applySnapshot(s, sn);
        Test.assertEqual(s["rd"]["today"]["entries"].size(), 4);
        Core.start(s, s["rd"]["today"]);
        Test.assertEqual(s["w"]["count"], 10);
        var sent = 0;
        for (var j = 0; j < 12; j += 1) {
            var ev = Core.tick(s, j / 4, j % 4, null, 60, 8, null, null);
            if (!Core.full(s, ev)) { s["ob"].add(Core.pack(ev)); sent += 1; }
        }
        Test.assertEqual(sent, 6);
        Test.assertEqual(Core.waiting(s), 12);
        // the phone took four: four pending ticks go in
        var ids = [];
        for (var k = 0; k < 4; k += 1) { ids.add(Core.evField(s["ob"][k], 0)); s["p"].remove("e0:x0#" + k); }
        Core.ackOutbox(s, ids);
        Core.refill(s, false);
        Test.assertEqual(s["ob"].size(), 6);
        Test.assert(Core.isTrue(s["of"]));
        // two more past the cap, then Finish: they go in with it, none is lost
        for (var m = 12; m < 14; m += 1) {
            var ev2 = Core.tick(s, m / 4, m % 4, null, 60, 8, null, null);
            if (!Core.full(s, ev2)) { s["ob"].add(Core.pack(ev2)); }
        }
        Core.finish(s, false);
        Test.assertEqual(Core.waiting(s), 10);
        return true;
    }

    //! An event waits packed (an array) and goes out as the same dictionary.
    (:test)
    function outboxPacksEvents(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var ev = Core.tick(s, 0, 1, null, 62.5, 7.0, null, [128, 141]);
        var p = Core.pack(ev);
        Test.assert(p instanceof Lang.Array);
        Test.assert(Core.same(Core.evField(p, 0), ev["id"]));
        Test.assert(Core.same(Core.evField(p, 1), "setDone"));
        var back = Core.unpack(p);
        Test.assertEqual(back.size(), ev.size());
        Test.assert(Core.same(back["exId"], "0025"));
        Test.assertEqual(back["w"], 62.5);
        Test.assertEqual(back["at"], ev["at"]);
        Test.assertEqual(back["hr"]["max"], 141);
        Test.assert(!back.hasKey("sec"));
        var st = Core.unpack(Core.pack(Core.start(Core.emptyState(), { "routineIds" => ["r1"], "name" => "A", "entries" => [] })));
        Test.assert(Core.same(st["routineIds"][0], "r1"));
        // one stored by an older app (a dictionary) still counts and goes as it is
        s["ob"] = [{ "id" => "old", "type" => "setDone" }, p];
        Test.assertEqual(Core.waiting(s), 2);
        Test.assert(Core.same(Core.unpack(s["ob"][0])["id"], "old"));
        return true;
    }

    //! Waiting to sync counts the sets in the outbox, not a start or a finish; acked ones go.
    (:test)
    function waitingCountsSetsNotSent(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Test.assertEqual(Core.waiting(s), 0);
        s["ob"] = [{ "id" => "a", "type" => "start" }, { "id" => "b", "type" => "setDone" }, { "id" => "c", "type" => "setDone" }, { "id" => "d", "type" => "finish" }];
        s["obn"] = 4;
        Test.assertEqual(Core.waiting(s), 2);
        var sn = coreSnap();
        sn["acked"] = ["b"];
        Core.applySnapshot(s, sn);
        Test.assertEqual(Core.waiting(s), 1);
        return true;
    }

    /* ---------- the link: offline, the outbox, the phone coming back (docs/GARMIN.md) ---------- */

    //! Today's routine as the phone sends it for a start with the phone away.
    function coreReady() {
        var sn = coreSnap();
        var es = sn["active"]["entries"];
        es[0]["sets"][0] = { "w" => 60, "r" => 8, "done" => false, "warmup" => false };
        sn["ready"] = { "today" => { "name" => "Push day", "routineIds" => ["r-push"], "entries" => es }, "others" => [] };
        sn["active"] = null;
        return sn;
    }

    //! What Link.send does with an event, without the radio.
    function corePut(s, ev) {
        Core.room(s, 60, 90);
        s["ob"].add(Core.pack(ev));
    }

    //! A whole workout with the phone away: started here, three sets, finished. Everything waits
    //! in the outbox in the order it happened, and goes only as the phone names it.
    (:test)
    function offlineWorkoutWaitsInOrder(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreReady());
        var st = Core.start(s, s["rd"]["today"]);
        corePut(s, st);
        var wid = st["wid"];
        Test.assertEqual(Core.entries(s).size(), 2);
        var a = Core.tick(s, 0, 0, null, 60.0, 8.0, null, [120, 130]);
        corePut(s, a);
        var b = Core.tick(s, 0, 1, null, 60.0, 7.0, null, null);
        corePut(s, b);
        var c = Core.tick(s, 1, 1, null, 30.0, 10.0, null, null);
        corePut(s, c);
        // a watch-only workout counts its own sets (no phone total yet)
        Test.assertEqual(Core.progress(s)[0], 3);
        var fin = Core.finish(s, false);
        corePut(s, fin);
        Test.assertEqual(s["ob"].size(), 5);
        Test.assertEqual(Core.waiting(s), 3);
        Test.assertEqual(Core.unsent(s), 5);
        var types = ["start", "setDone", "setDone", "setDone", "finish"];
        for (var i = 0; i < 5; i += 1) {
            Test.assert(Core.same(Core.evField(s["ob"][i], 1), types[i]));
            Test.assert(Core.same(Core.unpack(s["ob"][i])["wid"], wid));
        }
        // sets of a workout started here carry the routine's own places
        Test.assertEqual(c["entryIdx"], 1);
        Test.assertEqual(c["setIdx"], 1);
        // the first four went out (Link.flush) and the phone names three: the fourth stays as sent
        s["obn"] = 4;
        var sn = coreReady();
        sn["acked"] = [st["id"], a["id"], b["id"]];
        // the phone has the workout running by now: finished here, it does not come back
        sn["active"] = coreSnap()["active"];
        sn["active"]["id"] = wid;
        Test.assert(Core.applySnapshot(s, sn) == null);
        Test.assert(s["w"] == null);
        Test.assertEqual(s["ob"].size(), 2);
        Test.assertEqual(s["obn"], 1);
        Test.assert(Core.same(Core.evField(s["ob"][0], 0), c["id"]));
        // acked twice (the same list again), and ids the watch never had: nothing breaks
        Test.assert(Core.applySnapshot(s, sn) == null);
        Test.assertEqual(s["ob"].size(), 2);
        sn["acked"] = [c["id"], fin["id"], "nope"];
        sn["active"] = null;
        Core.applySnapshot(s, sn);
        Test.assertEqual(s["ob"].size(), 0);
        Test.assertEqual(s["obn"], 0);
        Test.assertEqual(Core.waiting(s), 0);
        return true;
    }

    //! The app closed mid-queue and came back: the state as stored (save keeps the outbox apart,
    //! and only it after a send), with a count of sent ones that no longer fits.
    (:test)
    function restartMidQueue(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var a = Core.tick(s, 0, 1, null, 60.0, 8.0, null, null);
        corePut(s, a);
        s["obn"] = 7;
        var back = Core.normalize(s);
        Test.assertEqual(back["obn"], 1);
        Test.assertEqual(Core.unsent(back), 0);
        // an older app's state without the newer keys, and nothing stored at all
        var old = { "w" => null, "ob" => [Core.pack(a)] };
        back = Core.normalize(old);
        Test.assertEqual(back["obn"], 0);
        Test.assertEqual(Core.unsent(back), 1);
        Test.assertEqual(Core.normalize(null)["ob"].size(), 0);
        // the tick itself is still pending after the restart: a stale snapshot does not undo it
        Core.applySnapshot(s, coreSnap());
        Test.assert(Core.isTrue(coreRow(s, 0, 1)["done"]));
        return true;
    }

    //! The outbox has an end. With sent ones the oldest of those goes at 60; with the phone away
    //! all along it grows to 90, then the oldest goes, a workout's start last.
    (:test)
    function outboxMakesRoom(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        corePut(s, { "id" => "st", "type" => "start", "wid" => "w", "at" => 1l });
        for (var i = 0; i < 59; i += 1) {
            corePut(s, { "id" => "e" + i, "type" => "setDone", "at" => 2l });
        }
        Test.assertEqual(s["ob"].size(), 60);
        // none sent: it grows on
        corePut(s, { "id" => "x", "type" => "setDone", "at" => 3l });
        Test.assertEqual(s["ob"].size(), 61);
        // some sent: the oldest sent one goes, the count of sent ones with it
        s["obn"] = 2;
        corePut(s, { "id" => "y", "type" => "setDone", "at" => 3l });
        Test.assertEqual(s["ob"].size(), 61);
        Test.assertEqual(s["obn"], 1);
        Test.assert(Core.same(Core.evField(s["ob"][0], 0), "e0"));
        // away all along, at the end: the oldest set goes, not the start in front of it
        s = Core.emptyState();
        corePut(s, { "id" => "st", "type" => "start", "wid" => "w", "at" => 1l });
        for (var j = 0; j < 100; j += 1) {
            corePut(s, { "id" => "e" + j, "type" => "setDone", "at" => 2l });
        }
        Test.assertEqual(s["ob"].size(), 90);
        Test.assert(Core.same(Core.evField(s["ob"][0], 0), "st"));
        Test.assert(Core.same(Core.evField(s["ob"][1], 0), "e11"));
        Test.assert(Core.same(Core.evField(s["ob"][89], 0), "e99"));
        return true;
    }

    //! A snapshot that comes while a set is being done here: the set on screen stays, a set
    //! ticked here and not yet named by the phone stays done, and the phone's other news lands.
    (:test)
    function snapshotDuringASet(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        s["pos"] = 1;
        var ev = Core.tick(s, 1, 0, null, 20.0, 10.0, null, null);
        var sn = coreSnap();
        sn["active"]["entries"][0]["sets"][1] = { "w" => 65, "r" => 5, "done" => true, "warmup" => false, "at" => 1761742950000l };
        sn["restSec"] = 75;
        Core.applySnapshot(s, sn);
        Test.assertEqual(s["pos"], 1);
        Test.assert(Core.isTrue(coreRow(s, 1, 0)["done"]));
        Test.assertEqual(Core.setIndex(s, 1), 1);
        Test.assertEqual(coreRow(s, 0, 1)["w"], 65);
        Test.assertEqual(s["rs"], 75.0);
        // the phone names the tick and shows the set with its own numbers (edited there): its copy wins
        sn = coreSnap();
        sn["acked"] = [ev["id"]];
        sn["active"]["entries"][1]["sets"][0] = { "w" => 22.5, "r" => 9, "done" => true, "warmup" => true, "at" => Core.nowMs() + 5000l };
        Core.applySnapshot(s, sn);
        Test.assertEqual(s["p"].size(), 0);
        Test.assertEqual(coreRow(s, 1, 0)["w"], 22.5);
        return true;
    }

    //! Ended on the phone while sets logged here are still on their way: the summary comes up,
    //! and the sets stay in the outbox (the phone writes them into the saved workout).
    (:test)
    function endedOnThePhoneKeepsTheOutbox(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        var ev = Core.tick(s, 0, 1, null, 60.0, 8.0, null, null);
        corePut(s, ev);
        var none = coreSnap();
        none["active"] = null;
        var sm = Core.applySnapshot(s, none);
        Test.assert(sm != null && Core.isTrue(sm["ended"]));
        Test.assertEqual(sm["sets"], 2);
        Test.assertEqual(s["ob"].size(), 1);
        Test.assertEqual(Core.waiting(s), 1);
        // discarded on the phone: gone without a summary, the outbox as it is
        s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        corePut(s, Core.tick(s, 0, 1, null, 60.0, 8.0, null, null));
        none["discarded"] = ["w-1"];
        Test.assert(Core.applySnapshot(s, none) == null);
        Test.assert(s["w"] == null);
        Test.assertEqual(s["ob"].size(), 1);
        return true;
    }

    //! "Waiting to sync" counts sets: one fixed or rated after its tick is still one set.
    (:test, :fixui)
    function waitingCountsASetOnce(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        corePut(s, Core.tick(s, 0, 1, null, 60.0, 8.0, null, null));
        Test.assertEqual(Core.waiting(s), 1);
        // rated during the rest, then its reps fixed: two more events, the same set
        corePut(s, Core.fix(s, 0, 1, null, 60.0, 8.0, null, ["rir", 2]));
        corePut(s, Core.fix(s, 0, 1, null, 60.0, 7.0, null, null));
        Test.assertEqual(s["ob"].size(), 3);
        Test.assertEqual(Core.waiting(s), 1);
        // another set counts
        corePut(s, Core.tick(s, 1, 0, null, 20.0, 10.0, null, null));
        Test.assertEqual(Core.waiting(s), 2);
        // the phone names the first tick only: the set is still on its way (its fix is)
        var sn = coreSnap();
        sn["acked"] = [Core.evField(s["ob"][0], 0)];
        Core.applySnapshot(s, sn);
        Test.assertEqual(s["ob"].size(), 3);
        Test.assertEqual(Core.waiting(s), 2);
        return true;
    }

    //! A bridge that hands a JSON true over as the number 1 (and false as 0) reads the same.
    (:test)
    function yesAndNoAsNumbers(logger as Test.Logger) as Boolean {
        Test.assert(Core.isTrue(true) && Core.isTrue(1) && !Core.isTrue(false) && !Core.isTrue(0) && !Core.isTrue(null) && !Core.isTrue(2) && !Core.isTrue("1"));
        Test.assert(Core.isOff(false) && Core.isOff(0) && !Core.isOff(true) && !Core.isOff(1) && !Core.isOff(null));
        var sn = coreSnap();
        sn["active"]["entries"][0]["sets"][0]["done"] = 1;
        sn["active"]["entries"][0]["sets"][1]["done"] = 0;
        sn["active"]["entries"][1]["sets"][0]["warmup"] = 1;
        var s = Core.emptyState();
        Core.applySnapshot(s, sn);
        Test.assertEqual(Core.setIndex(s, 0), 1);
        Test.assertEqual(Core.progress(s)[0], 1);
        Test.assertEqual(Core.place(Core.entryAt(s, 1), 0)[1], 1);
        return true;
    }

    //! "Still training?" after 20 minutes without a set (or the phone's minutes); "Keep going"
    //! waits as long again.
    (:test, :big)
    function asksAfterTwentyMinutes(logger as Test.Logger) as Boolean {
        var now = 10000000l;
        Test.assert(!Core.asks(now - 60000l, null, now, null));
        Test.assert(Core.asks(now - 1200000l, null, now, null));
        Test.assert(!Core.asks(now - 3000000l, now - 60000l, now, null));
        Test.assert(!Core.asks(null, null, now, null));
        // the phone's forgotten-workout minutes: 30, or 0 (never by time)
        Test.assert(!Core.asks(now - 1200000l, null, now, 30));
        Test.assert(Core.asks(now - 1800000l, null, now, 30));
        Test.assert(!Core.asks(now - 9000000l, null, now, 0));
        var w = coreSnap()["active"];
        Test.assertEqual(Core.lastSet(w), 1761742900000l);
        w["activeAt"] = 1761742950000l;
        Test.assertEqual(Core.lastSet(w), 1761742950000l);
        return true;
    }

    //! The superset partner is named on the set page.
    (:test)
    function partnersAreNamed(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var sn = coreSnap();
        sn["active"]["entries"][0]["group"] = "g";
        sn["active"]["entries"][1]["group"] = "g";
        Core.applySnapshot(s, sn);
        var p = Core.partners(s, 0);
        Test.assertEqual(p.size(), 1);
        Test.assert(Core.same(p[0], "3/4 Sit-Up"));
        Test.assertEqual(Core.partners(Core.emptyState(), 0).size(), 0);
        return true;
    }

    //! "#30d158" from the phone, as the screen has it; nonsense is no colour.
    (:test)
    function accentFromThePhone(logger as Test.Logger) as Boolean {
        Test.assertEqual(Ui.hex("#30d158"), 0x30D158);
        Test.assertEqual(Ui.hex("#FFAA00"), 0xFFAA00);
        Test.assert(Ui.hex("green") == null);
        Test.assert(Ui.hex("#12345") == null);
        Test.assert(Ui.hex(null) == null);
        Test.assert(Ui.light(0x30D158));
        Test.assert(Ui.light(0xA3E635));
        Test.assert(Ui.light(0xAAFF55));
        Test.assert(!Ui.light(0x0A3D91));
        return true;
    }
    /* ---------- protocol 2 (docs/WATCH_SYNC.md): the clocks, one rest, set ids ---------- */

    //! The snapshot as a protocol 2 phone sends it: the phone's clock, the sets' ids, the rest's stamp.
    function coreSnap2(phoneNow, restAt) {
        var sn = coreSnap();
        sn["now"] = phoneNow;
        var es = sn["active"]["entries"];
        for (var i = 0; i < es.size(); i += 1) {
            for (var j = 0; j < es[i]["sets"].size(); j += 1) { es[i]["sets"][j]["sid"] = "s" + i + j; }
        }
        if (restAt != null) { sn["active"]["restAt"] = restAt; }
        return sn;
    }

    //! The watch's clock against the phone's: the smallest gap of the last five minutes (the link
    //! only adds delay), else the newest; none is 0. The clock itself has milliseconds.
    (:test)
    function clockOffsetFromSnapshots(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Test.assertEqual(Core.off(s), 0l);
        var now = Core.nowMs();
        Core.noteClock(s, now - 3000l);
        Core.noteClock(s, now - 9000l);
        var o = Core.off(s);
        Test.assert(o >= 3000l && o < 3500l);
        // a watch behind the phone
        s["ck"] = [[now, -90000l]];
        Test.assertEqual(Core.off(s), -90000l);
        // older than five minutes: only when nothing newer is there
        s["ck"] = [[now - 400000l, 100l], [now - 1000l, 4000l]];
        Test.assertEqual(Core.off(s), 4000l);
        s["ck"] = [[now - 900000l, 100l], [now - 400000l, 4000l]];
        Test.assertEqual(Core.off(s), 4000l);
        // the newest 8 are kept
        for (var i = 0; i < 12; i += 1) { Core.noteClock(s, now); }
        Test.assertEqual(s["ck"].size(), 8);
        Core.noteClock(s, null);
        Test.assertEqual(s["ck"].size(), 8);
        // two calls in one go are never apart by more than a few ms, and never go back
        var a = Core.nowMs();
        var b = Core.nowMs();
        Test.assert(b >= a && b - a < 50l);
        return true;
    }

    //! A set done here names its row by id and says how far off the watch is; the rest it starts
    //! ends where the tick says (restEnd), and is the rest's stamp here, on the phone's clock.
    (:test)
    function tickCarriesRestEndSidAndOff(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap2(Core.nowMs() - 5000l, null));
        var o = Core.off(s);
        var ev = Core.tick(s, 0, 1, null, 62.5, 7.0, null, null);
        Test.assert(Core.same(ev["sid"], "s01"));
        Test.assertEqual(ev["off"], o);
        Test.assert(s["p"].hasKey("s:s01"));
        // the set keeps the tick's time as the phone will: on its clock
        Test.assertEqual(coreRow(s, 0, 1)["at"], ev["at"] - o);
        var end = Core.tickRest(s, ev, 90.0);
        Test.assertEqual(end, ev["at"] + 90000l);
        Test.assertEqual(ev["restEnd"], end);
        Test.assertEqual(s["rest"], end);
        Test.assertEqual(s["ra"], ev["at"] - o);
        // no rest (the last set, a side to go): restEnd 0, and none runs here
        var ev2 = Core.tick(s, 1, 1, null, 30.0, 10.0, null, null);
        Test.assert(Core.tickRest(s, ev2, null) == null);
        Test.assertEqual(ev2["restEnd"], 0l);
        Test.assert(s["rest"] == null);
        // both go through the outbox as they are: restEnd 0 is kept, a Skip's endsAt is none
        var back = Core.unpack(Core.pack(ev2));
        Test.assertEqual(back["restEnd"], 0l);
        Test.assert(Core.same(back["sid"], "s11"));
        var sk = Core.unpack(Core.pack(Core.restEvent(s, null)));
        Test.assert(Core.same(sk["type"], "rest") && !sk.hasKey("endsAt") && Core.same(sk["wid"], "w-1"));
        return true;
    }

    //! The phone's rest is followed by its stamp: a newer change runs here (its end on this
    //! watch's clock), holds while paused there, or ends as a Skip here (rx); the same stamp or an
    //! older one changes nothing, whatever its end says.
    (:test)
    function followsThePhonesRestByItsStamp(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var now = Core.nowMs();
        // a watch 2 s ahead of the phone
        var sn = coreSnap2(now - 2000l, 1000l);
        sn["active"]["rest"] = { "endsAt" => now + 60000l, "total" => 90 };
        Core.applySnapshot(s, sn);
        var o = Core.off(s);
        Test.assertEqual(s["rest"], now + 60000l + o);
        Test.assertEqual(s["ra"], 1000l);
        // +15 here, then a snapshot with the same stamp and the old end: the +15 stands
        s["rest"] = now + 75000l + o;
        var same = coreSnap2(now - 2000l, 1000l);
        same["active"]["rest"] = { "endsAt" => now + 60000l };
        Core.applySnapshot(s, same);
        Test.assertEqual(s["rest"], now + 75000l + o);
        // an end within 250 ms of ours does not restart it
        var close = coreSnap2(now - 2000l, 1500l);
        close["active"]["rest"] = { "endsAt" => now + 75100l };
        Core.applySnapshot(s, close);
        Test.assertEqual(s["rest"], now + 75000l + o);
        Test.assertEqual(s["ra"], 1500l);
        // paused on the phone: it holds here
        var paused = coreSnap2(now - 2000l, 2000l);
        paused["active"]["restPaused"] = true;
        paused["active"]["restLeft"] = 42;
        Core.applySnapshot(s, paused);
        Test.assert(s["rest"] == null);
        Test.assertEqual(s["rh"], 42);
        Test.assert(!Core.rx);
        // resumed there
        var resumed = coreSnap2(now - 2000l, 3000l);
        resumed["active"]["rest"] = { "endsAt" => now + 42000l };
        Core.applySnapshot(s, resumed);
        Test.assert(s["rh"] == null);
        Test.assertEqual(s["rest"], now + 42000l + o);
        // skipped there: ended here as a Skip, once
        var skipped = coreSnap2(now - 2000l, 4000l);
        Core.applySnapshot(s, skipped);
        Test.assert(s["rest"] == null);
        Test.assert(Core.rx);
        Core.applySnapshot(s, coreSnap2(now - 2000l, 4000l));
        Test.assert(!Core.rx);
        // an older stamp (a late snapshot) brings nothing back
        var late = coreSnap2(now - 2000l, 3000l);
        late["active"]["rest"] = { "endsAt" => now + 42000l };
        Core.applySnapshot(s, late);
        Test.assert(s["rest"] == null);
        // an end that has passed already: no rest, and no buzz for one that is over
        var over = coreSnap2(now - 2000l, 5000l);
        over["active"]["rest"] = { "endsAt" => now - 10000l };
        Core.applySnapshot(s, over);
        Test.assert(s["rest"] == null);
        // another workout: the stamp starts over, its rest is followed
        var other = coreSnap2(now - 2000l, 10l);
        other["active"]["id"] = "w-2";
        other["active"]["rest"] = { "endsAt" => now + 30000l };
        Core.applySnapshot(s, other);
        Test.assertEqual(s["ra"], 10l);
        // (the oldest clock samples have gone by now: the offset is a few ms more)
        var d = s["rest"] - (now + 30000l + o);
        Test.assert(d >= 0 && d < 100);
        return true;
    }

    //! A set done here, then the phone's snapshot of it (the stamp the tick gave): the watch's rest
    //! stands, +15 pressed since too. +15 here is a newer stamp the phone's late snapshot can't beat.
    (:test)
    function ownRestIsNotFollowedBack(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var now = Core.nowMs();
        Core.applySnapshot(s, coreSnap2(now - 1000l, null));
        var o = Core.off(s);
        var ev = Core.tick(s, 0, 1, null, 62.5, 7.0, null, null);
        var end = Core.tickRest(s, ev, 120.0);
        // the phone stamps the tick's rest with the tick's time, on its clock
        var back = coreSnap2(now - 1000l, ev["at"] - o);
        back["acked"] = [ev["id"]];
        back["active"]["rest"] = { "endsAt" => end - o + 900l };
        Core.applySnapshot(s, back);
        Test.assertEqual(s["rest"], end);
        var plus = Core.restEvent(s, end + 15000l);
        s["rest"] = end + 15000l;
        Test.assert(plus["at"] - o == s["ra"]);
        Test.assert(s["ra"] > ev["at"] - o);
        Core.applySnapshot(s, back);
        Test.assertEqual(s["rest"], end + 15000l);
        // two presses within one second are two changes, the second after the first
        var again = Core.restEvent(s, end + 30000l);
        Test.assert(again["at"] > plus["at"]);
        return true;
    }

    //! A fix of a done set is later than the set's own time on the phone (its `at` plus the
    //! watch's offset), and carries no restEnd.
    (:test, :fixui)
    function fixIsLaterOnThePhonesClock(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var now = Core.nowMs();
        var sn = coreSnap2(now - 600000l, null);
        // the phone stamped set 1 a moment ago (its clock, ten minutes behind this watch)
        sn["active"]["entries"][0]["sets"][0]["at"] = now - 600000l + 5000l;
        Core.applySnapshot(s, sn);
        var ev = Core.fix(s, 0, 0, null, 60.0, 9.0, null, null);
        Test.assert(ev["at"] - Core.off(s) > now - 600000l + 5000l);
        Test.assert(!ev.hasKey("restEnd"));
        return true;
    }

    //! Pending ticks are kept by the set's id; a tick made before the phone gave ids moves to its
    //! id; one exercise twice in a workout does not share marks (#1162).
    (:test)
    function pendingTicksBySetId(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap());
        Core.tick(s, 0, 1, null, 62.5, 7.0, null, null);
        Test.assert(s["p"].hasKey("e0:0025#1"));
        var sn = coreSnap2(Core.nowMs(), null);
        Core.applySnapshot(s, sn);
        Test.assert(s["p"].hasKey("s:s01") && !s["p"].hasKey("e0:0025#1"));
        Test.assert(Core.isTrue(coreRow(s, 0, 1)["done"]));
        Test.assertEqual(coreRow(s, 0, 1)["w"], 62.5);
        // done on the phone at the tick's time or later: let go of
        var conf = coreSnap2(Core.nowMs(), null);
        conf["active"]["entries"][0]["sets"][1]["done"] = true;
        conf["active"]["entries"][0]["sets"][1]["at"] = s["p"]["s:s01"][2];
        Core.applySnapshot(s, conf);
        Test.assertEqual(s["p"].size(), 0);
        // the same exercise twice: a tick on the first is not the second's
        var two = coreSnap2(Core.nowMs(), null);
        var es = two["active"]["entries"];
        es[1] = { "id" => "0025", "name" => "Barbell Bench Press", "mode" => "reps", "i" => 1,
            "sets" => [{ "w" => 60, "r" => 8, "done" => false, "sid" => "t0" }, { "w" => 60, "r" => 8, "done" => false, "sid" => "t1" }] };
        var s2 = Core.emptyState();
        Core.applySnapshot(s2, two);
        Core.tick(s2, 0, 1, null, 60.0, 8.0, null, null);
        var again = coreSnap2(Core.nowMs(), null);
        again["active"]["entries"][1] = { "id" => "0025", "name" => "Barbell Bench Press", "mode" => "reps", "i" => 1,
            "sets" => [{ "w" => 60, "r" => 8, "done" => false, "sid" => "t0" }, { "w" => 60, "r" => 8, "done" => false, "sid" => "t1" }] };
        Core.applySnapshot(s2, again);
        Test.assert(Core.isTrue(coreRow(s2, 0, 1)["done"]));
        Test.assert(!Core.isTrue(coreRow(s2, 1, 1)["done"]));
        return true;
    }

    //! A set the phone ticked is told to the app (ptick), so the watch moves on as its own Done
    //! would, on whichever exercise; a set ticked here and confirmed is no phone tick.
    (:test)
    function phoneTickMovesTheWatchOn(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap2(Core.nowMs(), null));
        Test.assert(Core.ptick == null);
        // the phone ticks the sit-up's warm-up while the watch shows the bench press
        var sn = coreSnap2(Core.nowMs(), null);
        sn["active"]["entries"][1]["sets"][0]["done"] = true;
        sn["active"]["entries"][1]["sets"][0]["at"] = 1761743000000l;
        Core.applySnapshot(s, sn);
        Test.assertEqual(Core.ptick[0], 1);
        Test.assertEqual(Core.ptick[1], 0);
        Test.assertEqual(Core.followTick(s, 1, 0), 1);
        // the same snapshot again: nothing new
        var sn2 = coreSnap2(Core.nowMs(), null);
        sn2["active"]["entries"][1]["sets"][0]["done"] = true;
        Core.applySnapshot(s, sn2);
        Test.assert(Core.ptick == null);
        // the phone's last set of the bench press: on to the next with something to do
        s["pos"] = 0;
        coreRow(s, 0, 1)["done"] = true;
        Test.assertEqual(Core.followTick(s, 0, 1), 1);
        // a tick here, confirmed: no phone tick
        var s2 = Core.emptyState();
        Core.applySnapshot(s2, coreSnap2(Core.nowMs(), null));
        var ev = Core.tick(s2, 0, 1, null, 60.0, 8.0, null, null);
        var conf = coreSnap2(Core.nowMs(), null);
        conf["acked"] = [ev["id"]];
        conf["active"]["entries"][0]["sets"][1]["done"] = true;
        conf["active"]["entries"][0]["sets"][1]["at"] = s2["p"]["s:s01"][2];
        Core.applySnapshot(s2, conf);
        Test.assert(Core.ptick == null);
        return true;
    }

    //! A workout logged here with the phone away drains a few sets at a time: a window that does
    //! not have the exercise on screen yet is the phone behind, and the watch stays where it is.
    //! Once every set is in, the phone moving to another exercise moves the watch (#1066).
    (:test)
    function drainingDoesNotJumpBack(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap2(Core.nowMs(), null));
        s["pos"] = 1;
        corePut(s, Core.tick(s, 1, 0, null, 20.0, 10.0, null, null));
        // the phone has applied none of it yet, and its window is the bench press and another one
        var behind = coreSnap2(Core.nowMs(), null);
        behind["active"]["entries"][1] = { "id" => "0099", "name" => "Row", "mode" => "reps", "i" => 2, "sets" => [{ "w" => 50, "r" => 8, "done" => false, "sid" => "r0" }] };
        behind["active"]["count"] = 3;
        Core.applySnapshot(s, behind);
        Test.assertEqual(s["pos"], 1);
        Test.assert(Core.same(Core.entryAt(s, 1)["id"], "0001"));
        Test.assert(Core.isTrue(coreRow(s, 1, 0)["done"]));
        // everything in, the phone at the sit-up: there
        var caught = coreSnap2(Core.nowMs(), null);
        caught["acked"] = [Core.evField(s["ob"][0], 0)];
        caught["active"]["entries"][1]["sets"][0]["done"] = true;
        caught["active"]["entries"][1]["sets"][0]["at"] = 1761743000000l;
        Core.applySnapshot(s, caught);
        Test.assertEqual(Core.waiting(s), 0);
        Test.assertEqual(s["pos"], 1);
        // the phone moves back to the bench press (its own pick): the watch goes along
        var moved = coreSnap2(Core.nowMs(), null);
        moved["active"]["cur"] = 1;
        Core.applySnapshot(s, moved);
        var back = coreSnap2(Core.nowMs(), null);
        back["active"]["cur"] = 0;
        Core.applySnapshot(s, back);
        Test.assertEqual(s["pos"], 0);
        // with a set of its own still on the way it stays
        s["pos"] = 1;
        corePut(s, Core.tick(s, 1, 1, null, 30.0, 10.0, null, null));
        var mv = coreSnap2(Core.nowMs(), null);
        mv["active"]["cur"] = 1;
        Core.applySnapshot(s, mv);
        Test.assertEqual(s["pos"], 1);
        return true;
    }

    //! The rest's end counts a hold in by itself only where there is a hold timer: elsewhere it
    //! would log a set nobody did.
    (:test)
    function autoHoldOnlyWithATimer(logger as Test.Logger) as Boolean {
        var s = Core.emptyState();
        var sn = coreSnap();
        sn["active"]["entries"][0]["mode"] = "time";
        sn["settings"]["autoHolds"] = true;
        Core.applySnapshot(s, sn);
        Test.assert(Core.autoHold(s, true));
        Test.assert(!Core.autoHold(s, false));
        s["set"]["autoHolds"] = false;
        Test.assert(!Core.autoHold(s, true));
        return true;
    }
    /* ---------- the rest on the watch (App.mc Rest), without screens or buzzes ---------- */

    //! A rest as the app runs it, with nothing drawn (a menu "on top") and no buzz.
    function restState() {
        var s = Core.emptyState();
        Core.applySnapshot(s, coreSnap2(Core.nowMs(), null));
        s["set"] = { "restHaptics" => false };
        return s;
    }

    //! A rest the watch took from the phone after one of its own had run out ends here as well:
    //! the end's flag was the old rest's, so it never ended (nor buzzed) before.
    (:test)
    function aRestFromThePhoneRunsOutToo(logger as Test.Logger) as Boolean {
        var keep = G.state;
        var ov = Nav.overlay;
        G.state = restState();
        Nav.overlay = true;
        var end = Core.nowMs() - 1l;
        G.state["rest"] = end;
        Rest.begin(end, 60);
        Rest.tick();
        var first = G.state["rest"] == null;
        // the phone's rest (a snapshot set it), over by now
        G.state["rest"] = Core.nowMs() - 1l;
        Rest.tick();
        var second = G.state["rest"] == null;
        // and nothing went to the phone: a rest running out is no change
        var sent = G.state["ob"].size();
        G.state = keep;
        Nav.overlay = ov;
        Test.assert(first);
        Test.assert(second);
        Test.assertEqual(sent, 0);
        return true;
    }

    //! +15, -15 and Skip pressed here go to the phone as `rest` events; a rest ended on the phone
    //! (rx) or one that runs out sends nothing back.
    (:test)
    function onlyTheLiftersRestChangesAreSent(logger as Test.Logger) as Boolean {
        var keep = G.state;
        var ov = Nav.overlay;
        G.state = restState();
        Nav.overlay = true;
        var end = Core.nowMs() + 60000l;
        G.state["rest"] = end;
        Rest.begin(end, 60);
        Rest.add(15);
        Rest.add(-15);
        var plus = Core.unpack(G.state["ob"][0]);
        var minus = Core.unpack(G.state["ob"][1]);
        var two = G.state["ob"].size();
        Rest.skip();
        var skip = Core.unpack(G.state["ob"][2]);
        var three = G.state["ob"].size();
        // the phone skips the next one (Core.followRest has ended it and says so: rx)
        G.state["rest"] = null;
        Core.rx = true;
        Rest.followed(null);
        var after = G.state["ob"].size();
        // Skip with no rest running: nothing to tell
        Rest.skip();
        var none = G.state["ob"].size();
        G.state = keep;
        Nav.overlay = ov;
        Test.assertEqual(two, 2);
        Test.assert(Core.same(plus["type"], "rest") && plus["endsAt"] == end + 15000l);
        Test.assert(minus["endsAt"] == end);
        Test.assert(minus["at"] > plus["at"]);
        Test.assertEqual(three, 3);
        Test.assert(Core.same(skip["type"], "rest") && !skip.hasKey("endsAt"));
        Test.assertEqual(after, 3);
        Test.assertEqual(none, 3);
        return true;
    }
}
