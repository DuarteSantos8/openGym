// Drawing helpers shared by the screens. Garmin screens are small and many are memory-in-pixel
// (MIP: 64 colours, read in sunlight) or, on the Instinct, black and white: big numbers, white on
// black, the accent (the brand's green by default) only where it means something (the value you are changing, Done, a
// streak kept). The monochrome watches build with the (:mono) functions (monkey.jungle).
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

module Ui {
    // The redesign's look (the Apple Watch's Theme.swift, adapted): black, the phone's accent for
    // what you press or change, number boxes. AMOLED screens get filled grey boxes like the other
    // watches; MIP screens (64 colours) outlines, with the accent rounded to the nearest colour
    // the screen has; black-and-white ones (the Instinct) outlines, and the focused box inverted.

    var accS = null;
    var accV = null;
    var inkV = null;

    //! "#30d158" as 0x30D158, or null.
    function hex(v) {
        if (!(v instanceof Lang.String) || v.length() != 7 || !v.substring(0, 1).equals("#")) {
            return null;
        }
        var n = 0;
        var digits = "0123456789abcdef";
        var low = v.toLower();
        for (var i = 1; i < 7; i += 1) {
            var d = digits.find(low.substring(i, i + 1));
            if (d == null) {
                return null;
            }
            n = n * 16 + d;
        }
        return n;
    }

    //! A colour as the screen has it: as is on AMOLED, else each channel on the MIP palette's grid.
    function onScreen(c) {
        if (amoled()) {
            return c;
        }
        var out = 0;
        for (var sh = 16; sh >= 0; sh -= 8) {
            var ch = (c >> sh) & 0xFF;
            out = (out << 8) | (((ch + 42) / 85) * 85);
        }
        return out;
    }

    //! Whether text on c should be black (a light colour) rather than white.
    function light(c) {
        return ((c >> 16) & 0xFF) * 3 + ((c >> 8) & 0xFF) * 6 + (c & 0xFF) > 1100;
    }

    //! The phone's accent (settings.accent), else the brand's green (#a3e635; 0xAAFF55 on the MIP
    //! palette's grid, where the old 0x55FF55 was the iOS green's); and the ink on it, black on both.
    (:color)
    function accent() {
        var st = G.state == null ? null : G.state["set"];
        var a = (st instanceof Lang.Dictionary) ? st["accent"] : null;
        if (accV == null || !(a == null ? accS == null : Core.same(a, accS))) {
            accS = a;
            var c = hex(a);
            // the phone makes the user's own colour readable on black; a very dark one is not
            if (c == null || (((c >> 16) & 0xFF) < 0x50 && ((c >> 8) & 0xFF) < 0x50 && (c & 0xFF) < 0x50)) {
                c = amoled() ? 0xA3E635 : 0xAAFF55;
            }
            accV = onScreen(c);
            var ink = amoled() ? hex(st instanceof Lang.Dictionary ? st["onAccent"] : null) : null;
            inkV = ink != null && c == hex(a) ? ink : (light(accV) ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE);
        }
        return accV;
    }
    (:mono)
    function accent() {
        return Graphics.COLOR_WHITE;
    }
    (:color)
    function onAccent() {
        accent();
        return inkV;
    }
    (:mono)
    function onAccent() {
        return Graphics.COLOR_BLACK;
    }
    //! Screens that stay lit (AMOLED): filled boxes, a smooth 3-2-1. MIP and mono: outlines, steps.
    (:color)
    function amoled() {
        var ds = System.getDeviceSettings();
        return (ds has :requiresBurnInProtection) && ds.requiresBurnInProtection;
    }
    (:mono)
    function amoled() {
        return false;
    }
    (:color)
    function mono() {
        return false;
    }
    (:mono)
    function mono() {
        return true;
    }
    //! Whether this build has Metrics, the effort and "All done?" (not on the watches with the
    //! least memory: (:small) in monkey.jungle).
    (:big)
    function big() {
        return true;
    }
    (:small)
    function big() {
        return false;
    }
    //! Whether this build has the Overview and fixing a set (all but the Instinct 2 family's 96 KB).
    (:fixui)
    function roomy() {
        return true;
    }
    (:nofixui)
    function roomy() {
        return false;
    }
    //! Whether there is a logged set to fix (never on the Instinct 2 family's 96 KB: (:nofixui)).
    (:fixui)
    function fixes(s) {
        return Core.fixList(s).size() > 0;
    }
    (:nofixui)
    function fixes(s) {
        return false;
    }
    function smooth() {
        return amoled();
    }
    (:color)
    function quiet() {
        return 0xAAAAAA;
    }
    (:mono)
    function quiet() {
        return Graphics.COLOR_WHITE;
    }
    (:color)
    function warm() {
        return amoled() ? 0xFF9F0A : 0xFFAA00;
    }
    (:mono)
    function warm() {
        return Graphics.COLOR_WHITE;
    }
    (:color)
    function heart() {
        return 0xFF5555;
    }
    (:mono)
    function heart() {
        return Graphics.COLOR_WHITE;
    }
    //! The Metrics page's time (Apple Workout's yellow), a hold's bar (teal).
    (:color)
    function yellow() {
        return amoled() ? 0xFFD60A : 0xFFFF55;
    }
    (:mono)
    function yellow() {
        return Graphics.COLOR_WHITE;
    }
    (:color)
    function teal() {
        return amoled() ? 0x40C8E0 : 0x55FFFF;
    }
    (:mono)
    function teal() {
        return Graphics.COLOR_WHITE;
    }
    (:color)
    function dim() {
        return amoled() ? 0x2C2C2E : 0x555555;
    }
    (:mono)
    function dim() {
        return Graphics.COLOR_WHITE;
    }

