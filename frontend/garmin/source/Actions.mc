// What the buttons do: each changes the state through Core.mc, sends the phone its event, and
// lets Nav put up the screen that goes with the new state.
import Toybox.Lang;
import Toybox.Sensor;
import Toybox.System;
import Toybox.WatchUi;

module Actions {

    //! Start on the start screen: the 3-2-1 first (the heart-rate sensor warms up meanwhile), then
    //! the routine starts here. START or a tap on it starts at once, BACK cancels.
    function start(session) {
        if (G.locked()) {
            return;
        }
        G.cd = [System.getTimer(), session];
        if (Sensor has :setEnabledSensors) {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        }
        Motion.run();
        G.changed();
    }

    function startNow() {
        var c = G.cd;
        if (c == null) {
            return;
        }
        G.cd = null;
        Motion.stop();
        var ev = Core.start(G.state, c[1]);
        G.ended = null;
        reset();
        Link.send(ev);
        Workout.begin();
        G.changed();
    }

    function cancelStart() {
        G.cd = null;
        Motion.stop();
        G.changed();
    }

    //! Nothing of the last workout's screens stays: the page, a fix, a hold, "All done?".
    function reset() {
        G.page = :set; G.fix = null; G.hold = null; G.hcd = null; G.last = null; G.rated = null;
        G.ask = false; G.snooze = null;
    }

    //! A workout ended (here or on the phone): its summary comes up, Done waits a second.
    function ended(sm) {
        reset();
        G.ended = sm;
        G.endedAt = System.getTimer();
    }

    //! A set done: logged with its heart rate, a lap in Garmin Connect, a short buzz, then the
    //! rest (the exercise's, else the workout's, else the phone's default) or the next set. After
    //! the last set the Overview comes up by itself (its Finish is next).
    function tick(pos, si, side, w, r, sec, restSec) {
        var s = G.state;
        var e = Core.entryAt(s, pos);
        var ev = Core.tick(s, pos, si, side, w, r, sec, Workout.hrForSet());
        if (ev == null) {
            return;
        }
        G.last = [e["id"], si, side];
        G.rated = null;
        G.ask = false;
        G.lock = System.getTimer() + 1000;
        Link.send(ev);
        Workout.lap();
        Rest.buzz([[40, 60]]);
        var nx = Core.next(s, pos, si);
        s["pos"] = nx[0];
        var atEnd = nx[0] >= Core.entries(s).size();
        if (nx[1] && (!atEnd || Core.hasMore(s))) {
            var wk = Core.dictOf(s["w"]);
            var rs = restSec;
            if (rs == null || rs <= 0) {
                rs = wk == null ? null : Core.toF(wk["restSec"]);
            }
            if (rs == null || rs <= 0) {
                rs = Core.toF(s["rs"]);
            }
            if (rs != null && rs > 0) {
                Rest.start(rs);
            }
        }
        if (atEnd && !Core.hasMore(s)) {
            G.page = :over;
        }
        G.changed();
    }

    //! The set on screen passed over.
    function skipSet() {
        var s = G.state;
        var pos = s["pos"];
        var si = Core.setIndex(s, pos);
        if (si == null) {
            nextExercise();
            return;
        }
        G.hold = null; G.hcd = null;
        Core.skip(s, pos, si);
        s["pos"] = Core.next(s, pos, si)[0];
        if (s["pos"] >= Core.entries(s).size() && !Core.hasMore(s)) {
            G.page = :over;
        }
        G.changed();
    }

    //! On to the next exercise with a set to do (after the last: the end page).
    function nextExercise() {
        var s = G.state;
        var count = Core.entries(s).size();
        var pos = s["pos"];
        var to = count;
        for (var k = pos + 1; k < count; k += 1) {
            if (Core.setIndex(s, k) != null) {
                to = k;
                break;
            }
        }
        s["pos"] = to;
        G.hold = null; G.hcd = null;
        Rest.stop();
        G.changed();
    }

