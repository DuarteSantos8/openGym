// Which screen is up follows the state, never the other way round: a snapshot from the phone, a
// rest running out or a set ticked changes the state, and Nav.follow() puts up the screen for it.
//   summary   a workout just ended (G.ended)
//   idle      nothing running: the streak, today's routine, Start
//   rest      a rest is counting down
//   set       the set up now (or the end page, or "waiting for your phone")
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
            return :idle;
        }
        var left = Rest.left();
        if (left != null && left > 0) {
            return :rest;
        }
        return :set;
    }

    function make(k) {
        kind = k;
        if (k == :summary) {
            var v = new SummaryView();
            return [v, new SummaryDelegate()];
        }
        if (k == :idle) {
            var v2 = new IdleView();
            return [v2, new IdleDelegate(v2)];
        }
        if (k == :rest) {
            var v3 = new RestView();
            return [v3, new RestDelegate(v3)];
        }
        var v4 = new SetView();
        return [v4, new SetDelegate(v4)];
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
