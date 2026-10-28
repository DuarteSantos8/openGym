package ch.duartesantos.opengym;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

/**
 * "What to show": opens when an openGym widget is placed, and again from its long-press menu on
 * Android 12 and later. Two lists, the widget's thing and, for the wide widget, the one beside it.
 * The words are the app's (the snapshot carries them in the app's language), English before the
 * app ever wrote one. Backing out leaves the widget unplaced, as Android expects.
 */
public class OpenGymWidgetConfigure extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        Bundle extras = getIntent() == null ? null : getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        JSONObject snap = OpenGymWidgetProvider.snapshot(this);
        JSONObject labels = snap == null ? null : snap.optJSONObject("labels");
        JSONObject kinds = labels == null ? null : labels.optJSONObject("kinds");

        String first = WidgetContent.validKind(OpenGymWidgetProvider.prefs(this).getString(OpenGymWidgetProvider.kindKey(widgetId), null));
        String second = WidgetContent.validKind(OpenGymWidgetProvider.prefs(this).getString(OpenGymWidgetProvider.secondKey(widgetId), WidgetContent.defaultSecond(first)));

        int pad = dp(20);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad, pad, dp(12));

        col.addView(heading(word(labels, "whatToShow", R.string.widget_what)));
        RadioGroup one = group(kinds, first);
        col.addView(one);
        TextView h2 = heading(word(labels, "secondThing", R.string.widget_beside));
        h2.setPadding(0, dp(16), 0, dp(4));
        col.addView(h2);
        RadioGroup two = group(kinds, second);
        col.addView(two);

        Button done = new Button(this);
        done.setText(R.string.widget_done);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.END;
        lp.topMargin = dp(12);
        col.addView(done, lp);
        done.setOnClickListener(v -> save(kindOf(one), kindOf(two)));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(col);
        setContentView(scroll);
    }

    private void save(String first, String second) {
        OpenGymWidgetProvider.prefs(this).edit()
                .putString(OpenGymWidgetProvider.kindKey(widgetId), first)
                .putString(OpenGymWidgetProvider.secondKey(widgetId), second)
                .apply();
        OpenGymWidgetProvider.draw(this, AppWidgetManager.getInstance(this), widgetId);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private String word(JSONObject labels, String key, int fallback) {
        String s = labels == null ? null : labels.optString(key, null);
        return s == null || s.isEmpty() ? getString(fallback) : s;
    }

    private static final int[] KIND_WORDS = {
        R.string.widget_kind_streak, R.string.widget_kind_weight, R.string.widget_kind_week,
        R.string.widget_kind_next, R.string.widget_kind_records, R.string.widget_kind_volume,
        R.string.widget_kind_challenges,
    };

    private RadioGroup group(JSONObject kinds, String selected) {
        RadioGroup g = new RadioGroup(this);
        for (int i = 0; i < WidgetContent.KINDS.length; i++) {
            String k = WidgetContent.KINDS[i];
            RadioButton b = new RadioButton(this);
            b.setId(View.generateViewId());
            b.setTag(k);
            String w = kinds == null ? null : kinds.optString(k, null);
            b.setText(w == null || w.isEmpty() ? getString(KIND_WORDS[i]) : w);
            b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            b.setMinHeight(dp(44));
            g.addView(b);
            if (k.equals(selected)) b.setChecked(true);
        }
        return g;
    }

    private String kindOf(RadioGroup g) {
        View v = g.findViewById(g.getCheckedRadioButtonId());
        return v == null ? WidgetContent.DEFAULT_KIND : WidgetContent.validKind((String) v.getTag());
    }

    private TextView heading(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setPadding(0, 0, 0, dp(4));
        return t;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
