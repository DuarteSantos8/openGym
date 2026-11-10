package ch.duartesantos.opengym;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What one block of the Home Screen widget says (OpenGymWidgetProvider draws it): the snapshot the
 * app wrote (lib/widgets.js buildWidgetSnapshot, the same one the iPhone widgets read) and the kind
 * the widget was set to show, as plain text and a link. No Android in here, so the JVM tests can
 * run it (WidgetContentTest).
 *
 * The links are the app's own (lib/widget-links.js): opengym://home, stats, weigh-in and
 * start?r=<routine ids>. Keep the three in step.
 */
final class WidgetContent {
    static final String[] KINDS = {"streak", "weight", "week", "next", "records", "volume", "challenges"};
    static final String DEFAULT_KIND = "streak";

    /** The drawable each kind shows (res/drawable/ic_widget_*). */
    enum Icon { FLAME, SCALE, CALENDAR, DUMBBELL, TROPHY, CHART, MEDAL }

    final String kind;
    final Icon icon;
    final String title;
    final String value;
    final String caption;
    final String link;
    /** The weight goal's last weigh-ins, oldest first; empty for every other kind. */
    final double[] trend;
    /** Streak freezes banked, shown as snowflakes beside the streak. */
    final int freezes;

    private WidgetContent(String kind, Icon icon, String title, String value, String caption, String link, double[] trend, int freezes) {
        this.kind = kind;
        this.icon = icon;
        this.title = title == null ? "" : title;
        this.value = value == null ? "" : value;
        this.caption = caption == null ? "" : caption;
        this.link = link;
        this.trend = trend == null ? new double[0] : trend;
        this.freezes = freezes;
    }

    static String validKind(String kind) {
        if (kind != null) for (String k : KINDS) if (k.equals(kind)) return k;
        return DEFAULT_KIND;
    }

    /** The second block's kind on a wide widget when none was chosen: something else than the first. */
    static String defaultSecond(String first) {
        return "week".equals(first) ? "streak" : "week";
    }

    private static String label(JSONObject labels, String key, String fallback) {
        String s = labels == null ? null : labels.optString(key, null);
        return s == null || s.isEmpty() ? fallback : s;
    }

    private static String str(JSONObject o, String key) {
        if (o == null || o.isNull(key)) return null;
        String s = o.optString(key, null);
        return s == null || s.isEmpty() ? null : s;
    }

