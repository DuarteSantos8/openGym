package ch.duartesantos.opengym;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Calendar;
import java.util.Locale;
import org.json.JSONObject;

/**
 * openGym's Home Screen widget on Android: one thing big at 2x1 and 2x2, two side by side at 4x2,
 * each picked when the widget is placed (OpenGymWidgetConfigure): the streak, the weight goal, this
 * week, the next workout, records or volume (WidgetContent). What it shows is the snapshot the app
 * wrote (WidgetBridgePlugin, lib/widgets.js), in the app's language and accent; light or dark with
 * the phone (values-night). A tap opens the screen it is about through the app's own links.
 */
public class OpenGymWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "opengym_widgets";
    static final String SNAPSHOT = "snapshot";

    static String kindKey(int id) { return "kind_" + id; }
    static String secondKey(int id) { return "kind2_" + id; }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) draw(context, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager mgr, int id, Bundle options) {
        draw(context, mgr, id);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor e = prefs(context).edit();
        for (int id : ids) e.remove(kindKey(id)).remove(secondKey(id));
        e.apply();
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Every openGym widget on the Home Screen, drawn again (after the app wrote a new snapshot). */
    static void updateAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, OpenGymWidgetProvider.class));
        for (int id : ids) draw(context, mgr, id);
    }

    static JSONObject snapshot(Context context) {
        String json = prefs(context).getString(SNAPSHOT, null);
        if (json == null) return null;
        try { return new JSONObject(json); } catch (Exception e) { return null; }
    }

    static String today() {
        Calendar c = Calendar.getInstance();
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static void draw(Context context, AppWidgetManager mgr, int id) {
        try {
            mgr.updateAppWidget(id, build(context, mgr, id));
        } catch (Exception e) {
            // A widget the launcher no longer has: nothing to draw.
        }
    }

    static RemoteViews build(Context context, AppWidgetManager mgr, int id) {
        Bundle opts = mgr.getAppWidgetOptions(id);
        int minW = opts == null ? 0 : opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int minH = opts == null ? 0 : opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        boolean wide = minW >= 220;
        boolean row = !wide && minH > 0 && minH < 90;
        SharedPreferences p = prefs(context);
        String first = WidgetContent.validKind(p.getString(kindKey(id), null));
        String second = WidgetContent.validKind(p.getString(secondKey(id), WidgetContent.defaultSecond(first)));
        JSONObject snap = snapshot(context);
        String today = today();
        String empty = context.getString(R.string.widget_empty);
        int accent = accentOf(snap);

        int layout = wide ? R.layout.widget_medium : row ? R.layout.widget_row : R.layout.widget_small;
        RemoteViews v = new RemoteViews(context.getPackageName(), layout);
        WidgetContent a = WidgetContent.of(first, snap, today, empty);
        fill(context, v, a, accent, row, R.id.icon_a, R.id.title_a, R.id.value_a, R.id.caption_a, R.id.trend_a);
        v.setOnClickPendingIntent(R.id.widget_root, open(context, a.link, id * 4));
        if (wide) {
            WidgetContent b = WidgetContent.of(second, snap, today, empty);
            fill(context, v, b, accent, false, R.id.icon_b, R.id.title_b, R.id.value_b, R.id.caption_b, R.id.trend_b);
            v.setOnClickPendingIntent(R.id.col_a, open(context, a.link, id * 4 + 1));
            v.setOnClickPendingIntent(R.id.col_b, open(context, b.link, id * 4 + 2));
        }
        return v;
    }

    private static void fill(Context context, RemoteViews v, WidgetContent c, int accent, boolean row,
                             int icon, int title, int value, int caption, int trend) {
        v.setImageViewResource(icon, iconRes(c.icon));
        // The flame is orange, as in the app; the rest takes the accent.
        int tint = c.icon == WidgetContent.Icon.FLAME ? context.getColor(R.color.widget_flame) : accent;
        v.setInt(icon, "setColorFilter", tint);
        String val = c.value;
        // Freezes as snowflakes beside the streak (❄ in text style, not the emoji).
        if (c.freezes > 0) {
            StringBuilder b = new StringBuilder(val).append(' ');
            for (int i = 0; i < Math.min(2, c.freezes); i++) b.append(" \u2744\uFE0E");
            val = b.toString();
        }
        v.setTextViewText(value, val);
        v.setTextViewText(caption, row && !c.title.isEmpty() ? c.title + (c.caption.isEmpty() ? "" : " · " + c.caption) : c.caption);
        v.setViewVisibility(caption, row && c.title.isEmpty() && c.caption.isEmpty() ? View.GONE : View.VISIBLE);
        v.setContentDescription(value, c.title + ": " + c.value + ". " + c.caption);
        if (!row) {
            v.setTextViewText(title, c.title);
            Bitmap spark = c.trend.length >= 2 ? sparkline(context, c.trend, accent) : null;
            if (spark != null) {
                v.setImageViewBitmap(trend, spark);
                v.setViewVisibility(trend, View.VISIBLE);
            } else {
                v.setViewVisibility(trend, View.GONE);
            }
        }
    }

    private static int iconRes(WidgetContent.Icon icon) {
        switch (icon) {
            case SCALE: return R.drawable.ic_widget_scale;
            case CALENDAR: return R.drawable.ic_widget_calendar;
            case DUMBBELL: return R.drawable.ic_widget_dumbbell;
            case TROPHY: return R.drawable.ic_widget_trophy;
            case CHART: return R.drawable.ic_widget_chart;
            case MEDAL: return R.drawable.ic_widget_medal;
            default: return R.drawable.ic_widget_flame;
        }
    }

    /** The app's accent (Settings → Look & Home), or its green when the snapshot has none. */
    static int accentOf(JSONObject snap) {
        try {
            String hex = snap == null ? null : snap.optString("accent", null);
            if (hex != null && hex.matches("#[0-9a-fA-F]{6}")) return Color.parseColor(hex);
        } catch (Exception e) {
            // the default below
        }
        return 0xFF30D158;
    }

    /** The weight goal's last weigh-ins as a thin line in the accent. */
    static Bitmap sparkline(Context context, double[] ys, int color) {
        float d = context.getResources().getDisplayMetrics().density;
        int w = Math.round(160 * d), h = Math.round(22 * d);
        double lo = Double.POSITIVE_INFINITY, hi = Double.NEGATIVE_INFINITY;
        int n = 0;
        for (double y : ys) if (!Double.isNaN(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); n++; }
        if (n < 2) return null;
        if (hi - lo < 0.5) { double mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25; }
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(bmp);
        Paint pt = new Paint(Paint.ANTI_ALIAS_FLAG);
        pt.setColor(color);
        pt.setStyle(Paint.Style.STROKE);
        pt.setStrokeWidth(2 * d);
        pt.setStrokeCap(Paint.Cap.ROUND);
        pt.setStrokeJoin(Paint.Join.ROUND);
        Path path = new Path();
        float pad = 3 * d;
        boolean started = false;
        float lastX = 0, lastY = 0;
        for (int i = 0; i < ys.length; i++) {
            if (Double.isNaN(ys[i])) continue;
            float x = pad + (w - 2 * pad) * i / (float) (ys.length - 1);
            float y = (float) (pad + (h - 2 * pad) * (1 - (ys[i] - lo) / (hi - lo)));
            if (!started) { path.moveTo(x, y); started = true; } else path.lineTo(x, y);
            lastX = x; lastY = y;
        }
        cv.drawPath(path, pt);
        pt.setStyle(Paint.Style.FILL);
        cv.drawCircle(lastX, lastY, 2.6f * d, pt);
        return bmp;
    }

    /** A tap: the app, at the screen the link names (lib/widget-links.js reads it). */
    static PendingIntent open(Context context, String link, int requestCode) {
        Intent i = new Intent(context, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(link))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
