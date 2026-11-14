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
}
