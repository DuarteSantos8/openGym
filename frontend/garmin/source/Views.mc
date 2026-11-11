// The screens, in the 1.4.5 watch redesign (the Apple Watch's, docs/GARMIN.md "Design"):
//   Start     "Today", the routine, exercises and sets, one Start (a 3-2-1 first)
//   session   Overview <- Set -> Metrics. The set page also runs the rest, a hold, the 3-2-1
//             before a hold, a set being fixed and "All done?".
//   Summary   the workout's time, sets, volume, heart rate, and whether it all reached the phone
// Buttons and touch both work everywhere (the button map in docs/GARMIN.md is the one users know):
//   START (or a tap on the button)      the main thing: Start, Done, Skip the rest, Stop a hold
//   UP / DOWN (or swipe down / up)      more / less of the outlined number; +15 / -15 on a rest
//   BACK                                on a set: weight <-> reps; elsewhere back to the set
//   MENU (hold UP, or touch and hold)   Overview, Metrics, Previous set, skip, finish, discard
//   swipe left (touch)                  the next page: Set, Metrics, Overview (right is BACK)
import Toybox.Activity;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

//! The numbers on the set page (or on a set being fixed) until Done or Save: UP / DOWN move the
//! outlined one, BACK picks the other.
module Ed {
    var key = null;
    var w = null;
    var r = null;
    var focus = :r;

    //! The set on screen: [pos, si, entry, row, side, fixing], or null (end page). si is null when
    //! the exercise has nothing left to do here (cardio, all done).
    function cur() {
        var s = G.state;
        if (G.fix != null) {
            var fc = fixCur(s, G.fix);
            if (fc != null) {
                return fc;
            }
        }
        var pos = s["pos"];
        var e = Core.entryAt(s, pos);
        if (e == null) {
            return null;
        }
        var si = Core.setIndex(s, pos);
        if (si == null) {
            return [pos, null, e, null, null, false];
        }
        var row = Core.dictOf(Core.arrOf(e["sets"])[si]);
        var side = Core.sideUp(row);
        var ww = Core.toF(row["w"]);
        var rr = Core.isTimed(e) ? Core.toF(row["sec"]) : Core.toF(row["r"]);
        // a per-side set: the numbers of the side up now, not the row's total
        var sd = Core.dictOf(row["sides"]);
        var one = sd == null ? null : Core.dictOf(sd[side]);
        if (one != null) {
            if (Core.toF(one["w"]) != null) { ww = Core.toF(one["w"]); }
            if (Core.toF(one["r"]) != null) { rr = Core.toF(one["r"]); }
        }
        load(Core.key(e["id"], si, side), e, ww, rr);
        return [pos, si, e, row, side, false];
    }

    //! The set being fixed, as cur() has it, or null (and the fix dropped) when it is gone.
    (:nofixui)
    function fixCur(s, f) {
        G.fix = null;
        return null;
    }
    (:fixui)
    function fixCur(s, f) {
        var p = Core.posOf(s, f[0]);
        var n = p == null ? null : Core.logged(s, p, f[1], f[2]);
        if (n == null) {
            // unticked on the phone, or the window moved on: nothing left to fix
            G.fix = null;
            return null;
        }
        var fe = Core.entryAt(s, p);
        load("f" + Core.key(f[0], f[1], f[2]), fe, n[0], Core.isTimed(fe) ? n[2] : n[1]);
        return [p, f[1], fe, Core.dictOf(Core.arrOf(fe["sets"])[f[1]]), f[2], true];
    }

    //! A new set on screen: its own numbers, and the focus where the phone's settings put it.
    function load(k, e, ww, rr) {
        if (k.equals(key)) {
            return;
        }
        key = k;
        w = ww;
        r = rr;
        var st = Core.dictOf(G.state["set"]);
        focus = (st != null && Core.same(st["crown"], "weight") && hasWeight(e)) ? :w : :r;
    }

    //! Whether the set has a weight to show: not a hold, not a bodyweight one without added weight.
    function hasWeight(e) {
        if (Core.isTimed(e) || Core.isCardio(e)) {
            return false;
        }
        if (Core.isTrue(e["bodyweight"])) {
            return w != null && w > 0;
        }
        return true;
    }

    //! The seconds a hold up now is to last (the number on its set page).
    function target() {
        var c = cur();
        return (c == null || c[1] == null || r == null) ? null : r.toNumber();
    }

    //! UP / DOWN: the outlined number moved by one step (the exercise's own plate step, 1 rep, 5 s).
    function adjust(steps) {
        var c = cur();
        if (c == null || c[1] == null) {
            return;
        }
        var e = c[2];
        if (focus == :w && hasWeight(e)) {
            w = Core.stepWeight(w, Core.stepOf(G.state, e), steps);
        } else {
            r = Core.stepReps(r, Core.isTimed(e) ? steps * 5 : steps);
        }
        WatchUi.requestUpdate();
    }

    function toggle() {
        var c = cur();
        if (c == null || c[1] == null || !hasWeight(c[2])) {
            return false;
        }
        focus = focus == :w ? :r : :w;
        WatchUi.requestUpdate();
        return true;
    }

    (:nofixui)
    function save() {
    }
    //! Save on a set being fixed.
    (:fixui)
    function save() {
        var c = cur();
        if (c != null && c[5]) {
            Actions.saveFix(hasWeight(c[2]) || Core.isTimed(c[2]) ? w : null, r);
        }
    }

    //! Done (START): the set logged; on a hold, its 3-2-1 first.
    function done() {
        var s = G.state;
        if (Core.entries(s).size() == 0) {
            return;
        }
        var c = cur();
        if (c == null) {
            Menus.confirmFinish();
            return;
        }
        if (c[1] == null || Core.isCardio(c[2])) {
            Actions.nextExercise();
            return;
        }
        var e = c[2];
        if (Core.isTimed(e)) {
            Actions.holdCount();
            return;
        }
        Actions.tick(c[0], c[1], c[4], w, r, null, Core.toF(e["restSec"]));
    }
}

