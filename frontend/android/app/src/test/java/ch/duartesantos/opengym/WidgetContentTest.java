package ch.duartesantos.opengym;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

/** What the Home Screen widget's blocks say for a snapshot (lib/widgets.js writes it). */
public class WidgetContentTest {
    private static final String TODAY = "2026-10-14";

    private static JSONObject snap() throws Exception {
        return new JSONObject("{\"v\":2,\"today\":\"2026-10-14\",\"weekFrom\":\"2026-10-12\",\"weekUntil\":\"2026-10-19\","
                + "\"days\":[{\"iso\":\"2026-10-14\",\"name\":\"Push\",\"ids\":[\"r1\"],\"done\":true,\"weekday\":\"Wednesday\"},"
                + "{\"iso\":\"2026-10-15\",\"name\":null},{\"iso\":\"2026-10-16\",\"name\":\"Legs\",\"ids\":[\"r2\",\"bad id!\"],\"weekday\":\"Friday\"}],"
                + "\"week\":{\"done\":1,\"planned\":2},\"streak\":5,"
                + "\"streakInfo\":{\"current\":5,\"best\":9,\"freezes\":1,\"line\":\"5 week streak\",\"bestLine\":\"Best: 9\"},"
                + "\"weight\":{\"currentText\":\"86 kg\",\"line\":\"6 kg to go\",\"trend\":[88,87,86]},"
                + "\"records\":{\"month\":3,\"monthLine\":\"3 PRs this month\",\"last\":{\"name\":\"Squat\",\"value\":\"120 kg\"}},"
                + "\"volume\":{\"nowText\":\"12.4k kg\",\"line\":\"+20% vs last week\"},\"level\":null,"
                + "\"labels\":{\"weekStreak\":\"Wochen-Serie\",\"nextWorkout\":\"Nächstes Training\",\"today\":\"Heute\"}}");
    }

    @Test
    public void streakWithBestAndFreezes() throws Exception {
        WidgetContent c = WidgetContent.of("streak", snap(), TODAY, "empty");
        assertEquals("5", c.value);
        assertEquals("Best: 9", c.caption);
        assertEquals(1, c.freezes);
        assertEquals("Wochen-Serie", c.title);
        assertEquals("opengym://stats", c.link);
    }

    @Test
    public void nextWorkoutSkipsTodayOnceDoneAndStartsItsRoutines() throws Exception {
        WidgetContent c = WidgetContent.of("next", snap(), TODAY, "empty");
        assertEquals("Legs", c.value);
        assertEquals("Friday", c.caption);
        assertEquals("opengym://start?r=r2", c.link);
        // A day later the snapshot's "done" no longer counts, and a past day is never next.
        assertEquals("Legs", WidgetContent.of("next", snap(), "2026-10-16", "").value);
        assertEquals("Heute", WidgetContent.of("next", snap(), "2026-10-16", "").caption);
        assertEquals("opengym://home", WidgetContent.of("next", snap(), "2026-10-20", "").link);
    }

    @Test
    public void weightWeekRecordsVolume() throws Exception {
        WidgetContent w = WidgetContent.of("weight", snap(), TODAY, "");
        assertEquals("86 kg", w.value);
        assertEquals("opengym://weigh-in", w.link);
        assertArrayEquals(new double[] {88, 87, 86}, w.trend, 0.001);
        assertEquals("1 / 2", WidgetContent.of("week", snap(), TODAY, "").value);
        // last week's snapshot: nothing done this week yet
        assertEquals("0 / 2", WidgetContent.of("week", snap(), "2026-10-20", "").value);
        WidgetContent r = WidgetContent.of("records", snap(), TODAY, "");
        assertEquals("3", r.value);
        assertEquals("Squat · 120 kg", r.caption);
        assertEquals("12.4k kg", WidgetContent.of("volume", snap(), TODAY, "").value);
    }

    @Test
    public void noSnapshotAndUnknownKinds() throws Exception {
        WidgetContent c = WidgetContent.of("weight", null, TODAY, "Open openGym once");
        assertEquals("Open openGym once", c.caption);
        assertEquals("opengym://home", c.link);
        assertEquals("streak", WidgetContent.of("nonsense", snap(), TODAY, "").kind);
        assertEquals("week", WidgetContent.defaultSecond("streak"));
        assertEquals("streak", WidgetContent.defaultSecond("week"));
    }
}