    /**
     * One block. `snap` may be null (the app never wrote anything yet): the block then says so.
     * `today` is the phone's date, YYYY-MM-DD: the snapshot carries a week of plan, so the next
     * workout is still right days after the app was last opened.
     */
    static WidgetContent of(String kindIn, JSONObject snap, String today, String emptyText) {
        String kind = validKind(kindIn);
        if (snap == null) return new WidgetContent(kind, Icon.DUMBBELL, "openGym", "", emptyText, "opengym://home", null, 0);
        JSONObject labels = snap.optJSONObject("labels");
        switch (kind) {
            case "weight": {
                JSONObject w = snap.optJSONObject("weight");
                String title = label(labels, "weightGoal", "Weight goal");
                if (w == null) return new WidgetContent(kind, Icon.SCALE, title, "–", label(labels, "noWeighIn", "No weigh-ins yet"), "opengym://weigh-in", null, 0);
                JSONArray tr = w.optJSONArray("trend");
                double[] trend = new double[tr == null ? 0 : tr.length()];
                for (int i = 0; i < trend.length; i++) trend[i] = tr.optDouble(i, Double.NaN);
                return new WidgetContent(kind, Icon.SCALE, title, str(w, "currentText"), str(w, "line"), "opengym://weigh-in", trend, 0);
            }
            case "week": {
                JSONObject wk = snap.optJSONObject("week");
                int done = wk == null ? 0 : wk.optInt("done", 0);
                int planned = wk == null ? 0 : wk.optInt("planned", 0);
                // A snapshot from last week says nothing about this one.
                String until = str(snap, "weekUntil");
                if (until != null && today.compareTo(until) >= 0) done = 0;
                JSONObject st = snap.optJSONObject("streakInfo");
                String value = planned > 0 ? done + " / " + planned : String.valueOf(done);
                return new WidgetContent(kind, Icon.CALENDAR, label(labels, "thisWeek", "This week"), value, st == null ? null : str(st, "line"), "opengym://home", null, 0);
            }
            case "next": {
                String title = label(labels, "nextWorkout", "Next workout");
                JSONObject day = nextDay(snap, today);
                if (day == null) return new WidgetContent(kind, Icon.DUMBBELL, title, label(labels, "nothingPlanned", "Nothing planned"), label(labels, "restDay", null), "opengym://home", null, 0);
                boolean isToday = today.equals(day.optString("iso"));
                String when = isToday ? label(labels, "today", "Today") : str(day, "weekday");
                return new WidgetContent(kind, Icon.DUMBBELL, title, str(day, "name"), when, startLink(day.optJSONArray("ids")), null, 0);
            }
            case "records": {
                JSONObject r = snap.optJSONObject("records");
                JSONObject last = r == null ? snap.optJSONObject("lastPR") : r.optJSONObject("last");
                String caption = r == null ? null : str(r, "monthLine");
                if (last != null) {
                    String name = str(last, "name"), v = str(last, "value");
                    String line = name == null ? null : (v == null ? name : name + " · " + v);
                    if (line != null) caption = line;
                }
                String value = r == null ? "0" : String.valueOf(r.optInt("month", 0));
                return new WidgetContent(kind, Icon.TROPHY, label(labels, "records", "Records"), value, caption, "opengym://stats", null, 0);
            }
            case "volume": {
                JSONObject v = snap.optJSONObject("volume");
                return new WidgetContent(kind, Icon.CHART, label(labels, "volume", "Volume"), v == null ? "0" : str(v, "nowText"), v == null ? null : str(v, "line"), "opengym://stats", null, 0);
            }
            case "challenges": {
                // The month's challenges (lib/widgets.js challengesOfWidget): "2 / 3" and the first one still open.
                JSONObject c = snap.optJSONObject("challenges");
                String value = c == null ? "–" : c.optInt("done", 0) + " / " + c.optInt("total", 0);
                String caption = c == null ? null : (str(c, "next") != null ? str(c, "next") : str(c, "line"));
                return new WidgetContent(kind, Icon.MEDAL, label(labels, "challenges", "Challenges"), value, caption, "opengym://home", null, 0);
            }
            default: {
                JSONObject st = snap.optJSONObject("streakInfo");
                int current = st == null ? snap.optInt("streak", 0) : st.optInt("current", 0);
                int freezes = st == null ? 0 : st.optInt("freezes", 0);
                String caption = st == null ? null : str(st, "bestLine");
                return new WidgetContent("streak", Icon.FLAME, label(labels, "weekStreak", "Week streak"), String.valueOf(current), caption, "opengym://stats", null, freezes);
            }
        }
    }

    /** Today's plan while it is not done, else the next day with one (as the iPhone widget reads it). */
    static JSONObject nextDay(JSONObject snap, String today) {
        JSONArray days = snap.optJSONArray("days");
        if (days == null) return null;
        for (int i = 0; i < days.length(); i++) {
            JSONObject d = days.optJSONObject(i);
            if (d == null || d.isNull("name") || d.optString("name", "").isEmpty()) continue;
            String iso = d.optString("iso", "");
            if (iso.compareTo(today) < 0) continue;
            // `done` is only right on the day the snapshot was written.
            if (iso.equals(today) && today.equals(snap.optString("today")) && d.optBoolean("done", false)) continue;
            return d;
        }
        return null;
    }

    static String startLink(JSONArray ids) {
        if (ids == null || ids.length() == 0) return "opengym://home";
        StringBuilder b = new StringBuilder("opengym://start?r=");
        for (int i = 0; i < ids.length() && i < 8; i++) {
            String id = ids.optString(i, "");
            // Routine ids are the app's own (letters and digits, from imports also . : - _); anything else is left out.
            if (!id.matches("[A-Za-z0-9_.:-]{1,64}")) continue;
            if (b.charAt(b.length() - 1) != '=') b.append(',');
            b.append(id);
        }
        return b.charAt(b.length() - 1) == '=' ? "opengym://home" : b.toString();
    }
}