    //! Finished here (the phone's own Finish and save runs), or discarded (dropped unsaved). A
    //! hold running is logged first with the seconds held.
    function finish(discard) {
        var s = G.state;
        var w = Core.dictOf(s["w"]);
        if (w == null) {
            return;
        }
        if (!discard && G.hold != null) {
            holdStop();
        }
        var sm = discard ? null : Core.summary(s, w, false);
        Link.send(Core.finish(s, discard));
        Workout.end(!discard);
        var hr = Workout.hrTotals();
        if (sm != null) {
            sm["hr"] = hr;
        }
        ended(sm);
        G.changed();
    }

    /* ---------- holds ---------- */

    //! The hold's 3-2-1 (START on a timed set), then the hold itself.
    function holdCount() {
        G.hcd = System.getTimer();
        G.hold = null;
        Motion.run();
        WatchUi.requestUpdate();
    }

    //! The hold runs: from the seconds on the set (the set page's number), done by itself at zero.
    function holdStart() {
        G.hcd = null;
        Motion.stop();
        var sec = Ed.target();
        G.hold = [System.getTimer(), sec == null || sec < 1 ? 30 : sec];
        Workout.newSet();
        WatchUi.requestUpdate();
    }

    function holdCancel() {
        G.hcd = null;
        G.hold = null;
        Motion.stop();
        WatchUi.requestUpdate();
    }

    //! Seconds held so far.
    function held() {
        return G.hold == null ? 0 : (System.getTimer() - G.hold[0]) / 1000;
    }

    //! Stop (or Finish mid-hold): the set logged with the seconds held.
    function holdStop() {
        var h = G.hold;
        if (h == null) {
            return;
        }
        var sec = held();
        G.hold = null;
        logHold(sec < 1 ? 1 : (sec > h[1] ? h[1] : sec));
    }

    function logHold(sec) {
        var s = G.state;
        var pos = s["pos"];
        var e = Core.entryAt(s, pos);
        var si = Core.setIndex(s, pos);
        if (e == null || si == null) {
            return;
        }
        var row = Core.dictOf(Core.arrOf(e["sets"])[si]);
        var w = Core.toF(row["w"]);
        tick(pos, si, Core.sideUp(row), w != null && w > 0 ? w : null, null, sec.toFloat(), Core.toF(e["restSec"]));
    }

    //! Once a second: a click for each of the last three seconds, the set logged at zero.
    function holdTick() {
        var h = G.hold;
        if (h == null) {
            return;
        }
        var left = h[1] - held();
        if (left <= 0) {
            G.hold = null;
            Rest.buzz([[100, 400], [0, 200], [100, 400]]);
            logHold(h[1]);
        } else if (left <= 3) {
            Rest.buzz([[30, 40]]);
        }
    }

    /* ---------- fixing a logged set, the effort ---------- */

    //! ‹: the done set before the one on screen (or before the one being fixed), › the one after;
    //! past the newest, back to the set up now.
    function fixStep(by) {
        var s = G.state;
        var from = null;
        if (G.fix != null) {
            var p = Core.posOf(s, G.fix[0]);
            from = p == null ? null : [p, G.fix[1], G.fix[2]];
        }
        var to = Core.fixStep(s, from, by);
        if (to == null && from == null && by < 0) {
            return;
        }
        G.fix = to == null ? null : [Core.entryAt(s, to[0])["id"], to[1], to[2]];
        Ed.key = null;
        WatchUi.requestUpdate();
    }

    //! ‹ on the rest (or "Previous set"): the set just done, while the rest runs on.
    function fixLast() {
        if (G.last != null && Core.posOf(G.state, G.last[0]) != null) {
            G.fix = G.last;
            Ed.key = null;
            WatchUi.requestUpdate();
        } else {
            fixStep(-1);
        }
    }

