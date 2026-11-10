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

    //! The width that is really on screen at height y: a chord on a round screen, less a margin.
    function widthAt(dc, y) {
        var w = dc.getWidth();
        if (!isRound()) {
            return w - 16;
        }
        var r = w / 2.0;
        var dy = y - dc.getHeight() / 2.0;
        if (dy < 0) {
            dy = -dy;
        }
        if (dy >= r) {
            return 0;
        }
        return (2 * Math.sqrt(r * r - dy * dy) - 20).toNumber();
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
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, y, font, fit(dc, s, font, widthAt(dc, y)), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    //! A few lines, centred around y, broken at spaces (CJK and Thai, which have none, break
    //! anywhere: the width check is per character then).
    function wrap(dc, y, font, s, color, maxLines) {
        var lines = [];
        var rest = s;
        var fh = dc.getFontHeight(font);
        var top = y - (fh * (maxLines - 1)) / 2;
        while (rest.length() > 0 && lines.size() < maxLines) {
            var maxW = widthAt(dc, top + fh * lines.size());
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
            lines[k] = fit(dc, lines[k] + " " + rest, font, widthAt(dc, top + fh * k));
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
        var h = dc.getFontHeight(font) + 8;
        var maxW = widthAt(dc, cy + h / 2) - 8;
        var w = dc.getTextWidthInPixels(label, font) + 32;
        if (w < dc.getWidth() * 0.42) {
            w = (dc.getWidth() * 0.42).toNumber();
        }
        if (w > maxW) {
            w = maxW;
        }
        var x = (dc.getWidth() - w) / 2;
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
        dc.drawText(dc.getWidth() / 2, cy, font, fit(dc, label, font, w - 12), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return [x, y, w, h];
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
