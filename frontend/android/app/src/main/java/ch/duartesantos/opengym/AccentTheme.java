package ch.duartesantos.opengym;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;

/**
 * The text selection handles, the native caret and the highlight in a native text field are drawn
 * by Android from the activity theme (colorAccent / colorControlActivated), where the page's CSS
 * cannot reach (#980). The page passes its accent here (lib/system-bars.js); it is kept in the
 * preferences and laid over the theme as one of nine overlays (styles.xml, Accent.*), now and at
 * every start. Nothing saved yet (a new install, before the page has said) is the brand's green, a
 * new profile's accent since 1.4.5. A colour of the user's own takes the preset closest to it: a theme is fixed in
 * resources, and the selection highlight drawn by the page itself is the exact colour anyway.
 */
final class AccentTheme {
    private AccentTheme() {}

    static final String PREFS = "opengym_accent";
    static final String KEY = "accent";

    // The same presets as lib/format.js ACCENTS, in that order.
    static final String[] NAMES = { "brand", "lime", "sky", "orange", "violet", "pink", "red", "teal", "gold" };
    static final int[] COLORS = { 0xa3e635, 0x30d158, 0x0a84ff, 0xff9f0a, 0xbf5af2, 0xff375f, 0xff453a, 0x40c8e0, 0xffd60a };

    /** The preset index for a preset key or a '#rrggbb' colour, or -1 for anything else. */
    static int presetFor(String accent) {
        if (accent == null) return -1;
        String a = accent.trim().toLowerCase();
        for (int i = 0; i < NAMES.length; i++) if (NAMES[i].equals(a)) return i;
        if (!a.matches("#[0-9a-f]{6}")) return -1;
        int c = Integer.parseInt(a.substring(1), 16);
        int best = -1;
        long bestD = Long.MAX_VALUE;
        for (int i = 0; i < COLORS.length; i++) {
            long dr = ((c >> 16) & 255) - ((COLORS[i] >> 16) & 255);
            long dg = ((c >> 8) & 255) - ((COLORS[i] >> 8) & 255);
            long db = (c & 255) - (COLORS[i] & 255);
            // Weighted like the eye: green counts most, blue least.
            long d = 3 * dr * dr + 4 * dg * dg + 2 * db * db;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    private static int styleRes(int preset) {
        switch (preset) {
            case 1: return R.style.Accent_Lime;
            case 2: return R.style.Accent_Sky;
            case 3: return R.style.Accent_Orange;
            case 4: return R.style.Accent_Violet;
            case 5: return R.style.Accent_Pink;
            case 6: return R.style.Accent_Red;
            case 7: return R.style.Accent_Teal;
            case 8: return R.style.Accent_Gold;
            default: return R.style.Accent_Brand;
        }
    }

    static void save(Context ctx, String accent) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, accent).apply();
    }

    /** Lays the saved accent over the activity's theme; nothing saved yet takes the brand's green. */
    static void apply(Activity activity) {
        if (activity == null) return;
        SharedPreferences p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int preset = presetFor(p.getString(KEY, null));
        if (preset < 0) preset = 0;
        activity.getTheme().applyStyle(styleRes(preset), true);
    }
}
