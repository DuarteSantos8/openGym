package ch.duartesantos.opengym;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * How a Huawei watch's messages are cut up and put together again (HuaweiLink, watch app in
 * watch-huawei). Wear Engine carries 1 KB of text per message, so one JSON text goes as numbered
 * frames, `<id>.<i>.<n>|<part>`. The watch has the same codec in JavaScript (watch-huawei/entry/src/main/js/MainAbility/common/frames.js);
 * both pass the cases in watch-huawei/test/frames.json. Plain Java so the JVM tests reach it.
 */
final class HuaweiFrames {
    private HuaweiFrames() {}

    /** Characters of the escaped text in one frame (the head takes at most 13 of the 1024 bytes). */
    static final int PART = 960;
    static final int MAX_PARTS = 16;

    /** Every character outside 0x20..0x7E as a backslash-u escape with four hex digits: in JSON only strings hold such characters, so JSON.parse gives the text back. */
    static String escape(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= 0x20 && c <= 0x7E) b.append(c);
            else b.append(String.format("\\u%04x", (int) c));
        }
        return b.toString();
    }

    /** Whether a message fits in MAX_PARTS frames (else it is not sent). */
    static boolean fits(String text) { return escape(text).length() <= MAX_PARTS * PART; }

    /** The frames of one message, or none when it would need more than MAX_PARTS (it is not sent). */
    static List<String> frames(String text, String id) {
        String e = escape(text);
        int n = Math.max(1, (e.length() + PART - 1) / PART);
        List<String> out = new ArrayList<>();
        if (n > MAX_PARTS) return out;
        for (int i = 0; i < n; i++) out.add(id + "." + i + "." + n + "|" + e.substring(i * PART, Math.min(e.length(), (i + 1) * PART)));
        return out;
    }

    private static final Pattern HEAD = Pattern.compile("^([0-9a-z]{1,6})\\.(\\d+)\\.(\\d+)\\|");

    /** One watch's frames, gathered into whole messages. One message at a time is in the making. */
    static final class Receiver {
        private String id;
        private String[] parts;

        /** The frame's part joined with the others once the message is whole (its escaped text), else null. */
        String accept(String frame) {
            Matcher m = HEAD.matcher(frame);
            if (!m.find()) return null;
            int i, n;
            try { i = Integer.parseInt(m.group(2)); n = Integer.parseInt(m.group(3)); } catch (NumberFormatException e) { return null; }
            if (n < 1 || n > MAX_PARTS || i >= n) return null;
            // Another message (or another cut of it) started: what was gathered is dropped.
            if (!m.group(1).equals(id) || parts.length != n) { id = m.group(1); parts = new String[n]; }
            parts[i] = frame.substring(m.end());
            for (String p : parts) if (p == null) return null;
            StringBuilder b = new StringBuilder();
            for (String p : parts) b.append(p);
            String text = b.toString();
            id = null;
            parts = null;
            return text.startsWith("{") && text.endsWith("}") ? text : null;
        }
    }
}