    //! A number box: grey on AMOLED, outlined on MIP, the focused one ringed in the accent (inverted
    //! on black and white). Returns the colour for the text in it.
    (:color)
    function box(dc, x, y, w, h, focused) {
        var r = h / 5;
        if (amoled()) {
            dc.setColor(0x1C1C1E, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x, y, w, h, r);
        }
        if (focused || !amoled()) {
            dc.setColor(focused ? accent() : 0x555555, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(focused ? 3 : 1);
            dc.drawRoundedRectangle(x, y, w, h, r);
            dc.setPenWidth(1);
        }
        return focused ? accent() : Graphics.COLOR_WHITE;
    }
    (:mono)
    function box(dc, x, y, w, h, focused) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        if (focused) {
            dc.fillRoundedRectangle(x, y, w, h, h / 5);
            return Graphics.COLOR_BLACK;
        }
        dc.drawRoundedRectangle(x, y, w, h, h / 5);
        return Graphics.COLOR_WHITE;
    }

    //! A bar that fills to frac: a grey track on colour screens, an outline on black and white.
    function bar(dc, x, y, w, h, frac, col) {
        if (frac < 0) { frac = 0.0; }
        if (frac > 1) { frac = 1.0; }
        dc.setColor(dim(), Graphics.COLOR_TRANSPARENT);
        if (mono()) {
            dc.drawRoundedRectangle(x, y, w, h, h / 2);
        } else {
            dc.fillRoundedRectangle(x, y, w, h, h / 2);
        }
        var fw = (w * frac).toNumber();
        if (fw >= h) {
            dc.setColor(col, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x, y, fw, h, h / 2);
        }
    }