    //! Save on a set being fixed: the phone gets it as that set done again (Core.fix).
    function saveFix(w, r) {
        var f = G.fix;
        var s = G.state;
        var pos = f == null ? null : Core.posOf(s, f[0]);
        G.fix = null;
        if (pos != null) {
            var timed = Core.isTimed(Core.entryAt(s, pos));
            Link.send(Core.fix(s, pos, f[1], f[2], w, timed ? null : r, timed ? r : null, null));
            Rest.buzz([[40, 60]]);
        }
        G.changed();
    }

    //! A chip during the rest: the set just done gets this effort (its setDone again, as logged).
    function rate(v) {
        var s = G.state;
        var st = Core.dictOf(s["set"]);
        var kind = st == null ? null : st["effort"];
        var l = G.last;
        var pos = l == null ? null : Core.posOf(s, l[0]);
        if (kind == null || pos == null || G.locked()) {
            return;
        }
        var n = Core.logged(s, pos, l[1], l[2]);
        if (n == null) {
            return;
        }
        Link.send(Core.fix(s, pos, l[1], l[2], n[0], n[1], n[2], [kind, v]));
        G.rated = v;
        Rest.buzz([[40, 60]]);
        G.changed();
    }

    //! Whether the rest offers the effort: the profile rates it and the set just done is a work set.
    function canRate() {
        var s = G.state;
        var st = Core.dictOf(s["set"]);
        var l = G.last;
        var pos = l == null ? null : Core.posOf(s, l[0]);
        if (st == null || !(st["effort"] instanceof Lang.String) || pos == null) {
            return false;
        }
        var e = Core.entryAt(s, pos);
        var row = Core.dictOf(Core.arrOf(e["sets"])[l[1]]);
        return !Core.isCardio(e) && row != null && !Core.isTrue(row["warmup"]);
    }

    /* ---------- a workout left running ---------- */

    var askN = 0;

    //! Every 10 s: "All done?" once 20 minutes passed without a set; gone again when a set comes.
    function askTick() {
        askN += 1;
        var w = Core.dictOf(G.state["w"]);
        if (w == null || askN % 10 != 0 || G.hold != null) {
            return;
        }
        var asks = Core.asks(Core.lastSet(w), G.snooze, Core.nowMs());
        if (asks && !G.ask) {
            G.ask = true;
            G.page = :set;
            Rest.buzz([[60, 300]]);
        } else if (!asks && G.ask) {
            G.ask = false;
        }
    }

    //! "Continue" on "All done?": asked again after another 20 minutes without a set.
    function keepGoing() {
        G.ask = false;
        G.snooze = Core.nowMs();
        WatchUi.requestUpdate();
    }
}

module Menus {
    function routines() {
        var rd = Core.dictOf(G.state["rd"]);
        var menu = new WatchUi.Menu2({ :title => Ui.t(Rez.Strings.routines) });
        var n = 0;
        if (rd != null) {
            var today = Core.dictOf(rd["today"]);
            if (today != null) {
                menu.addItem(new WatchUi.MenuItem(Core.strOf(today["name"]), Ui.t(Rez.Strings.today), -1, null));
                n += 1;
            }
            var others = Core.arrOf(rd["others"]);
            for (var i = 0; i < others.size(); i += 1) {
                var o = Core.dictOf(others[i]);
                if (o != null) {
                    menu.addItem(new WatchUi.MenuItem(Core.strOf(o["name"]), null, i, null));
                    n += 1;
                }
            }
        }
        if (n == 0) {
            return;
        }
        Nav.push(menu, new RoutineMenuDelegate());
    }

