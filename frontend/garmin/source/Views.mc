// The screens. Buttons and touch both work everywhere:
//   START (or a tap on the lime button)   the main thing: Start, Done, Skip the rest
//   UP / DOWN (or swipe down / up)        more / less of the value in lime
//   BACK (or swipe right)                 on a set: weight <-> reps; on a rest: back to the set
//   MENU (hold UP, or touch and hold)     skip, next exercise, finish, discard
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

/* ======================================================================= idle */

class IdleView extends WatchUi.View {
    var startBox = null;

    function initialize() {
        View.initialize();
    }

    function onShow() {
        Nav.shown();
    }

    //! What Start starts: today's plan, else the first routine (Quick start), else nothing.
    function session() {
        var rd = Core.dictOf(G.state["rd"]);
        if (rd == null) {
            return null;
        }
        var today = Core.dictOf(rd["today"]);
        if (today != null) {
            return today;
        }
        var others = Core.arrOf(rd["others"]);
        return others.size() > 0 ? Core.dictOf(others[0]) : null;
    }

    function onUpdate(dc) {
        Ui.clear(dc);
        var s = G.state;
        var h = dc.getHeight();
        var cx = dc.getWidth() / 2;

        // The week streak, big; lime once this week has a workout.
        var stk = Core.dictOf(s["stk"]);
        var weeks = stk == null ? 0 : Core.toI(stk["weeks"], 0);
        var kept = stk != null && Core.isTrue(stk["thisWeekDone"]);
        dc.setColor(kept ? Ui.accent() : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.21, Graphics.FONT_NUMBER_MEDIUM, weeks.toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        Ui.line(dc, h * 0.34, Graphics.FONT_XTINY, Ui.t(Rez.Strings.week_streak), Ui.quiet());

        var rd = Core.dictOf(s["rd"]);
        var today = rd == null ? null : Core.dictOf(rd["today"]);
        var go = session();
        if (!Core.isTrue(s["sy"])) {
            Ui.wrap(dc, h * 0.55, Graphics.FONT_XTINY, Ui.t(Rez.Strings.open_phone_once), Graphics.COLOR_WHITE, 3);
            startBox = null;
            return;
        }
        if (today != null) {
            Ui.line(dc, h * 0.47, Graphics.FONT_XTINY, Ui.t(Rez.Strings.today), Ui.quiet());
            Ui.line(dc, h * 0.57, Graphics.FONT_SMALL, Core.strOf(today["name"]), Graphics.COLOR_WHITE);
        } else if (go != null) {
            Ui.wrap(dc, h * 0.53, Graphics.FONT_XTINY, Ui.t(Rez.Strings.rest_day), Graphics.COLOR_WHITE, 2);
        } else {
            Ui.wrap(dc, h * 0.55, Graphics.FONT_XTINY, Ui.t(Rez.Strings.start_on_phone), Graphics.COLOR_WHITE, 3);
        }
        if (go != null) {
            startBox = Ui.pill(dc, h * 0.76, Ui.t(today != null ? Rez.Strings.start_workout : Rez.Strings.quick_start), true);
        } else {
            startBox = null;
        }
        if (G.state["ob"].size() > 0 && G.awayAt != null) {
            Ui.line(dc, h * 0.90, Graphics.FONT_XTINY, Ui.t(Rez.Strings.saved_later), Ui.quiet());
        }
    }
}

class IdleDelegate extends WatchUi.BehaviorDelegate {
    private var _v;

    function initialize(v) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function startNow() {
        var session = _v.session();
        if (session == null) {
            return true;
        }
        Actions.start(session);
        return true;
    }

    function onSelect() {
        return startNow();
    }

    function onTap(ev) {
        var xy = ev.getCoordinates();
        if (Ui.inBox(_v.startBox, xy[0], xy[1])) {
            return startNow();
        }
        return onMenu();
    }

    function onMenu() {
        Menus.routines();
        return true;
    }

    function onNextPage() {
        return onMenu();
    }

    function onPreviousPage() {
        return onMenu();
    }
}

/* ======================================================================= set */

class SetView extends WatchUi.View {
    //! The value being changed: :w or :r. Edits of the set on screen, until Done.
    var focus = :r;
    var forKey = null;
    var editW = null;
    var editR = null;
    var wBox = null;
    var rBox = null;
    var doneBox = null;