/* ======================================================================= start */

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
        var gap = (h * 0.02).toNumber() + 1;
        var top = topY(dc);
        var y = top + Ui.status(dc, top, null) + gap;

        var rd = Core.dictOf(s["rd"]);
        var today = rd == null ? null : Core.dictOf(rd["today"]);
        var go = session();
        var synced = Core.isTrue(s["sy"]);
        startBox = null;
        var sync = Ui.syncText(false);
        var bottom = bottomY(dc) - (sync != null ? xh : 0);
        var ph = Ui.pillH(dc);

        if (!synced || go == null) {
            // Nothing to start yet: say why, rather than a "no workout" that reads as if the two
            // were in touch.
            var head = Ui.t(synced ? Rez.Strings.no_workout : Rez.Strings.not_synced);
            var body = Ui.t(synced ? Rez.Strings.start_on_phone : Rez.Strings.open_phone_once);
            var mid = (y + bottom) / 2;
            Ui.wrap(dc, mid - xh * 2, Graphics.FONT_SMALL, head, Ui.accent(), 1);
            Ui.wrap(dc, mid + xh / 2, xt, body, Graphics.COLOR_WHITE, 3);
        } else {
            var name = Core.strOf(go["name"]);
            var label = Ui.t(today != null ? Rez.Strings.today : Rez.Strings.rest_day);
            var size = Core.planSize(Core.arrOf(go["entries"]));
            var stats = size[0] > 0 ? [size[0] + " " + Ui.t(Rez.Strings.exercises), size[1] + " " + Ui.t(Rez.Strings.sets)] : null;
            // "5 Exercises · 17 Sets" on one line where it fits, else on two
            if (stats != null && dc.getTextWidthInPixels(stats[0] + " · " + stats[1], xt) <= Ui.widthAt(dc, h * 0.62)) {
                stats = [stats[0] + " · " + stats[1]];
            }
            var room = bottom - y - xh - ph - gap * 2 - (stats != null ? xh * stats.size() : 0);
            var tl = Ui.title(dc, name, [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY], y + xh, room >= dc.getFontHeight(Graphics.FONT_SMALL) * 2 ? 2 : 1);
            var nameH = dc.getFontHeight(tl[0]) * tl[1].size();
            var total = xh + nameH + (stats != null ? xh * stats.size() : 0) + gap * 2 + ph;
            var y2 = y + (bottom - y - total) / 2;
            if (y2 < y) { y2 = y; }
            Ui.line(dc, y2 + xh / 2, xt, label, Ui.accent());
            y2 += xh;
            y2 += Ui.drawLines(dc, y2, tl[0], tl[1], Graphics.COLOR_WHITE);
            if (stats != null) {
                y2 += Ui.drawLines(dc, y2, xt, stats, Ui.quiet());
            }
            y2 += gap * 2;
            startBox = Ui.pill(dc, y2 + ph / 2, Ui.t(today != null ? Rez.Strings.start_workout : Rez.Strings.quick_start), true);
        }
        Ui.syncLine(dc, bottom + xh / 2, false);
    }
}

//! Where a screen's first line goes: clear of a round screen's narrow top.
function topY(dc) {
    var h = dc.getHeight();
    return (h * (Ui.isRound() ? 0.07 : 0.02)).toNumber() + 1;
}

function bottomY(dc) {
    var h = dc.getHeight();
    return (h * (Ui.isRound() ? 0.93 : 0.98)).toNumber();
}

class IdleDelegate extends WatchUi.BehaviorDelegate {
    private var _v;

    function initialize(v) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function startNow() {
        var session = _v.session();
        if (session != null && Core.isTrue(G.state["sy"])) {
            Actions.start(session);
        }
        return true;
    }

    //! START. On a touch watch with buttons (Venu Sq 2) it is a plain key, not "select" (a tap is),
    //! so it is caught here too; elsewhere this runs instead of onSelect, never as well.
    function onKey(ev) {
        if (ev.getKey() == WatchUi.KEY_ENTER) {
            return startNow();
        }
        return false;
    }

    //! A tap is a "select" first: on touch watches it goes on to onTap (Start, or the list).
    function onSelect() {
        return Ui.isTouch() ? false : startNow();
    }

    (:touch)
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

/* ======================================================================= 3-2-1 */

class CountView extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onShow() {
        Nav.shown();
    }

    function onUpdate(dc) {
        if (G.cd != null) {
            Ui.countdown(dc, G.cd[0], Ui.t(Rez.Strings.start_workout));
        }
    }
}

class CountDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onKey(ev) {
        if (ev.getKey() == WatchUi.KEY_ENTER) {
            return onSelect();
        }
        return false;
    }

    //! START or a tap: no need to wait.
    function onSelect() {
        Actions.startNow();
        return true;
    }

    (:touch)
    function onTap(ev) {
        return onSelect();
    }

    function onBack() {
        Actions.cancelStart();
        return true;
    }
}

/* ======================================================================= session */

class SessionView extends WatchUi.View {
    // touch targets of the screen drawn last
    var wBox = null;
    var rBox = null;
    var doneBox = null;
    var prevBox = null;
    var nextBox = null;
    var minusBox = null;
    var plusBox = null;
    var altBox = null;
    var chipBoxes = [];
    var rowBoxes = [];

    function initialize() {
        View.initialize();
    }

    function onShow() {
        Nav.shown();
    }

    //! What the screen shows now: :over, :met, or on the set page :wait, :ask, :fix, :hcd, :hold,
    //! :rest, :end, :card (nothing to log here) or :set.
    function mode() {
        if (G.page == :over || G.page == :met) {
            return G.page;
        }
        var s = G.state;
        if (Core.entries(s).size() == 0) {
            return :wait;
        }
        if (G.ask) {
            return :ask;
        }
        var c = Ed.cur();
        if (c != null && c[5]) {
            return :fix;
        }
        if (G.hcd != null) {
            return :hcd;
        }
        if (G.hold != null) {
            return :hold;
        }
        var left = Rest.left();
        if (left != null && left > 0) {
            return :rest;
        }
        if (c == null) {
            return :end;
        }
        return (c[1] == null || Core.isCardio(c[2])) ? :card : :set;
    }