    //! The sync pill: an arrow and the number of sets still on their way to the phone (orange; an
    //! outline on black and white). Returns its width.
    function syncPill(dc, x, cy, n, draw) {
        var f = Graphics.FONT_XTINY;
        var t = n.toString();
        var h = dc.getFontHeight(f) - 2;
        if (h > 22) { h = 22; }
        var w = dc.getTextWidthInPixels(t, f) + h + 6;
        if (!draw) {
            return w;
        }
        var y = cy - h / 2;
        var ink = Graphics.COLOR_BLACK;
        dc.setColor(warm(), Graphics.COLOR_TRANSPARENT);
        if (mono()) {
            dc.drawRoundedRectangle(x, y, w, h, h / 2);
            ink = Graphics.COLOR_WHITE;
        } else {
            dc.fillRoundedRectangle(x, y, w, h, h / 2);
        }
        dc.setColor(ink, Graphics.COLOR_TRANSPARENT);
        var ax = x + h / 2 + 1;
        var a = h / 4;
        dc.fillPolygon([[ax - a - 1, cy], [ax, cy - a - 2], [ax + a + 1, cy]]);
        dc.fillRectangle(ax - 1, cy, 3, a + 2);
        dc.drawText(x + h, cy, f, t, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        return w;
    }

    //! The line at a screen's top, as the other watches have it beside their clock: the time (or a
    //! rest's time left, while a set is being fixed), the heart rate, and the sync pill. Returns
    //! its height.
    (:color)
    function status(dc, y, first) {
        var f = Graphics.FONT_XTINY;
        var fh = dc.getFontHeight(f);
        var text = first != null ? first : clockNow();
        var tw = dc.getTextWidthInPixels(text, f);
        var total = tw;
        var bpm = G.bpm;
        var st = Core.dictOf(G.state["set"]);
        var show = st == null ? null : Core.dictOf(st["show"]);
        if (bpm != null && (show == null || !Core.isOff(show["hr"]))) {
            total += 8 + 14 + dc.getTextWidthInPixels(bpm.toString(), f);
        } else {
            bpm = null;
        }
        var n = Core.waiting(G.state);
        var pw = n > 0 ? syncPill(dc, 0, 0, n, false) : 0;
        if (n > 0) {
            total += 8 + pw;
        }
        var maxW = widthFor(dc, y + fh / 2, fh);
        if (total > maxW && bpm != null) {
            total -= 8 + 14 + dc.getTextWidthInPixels(bpm.toString(), f);
            bpm = null;
        }
        var x = cxFor(dc, y + fh / 2, fh) - total / 2;
        dc.setColor(first != null ? accent() : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y + fh / 2, f, text, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        x += tw + 8;
        if (bpm != null) {
            var bw = 14 + dc.getTextWidthInPixels(bpm.toString(), f);
            hr(dc, x + bw / 2, y + fh / 2, bpm);
            x += bw + 8;
        }
        if (n > 0) {
            syncPill(dc, x, y + fh / 2, n, true);
        }
        return fh;
    }

    //! The Instinct: the time and the sync pill go in its round window, a title beside it.
    (:mono)
    function status(dc, y, first) {
        var f = Graphics.FONT_XTINY;
        var fh = dc.getFontHeight(f);
        var sb = subscreen();
        var cx = sb[0] + sb[2] / 2;
        var cy = sb[1] + sb[3] / 2;
        var n0 = Core.waiting(G.state);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, n0 > 0 ? cy - fh / 2 + 2 : cy, f, clockNow(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        if (n0 > 0) {
            var pw0 = syncPill(dc, 0, 0, n0, false);
            syncPill(dc, cx - pw0 / 2, cy + fh / 2, n0, true);
        }
        if (first == null) {
            return 0;
        }
        line(dc, y + fh / 2, f, first, accent());
        return fh;
    }

    //! The watch's time, as its settings say (24 h, or 12 h without am / pm).
    function clockNow() {
        var ct = System.getClockTime();
        var h = ct.hour;
        if (!System.getDeviceSettings().is24Hour) {
            h = h % 12 == 0 ? 12 : h % 12;
        }
        return h.toString() + ":" + ct.min.format("%02d");
    }

    //! The sync line at y: in words where they fit, else just the pill (a narrow bottom, the
    //! Instinct). Nothing when all is synced and always is false.
    function syncLine(dc, y, always) {
        var text = syncText(always);
        if (text == null) {
            return;
        }
        var f = Graphics.FONT_XTINY;
        var n = Core.waiting(G.state);
        if (n > 0 && dc.getTextWidthInPixels(text, f) > widthFor(dc, y, dc.getFontHeight(f))) {
            var pw = syncPill(dc, 0, 0, n, false);
            syncPill(dc, cxFor(dc, y, 10) - pw / 2, y, n, true);
            return;
        }
        line(dc, y, f, text, n > 0 ? warm() : quiet());
    }

    //! The sync line in words: "Waiting to sync 3", "Phone out of reach", "All synced" (or null
    //! when everything is synced and that is not worth saying).
    function syncText(always) {
        var n = Core.waiting(G.state);
        if (n > 0) {
            return G.awayAt != null ? t(Rez.Strings.phone_out_of_reach) + " (" + n + ")" : t(Rez.Strings.waiting_sync) + " " + n;
        }
        return always ? t(Rez.Strings.all_synced) : null;
    }

    function t(id) {
        return WatchUi.loadResource(id);
    }

    function isRound() {
        return System.getDeviceSettings().screenShape == System.SCREEN_SHAPE_ROUND;
    }

    function isTouch() {
        var ds = System.getDeviceSettings();
        return (ds has :isTouchScreen) && ds.isTouchScreen;
    }

    function clear(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
    }

    //! The Instinct's round sub-screen (top right) as [x, y, w, h], or null: nothing is drawn under it.
    var sub = null;
    var subAsked = false;

    function subscreen() {
        if (!subAsked) {
            subAsked = true;
            if (WatchUi has :getSubscreen) {
                var b = WatchUi.getSubscreen();
                if (b != null) {
                    sub = [b.x, b.y, b.width, b.height];
                }
            }
        }
        return sub;
    }

    //! Extra room kept free at a round screen's edge (the rest ring), in px per side.
    var inset = 0;

    //! Whether a line of height hh centred at y runs beside the sub-screen.
    function besideSub(y, hh) {
        var sb = subscreen();
        return sb != null && y + hh / 2 > sb[1] && y - hh / 2 < sb[1] + sb[3];
    }

    //! The width that is really on screen at height y: a chord on a round screen, less a margin;
    //! beside the Instinct's sub-screen, only what is left of it.
    function widthAt(dc, y) {
        var w = dc.getWidth();
        var out;
        if (!isRound()) {
            out = w - 16 - 2 * cut(dc, y);
        } else {
            var r = w / 2.0 - inset;
            var dy = y - dc.getHeight() / 2.0;
            if (dy < 0) {
                dy = -dy;
            }
            out = dy >= r ? 0 : (2 * Math.sqrt(r * r - dy * dy) - 20).toNumber();
        }
        if (besideSub(y, 2)) {
            var sb = subscreen();
            if (sb[0] - 8 - cut(dc, y) < out) {
                out = sb[0] - 8 - cut(dc, y);
            }
        }
        return out;
    }

    //! How far the Instinct's semi-octagon cuts into the screen at height y, on each side (its
    //! corners are cut off at 45 degrees); 0 elsewhere.
    function cut(dc, y) {
        if (System.getDeviceSettings().screenShape != System.SCREEN_SHAPE_SEMI_OCTAGON) {
            return 0;
        }
        var c = (dc.getWidth() * 0.16).toNumber();
        var d = y < dc.getHeight() - y ? y : dc.getHeight() - y;
        return d < c ? (c - d).toNumber() : 0;
    }

    //! The width for a line of height hh centred at y: the narrower of its top and bottom edge
    //! (a little inside, glyphs do not fill the whole line height).
    function widthFor(dc, y, hh) {
        var a = widthAt(dc, y - hh * 0.35);
        var b = widthAt(dc, y + hh * 0.35);
        if (besideSub(y, hh)) {
            var sb = subscreen();
            var c = cut(dc, y - hh * 0.35);
            if (sb[0] - 8 - c < a) {
                a = sb[0] - 8 - c;
            }
        }
        return a < b ? a : b;
    }

    //! The centre of a line at y: the middle, or beside the sub-screen the middle of what is left.
    function cxFor(dc, y, hh) {
        if (besideSub(y, hh)) {
            return (subscreen()[0] + cut(dc, y - hh * 0.35)) / 2;
        }
        return dc.getWidth() / 2;
    }

    //! The height a font takes in a stack of lines. Number fonts carry room above and below the
    //! digits (they have no lower case), so they stack a little tighter.
    function hOf(dc, font) {
        var fh = dc.getFontHeight(font);
        if (font == Graphics.FONT_NUMBER_MILD || font == Graphics.FONT_NUMBER_MEDIUM || font == Graphics.FONT_NUMBER_HOT) {
            return (fh * 0.8).toNumber();
        }
        return fh;
    }

    //! The biggest number font, from `top` down, that takes no more than `room` px in the stack and
    //! keeps every text no wider than maxW (one watch's FONT_NUMBER_MEDIUM is a fifth of the
    //! screen, another's two fifths).
    function numFont(dc, top, room, texts, maxW) {
        var fonts = [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD];
        var i = top == Graphics.FONT_NUMBER_HOT ? 0 : (top == Graphics.FONT_NUMBER_MEDIUM ? 1 : 2);
        while (i < 2) {
            if (hOf(dc, fonts[i]) <= room && widest(dc, texts, fonts[i]) <= maxW) {
                return fonts[i];
            }
            i += 1;
        }
        return Graphics.FONT_NUMBER_MILD;
    }

    function widest(dc, texts, font) {
        var m = 0;
        for (var i = 0; i < texts.size(); i += 1) {
            var tw = dc.getTextWidthInPixels(texts[i], font);
            if (tw > m) {
                m = tw;
            }
        }
        return m;
    }

    //! The biggest text font that fits s in maxW: SMALL, else TINY, else XTINY (cut to fit then).
    function textFont(dc, s, maxW) {
        if (dc.getTextWidthInPixels(s, Graphics.FONT_SMALL) <= maxW) {
            return Graphics.FONT_SMALL;
        }
        if (dc.getTextWidthInPixels(s, Graphics.FONT_TINY) <= maxW) {
            return Graphics.FONT_TINY;
        }
        return Graphics.FONT_XTINY;
    }

    //! The height a stack of lines may take: a round screen's top and bottom are too narrow.
    function room(dc) {
        return (dc.getHeight() * (isRound() ? 0.88 : 0.95)).toNumber();
    }

    //! Where a stack of lines this tall starts: centred, but clear of the round edge's top.
    function stackTop(dc, total) {
        var h = dc.getHeight();
        var y = (h - total) / 2;
        var min = (h * (isRound() ? 0.06 : 0.03)).toNumber();
        return y < min ? min : y;
    }

    //! The text cut to fit maxW, with "..." when it had to be.
    function fit(dc, s, font, maxW) {
        if (s == null) {
            return "";
        }
        if (dc.getTextWidthInPixels(s, font) <= maxW) {
            return s;
        }
        var n = s.length();
        while (n > 1 && dc.getTextWidthInPixels(s.substring(0, n) + "...", font) > maxW) {
            n -= 1;
        }
        return s.substring(0, n) + "...";
    }

    //! One line, centred, cut to the width at its height.
    function line(dc, y, font, s, color) {
        var fh = dc.getFontHeight(font);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cxFor(dc, y, fh), y, font, fit(dc, s, font, widthFor(dc, y, fh)), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! A big number, centred at y (beside the sub-screen where it reaches it).
    function num(dc, y, font, s, color) {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cxFor(dc, y, hOf(dc, font)), y, font, s, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! s broken into at most maxLines lines of maxW, at spaces (CJK and Thai, which have none,
    //! anywhere: the width check is per character then); what does not fit is cut with "...".
    //! Each line's width is the screen's at that line's height (lines from the top at y).
    function lines(dc, s, font, y, maxLines) {
        var out = [];
        var rest = s;
        var fh = dc.getFontHeight(font);
        var maxW = 0;
        while (rest.length() > 0 && out.size() < maxLines) {
            maxW = widthFor(dc, y + fh * out.size() + fh / 2, fh);
            if (dc.getTextWidthInPixels(rest, font) <= maxW) {
                out.add(rest);
                rest = "";
                break;
            }
            var cut = rest.length();
            while (cut > 1 && dc.getTextWidthInPixels(rest.substring(0, cut), font) > maxW) {
                cut -= 1;
            }
            // back to the last space, when there is one in the line
            var sp = cut;
            while (sp > 0 && !rest.substring(sp - 1, sp).equals(" ")) {
                sp -= 1;
            }
            if (sp > 1) {
                cut = sp;
            }
            // (the space it broke at stays out of the line)
            out.add(rest.substring(0, sp > 1 ? cut - 1 : cut));
            rest = rest.substring(cut, rest.length());
            while (rest.length() > 0 && rest.substring(0, 1).equals(" ")) {
                rest = rest.substring(1, rest.length());
            }
        }
        if (rest.length() > 0 && out.size() > 0) {
            var k = out.size() - 1;
            out[k] = fit(dc, out[k] + " " + rest, font, maxW);
        }
        return out;
    }

    //! A title (an exercise's or a routine's name) set as big as it fits: whole on one line at the
    //! biggest of fonts that takes it, else on two (up to maxLines), else the smallest font, cut
    //! with "..." at the end. Returns [font, lines].
    function title(dc, s, fonts, y, maxLines) {
        // one line at any of the fonts before two lines at the biggest
        for (var n = 1; n <= maxLines; n += 1) {
            for (var i = 0; i < fonts.size(); i += 1) {
                var ls = lines(dc, s, fonts[i], y, n);
                var l = ls[ls.size() - 1];
                var cut = l.length() >= 3 && l.substring(l.length() - 3, l.length()).equals("...") && s.find("...") == null;
                if (!cut || (n == maxLines && i == fonts.size() - 1)) {
                    return [fonts[i], ls];
                }
            }
        }
        return [fonts[0], [s]];
    }

    //! Lines from the top at y, centred, each cut to the width at its height.
    function drawLines(dc, y, font, ls, color) {
        var fh = dc.getFontHeight(font);
        for (var i = 0; i < ls.size(); i += 1) {
            line(dc, y + fh * i + fh / 2, font, ls[i], color);
        }
        return fh * ls.size();
    }

    //! A few lines, centred around y.
    function wrap(dc, y, font, s, color, maxLines) {
        var fh = dc.getFontHeight(font);
        var ls = lines(dc, s, font, y - fh * maxLines / 2, maxLines);
        drawLines(dc, y - fh * ls.size() / 2, font, ls, color);
    }

    //! A pill button centred at cy: lime with black text (filled), or outlined. Returns its box
    //! [x, y, w, h], for taps.
    function pill(dc, cy, label, filled) {
        var font = Graphics.FONT_SMALL;
        var h = pillH(dc);
        var maxW = widthFor(dc, cy, h / 0.7) - 8;
        var w = dc.getTextWidthInPixels(label, font) + 32;
        if (w < dc.getWidth() * 0.42) {
            w = (dc.getWidth() * 0.42).toNumber();
        }
        if (w > maxW) {
            w = maxW;
        }
        // a label too long for the pill gets a smaller font before it gets cut
        font = textFont(dc, label, w - 12);
        var cx = cxFor(dc, cy, h);
        var x = cx - w / 2;
        var y = cy - h / 2;
        if (filled) {
            dc.setColor(accent(), Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x, y, w, h, h / 2);
            dc.setColor(onAccent(), Graphics.COLOR_TRANSPARENT);
        } else {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            dc.drawRoundedRectangle(x, y, w, h, h / 2);
            dc.setPenWidth(1);
        }
        dc.drawText(cx, cy, font, fit(dc, label, font, w - 12), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return [x, y, w, h];
    }

    function pillH(dc) {
        return dc.getFontHeight(Graphics.FONT_SMALL) + 8;
    }

    function inBox(box, x, y) {
        return box != null && x >= box[0] && x <= box[0] + box[2] && y >= box[1] - 6 && y <= box[1] + box[3] + 6;
    }

    //! A small heart (two dots and a point) and the bpm after it, centred at (cx, y).
    (:mono)
    function hr(dc, cx, y, bpm) {
    }
    (:color)
    function hr(dc, cx, y, bpm) {
        var s = bpm.toString();
        var font = Graphics.FONT_XTINY;
        var tw = dc.getTextWidthInPixels(s, font);
        var x0 = cx - (tw + 14) / 2;
        dc.setColor(heart(), Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x0 + 3, y - 2, 3);
        dc.fillCircle(x0 + 8, y - 2, 3);
        dc.fillPolygon([[x0, y - 1], [x0 + 11, y - 1], [x0 + 5, y + 5]]);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x0 + 14, y, font, s, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! A ring round a round screen that empties to frac (a bar along the top elsewhere, left of the
    //! Instinct's sub-screen). Sets the inset the lines inside keep; returns the bar's bottom (or 0).
    (:mono)
    function ring(dc, frac, col, y) {
        var sb = subscreen();
        var x0 = 12 + cut(dc, y + 3);
        bar(dc, x0, y, (sb != null ? sb[0] - 8 : dc.getWidth() - 12) - x0, 6, frac, col);
        return y + 6;
    }
    (:color)
    function ring(dc, frac, col, y) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        if (frac < 0) { frac = 0.0; }
        if (isRound()) {
            var pen = w > 300 ? 8 : 6;
            var r = w / 2 - pen / 2 - 2;
            dc.setPenWidth(pen);
            dc.setColor(dim(), Graphics.COLOR_TRANSPARENT);
            if (mono()) {
                dc.setPenWidth(1);
            }
            dc.drawCircle(w / 2, h / 2, r);
            dc.setPenWidth(pen);
            if (frac > 0.003) {
                dc.setColor(col, Graphics.COLOR_TRANSPARENT);
                if (frac >= 0.999) {
                    dc.drawCircle(w / 2, h / 2, r);
                } else {
                    dc.drawArc(w / 2, h / 2, r, Graphics.ARC_CLOCKWISE, 90, 90 - (360 * frac).toNumber());
                }
            }
            dc.setPenWidth(1);
            inset = pen + 4;
            return 0;
        }
        var sb = subscreen();
        var x0 = 12 + cut(dc, y + 3);
        var bw = (sb != null ? sb[0] - 8 : w - 12) - x0;
        bar(dc, x0, y, bw, 6, frac, col);
        return y + 6;
    }

    (:small)
    function countdown(dc, from, label) {
    }
    //! The 3-2-1 (the workout's start, a hold's): a ring that drains, the number in the middle,
    //! then "Go!" in the full ring. Smooth on AMOLED, a step a second elsewhere.
    (:big)
    function countdown(dc, from, label) {
        clear(dc);
        var h = dc.getHeight();
        var el = System.getTimer() - from;
        var n = Core.countNumber(el);
        var frac = n == 0 ? 1.0 : (smooth() ? 1.0 - el / 3000.0 : n / 3.0);
        var top = ring(dc, frac, accent(), (h * 0.04).toNumber() + 2);
        var xt = Graphics.FONT_XTINY;
        var xh = dc.getFontHeight(xt);
        var big = n == 0 ? t(Rez.Strings.go) : n.toString();
        var f = n == 0 ? textFont(dc, big, widthAt(dc, h / 2)) : numFont(dc, Graphics.FONT_NUMBER_HOT, h - top - xh * 3, [big], widthAt(dc, h / 2));
        if (n == 0 && f == Graphics.FONT_SMALL && dc.getTextWidthInPixels(big, Graphics.FONT_LARGE) <= widthAt(dc, h / 2)) {
            f = Graphics.FONT_LARGE;
        }
        var nh = n == 0 ? dc.getFontHeight(f) : hOf(dc, f);
        var y = (h - nh - xh) / 2;
        if (y < top + 4) { y = top + 4; }
        line(dc, y + xh / 2, xt, label, quiet());
        if (n == 0) {
            line(dc, y + xh + nh / 2, f, big, accent());
        } else {
            num(dc, y + xh + nh / 2, f, big, Graphics.COLOR_WHITE);
        }
        inset = 0;
    }

    //! 62.5 → "62.5", 60.0 → "60", 1.25 → "1.25".
    function fmtW(w) {
        if (w == null) {
            return "0";
        }
        var c = Math.round(w * 100).toNumber();
        if (c % 100 == 0) {
            return (c / 100).toString();
        }
        if (c % 10 == 0) {
            return w.format("%.1f");
        }
        return w.format("%.2f");
    }

    function fmtN(v) {
        return v == null ? "0" : Math.round(v).toNumber().toString();
    }

    //! Seconds as m:ss, or h:mm:ss from an hour.
    function clock(sec) {
        if (sec == null || sec < 0) {
            sec = 0;
        }
        var h = sec / 3600;
        var m = (sec % 3600) / 60;
        var s = sec % 60;
        if (h > 0) {
            return h.toString() + ":" + m.format("%02d") + ":" + s.format("%02d");
        }
        return m.toString() + ":" + s.format("%02d");
    }
}