    function initialize() {
        View.initialize();
    }

    function onShow() {
        Nav.shown();
    }

    //! The set on screen: [pos, setIndex, entry, row], or null (end page, waiting, all done).
    function current() {
        var s = G.state;
        var pos = s["pos"];
        var e = Core.entryAt(s, pos);
        if (e == null) {
            return null;
        }
        var si = Core.setIndex(s, pos);
        if (si == null) {
            return [pos, null, e, null];
        }
        var row = Core.dictOf(Core.arrOf(e["sets"])[si]);
        // A new set on screen: its own numbers, and the focus where the phone's settings put it.
        var k = Core.key(e["id"], si, Core.sideUp(row));
        if (!k.equals(forKey)) {
            forKey = k;
            editW = Core.toF(row["w"]);
            editR = Core.isTimed(e) ? Core.toF(row["sec"]) : Core.toF(row["r"]);
            var st = Core.dictOf(s["set"]);
            focus = (st != null && Core.same(st["crown"], "weight") && hasWeight(e)) ? :w : :r;
            if (!hasWeight(e)) {
                focus = :r;
            }
        }
        return [pos, si, e, row];
    }

    //! Whether the set has a weight to show: not a hold, not a bodyweight one without added weight.
    function hasWeight(e) {
        if (Core.isTimed(e) || Core.isCardio(e)) {
            return false;
        }
        if (Core.isTrue(e["bodyweight"])) {
            return editW != null && editW > 0;
        }
        return true;
    }

