package ch.duartesantos.opengym;

import android.content.Context;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Material You: from Android 12 the system builds tonal palettes from the wallpaper and lends
 * them to every app as android.R.color.system_*. This hands the page the three it draws with
 * (lib/dynamic-color.js): accent1 for the accent, neutral1 and neutral2 for the backgrounds,
 * each as 13 '#rrggbb' tones from white (0) to black (1000). Before Android 12 there are none,
 * and the answer says so.
 *
 * The palettes change when the wallpaper does. The page reads them again whenever the app comes
 * back to the front (lib/mobile.js onAppActive), which is where a new wallpaper is first seen.
 *
 * Usage from JS:
 *   registerPlugin('DynamicColor').palette()   // { available, accent1, neutral1, neutral2 }
 */
@CapacitorPlugin(name = "DynamicColor")
public class DynamicColorPlugin extends Plugin {

    @PluginMethod
    public void palette(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            out.put("available", false);
            call.resolve(out);
            return;
        }
        Context ctx = getContext();
        out.put("available", true);
        out.put("accent1", tones(ctx, new int[] {
            android.R.color.system_accent1_0, android.R.color.system_accent1_10,
            android.R.color.system_accent1_50, android.R.color.system_accent1_100,
            android.R.color.system_accent1_200, android.R.color.system_accent1_300,
            android.R.color.system_accent1_400, android.R.color.system_accent1_500,
            android.R.color.system_accent1_600, android.R.color.system_accent1_700,
            android.R.color.system_accent1_800, android.R.color.system_accent1_900,
            android.R.color.system_accent1_1000 }));
        out.put("neutral1", tones(ctx, new int[] {
            android.R.color.system_neutral1_0, android.R.color.system_neutral1_10,
            android.R.color.system_neutral1_50, android.R.color.system_neutral1_100,
            android.R.color.system_neutral1_200, android.R.color.system_neutral1_300,
            android.R.color.system_neutral1_400, android.R.color.system_neutral1_500,
            android.R.color.system_neutral1_600, android.R.color.system_neutral1_700,
            android.R.color.system_neutral1_800, android.R.color.system_neutral1_900,
            android.R.color.system_neutral1_1000 }));
        out.put("neutral2", tones(ctx, new int[] {
            android.R.color.system_neutral2_0, android.R.color.system_neutral2_10,
            android.R.color.system_neutral2_50, android.R.color.system_neutral2_100,
            android.R.color.system_neutral2_200, android.R.color.system_neutral2_300,
            android.R.color.system_neutral2_400, android.R.color.system_neutral2_500,
            android.R.color.system_neutral2_600, android.R.color.system_neutral2_700,
            android.R.color.system_neutral2_800, android.R.color.system_neutral2_900,
            android.R.color.system_neutral2_1000 }));
        call.resolve(out);
    }

    private static JSArray tones(Context ctx, int[] ids) {
        JSArray arr = new JSArray();
        for (int id : ids) arr.put(String.format("#%06x", ctx.getColor(id) & 0xFFFFFF));
        return arr;
    }
}
