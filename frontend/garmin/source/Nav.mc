// Which screen is up follows the state, never the other way round: a snapshot from the phone, a
// rest running out or a set ticked changes the state, and Nav.follow() puts up the screen for it.
//   summary   a workout just ended (G.ended)
//   count     the workout's 3-2-1 (G.cd)
//   idle      nothing running: today's routine, Start
//   session   a workout: one screen with three pages (G.page), Overview <- Set -> Metrics; the
//             set page also shows the rest, a hold and its 3-2-1, a set being fixed, "All done?"
import Toybox.Lang;
import Toybox.WatchUi;

module Nav {
    var kind = null;
    //! A menu or a confirmation is on top: the screen below changes when it closes (onShow).
    var overlay = false;

    function wanted() {
        if (G.ended != null) {
            return :summary;
        }
        if (G.state["w"] == null) {
            return G.cd != null ? :count : :idle;
        }
        return :session;
    }

    function make(k) {
        kind = k;
        if (k == :summary) {
            return [new SummaryView(), new SummaryDelegate()];
        }
        if (k == :count) {
            return [new CountView(), new CountDelegate()];
        }
        if (k == :idle) {
            var v2 = new IdleView();
            return [v2, new IdleDelegate(v2)];
        }
        var v4 = new SessionView();
        return [v4, new SessionDelegate(v4)];
    }

    function initial() {
        return make(wanted());
    }

    function follow() {
        if (overlay) {
            return;
        }
        var k = wanted();
        if (k == kind) {
            return;
        }
        var vd = make(k);
        WatchUi.switchToView(vd[0], vd[1], WatchUi.SLIDE_IMMEDIATE);
    }

    //! A menu or confirmation goes on top.
    function push(view, delegate) {
        overlay = true;
        WatchUi.pushView(view, delegate, WatchUi.SLIDE_UP);
    }

    //! A main screen is on top again (its onShow).
    function shown() {
        overlay = false;
        follow();
    }
}