    function onUpdate(dc) {
        Ui.clear(dc);
        wBox = null; rBox = null; doneBox = null; prevBox = null; nextBox = null;
        minusBox = null; plusBox = null; altBox = null; chipBoxes = []; rowBoxes = [];
        var s = G.state;
        if (s["w"] == null) {
            // ended, the summary is on its way (a confirmation was still on top)
            return;
        }
        var m = mode();
        var h = dc.getHeight();
        var xt = Graphics.FONT_XTINY;
        if (m == :over) {
            overview(dc);
        } else if (m == :met) {
            metrics(dc);
        } else if (m == :wait) {
            // Started by name: the phone builds it and sends it back.
            Ui.line(dc, h * 0.3, Graphics.FONT_SMALL, Core.strOf(s["w"]["name"]), Graphics.COLOR_WHITE);
            Ui.wrap(dc, h * 0.58, xt, Ui.t(Rez.Strings.waiting_phone), Ui.quiet(), 3);
        } else if (m == :ask) {
            ask(dc);
        } else if (m == :hcd) {
            Ui.countdown(dc, G.hcd, Ui.t(Rez.Strings.start_hold));
        } else if (m == :hold) {
            hold(dc);
        } else if (m == :rest) {
            rest(dc);
        } else if (m == :end) {
            // The end page: the rest of the workout comes from the phone, or it is all done (with
            // the sets and the sync, the Overview's lines, for the watches without one).
            var y0 = topY(dc);
            y0 += Ui.status(dc, y0, null);
            var sb = Ui.subscreen();
            if (sb != null && y0 < sb[1] + sb[3]) { y0 = sb[1] + sb[3]; }
            var ph = Ui.pillH(dc);
            var y1 = bottomY(dc) - ph * 3 / 2;
            var xh = dc.getFontHeight(xt);
            if (Core.hasMore(s)) {
                Ui.wrap(dc, (y0 + y1) / 2, xt, Ui.t(Rez.Strings.next_on_phone), Graphics.COLOR_WHITE, 3);
            } else {
                var mid = (y0 + y1) / 2 - xh;
                var ad = Ui.title(dc, Ui.t(Rez.Strings.all_sets_done), [Graphics.FONT_SMALL, xt], mid - xh * 2, 2);
                Ui.drawLines(dc, mid - dc.getFontHeight(ad[0]) * ad[1].size(), ad[0], ad[1], Ui.accent());
                Ui.line(dc, mid + xh, xt, Lang.format(Ui.t(Rez.Strings.sets_of), Core.progress(s)), Graphics.COLOR_WHITE);
                Ui.syncLine(dc, mid + xh * 2, true);
            }
            doneBox = Ui.pill(dc, y1 + ph / 2, Ui.t(Rez.Strings.finish_workout), true);
        } else if (m == :card) {
            var c = Ed.cur();
            var name = Core.strOf(c[2]["name"]);
            var top2 = topY(dc);
            var y = top2 + Ui.status(dc, top2, null);
            var tl = Ui.title(dc, name, [Graphics.FONT_SMALL, Graphics.FONT_TINY], y + 4, 2);
            Ui.drawLines(dc, y + 4, tl[0], tl[1], Graphics.COLOR_WHITE);
            Ui.wrap(dc, h * 0.52, xt, Ui.t(Core.isCardio(c[2]) ? Rez.Strings.log_on_phone : Rez.Strings.all_sets_done), Ui.quiet(), 3);
            doneBox = Ui.pill(dc, h * 0.76, Ui.t(Rez.Strings.next_exercise), false);
        } else {
            set(dc, Ed.cur());
        }
    }

    /* ---------- the set (and a set being fixed) ---------- */

    function set(dc, c) {
        var s = G.state;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var gap = (h * 0.015).toNumber() + 1;
        var ph = Ui.pillH(dc);
        var e = c[2];
        var row = c[3];
        var fixing = c[5];
        var name = Core.strOf(e["name"]);

        // "Set 2 of 4", what kind of set, and the side; "Edit" in front on a set being fixed.
        var pl = Core.place(e, c[1]);
        var tag = Core.isTrue(row["warmup"]) ? Ui.t(Rez.Strings.warmup) + " " + pl[0] + "/" + pl[1] : Lang.format(Ui.t(Rez.Strings.set_of), pl);
        if (dc.getTextWidthInPixels(tag, xt) > Ui.widthAt(dc, dc.getHeight() / 5) && Core.isTrue(row["warmup"])) {
            tag = Ui.t(Rez.Strings.warmup);
        }
        var side = c[4];
        if (side != null) {
            tag = tag + " · " + Ui.t(side.equals("L") ? Rez.Strings.left : Rez.Strings.right);
        }
        if (fixing) {
            tag = Ui.t(Rez.Strings.edit) + " · " + tag;
        }
        var tagColor = fixing ? Ui.accent() : (Core.isTrue(row["warmup"]) ? Ui.warm() : Ui.quiet());
        // the superset's other exercises, named
        var ps = Core.partners(s, c[0]);
        var partner = ps.size() > 0 ? "+ " + ps[0] + (ps.size() > 1 ? " +" + (ps.size() - 1) : "") : null;

        var two = Ed.hasWeight(e);
        var timed = Core.isTimed(e);
        var label2 = Ui.t(timed ? Rez.Strings.hold : Rez.Strings.reps);
        // number fonts have digits, ":" and "." only: a hold shows as 0:45
        var v2 = timed ? Ui.clock(Ed.r == null ? 0 : Ed.r.toNumber()) : Ui.fmtN(Ed.r);
        var v1 = Ui.fmtW(Ed.w);
        var st = Core.dictOf(s["set"]);
        var show = st == null ? null : Core.dictOf(st["show"]);
        var last = (!fixing && (show == null || !Core.isOff(show["last"])) && (e["last"] instanceof Lang.String)) ? e["last"] : null;

        // While fixing during a rest, the rest's time left stays in sight at the top.
        var rl = Rest.left();
        var top = topY(dc);
        var restTop = fixing && rl != null && rl > 0;
        // (on the Instinct the time sits in its round window: no line for it)
        var statusH = Ui.subscreen() == null || restTop ? xh : 0;
        var bottom = bottomY(dc);
        var avail = bottom - top - statusH;
        // The name: whole on one line at the biggest font that takes it, else on two or three (a
        // smaller font before anything is cut), and only when even that does not fit with the
        // smallest numbers, one line cut with "...".
        var lh = xh;
        var boxW = two ? ((Ui.widthAt(dc, h / 2) - 8) / 2) : (w * 0.55).toNumber();
        if (two && boxW > w * 0.42) { boxW = (w * 0.42).toNumber(); }
        var base = xh + gap * 2 + ph + gap + lh + 6;
        var tl = Ui.title(dc, name, [Graphics.FONT_SMALL, Graphics.FONT_TINY], top + statusH, 1);
        // a small screen gives the time's line to the name (the sync pill moves beside "Set 1 of 2")
        var pillOnTag = false;
        if (tl[1][0].find("...") != null) {
            var minNum = Ui.hOf(dc, Graphics.FONT_NUMBER_MILD);
            var fonts = [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY];
            var found = null;
            for (var pass = 0; pass < 2 && found == null; pass += 1) {
                var sh = pass == 0 ? statusH : 0;
                if (pass == 1 && (statusH == 0 || restTop)) {
                    break;
                }
                for (var i = 0; i < 3 && found == null; i += 1) {
                    var t = Ui.title(dc, name, [fonts[i]], top + sh, 3);
                    var l = t[1][t[1].size() - 1];
                    var whole = l.length() < 3 || !l.substring(l.length() - 3, l.length()).equals("...");
                    if (whole && dc.getFontHeight(fonts[i]) * t[1].size() + base + minNum <= avail + statusH - sh) {
                        found = t;
                        if (pass == 1) {
                            avail += statusH;
                            statusH = 0;
                            pillOnTag = true;
                        }
                    }
                }
            }
            if (found == null) {
                // nothing shows it whole: two lines cut at a word beat one cut short, where they fit
                found = Ui.title(dc, name, [Graphics.FONT_XTINY], top + statusH, 2);
                var need2 = dc.getFontHeight(Graphics.FONT_XTINY) * found[1].size() + base + minNum;
                if (need2 > avail && statusH > 0 && !restTop && need2 <= avail + statusH) {
                    avail += statusH;
                    statusH = 0;
                    pillOnTag = true;
                    found = Ui.title(dc, name, [Graphics.FONT_XTINY], top, 2);
                } else if (need2 > avail) {
                    found = Ui.title(dc, name, [Graphics.FONT_XTINY], top + statusH, 1);
                }
            }
            tl = found;
        }
        var nameF = tl[0];
        var nfh = dc.getFontHeight(nameF);
        var nameH = nfh * tl[1].size();
        var fixed = nameH + base - lh - 6;
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_MEDIUM, avail - fixed - lh - 6, two ? [v1, v2] : [v2], boxW - 10);
        var nh = Ui.hOf(dc, nf);
        var boxH = nh + lh + 6;
        // the boxes stay clear of the Instinct's sub-screen (the lines above go beside it)
        var sb = Ui.subscreen();
        var boxMin = sb == null ? 0 : sb[1] + sb[3] + 4;
        var room = avail - fixed - boxH;
        var aboveBoxes = top + statusH + nameH + xh + gap;
        if (boxMin > aboveBoxes) {
            room -= boxMin - aboveBoxes;
        }
        // then, as far as there is room: the partner, last time
        var partnerLine = false;
        if (partner != null) {
            if (room >= xh) {
                partnerLine = true;
                room -= xh;
            } else if (dc.getTextWidthInPixels(tag + "  " + partner, xt) <= Ui.widthAt(dc, top + statusH + nfh)) {
                tag = tag + "  " + partner;
            }
        }
        var lastLine = last != null && room >= xh;
        if (lastLine) {
            room -= xh;
        }