    //! MENU (UP held, or a long touch): what the screen up now can do. On watches without touch
    //! it is also the way to the Overview and Metrics pages and to ‹ (Previous set).
    function workout() {
        var s = G.state;
        var menu = new WatchUi.Menu2({ :title => Ui.t(Rez.Strings.workout) });
        if (G.fix != null) {
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.save), null, :save, null));
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.previous_set), null, :prev, null));
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.next_set_btn), null, :nextFix, null));
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.cancel), null, :cancel, null));
            Nav.push(menu, new WorkoutMenuDelegate());
            return;
        }
        var resting = Rest.left() != null && Rest.left() > 0;
        if (resting && Actions.canRate()) {
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.how_hard), null, :effort, null));
        }
        if (Core.fixList(s).size() > 0) {
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.previous_set), null, :prev, null));
        }
        if (G.page != :over) {
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.overview), null, :over, null));
        }
        if (G.page != :met) {
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.metrics), null, :met, null));
        }
        if (Core.entries(s).size() > 0) {
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.skip_set), null, :skip, null));
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.next_exercise), null, :next, null));
        }
        menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.finish_and_save), null, :finish, null));
        menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.discard_workout), null, :discard, null));
        menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.continue_workout), null, :back, null));
        Nav.push(menu, new WorkoutMenuDelegate());
    }

    //! "How hard was that set?": RIR 0 / 1 / 2 / 3+ (or RPE 10 / 9 / 8 / <8, by the phone's profile).
    function effort() {
        var st = Core.dictOf(G.state["set"]);
        var kind = st == null ? "rir" : st["effort"];
        var menu = new WatchUi.Menu2({ :title => Ui.t(Rez.Strings.effort) });
        var cs = Core.chips(kind);
        var hd = Core.same(kind, "rpe") ? "RPE " : "RIR ";
        for (var i = 0; i < cs.size(); i += 1) {
            menu.addItem(new WatchUi.MenuItem(hd + Core.chipLabel(kind, cs[i]), null, cs[i], null));
        }
        Nav.push(menu, new EffortMenuDelegate());
    }

    function confirmFinish() {
        Nav.push(new WatchUi.Confirmation(Ui.t(Rez.Strings.finish_workout_q)), new ConfirmDelegate(false));
    }

    function confirmDiscard() {
        Nav.push(new WatchUi.Confirmation(Ui.t(Rez.Strings.discard_q)), new ConfirmDelegate(true));
    }
}

class RoutineMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId() as Number;
        var rd = Core.dictOf(G.state["rd"]);
        var session = null;
        if (rd != null) {
            if (id == -1) {
                session = Core.dictOf(rd["today"]);
            } else {
                var others = Core.arrOf(rd["others"]);
                session = (id >= 0 && id < others.size()) ? Core.dictOf(others[id]) : null;
            }
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        if (session != null) {
            Actions.start(session);
        }
    }
}

class WorkoutMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        var id = item.getId();
        // still on top while this runs: what it changes shows when the menu has closed
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        if (id == :skip) {
            Actions.skipSet();
        } else if (id == :next) {
            Actions.nextExercise();
        } else if (id == :finish) {
            Menus.confirmFinish();
        } else if (id == :discard) {
            Menus.confirmDiscard();
        } else if (id == :over || id == :met) {
            G.page = id;
        } else if (id == :prev) {
            if (G.fix == null && Rest.left() != null && Rest.left() > 0) {
                Actions.fixLast();
            } else {
                Actions.fixStep(-1);
            }
        } else if (id == :nextFix) {
            Actions.fixStep(1);
        } else if (id == :save) {
            Ed.save();
        } else if (id == :cancel) {
            G.fix = null;
        } else if (id == :effort) {
            Menus.effort();
        }
    }
}

class EffortMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item) {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        Actions.rate(item.getId() as Number);
    }
}

class ConfirmDelegate extends WatchUi.ConfirmationDelegate {
    private var _discard;

    function initialize(discard) {
        ConfirmationDelegate.initialize();
        _discard = discard;
    }

    //! The confirmation closes itself after this; the screen below follows the state then.
    function onResponse(response) {
        // Still on top until this returns: a screen switched in now would be the one popped.
        Nav.overlay = true;
        if (response == WatchUi.CONFIRM_YES) {
            Actions.finish(_discard);
        }
        return true;
    }
}
