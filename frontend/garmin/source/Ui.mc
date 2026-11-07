// Drawing helpers shared by the screens. Garmin screens are small and many are memory-in-pixel
// (MIP: 64 colours, read in sunlight) or, on the Instinct, black and white: big numbers, white on
// black, the lime accent only where it means something (the value you are changing, Done, a
// streak kept). The monochrome watches build with the (:mono) functions (monkey.jungle).
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

module Ui {
    //! openGym's green on AMOLED (the app's --green); on MIP the palette's own bright lime, which
    //! shows as it is instead of being rounded to a dull green.
    (:color)
    function accent() {
        var ds = System.getDeviceSettings();
        if ((ds has :requiresBurnInProtection) && ds.requiresBurnInProtection) {
            return 0x30D158;
        }
        return 0x55FF55;
    }
    (:mono)
    function accent() {
        return Graphics.COLOR_WHITE;
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
        return 0xFFAA00;
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

    //! A few lines, centred around y, broken at spaces (CJK and Thai, which have none, break
    //! anywhere: the width check is per character then).
    function wrap(dc, y, font, s, color, maxLines) {
        var lines = [];
        var rest = s;
        var fh = dc.getFontHeight(font);
        var top = y - (fh * (maxLines - 1)) / 2;
        while (rest.length() > 0 && lines.size() < maxLines) {
            var maxW = widthFor(dc, top + fh * lines.size(), fh);
            if (dc.getTextWidthInPixels(rest, font) <= maxW) {
                lines.add(rest);
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
            if (sp > 0) {
                cut = sp;
            }
            lines.add(rest.substring(0, cut));
            rest = rest.substring(cut, rest.length());
            while (rest.length() > 0 && rest.substring(0, 1).equals(" ")) {
                rest = rest.substring(1, rest.length());
            }
        }
        if (rest.length() > 0 && lines.size() > 0) {
            var k = lines.size() - 1;
            lines[k] = fit(dc, lines[k] + " " + rest, font, widthFor(dc, top + fh * k, fh));
        }
        top = y - (fh * (lines.size() - 1)) / 2;
        for (var i = 0; i < lines.size(); i += 1) {
            line(dc, top + fh * i, font, lines[i], color);
        }
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
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
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