        if (!pillOnTag) {
            Ui.status(dc, top, restTop ? Ui.t(Rez.Strings.rest) + " " + Ui.clock(rl) : null);
        }
        var y = top + statusH + (room > gap * 4 ? gap * 2 : 0);
        y += Ui.drawLines(dc, y, nameF, tl[1], Graphics.COLOR_WHITE);
        var waiting = pillOnTag ? Core.waiting(s) : 0;
        if (waiting > 0) {
            var pw = Ui.syncPill(dc, 0, 0, waiting, false);
            var tw = dc.getTextWidthInPixels(tag, xt);
            dc.setColor(tagColor, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2 - (tw + pw + 6) / 2, y + xh / 2, xt, tag, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            Ui.syncPill(dc, w / 2 - (tw + pw + 6) / 2 + tw + 6, y + xh / 2, waiting, true);
        } else {
            Ui.line(dc, y + xh / 2, xt, tag, tagColor);
        }
        y += xh;
        if (partnerLine) {
            Ui.line(dc, y + xh / 2, xt, partner, Ui.quiet());
            y += xh;
        }
        y += gap;
        if (y < boxMin) {
            y = boxMin;
        }
        if (two) {
            var unit = Core.unitOf(s, e);
            wBox = value(dc, w / 2 - 4 - boxW, y, boxW, boxH, nf, v1, Core.isTrue(e["bodyweight"]) ? "+" + unit : unit, Ed.focus == :w);
            rBox = value(dc, w / 2 + 4, y, boxW, boxH, nf, v2, label2, Ed.focus == :r);
        } else {
            rBox = value(dc, (w - boxW) / 2, y, boxW, boxH, nf, v2, label2, true);
        }
        y += boxH + gap;
        if (lastLine) {
            Ui.line(dc, y + xh / 2, xt, Lang.format(Ui.t(Rez.Strings.last_time), [last]), Ui.quiet());
            y += xh;
        }
        var label = Ui.t(fixing ? Rez.Strings.save : (timed && Ui.big() ? Rez.Strings.start_hold : Rez.Strings.done));
        doneBox = Ui.pill(dc, y + gap + ph / 2, label, true);
        // ‹ › beside it on touch screens (on buttons: "Previous set" in the menu)
        if (Ui.isTouch()) {
            var cy = y + gap + ph / 2;
            if (fixing || (Ui.fixes(s))) {
                prevBox = arrow(dc, doneBox[0] - 6, cy, -1);
            }
            if (fixing) {
                nextBox = arrow(dc, doneBox[0] + doneBox[2] + 6, cy, 1);
            }
        }
    }

    (:notouch)
    function arrow(dc, x, cy, dir) {
        return null;
    }
    //! A small ‹ or › (a triangle: the text fonts of some watches have no such glyph), left of x
    //! (dir -1) or right of it; its box, for taps, a finger wide.
    (:touch)
    function arrow(dc, x, cy, dir) {
        var a = 7;
        var cx = x + dir * (a + 6);
        var off = cx - dc.getWidth() / 2;
        if (off < 0) { off = -off; }
        if (Ui.widthAt(dc, cy) / 2 < off + a + 4) {
            return null;
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([[cx + dir * a, cy], [cx - dir * a / 2, cy - a], [cx - dir * a / 2, cy + a]]);
        return [cx - 18, cy - 18, 36, 36];
    }

    //! A number in its box with its label under it; the focused one outlined in the accent (or
    //! inverted on black and white). Returns its box, for taps.
    function value(dc, x, y, bw, bh, font, text, label, focused) {
        var col = Ui.box(dc, x, y, bw, bh, focused);
        var lf = Graphics.FONT_XTINY;
        var lh = dc.getFontHeight(lf);
        var nh = Ui.hOf(dc, font);
        var cx = x + bw / 2;
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y + 2 + nh / 2, font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(focused ? col : Ui.quiet(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y + bh - lh / 2 - 2, lf, Ui.fit(dc, label, lf, bw - 6), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return [x, y, bw, bh];
    }

    /* ---------- the rest ---------- */

    function rest(dc) {
        var s = G.state;
        var h = dc.getHeight();
        var left = Rest.left();
        if (left == null) { left = 0; }
        if (Rest.total == null || left > Rest.total) {
            Rest.total = left > 0 ? left : 1;
        }
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var gap = (h * 0.015).toNumber() + 1;
        var ph = Ui.pillH(dc);
        var top = topY(dc);
        var barBottom = Ui.ring(dc, left.toFloat() / Rest.total, Ui.accent(), top + xh + 2);
        var y0 = top + Ui.status(dc, top, null);
        if (barBottom > y0) { y0 = barBottom; }
        var bottom = bottomY(dc) - (Ui.isRound() ? Ui.inset : 0);
        var touch = Ui.isTouch();

        // Up next: the exercise and set, and its numbers.
        var st = Core.dictOf(s["set"]);
        var show = st == null ? null : Core.dictOf(st["show"]);
        var next = null;
        var nums = null;
        if (show == null || !Core.isOff(show["next"])) {
            var e = Core.entryAt(s, s["pos"]);
            var si = Core.setIndex(s, s["pos"]);
            if (e != null && si != null) {
                next = Lang.format(Ui.t(Rez.Strings.up_next_set), [Core.strOf(e["name"]), Core.place(e, si)[0]]);
                var row = Core.dictOf(Core.arrOf(e["sets"])[si]);
                if (Core.isTimed(e)) {
                    nums = Ui.clock(Core.toI(row["sec"], 0));
                } else if (Core.toF(row["r"]) != null) {
                    var ww = Core.toF(row["w"]);
                    nums = (ww != null && ww > 0 ? Ui.fmtW(ww) + " " + Core.unitOf(s, e) + " × " : "") + Ui.fmtN(row["r"]) + " " + Ui.t(Rez.Strings.reps);
                }
                var sd = Core.sideUp(row);
                if (sd != null) {
                    nums = (nums == null ? "" : nums + " · ") + Ui.t(sd.equals("L") ? Rez.Strings.left : Rez.Strings.right);
                }
            }
        }
        // The effort for the set just done: chips on touch screens, the menu on buttons; once
        // given, a small capsule (a tap opens the chips again).
        var kind = st == null ? null : st["effort"];
        var canRate = Actions.canRate();
        var chips = touch && G.rated == null && canRate;
        var capsule = G.rated != null && canRate;
        var chipH = chips ? dc.getFontHeight(Graphics.FONT_TINY) + 6 : (capsule ? xh + 2 : 0);
        var btnH = touch ? dc.getFontHeight(Graphics.FONT_SMALL) + 8 : ph;

        var fixedH = xh + gap + btnH + gap + (chipH > 0 ? chipH + gap : 0);
        var nextH = next != null ? xh + (nums != null ? xh : 0) : 0;
        var maxW = Ui.widthAt(dc, h / 2);
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_HOT, bottom - y0 - fixedH - nextH, ["0:00", Ui.clock(left)], maxW);
        var nh = Ui.hOf(dc, nf);
        var room = bottom - y0 - fixedH - nh;
        if (room < nextH && nums != null) { nums = null; nextH = xh; }
        if (room < nextH) { next = null; nextH = 0; }
        var total = fixedH + nh + nextH;
        var y = y0 + (bottom - y0 - total) / 2;
        if (y < y0) { y = y0; }

        Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.rest), Ui.quiet());
        y += xh;
        Ui.num(dc, y + nh / 2, nf, Ui.clock(left), Graphics.COLOR_WHITE);
        y += nh + gap;
        if (next != null) {
            Ui.line(dc, y + xh / 2, xt, next, Graphics.COLOR_WHITE);
            y += xh;
            if (nums != null) {
                Ui.line(dc, y + xh / 2, xt, nums, Ui.quiet());
                y += xh;
            }
        }
        y = effortRow(dc, y, chipH, kind, chips, capsule) + (chipH > 0 ? gap : 0);
        if (touch) {
            touchRow(dc, y, btnH);
        } else {
            doneBox = Ui.pill(dc, y + ph / 2, Ui.t(Rez.Strings.skip), false);
        }
        Ui.inset = 0;
    }

