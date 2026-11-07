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
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var gap = (h * 0.02).toNumber();

        // The week streak, big; lime once this week has a workout.
        var stk = Core.dictOf(s["stk"]);
        var weeks = (stk == null ? 0 : Core.toI(stk["weeks"], 0)).toString();
        var kept = stk != null && Core.isTrue(stk["thisWeekDone"]);

        // Under it: today's routine and Start, or a few words on why there is nothing to start.
        var rd = Core.dictOf(s["rd"]);
        var today = rd == null ? null : Core.dictOf(rd["today"]);
        var go = session();
        var synced = Core.isTrue(s["sy"]);
        var msg = null;
        var lines = 3;
        if (!synced) {
            msg = Rez.Strings.open_phone_once;
        } else if (today == null) {
            msg = go != null ? Rez.Strings.rest_day : Rez.Strings.start_on_phone;
            lines = go != null ? 2 : 3;
        }
        var name = today == null ? "" : Core.strOf(today["name"]);
        var nameF = Ui.textFont(dc, name, Ui.widthAt(dc, h / 2));
        var bodyH = msg != null ? xh * lines : xh + dc.getFontHeight(nameF);
        var showStart = synced && go != null;
        var ph = Ui.pillH(dc);
        var rest = xh + gap * 2 + bodyH + (showStart ? gap * 2 + ph : 0);
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_MEDIUM, Ui.room(dc) - rest, [weeks], dc.getWidth() / 2);
        var nh = Ui.hOf(dc, nf);
        var y = Ui.stackTop(dc, nh + rest);

        Ui.num(dc, y + nh / 2, nf, weeks, kept ? Ui.accent() : Graphics.COLOR_WHITE);
        y += nh;
        Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.week_streak), Ui.quiet());
        y += xh + gap * 2;
        if (msg != null) {
            Ui.wrap(dc, y + bodyH / 2, xt, Ui.t(msg), Graphics.COLOR_WHITE, lines);
        } else {
            Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.today), Ui.quiet());
            Ui.line(dc, y + xh + dc.getFontHeight(nameF) / 2, nameF, name, Graphics.COLOR_WHITE);
        }
        y += bodyH;
        startBox = null;
        if (showStart) {
            y += gap * 2;
            startBox = Ui.pill(dc, y + ph / 2, Ui.t(today != null ? Rez.Strings.start_workout : Rez.Strings.quick_start), true);
            y += ph;
        }
        if (Core.unsent(G.state) > 0 && G.awayAt != null && y + gap + xh <= h * 0.94) {
            Ui.line(dc, y + gap + xh / 2, xt, Ui.t(Rez.Strings.saved_later), Ui.quiet());
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

    //! START. On a touch watch with buttons (Venu Sq 2) it is a plain key, not "select" (a tap is),
    //! so it is caught here too; elsewhere this runs instead of onSelect, never as well.
    function onKey(ev) {
        if (ev.getKey() == WatchUi.KEY_ENTER) {
            return onSelect();
        }
        return false;
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
            // A per-side set: the numbers of the side up now, not the row's total.
            var sd = Core.dictOf(row["sides"]);
            var one = sd == null ? null : Core.dictOf(sd[Core.sideUp(row)]);
            if (one != null) {
                if (Core.toF(one["w"]) != null) { editW = Core.toF(one["w"]); }
                if (Core.toF(one["r"]) != null) { editR = Core.toF(one["r"]); }
            }
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
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var gap = (h * 0.015).toNumber() + 1;
        var ph = Ui.pillH(dc);
        var es = Core.entries(s);

        if (es.size() == 0) {
            // Started by name: the phone builds it and sends it back.
            Ui.line(dc, h * 0.25, Graphics.FONT_SMALL, Core.strOf(s["w"]["name"]), Graphics.COLOR_WHITE);
            Ui.wrap(dc, h * 0.55, xt, Ui.t(Rez.Strings.waiting_phone), Ui.quiet(), 3);
            return;
        }
        var c = current();
        if (c == null) {
            // The end page: the rest of the workout comes from the phone, or it is all done.
            if (Core.hasMore(s)) {
                Ui.wrap(dc, h * 0.40, xt, Ui.t(Rez.Strings.next_on_phone), Graphics.COLOR_WHITE, 3);
            } else {
                Ui.line(dc, h * 0.36, Graphics.FONT_SMALL, Ui.t(Rez.Strings.all_sets_done), Ui.accent());
                var pr = Core.progress(s);
                Ui.line(dc, h * 0.36 + dc.getFontHeight(Graphics.FONT_SMALL) / 2 + xh / 2 + gap, xt, pr[0].toString() + " / " + pr[1].toString(), Ui.quiet());
            }
            doneBox = Ui.pill(dc, h * 0.72, Ui.t(Rez.Strings.finish_workout), true);
            return;
        }
        var e = c[2];
        var row = c[3];
        var name = Core.strOf(e["name"]);

        if (Core.isCardio(e) || row == null) {
            Ui.line(dc, h * 0.2, Ui.textFont(dc, name, Ui.widthAt(dc, h * 0.2)), name, Graphics.COLOR_WHITE);
            Ui.wrap(dc, h * 0.46, xt, Ui.t(Core.isCardio(e) ? Rez.Strings.log_on_phone : Rez.Strings.all_sets_done), Ui.quiet(), 3);
            doneBox = Ui.pill(dc, h * 0.72, Ui.t(Rez.Strings.next_exercise), false);
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

        // The numbers: as big as the watch allows with both side by side.
        var two = hasWeight(e);
        var label2 = Core.isTimed(e) ? Ui.t(Rez.Strings.hold) : Ui.t(Rez.Strings.reps);
        // number fonts have digits, ":" and "." only: a hold shows as 0:45
        var v2 = Core.isTimed(e) ? Ui.clock(editR == null ? 0 : editR.toNumber()) : Ui.fmtN(editR);
        var v1 = Ui.fmtW(editW);

        // Heart rate and last time, small, as far as there is room.
        var st = Core.dictOf(s["set"]);
        var show = st == null ? null : Core.dictOf(st["show"]);
        var hrOn = (show == null || show["hr"] != false) && G.bpm != null;
        var last = ((show == null || show["last"] != false) && (e["last"] instanceof Lang.String)) ? e["last"] : null;
        var nameF = Ui.textFont(dc, name, Ui.widthAt(dc, h * 0.16));
        var fixed = dc.getFontHeight(nameF) + xh + gap + xh + 5 + gap * 2 + ph;
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_MEDIUM, Ui.room(dc) - fixed, two ? [v1, v2] : [v2], two ? w * 0.4 : w * 0.7);
        var nh = Ui.hOf(dc, nf);
        fixed += nh;
        var room = Ui.room(dc) - fixed;
        // The numbers stay clear of the Instinct's sub-screen (the lines above go beside it).
        var nfh = dc.getFontHeight(nameF);
        var sb = Ui.subscreen();
        var minY = sb == null ? 0 : sb[1] + sb[3] + 10 - (nfh + xh + gap);
        if (minY > Ui.stackTop(dc, fixed)) {
            room -= 2 * (minY - Ui.stackTop(dc, fixed));
        }
        var extra = [];
        if (hrOn && room >= xh + gap) { extra.add(:hr); room -= xh; }
        if (last != null && room >= xh + gap) { extra.add(:last); room -= xh; }
        var y = Ui.stackTop(dc, fixed + xh * extra.size());
        if (y < minY) {
            y = minY;
        }

        Ui.line(dc, y + nfh / 2, nameF, name, Graphics.COLOR_WHITE);
        y += nfh;
        Ui.line(dc, y + xh / 2, xt, tag, tagColor);
        y += xh + gap;
        if (two) {
            var unit = Core.unitOf(s, e);
            wBox = value(dc, w * 0.30, y + nh / 2, nf, v1, Core.isTrue(e["bodyweight"]) ? "+" + unit : unit, focus == :w);
            rBox = value(dc, w * 0.70, y + nh / 2, nf, v2, label2, focus == :r);
        } else {
            rBox = value(dc, w * 0.5, y + nh / 2, nf, v2, label2, true);
        }
        y += nh + xh + 5 + gap;
        for (var k = 0; k < extra.size(); k += 1) {
            if (extra[k] == :hr) {
                Ui.hr(dc, w / 2, y + xh / 2, G.bpm);
            } else {
                Ui.line(dc, y + xh / 2, xt, Lang.format(Ui.t(Rez.Strings.last_time), [last]), Ui.quiet());
            }
            y += xh;
        }
        doneBox = Ui.pill(dc, y + gap + ph / 2, Ui.t(Rez.Strings.done), true);
    }

    //! One number centred at (x, y) with its label under it; the focused one lime with a bar.
    //! Returns its box, for taps.
    function value(dc, x, y, font, text, label, focused) {
        var col = focused ? Ui.accent() : Graphics.COLOR_WHITE;
        var nh = Ui.hOf(dc, font);
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var lf = Graphics.FONT_XTINY;
        var lh = dc.getFontHeight(lf);
        var ly = y + nh / 2 + lh / 2;
        var tw = dc.getTextWidthInPixels(text, font);
        dc.setColor(focused ? Ui.accent() : Ui.quiet(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, ly, lf, Ui.fit(dc, label, lf, dc.getWidth() * 0.4), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        if (focused) {
            var bw = tw > dc.getTextWidthInPixels(label, lf) ? tw : dc.getTextWidthInPixels(label, lf);
            if (bw > dc.getWidth() * 0.4) {
                bw = (dc.getWidth() * 0.4).toNumber();
            }
            dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(x - bw / 2, ly + lh / 2 + 1, bw, 3);
        }
        return [x - tw / 2 - 10, y - nh / 2, tw + 20, nh + lh + 8];
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

    //! START. On a touch watch with buttons (Venu Sq 2) it is a plain key, not "select" (a tap is),
    //! so it is caught here too; elsewhere this runs instead of onSelect, never as well.
    function onKey(ev) {
        if (ev.getKey() == WatchUi.KEY_ENTER) {
            return onSelect();
        }
        return false;
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
        var round = Ui.isRound();
        // A ring that empties (a bar on a square screen), so the time left reads at a glance.
        var frac = total > 0 ? left.toFloat() / total : 0.0;
        var pen = round ? (w > 300 ? 8 : 6) : 6;
        dc.setPenWidth(pen);
        var barTop = 8;
        if (round) {
            dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
            dc.drawCircle(w / 2, h / 2, w / 2 - pen / 2 - 2);
            if (frac > 0.003) {
                dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
                dc.drawArc(w / 2, h / 2, w / 2 - pen / 2 - 2, Graphics.ARC_CLOCKWISE, 90, 90 - (360 * frac).toNumber());
            }
        } else {
            // left of the Instinct's sub-screen
            var sb = Ui.subscreen();
            var bw = (sb != null ? sb[0] - 8 : w - 12) - 12;
            dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(12, barTop, bw, 6);
            dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(12, barTop, (bw * frac).toNumber(), 6);
        }
        dc.setPenWidth(1);
        // inside the ring
        Ui.inset = round ? pen + 4 : 0;

        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var gap = (h * 0.015).toNumber() + 1;
        var ph = Ui.pillH(dc);
        var clk = Ui.clock(left);
        var addH = Ui.isTouch() ? dc.getFontHeight(Graphics.FONT_SMALL) : 0;

        // What comes next and the heart rate, when the phone's settings show them and there is room.
        var s = G.state;
        var st = Core.dictOf(s["set"]);
        var show = st == null ? null : Core.dictOf(st["show"]);
        var nextText = null;
        if (show == null || show["next"] != false) {
            var e = Core.entryAt(s, s["pos"]);
            var si = Core.setIndex(s, s["pos"]);
            if (e != null && si != null) {
                nextText = Lang.format(Ui.t(Rez.Strings.next_set), [Core.strOf(e["name"]), si + 1]);
            }
        }
        var hrOn = G.bpm != null && (show == null || show["hr"] != false);
        var fixed = xh + gap * 2 + addH + ph + (nextText != null ? xh : 0);
        var avail = (h * (round ? 0.84 : 0.9)).toNumber() - (round ? 0 : barTop + 6);
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_HOT, avail - fixed, ["0:00", clk], Ui.widthAt(dc, h / 2));
        var nh = Ui.hOf(dc, nf);
        fixed += nh;
        var withNext = nextText != null;
        var withHr = hrOn && avail - fixed >= xh;
        var y = Ui.stackTop(dc, fixed + (withNext ? xh : 0) + (withHr ? xh : 0));
        if (!round && y < barTop + 10) {
            y = barTop + 10;
        }

        Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.rest), Ui.quiet());
        y += xh;
        Ui.num(dc, y + nh / 2, nf, clk, Graphics.COLOR_WHITE);
        y += nh + gap;
        if (withNext) {
            Ui.line(dc, y + xh / 2, xt, nextText, Graphics.COLOR_WHITE);
            y += xh;
        }
        if (withHr) {
            Ui.hr(dc, w / 2, y + xh / 2, G.bpm);
            y += xh;
        }
        // +15 above Skip on touch screens; on buttons UP adds, START skips.
        addBox = null;
        y += gap;
        if (addH > 0) {
            Ui.line(dc, y + addH / 2, Graphics.FONT_SMALL, "+15", Ui.accent());
            addBox = [w / 4, y, w / 2, addH];
            y += addH;
        }
        skipBox = Ui.pill(dc, y + ph / 2, Ui.t(Rez.Strings.skip), false);
        Ui.inset = 0;
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

    //! START. On a touch watch with buttons (Venu Sq 2) it is a plain key, not "select" (a tap is),
    //! so it is caught here too; elsewhere this runs instead of onSelect, never as well.
    function onKey(ev) {
        if (ev.getKey() == WatchUi.KEY_ENTER) {
            return onSelect();
        }
        return false;
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
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var sf = Graphics.FONT_SMALL;
        var sh = dc.getFontHeight(sf);
        var gap = (h * 0.015).toNumber() + 1;
        var title = Core.isTrue(sm["ended"]) ? Ui.t(Rez.Strings.ended_on_phone) : Ui.t(Rez.Strings.workout_saved);
        var name = Core.strOf(sm["name"]);
        var nameF = Ui.textFont(dc, name, Ui.widthAt(dc, h * 0.25));
        var nameH = dc.getFontHeight(nameF);
        var dur = Ui.clock(sm["dur"]);
        var hr = sm["hr"];
        var foot = hr != null ? hr[0].toString() + " / " + hr[1].toString() + " bpm" : (Core.unsent(G.state) > 0 ? Ui.t(Rez.Strings.saved_later) : null);
        var fixed = xh + nameH + gap + gap + sh + xh;
        // the number as big as fits with one small line more
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_MEDIUM, Ui.room(dc) - fixed - xh, [dur], w * 0.7);
        var nh = Ui.hOf(dc, nf);
        // then the heart rate (or "saved later") at the foot, then the "Time" label, if there is room
        var left = Ui.room(dc) - fixed - nh;
        // "saved later" is a sentence: two lines where one is too narrow at the bottom
        var footLines = foot != null && hr == null && dc.getTextWidthInPixels(foot, xt) > Ui.widthAt(dc, h * 0.85) ? 2 : 1;
        if (footLines == 2 && left < gap + xh * 2) {
            footLines = 1;
        }
        var withFoot = foot != null && left >= gap + xh * footLines;
        if (withFoot) {
            left -= gap + xh * footLines;
        }
        var withTime = left >= xh;
        fixed += nh + (withTime ? xh : 0);
        var y = Ui.stackTop(dc, fixed + (withFoot ? gap + xh * footLines : 0));

        Ui.line(dc, y + xh / 2, xt, title, Ui.accent());
        y += xh;
        Ui.line(dc, y + nameH / 2, nameF, name, Graphics.COLOR_WHITE);
        y += nameH + gap;
        Ui.num(dc, y + nh / 2, nf, dur, Graphics.COLOR_WHITE);
        y += nh;
        if (withTime) {
            Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.time), Ui.quiet());
            y += xh;
        }
        y += gap;
        // Sets and volume side by side.
        var col = w * 0.34;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.32, y + sh / 2, sf, sm["sets"].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w * 0.68, y + sh / 2, sf, Ui.fit(dc, Ui.fmtN(sm["vol"]) + " " + Core.strOf(sm["unit"]), sf, w * 0.4), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        y += sh;
        dc.setColor(Ui.quiet(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.32, y + xh / 2, xt, Ui.fit(dc, Ui.t(Rez.Strings.sets), xt, col), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w * 0.68, y + xh / 2, xt, Ui.fit(dc, Ui.t(Rez.Strings.volume), xt, col), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        y += xh;
        if (withFoot) {
            Ui.wrap(dc, y + gap + (xh * footLines) / 2, xt, foot, hr != null ? Ui.heart() : Ui.quiet(), footLines);
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

    //! START. On a touch watch with buttons (Venu Sq 2) it is a plain key, not "select" (a tap is),
    //! so it is caught here too; elsewhere this runs instead of onSelect, never as well.
    function onKey(ev) {
        if (ev.getKey() == WatchUi.KEY_ENTER) {
            return onSelect();
        }
        return false;
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