    function onUpdate(dc) {
        Ui.clear(dc);
        wBox = null; rBox = null; doneBox = null;
        var s = G.state;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var es = Core.entries(s);

        if (es.size() == 0) {
            // Started by name: the phone builds it and sends it back.
            Ui.line(dc, h * 0.25, Graphics.FONT_SMALL, Core.strOf(s["w"]["name"]), Graphics.COLOR_WHITE);
            Ui.wrap(dc, h * 0.55, Graphics.FONT_XTINY, Ui.t(Rez.Strings.waiting_phone), Ui.quiet(), 3);
            return;
        }
        var c = current();
        if (c == null) {
            // The end page: the rest of the workout comes from the phone, or it is all done.
            if (Core.hasMore(s)) {
                Ui.wrap(dc, h * 0.42, Graphics.FONT_XTINY, Ui.t(Rez.Strings.next_on_phone), Graphics.COLOR_WHITE, 3);
            } else {
                Ui.line(dc, h * 0.35, Graphics.FONT_SMALL, Ui.t(Rez.Strings.all_sets_done), Ui.accent());
                var pr = Core.progress(s);
                Ui.line(dc, h * 0.50, Graphics.FONT_XTINY, pr[0].toString() + " / " + pr[1].toString(), Ui.quiet());
            }
            doneBox = Ui.pill(dc, h * 0.76, Ui.t(Rez.Strings.finish_workout), true);
            return;
        }
        var e = c[2];
        var row = c[3];
        Ui.line(dc, h * 0.15, Graphics.FONT_SMALL, Core.strOf(e["name"]), Graphics.COLOR_WHITE);

        if (Core.isCardio(e) || row == null) {
            Ui.wrap(dc, h * 0.47, Graphics.FONT_XTINY, Ui.t(Core.isCardio(e) ? Rez.Strings.log_on_phone : Rez.Strings.all_sets_done), Ui.quiet(), 3);
            doneBox = Ui.pill(dc, h * 0.76, Ui.t(Rez.Strings.next_exercise), false);
            return;
        }

        // "Set 2 of 4", and what kind of set it is.
        var sets = Core.arrOf(e["sets"]);
        var work = 0;
        var nth = 0;
        for (var i = 0; i < sets.size(); i += 1) {
            var r0 = Core.dictOf(sets[i]);
            if (r0 != null && !Core.isTrue(r0["warmup"])) {
                work += 1;
                if (i <= c[1]) { nth = work; }
            }
        }
        var tag;
        var tagColor = Ui.quiet();
        if (Core.isTrue(row["warmup"])) {
            tag = Ui.t(Rez.Strings.warmup);
            tagColor = Ui.warm();
        } else {
            tag = Lang.format(Ui.t(Rez.Strings.set_of), [nth, work]);
        }
        var side = Core.sideUp(row);
        if (side != null) {
            tag = tag + "  " + Ui.t(side.equals("L") ? Rez.Strings.left : Rez.Strings.right);
        } else if (e["group"] != null) {
            tag = tag + "  " + Ui.t(Rez.Strings.superset);
        }
        Ui.line(dc, h * 0.27, Graphics.FONT_XTINY, tag, tagColor);

        // The numbers: big, the one UP and DOWN change in lime and underlined.
        var numFont = Graphics.FONT_NUMBER_MEDIUM;
        var ny = h * 0.47;
        var ly = ny + dc.getFontHeight(numFont) / 2 + 2;
        var label2 = Core.isTimed(e) ? Ui.t(Rez.Strings.hold) : Ui.t(Rez.Strings.reps);
        // number fonts have digits, ":" and "." only: a hold shows as 0:45
        var v2 = Core.isTimed(e) ? Ui.clock(editR == null ? 0 : editR.toNumber()) : Ui.fmtN(editR);
        if (hasWeight(e)) {
            var unit = Core.unitOf(s, e);
            rBox = value(dc, w * 0.70, ny, ly, numFont, v2, label2, focus == :r);
            wBox = value(dc, w * 0.30, ny, ly, numFont, Ui.fmtW(editW), Core.isTrue(e["bodyweight"]) ? "+" + unit : unit, focus == :w);
        } else {
            rBox = value(dc, w * 0.5, ny, ly, numFont, v2, label2, true);
        }

        // Heart rate and last time, small.
        var my = h * 0.68;
        var st = Core.dictOf(s["set"]);
        var show = st == null ? null : Core.dictOf(st["show"]);
        var showHr = show == null || show["hr"] != false;
        var showLast = show == null || show["last"] != false;
        var last = (showLast && (e["last"] instanceof Lang.String)) ? e["last"] : null;
        if (showHr && G.bpm != null && last == null) {
            Ui.hr(dc, w / 2, my, G.bpm);
        } else if (last != null) {
            var lastText = Lang.format(Ui.t(Rez.Strings.last_time), [last]);
            if (showHr && G.bpm != null) {
                Ui.hr(dc, w / 2, my - dc.getFontHeight(Graphics.FONT_XTINY) / 2 - 1, G.bpm);
                Ui.line(dc, my + dc.getFontHeight(Graphics.FONT_XTINY) / 2 + 1, Graphics.FONT_XTINY, lastText, Ui.quiet());
            } else {
                Ui.line(dc, my, Graphics.FONT_XTINY, lastText, Ui.quiet());
            }
        }
        doneBox = Ui.pill(dc, h * 0.85, Ui.t(Rez.Strings.done), true);
    }

