// What the buttons do: each changes the state through Core.mc, sends the phone its event, and
// lets Nav put up the screen that goes with the new state.
import Toybox.Lang;
import Toybox.WatchUi;

module Actions {

    //! A routine started here.
    function start(session) {
        var ev = Core.start(G.state, session);
        G.ended = null;
        Link.send(ev);
        Workout.begin();
        G.changed();
    }

    //! A set done: logged with its heart rate, a lap in Garmin Connect, a short buzz, then the
    //! rest (the exercise's, else the workout's, else the phone's default) or the next set.
    function tick(pos, si, side, w, r, sec, restSec) {
        var s = G.state;
        var ev = Core.tick(s, pos, si, side, w, r, sec, Workout.hrForSet());
        if (ev == null) {
            return;
        }
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
        Core.skip(s, pos, si);
        s["pos"] = Core.next(s, pos, si)[0];
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
        Rest.stop();
        G.changed();
    }

    //! Finished here (the phone's own Finish and save runs), or discarded (dropped unsaved).
    function finish(discard) {
        var s = G.state;
        var w = Core.dictOf(s["w"]);
        if (w == null) {
            return;
        }
        var sm = discard ? null : Core.summary(s, w, false);
        Link.send(Core.finish(s, discard));
        Workout.end(!discard);
        var hr = Workout.hrTotals();
        if (sm != null) {
            sm["hr"] = hr;
        }
        G.ended = sm;
        G.changed();
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

    function workout() {
        var menu = new WatchUi.Menu2({ :title => Ui.t(Rez.Strings.workout) });
        if (Core.entries(G.state).size() > 0) {
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.skip_set), null, :skip, null));
            menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.next_exercise), null, :next, null));
        }
        menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.finish_and_save), null, :finish, null));
        menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.discard_workout), null, :discard, null));
        menu.addItem(new WatchUi.MenuItem(Ui.t(Rez.Strings.continue_workout), null, :back, null));
        Nav.push(menu, new WorkoutMenuDelegate());
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
        var id = item.getId();
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
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        if (id == :skip) {
            Actions.skipSet();
        } else if (id == :next) {
            Actions.nextExercise();
        } else if (id == :finish) {
            Menus.confirmFinish();
        } else if (id == :discard) {
            Menus.confirmDiscard();
        }
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