    //! The effort for the set just done: four chips (touch), or the capsule once given.
    (:big)
    function effortRow(dc, y, chipH, kind, chips, capsule) {
        var w = dc.getWidth();
        var xt = Graphics.FONT_XTINY;
        if (chips) {
            var cs = Core.chips(kind);
            var cw = (Ui.widthFor(dc, y + chipH / 2, chipH) - 6 * 3) / 4;
            if (cw > 48) { cw = 48; }
            var x = w / 2 - (cw * 4 + 18) / 2;
            for (var i = 0; i < 4; i += 1) {
                dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(2);
                dc.drawRoundedRectangle(x, y, cw, chipH, chipH / 2);
                dc.setPenWidth(1);
                dc.drawText(x + cw / 2, y + chipH / 2, Graphics.FONT_TINY, Core.chipLabel(kind, cs[i]), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                chipBoxes.add([x, y, cw, chipH, cs[i]]);
                x += cw + 6;
            }
            return y + chipH;
        }
        if (capsule) {
            var label = (Core.same(kind, "rpe") ? "RPE " : "RIR ") + Core.chipLabel(kind, G.rated);
            var lw = dc.getTextWidthInPixels(label, xt) + 16;
            dc.setColor(Ui.accent(), Graphics.COLOR_TRANSPARENT);
            dc.drawRoundedRectangle(w / 2 - lw / 2, y, lw, chipH, chipH / 2);
            dc.drawText(w / 2, y + chipH / 2, xt, label, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            altBox = [w / 2 - lw / 2, y, lw, chipH];
            return y + chipH;
        }
        return y;
    }
    (:small)
    function effortRow(dc, y, chipH, kind, chips, capsule) {
        return y;
    }

    //! -15 | Skip | +15 in a row, on touch screens.
    (:touch)
    function touchRow(dc, y, btnH) {
        var w = dc.getWidth();
        var rw = Ui.widthFor(dc, y + btnH / 2, btnH);
        var bw = rw / 3 - 4;
        var bx = w / 2 - (bw * 3 + 8) / 2;
        var labels = ["-15", Ui.t(Rez.Strings.skip), "+15"];
        for (var j = 0; j < 3; j += 1) {
            var bxj = bx + j * (bw + 4);
            dc.setColor(j == 1 ? Graphics.COLOR_WHITE : Ui.dim(), Graphics.COLOR_TRANSPARENT);
            if (j == 1 || !Ui.amoled()) {
                dc.drawRoundedRectangle(bxj, y, bw, btnH, btnH / 2);
            } else {
                dc.fillRoundedRectangle(bxj, y, bw, btnH, btnH / 2);
            }
            var f = Ui.textFont(dc, labels[j], bw - 8);
            dc.setColor(j == 1 ? Graphics.COLOR_WHITE : Ui.accent(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(bxj + bw / 2, y + btnH / 2, f, Ui.fit(dc, labels[j], f, bw - 8), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        minusBox = [bx, y, bw, btnH];
        doneBox = [bx + bw + 4, y, bw, btnH];
        plusBox = [bx + 2 * (bw + 4), y, bw, btnH];
    }
    (:notouch)
    function touchRow(dc, y, btnH) {
    }

    /* ---------- a hold ---------- */

    (:small)
    function hold(dc) {
    }
    (:big)
    function hold(dc) {
        var s = G.state;
        var h = dc.getHeight();
        var w = dc.getWidth();
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var gap = (h * 0.015).toNumber() + 1;
        var ph = Ui.pillH(dc);
        var hd = G.hold;
        var left = hd[1] - Actions.held();
        if (left < 0) { left = 0; }
        var top = topY(dc);
        var y = top + Ui.status(dc, top, null) + gap;
        var e = Core.entryAt(s, s["pos"]);
        var si = Core.setIndex(s, s["pos"]);
        var name = e == null ? "" : Core.strOf(e["name"]);
        var tl = Ui.title(dc, name, [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY], y, 1);
        y += Ui.drawLines(dc, y, tl[0], tl[1], Graphics.COLOR_WHITE);
        var row = (e == null || si == null) ? null : Core.dictOf(Core.arrOf(e["sets"])[si]);
        var sd = Core.sideUp(row);
        Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.hold) + (sd != null ? " · " + Ui.t(sd.equals("L") ? Rez.Strings.left : Rez.Strings.right) : ""), Ui.teal());
        y += xh + gap;
        var sb = Ui.subscreen();
        if (sb != null && y < sb[1] + sb[3] + 4) { y = sb[1] + sb[3] + 4; }
        var bottom = bottomY(dc);
        var barH = 8;
        var clk = Ui.clock(left);
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_HOT, bottom - y - ph - barH - gap * 3, ["0:00", clk], Ui.widthAt(dc, h / 2));
        var nh = Ui.hOf(dc, nf);
        // the last 5 s: orange on colour screens, the number inverted on black and white
        var end = left <= 5;
        if (end && Ui.mono()) {
            var tw = dc.getTextWidthInPixels(clk, nf) + 16;
            Ui.box(dc, w / 2 - tw / 2, y, tw, nh + 4, true);
            Ui.num(dc, y + 2 + nh / 2, nf, clk, Graphics.COLOR_BLACK);
        } else {
            Ui.num(dc, y + 2 + nh / 2, nf, clk, end ? Ui.warm() : Graphics.COLOR_WHITE);
        }
        y += nh + 4 + gap;
        var bw = Ui.widthFor(dc, y + barH / 2, barH) - 10;
        Ui.bar(dc, w / 2 - bw / 2, y, bw, barH, hd[1] > 0 ? left.toFloat() / hd[1] : 0.0, end ? Ui.warm() : Ui.teal());
        y += barH + gap * 2;
        doneBox = Ui.pill(dc, y + ph / 2, Ui.t(Rez.Strings.stop), false);
    }

    /* ---------- "All done?" (not on the watches with the least memory) ---------- */

    (:small)
    function ask(dc) {
    }
    (:big)
    function ask(dc) {
        var h = dc.getHeight();
        var xt = Graphics.FONT_XTINY;
        var sh = dc.getFontHeight(Graphics.FONT_SMALL);
        var ph = Ui.pillH(dc);
        var gap = (h * 0.02).toNumber() + 1;
        var w = Core.dictOf(G.state["w"]);
        var last = w == null ? null : Core.lastSet(w);
        var min = last == null ? 20 : ((Core.nowMs() - last) / 60000l).toNumber();
        var top = topY(dc);
        var y = top + Ui.status(dc, top, null) + gap;
        Ui.wrap(dc, y + sh / 2, Graphics.FONT_SMALL, Ui.t(Rez.Strings.still_training), Ui.accent(), 1);
        y += sh;
        var bottom = bottomY(dc);
        var pillsTop = bottom - ph * 2 - gap;
        Ui.wrap(dc, (y + pillsTop) / 2, xt, G.askLeft ? Ui.t(Rez.Strings.left_gym) : Lang.format(Ui.t(Rez.Strings.no_set_for), [min]), Graphics.COLOR_WHITE, 3);
        doneBox = Ui.pill(dc, pillsTop + ph / 2, Ui.t(Rez.Strings.keep_going), true);
        altBox = Ui.pill(dc, bottom - ph / 2, Ui.t(Rez.Strings.finish_workout), false);
    }

    /* ---------- Overview ---------- */

    (:nofixui)
    function overview(dc) {
    }
    (:fixui)
    function overview(dc) {
        var s = G.state;
        var h = dc.getHeight();
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var gap = (h * 0.015).toNumber() + 1;
        var ph = Ui.pillH(dc);
        var top = topY(dc);
        var y = top + Ui.status(dc, top, Ui.t(Rez.Strings.overview));
        var bottom = bottomY(dc);
        var prs = Lang.format(Ui.t(Rez.Strings.sets_of), Core.progress(s));
        var sf = Ui.textFont(dc, prs, Ui.widthFor(dc, y + 12, 24));
        var sh = dc.getFontHeight(sf);
        Ui.line(dc, y + sh / 2, sf, prs, Graphics.COLOR_WHITE);
        y += sh;
        // where the sets are: "Waiting to sync 3", "All synced"
        Ui.syncLine(dc, y + xh / 2, true);
        y += xh + gap;
        var sb = Ui.subscreen();
        if (sb != null && y < sb[1] + sb[3]) { y = sb[1] + sb[3]; }
        // the window's exercises, the one up now outlined, a superset under its heading
        var es = Core.entries(s);
        var rh = xh + 4;
        var rowsEnd = bottom - ph * 3 / 2 - gap;
        var cur = s["pos"];
        var first = 0;
        var fits = (rowsEnd - y) / rh;
        if (fits > 0 && cur >= fits && cur < es.size()) { first = cur - fits + 1; }
        for (var i = first; i < es.size() && y + rh <= rowsEnd; i += 1) {
            var e = Core.dictOf(es[i]);
            var g = e["group"];
            if (g != null && (i == 0 || !Core.same(Core.dictOf(es[i - 1])["group"], g)) && i + 1 < es.size() && Core.same(Core.dictOf(es[i + 1])["group"], g)) {
                if (y + xh + rh > rowsEnd) { break; }
                Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.superset), Ui.quiet());
                y += xh;
            }
            var done = 0;
            var all = 0;
            var rows = Core.arrOf(e["sets"]);
            for (var j = 0; j < rows.size(); j += 1) {
                var r = Core.dictOf(rows[j]);
                if (!Core.isTrue(r["warmup"])) {
                    all += 1;
                    if (Core.isTrue(r["done"])) { done += 1; }
                }
            }
            var rw = Ui.widthFor(dc, y + rh / 2, rh) - 4;
            var x0 = Ui.cxFor(dc, y + rh / 2, rh) - rw / 2;
            var count = done + "/" + all;
            var cw = dc.getTextWidthInPixels(count, xt);
            var finished = all > 0 && done >= all;
            if (i == cur) {
                Ui.box(dc, x0, y, rw, rh, true);
            }
            var col = i == cur && Ui.mono() ? Graphics.COLOR_BLACK : (finished ? Ui.quiet() : Graphics.COLOR_WHITE);
            dc.setColor(col, Graphics.COLOR_TRANSPARENT);
            dc.drawText(x0 + 8, y + rh / 2, xt, Ui.fit(dc, Core.strOf(e["name"]), xt, rw - cw - 22), Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(i == cur ? col : (finished ? Ui.accent() : Ui.quiet()), Graphics.COLOR_TRANSPARENT);
            dc.drawText(x0 + rw - 8, y + rh / 2, xt, count, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
            rowBoxes.add([x0, y, rw, rh, i]);
            y += rh + 1;
        }
        // exercises after the window: the phone sends them as the workout goes on
        var w0 = Core.dictOf(s["w"]);
        var lastE = es.size() > 0 ? Core.dictOf(es[es.size() - 1]) : null;
        var after = w0 == null ? 0 : Core.toI(w0["count"], es.size()) - (lastE == null ? 0 : Core.toI(lastE["i"], es.size() - 1) + 1);
        if (after > 0 && y + xh <= rowsEnd) {
            Ui.line(dc, y + xh / 2, xt, "+" + after + " " + Ui.t(Rez.Strings.exercises), Ui.quiet());
        }
        doneBox = Ui.pill(dc, bottom - ph, Ui.t(Ui.isTouch() ? Rez.Strings.hold_to_finish : Rez.Strings.finish_workout), true);
    }

    /* ---------- Metrics (not on the watches with the least memory) ---------- */

    (:small)
    function metrics(dc) {
    }
    (:big)
    function metrics(dc) {
        var s = G.state;
        var h = dc.getHeight();
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var sh = dc.getFontHeight(Graphics.FONT_SMALL);
        var gap = (h * 0.015).toNumber() + 1;
        var top = topY(dc);
        var y = top + Ui.status(dc, top, null) + gap;
        var sb = Ui.subscreen();
        // the time, big and yellow; it stands still while the phone has the workout paused
        var wk = Core.dictOf(s["w"]);
        var start = wk == null ? null : Core.toMs(wk["start"]);
        var paused = wk == null ? null : Core.toMs(wk["pausedAt"]);
        var sec = start == null ? 0 : (((paused != null ? paused : Core.nowMs()) - start) / 1000l).toNumber();
        var clk = Ui.clock(sec);
        var bottom = bottomY(dc);
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_MEDIUM, bottom - y - xh - (sh + xh) * 2 - gap * 2, [clk], Ui.widthAt(dc, h / 2) - (sb != null ? sb[2] : 0));
        var nh = Ui.hOf(dc, nf);
        Ui.num(dc, y + nh / 2, nf, clk, Ui.yellow());
        y += nh;
        Ui.line(dc, y + xh / 2, xt, Ui.t(Rez.Strings.time), Ui.quiet());
        y += xh + gap;
        if (sb != null && y < sb[1] + sb[3]) { y = sb[1] + sb[3]; }
        var pr = Core.progress(s);
        var vol = wk == null ? 0.0 : Core.summary(s, wk, false)["vol"];
        cols(dc, y, [pr[0] + "/" + pr[1], Ui.fmtN(vol) + " " + Core.unitOf(s, null)], [Ui.t(Rez.Strings.sets), Ui.t(Rez.Strings.volume)]);
        y += sh + xh + gap;
        // heart rate and calories (the activity Garmin records), when there are any
        var info = Activity.getActivityInfo();
        var kcal = info == null ? null : info.calories;
        if (y + sh + xh <= bottom) {
            var vals = [];
            var labs = [];
            if (G.bpm != null) { vals.add(G.bpm.toString()); labs.add(Ui.t(Rez.Strings.heart_rate)); }
            if (kcal != null && kcal > 0) { vals.add(kcal.toString()); labs.add("kcal"); }
            if (vals.size() > 0) {
                cols(dc, y, vals, labs);
            }
        }
    }

    //! One or two numbers side by side, each with its label under it.
    (:big)
    function cols(dc, y, vals, labs) {
        var w = dc.getWidth();
        var sf = Graphics.FONT_SMALL;
        var sh = dc.getFontHeight(sf);
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var n = vals.size();
        var cw = Ui.widthFor(dc, y + (sh + xh) / 2, sh + xh) / n;
        for (var i = 0; i < n; i += 1) {
            var cx = n == 1 ? w / 2 : (i == 0 ? w / 2 - cw / 2 : w / 2 + cw / 2);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, y + sh / 2, sf, Ui.fit(dc, vals[i], sf, cw - 6), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Ui.quiet(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, y + sh + xh / 2, xt, Ui.fit(dc, labs[i], xt, cw - 6), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }
}

class SessionDelegate extends WatchUi.BehaviorDelegate {
    private var _v;

    function initialize(v) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    //! START is caught as the key it is (on the Venu Sq 2 it is no "select" at all). A tap is a
    //! "select" first: on touch watches that goes on to onTap, which knows where the finger was.
    function onKey(ev) {
        if (ev.getKey() == WatchUi.KEY_ENTER) {
            return select();
        }
        return false;
    }

    function onSelect() {
        return Ui.isTouch() ? false : select();
    }

    function select() {
        var m = _v.mode();
        if (G.locked() && m != :hcd && m != :hold) {
            return true;
        }
        if (m == :set) {
            Ed.done();
        } else if (m == :fix) {
            Ed.save();
        } else if (m == :hcd) {
            Actions.holdStart();
        } else if (m == :hold) {
            Actions.holdStop();
        } else if (m == :rest) {
            skipRest();
        } else if (m == :ask) {
            Actions.keepGoing(true);
        } else if (m == :end || m == :over) {
            Menus.confirmFinish();
        } else if (m == :card) {
            Actions.nextExercise();
        } else if (m == :met) {
            page(:set);
        }
        return true;
    }

    function skipRest() {
        if (!G.locked()) {
            Rest.stop();
            Nav.follow();
            WatchUi.requestUpdate();
        }
        return true;
    }

    function page(p) {
        G.page = p;
        WatchUi.requestUpdate();
        return true;
    }

    //! BACK never leaves a running workout by accident: on a set it switches weight and reps (or
    //! opens the menu where there is only one number); elsewhere it goes back to the set.
    function onBack() {
        var m = _v.mode();
        if (m == :set) {
            if (!Ed.toggle()) {
                Menus.workout();
            }
        } else if (m == :fix) {
            if (!Ed.toggle()) {
                G.fix = null;
                WatchUi.requestUpdate();
            }
        } else if (m == :hcd) {
            Actions.holdCancel();
        } else if (m == :hold) {
            Actions.holdStop();
        } else if (m == :rest) {
            skipRest();
        } else if (m == :ask) {
            Actions.keepGoing(true);
        } else if (m == :over || m == :met) {
            page(:set);
        } else {
            Menus.workout();
        }
        return true;
    }

    //! UP: more of the outlined number; +15 s on a rest; on Metrics back to the set.
    function onPreviousPage() {
        var m = _v.mode();
        if (m == :set || m == :fix) {
            Ed.adjust(1);
        } else if (m == :rest) {
            if (!G.locked()) {
                Rest.add(15);
                WatchUi.requestUpdate();
            }
        } else if (m == :met) {
            page(:set);
        }
        return true;
    }

    //! DOWN: less of it; -15 s on a rest (a Skip at 15 s or less); on the Overview back to the set;
    //! on "All done?" Finish (the Overview, with its Finish).
    function onNextPage() {
        var m = _v.mode();
        if (m == :set || m == :fix) {
            Ed.adjust(-1);
        } else if (m == :rest) {
            if (!G.locked()) {
                Rest.add(-15);
                WatchUi.requestUpdate();
            }
        } else if (m == :over) {
            page(:set);
        } else if (m == :ask) {
            endAsk();
        }
        return true;
    }

    function endAsk() {
        Actions.keepGoing(false);
        page(:over);
    }

    //! Touch: swipe down / up for more / less; swipe left for the next page (Set, Metrics,
    //! Overview, round again). Swipe right is the watch's own BACK: back to the set.
    (:touch)
    function onSwipe(ev) {
        var d = ev.getDirection();
        var m = _v.mode();
        if (d == WatchUi.SWIPE_LEFT) {
            if (G.page == :set && Ui.big()) {
                return page(:met);
            }
            return page(G.page == :over ? :set : (Ui.roomy() ? :over : :set));
        }
        if (m == :set || m == :fix) {
            if (d == WatchUi.SWIPE_DOWN) {
                Ed.adjust(1);
            } else if (d == WatchUi.SWIPE_UP) {
                Ed.adjust(-1);
            }
            return true;
        }
        return false;
    }

    (:touch)
    function onTap(ev) {
        var xy = ev.getCoordinates();
        var x = xy[0];
        var y = xy[1];
        var m = _v.mode();
        if (m == :rest) {
            if (G.locked()) {
                return true;
            }
            for (var i = 0; i < _v.chipBoxes.size(); i += 1) {
                var c = _v.chipBoxes[i];
                if (Ui.inBox(c, x, y)) {
                    Actions.rate(c[4]);
                    return true;
                }
            }
            if (Ui.inBox(_v.altBox, x, y)) {
                G.rated = null;
                WatchUi.requestUpdate();
            } else if (Ui.inBox(_v.minusBox, x, y)) {
                return onNextPage();
            } else if (Ui.inBox(_v.plusBox, x, y)) {
                return onPreviousPage();
            } else if (Ui.inBox(_v.doneBox, x, y)) {
                return skipRest();
            }
            return true;
        }
        if (m == :over) {
            for (var j = 0; j < _v.rowBoxes.size(); j += 1) {
                var r = _v.rowBoxes[j];
                if (Ui.inBox(r, x, y) && Core.setIndex(G.state, r[4]) != null) {
                    G.state["pos"] = r[4];
                    G.hold = null;
                    G.hcd = null;
                    return page(:set);
                }
            }
        }
        if (m == :ask && Ui.inBox(_v.altBox, x, y)) {
            endAsk();
            return true;
        }
        if (Ui.inBox(_v.doneBox, x, y)) {
            return select();
        }
        if (Ui.inBox(_v.prevBox, x, y)) {
            Actions.fixStep(-1);
        } else if (Ui.inBox(_v.nextBox, x, y)) {
            Actions.fixStep(1);
        } else if (Ui.inBox(_v.wBox, x, y)) {
            Ed.focus = :w;
            WatchUi.requestUpdate();
        } else if (Ui.inBox(_v.rBox, x, y)) {
            Ed.focus = :r;
            WatchUi.requestUpdate();
        } else if (m == :hold || m == :hcd || m == :met) {
            select();
        } else if (y < System.getDeviceSettings().screenHeight * 0.25) {
            // the top (the name): the menu
            Menus.workout();
        }
        return true;
    }

    function onMenu() {
        Menus.workout();
        return true;
    }

    //! Touch and hold: on the Overview's button it finishes at once ("Hold to finish"); anywhere
    //! else the menu.
    (:touch)
    function onHold(ev) {
        var xy = ev.getCoordinates();
        if (_v.mode() == :over && Ui.inBox(_v.doneBox, xy[0], xy[1])) {
            Actions.finish(false);
            return true;
        }
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
        var titleS = Core.isTrue(sm["ended"]) ? Ui.t(Rez.Strings.ended_on_phone) : Ui.t(Rez.Strings.workout_saved);
        var top = topY(dc);
        var bottom = bottomY(dc);
        // the title and the name wrap (two lines at most) before they get cut: "Workout s..." no more
        var tt = Ui.title(dc, titleS, [xt], top + xh / 2, 2);
        var name = Core.strOf(sm["name"]);
        var nt = Ui.title(dc, name, [Graphics.FONT_SMALL, Graphics.FONT_TINY, xt], top + xh * 2, 2);
        var dur = Ui.clock(sm["dur"]);
        var hr = sm["hr"];
        var foot = hr != null ? Lang.format(Ui.t(Rez.Strings.hr_avg_max), hr) : null;
        var fixed = xh * tt[1].size() + dc.getFontHeight(nt[0]) * nt[1].size() + gap * 2 + sh + xh;
        var nf = Ui.numFont(dc, Graphics.FONT_NUMBER_MEDIUM, bottom - top - fixed - xh * 2, [dur], w * 0.7);
        var nh = Ui.hOf(dc, nf);
        var left = bottom - top - fixed - nh;
        var withSync = left >= xh;
        if (withSync) { left -= xh; }
        var withFoot = foot != null && left >= xh;
        if (withFoot) { left -= xh; }
        var withTime = left >= xh;
        if (withTime) { left -= xh; }
        // the name's second line goes first when it is short of room
        if (left < 0 && nt[1].size() > 1) {
            nt = [nt[0], [Ui.fit(dc, name, nt[0], Ui.widthAt(dc, top + xh * 2))]];
            left += dc.getFontHeight(nt[0]);
        }
        var y = top + (left > 0 ? left / 2 : 0);

        y += Ui.drawLines(dc, y, xt, tt[1], Ui.accent());
        y += Ui.drawLines(dc, y, nt[0], nt[1], Graphics.COLOR_WHITE) + gap;
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
        var vol = Ui.fmtN(sm["vol"]) + " " + Core.strOf(sm["unit"]);
        var cw = Ui.widthAt(dc, y + sh) / 2 - 2;
        var vf = Ui.textFont(dc, vol, cw);
        dc.drawText(w / 2 - cw / 2, y + sh / 2, vf, sm["sets"].toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w / 2 + cw / 2, y + sh / 2, vf, Ui.fit(dc, vol, vf, cw), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        y += sh;
        dc.setColor(Ui.quiet(), Graphics.COLOR_TRANSPARENT);
        col = Ui.widthAt(dc, y + xh) / 2 - 2;
        dc.drawText(w / 2 - col / 2, y + xh / 2, xt, Ui.fit(dc, Ui.t(Rez.Strings.sets), xt, col), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w / 2 + col / 2, y + xh / 2, xt, Ui.fit(dc, Ui.t(Rez.Strings.volume), xt, col), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        y += xh;
        if (withFoot) {
            Ui.line(dc, y + xh / 2, xt, foot, Ui.heart());
            y += xh;
        }
        if (withSync) {
            Ui.syncLine(dc, y + xh / 2, true);
        } else if (Core.waiting(G.state) > 0) {
            // no room for the words: the pill at the top
            var n = Core.waiting(G.state);
            var pw = Ui.syncPill(dc, 0, 0, n, false);
            Ui.syncPill(dc, w / 2 - pw / 2, top / 2 + 3, n, true);
        }
    }
}

class SummaryDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    //! Done ignores the summary's first second (the thumb that finished is still there), and the
    //! start screen's Start waits a second after it.
    function close() {
        if (System.getTimer() - G.endedAt < 1000) {
            return true;
        }
        G.ended = null;
        G.lock = System.getTimer() + 1000;
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

    (:touch)
    function onTap(ev) {
        return close();
    }
}