    //! One number with its label under it; the focused one lime with a bar. Returns its box.
    function value(dc, x, y, ly, font, text, label, focused) {
        var col = focused ? Ui.accent() : Graphics.COLOR_WHITE;
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var lf = Graphics.FONT_XTINY;
        dc.setColor(focused ? Ui.accent() : Ui.quiet(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, ly + dc.getFontHeight(lf) / 2, lf, label, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var tw = dc.getTextWidthInPixels(text, font);
        var fh = dc.getFontHeight(font);
        if (focused) {
            dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(x - tw / 2, ly + dc.getFontHeight(lf) + 2, tw, 3);
        }
        return [x - tw / 2 - 10, y - fh / 2, tw + 20, fh + dc.getFontHeight(lf) + 8];
    }

    //! UP / DOWN: the focused value moved by one step.
    function adjust(steps) {
        var c = current();
        if (c == null || c[1] == null) {
            return;
        }
        var e = c[2];
        if (focus == :w && hasWeight(e)) {
            editW = Core.stepWeight(editW, Core.stepOf(G.state, e), steps);
        } else if (Core.isTimed(e)) {
            editR = Core.stepReps(editR, steps * 5);
        } else {
            editR = Core.stepReps(editR, steps);
        }
        WatchUi.requestUpdate();
    }

    function toggle() {
        var c = current();
        if (c == null || c[1] == null || !hasWeight(c[2])) {
            return false;
        }
        focus = focus == :w ? :r : :w;
        WatchUi.requestUpdate();
        return true;
    }

    //! Done (START): the set logged, a short buzz, then the rest or the next set.
    function done() {
        var s = G.state;
        if (Core.entries(s).size() == 0) {
            return;
        }
        var c = current();
        if (c == null) {
            Menus.confirmFinish();
            return;
        }
        if (c[1] == null || Core.isCardio(c[2])) {
            Actions.nextExercise();
            return;
        }
        var e = c[2];
        var timed = Core.isTimed(e);
        Actions.tick(c[0], c[1], Core.sideUp(c[3]), timed ? null : editW, timed ? null : editR, timed ? editR : null, Core.toF(e["restSec"]));
    }
}

class SetDelegate extends WatchUi.BehaviorDelegate {
    private var _v;

    function initialize(v) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function onSelect() {
        _v.done();
        return true;
    }

    function onTap(ev) {
        var xy = ev.getCoordinates();
        if (Ui.inBox(_v.doneBox, xy[0], xy[1])) {
            _v.done();
        } else if (Ui.inBox(_v.wBox, xy[0], xy[1])) {
            _v.focus = :w;
            WatchUi.requestUpdate();
        } else if (Ui.inBox(_v.rBox, xy[0], xy[1])) {
            _v.focus = :r;
            WatchUi.requestUpdate();
        } else if (xy[1] < System.getDeviceSettings().screenHeight * 0.22) {
            // the exercise's name: the menu (skip, next exercise, finish)
            Menus.workout();
        }
        return true;
    }

    function onSwipe(ev) {
        var d = ev.getDirection();
        if (d == WatchUi.SWIPE_DOWN) {
            _v.adjust(1);
            return true;
        }
        if (d == WatchUi.SWIPE_UP) {
            _v.adjust(-1);
            return true;
        }
        return false;
    }

    function onPreviousPage() {
        _v.adjust(1);
        return true;
    }

    function onNextPage() {
        _v.adjust(-1);
        return true;
    }

    //! BACK never leaves a running workout by accident: it switches weight and reps, or opens
    //! the menu where there is only one number.
    function onBack() {
        if (!_v.toggle()) {
            Menus.workout();
        }
        return true;
    }

    function onMenu() {
        Menus.workout();
        return true;
    }

    function onHold(ev) {
        Menus.workout();
        return true;
    }
}

/* ======================================================================= rest */

class RestView extends WatchUi.View {
    var total = null;
    var addBox = null;
    var skipBox = null;

    function initialize() {
        View.initialize();
    }

    function onShow() {
        Nav.shown();
    }

    function onUpdate(dc) {
        Ui.clear(dc);
        var w = dc.getWidth();
        var h = dc.getHeight();
        var left = Rest.left();
        if (left == null) {
            left = 0;
        }
        if (total == null || left > total) {
            total = left > 0 ? left : 1;
        }
        // A ring that empties (a bar on a square screen), so the time left reads at a glance.
        var frac = total > 0 ? left.toFloat() / total : 0.0;
        dc.setPenWidth(Ui.isRound() ? 8 : 6);
        if (Ui.isRound()) {
            dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
            dc.drawCircle(w / 2, h / 2, w / 2 - 6);
            if (frac > 0.003) {
                dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
                dc.drawArc(w / 2, h / 2, w / 2 - 6, Graphics.ARC_CLOCKWISE, 90, 90 - (360 * frac).toNumber());
            }
        } else {
            dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(12, 8, w - 24, 6);
            dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(12, 8, ((w - 24) * frac).toNumber(), 6);
        }
        dc.setPenWidth(1);

        Ui.line(dc, h * 0.22, Graphics.FONT_XTINY, Ui.t(Rez.Strings.rest), Ui.quiet());
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.42, Graphics.FONT_NUMBER_HOT, Ui.clock(left), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // What comes next, when the phone's settings show it.
        var s = G.state;
        var st = Core.dictOf(s["set"]);
        var show = st == null ? null : Core.dictOf(st["show"]);
        if (show == null || show["next"] != false) {
            var e = Core.entryAt(s, s["pos"]);
            var si = Core.setIndex(s, s["pos"]);
            if (e != null && si != null) {
                Ui.line(dc, h * 0.60, Graphics.FONT_XTINY, Lang.format(Ui.t(Rez.Strings.next_set), [Core.strOf(e["name"]), si + 1]), Graphics.COLOR_WHITE);
            }
        }
        if (G.bpm != null && (show == null || show["hr"] != false)) {
            Ui.hr(dc, w / 2, h * 0.68, G.bpm);
        }
        // +15 above Skip on touch screens; on buttons UP adds, START skips.
        addBox = null;
        if (Ui.isTouch()) {
            Ui.line(dc, h * 0.77, Graphics.FONT_SMALL, "+15", Ui.accent());
            var fh = dc.getFontHeight(Graphics.FONT_SMALL);
            addBox = [w / 4, h * 0.77 - fh / 2, w / 2, fh];
        }
        skipBox = Ui.pill(dc, Ui.isTouch() ? h * 0.88 : h * 0.82, Ui.t(Rez.Strings.skip), false);
    }
}

class RestDelegate extends WatchUi.BehaviorDelegate {
    private var _v;

    function initialize(v) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function skipRest() {
        Rest.stop();
        Nav.follow();
        return true;
    }

    function onSelect() {
        return skipRest();
    }

    function onBack() {
        return skipRest();
    }

    function onTap(ev) {
        var xy = ev.getCoordinates();
        if (Ui.inBox(_v.addBox, xy[0], xy[1])) {
            Rest.add(15);
            WatchUi.requestUpdate();
            return true;
        }
        if (Ui.inBox(_v.skipBox, xy[0], xy[1])) {
            return skipRest();
        }
        return true;
    }

    function onPreviousPage() {
        Rest.add(15);
        WatchUi.requestUpdate();
        return true;
    }

    function onNextPage() {
        Rest.add(-15);
        WatchUi.requestUpdate();
        return true;
    }

    function onMenu() {
        Menus.workout();
        return true;
    }
}

/* ======================================================================= summary */

class SummaryView extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onShow() {
        Nav.shown();
    }

    function onUpdate(dc) {
        Ui.clear(dc);
        var sm = G.ended;
        if (sm == null) {
            return;
        }
        var w = dc.getWidth();
        var h = dc.getHeight();
        var title = Core.isTrue(sm["ended"]) ? Ui.t(Rez.Strings.ended_on_phone) : Ui.t(Rez.Strings.workout_saved);
        Ui.line(dc, h * 0.16, Graphics.FONT_XTINY, title, Ui.accent());
        Ui.line(dc, h * 0.27, Graphics.FONT_SMALL, Core.strOf(sm["name"]), Graphics.COLOR_WHITE);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.44, Graphics.FONT_NUMBER_MEDIUM, Ui.clock(sm["dur"]), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        Ui.line(dc, h * 0.58, Graphics.FONT_XTINY, Ui.t(Rez.Strings.time), Ui.quiet());
        // Sets and volume side by side.
        var y = h * 0.70;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.32, y, Graphics.FONT_SMALL, sm["sets"].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w * 0.68, y, Graphics.FONT_SMALL, Ui.fmtN(sm["vol"]), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var ly = y + dc.getFontHeight(Graphics.FONT_SMALL) / 2 + dc.getFontHeight(Graphics.FONT_XTINY) / 2;
        dc.setColor(Ui.quiet(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.32, ly, Graphics.FONT_XTINY, Ui.t(Rez.Strings.sets), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w * 0.68, ly, Graphics.FONT_XTINY, Ui.t(Rez.Strings.volume) + " " + Core.strOf(sm["unit"]), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var hr = sm["hr"];
        if (hr != null) {
            Ui.line(dc, h * 0.90, Graphics.FONT_XTINY, hr[0].toString() + " / " + hr[1].toString() + " bpm", Ui.heart());
        } else if (G.state["ob"].size() > 0) {
            Ui.line(dc, h * 0.90, Graphics.FONT_XTINY, Ui.t(Rez.Strings.saved_later), Ui.quiet());
        }
    }
}

class SummaryDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function close() {
        G.ended = null;
        Nav.follow();
        return true;
    }

    function onSelect() {
        return close();
    }

    function onBack() {
        return close();
    }

    function onTap(ev) {
        return close();
    }
}
