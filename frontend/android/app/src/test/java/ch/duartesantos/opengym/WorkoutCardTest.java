package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** The workout notification's buttons with the page asleep: the same moves as the iPhone's Live Activity. */
public class WorkoutCardTest {
    private static final long NOW = 1_762_400_000_000L;

    private static String set(int e, int s, int unit, int rest) {
        return "{\"exId\":\"x" + e + "\",\"entryIdx\":" + e + ",\"setIdx\":" + s + ",\"unit\":" + unit
                + ",\"exName\":\"Bench " + e + "\",\"setLine\":\"Set " + (s + 1) + " of 3\",\"target\":\"80 kg × 8\",\"restAfter\":" + rest + "}";
    }

    // Bench (entry 0) sets 1 and 2 to go, then rows (entry 1), as lib/live-activity.js sends it.
    private static JSONObject state() throws Exception {
        return new JSONObject("{\"name\":\"Push\",\"cur\":" + set(0, 1, 0, 90)
                + ",\"ahead\":[" + set(0, 2, 0, 90) + "," + set(1, 0, 1, 60) + "]"
                + ",\"unitStarts\":[" + set(1, 0, 1, 60) + "]"
                + ",\"restEndsAt\":null,\"restLeft\":null,\"restTotal\":null,\"done\":1,\"total\":4}");
    }

    @Test
    public void logSetMovesOnAndStartsTheRestAfterIt() throws Exception {
        WorkoutCard.Move m = WorkoutCard.logSet(state(), "w1", "0:1", NOW);
        assertNotNull(m);
        assertEquals("setDone", m.event.getString("type"));
        assertEquals("x0", m.event.getString("exId"));
        assertEquals(1, m.event.getInt("setIdx"));
        assertEquals(NOW, m.event.getLong("at"));
        assertEquals("0:2", WorkoutCard.key(WorkoutCard.cur(m.state)));
        assertEquals(1, m.state.getJSONArray("ahead").length());
        assertEquals(2, m.state.getInt("done"));
        assertEquals(90_000, m.restMs);
        assertEquals(NOW + 90_000, m.state.getLong("restEndsAt"));
        assertTrue(WorkoutCard.resting(m.state, NOW + 1000));
        assertFalse(WorkoutCard.resting(m.state, NOW + 91_000));
    }

    @Test
    public void aButtonFromACardThatMovedOnDoesNothing() throws Exception {
        assertNull(WorkoutCard.logSet(state(), "w1", "0:0", NOW));
        assertNull(WorkoutCard.nextExercise(state(), "w1", "1:0", NOW));
    }

    @Test
    public void theLastSetHasNoRestAndLeavesAllDone() throws Exception {
        JSONObject s = new JSONObject("{\"name\":\"Push\",\"cur\":" + set(0, 2, 0, 90) + ",\"ahead\":[],\"unitStarts\":[],\"done\":3,\"total\":4}");
        WorkoutCard.Move m = WorkoutCard.logSet(s, "w1", "0:2", NOW);
        assertNotNull(m);
        assertNull(WorkoutCard.cur(m.state));
        assertEquals(0, m.restMs);
        assertEquals(4, m.state.getInt("done"));
        assertFalse(WorkoutCard.resting(m.state, NOW));
    }

    @Test
    public void nextExerciseSkipsToTheNextUnitWithoutTicking() throws Exception {
        WorkoutCard.Move m = WorkoutCard.nextExercise(state(), "w1", "0:1", NOW);
        assertNotNull(m);
        assertEquals("next", m.event.getString("type"));
        assertEquals(0, m.event.getInt("fromEntryIdx"));
        assertEquals("1:0", WorkoutCard.key(WorkoutCard.cur(m.state)));
        assertEquals(0, m.state.getJSONArray("ahead").length());
        assertEquals(0, m.state.getJSONArray("unitStarts").length());
        assertEquals(1, m.state.getInt("done"));
        // Nothing after the rows: no Next there.
        assertNull(WorkoutCard.nextUnitStart(m.state));
    }

    @Test
    public void skipRestOnlyWhileOneRuns() throws Exception {
        assertNull(WorkoutCard.skipRest(state(), "w1", NOW));
        WorkoutCard.Move logged = WorkoutCard.logSet(state(), "w1", "0:1", NOW);
        WorkoutCard.Move m = WorkoutCard.skipRest(logged.state, "w1", NOW + 5000);
        assertNotNull(m);
        assertEquals("restSkip", m.event.getString("type"));
        assertFalse(WorkoutCard.resting(m.state, NOW + 5000));
        assertFalse(m.state.has("restEndsAt"));
    }

    @Test
    public void readsTheLinesAndLabels() throws Exception {
        assertEquals("Set 2 of 3 · 80 kg × 8", WorkoutCard.setText(WorkoutCard.cur(state())));
        JSONObject attrs = new JSONObject("{\"labels\":{\"done\":\"Serie registrieren\",\"rest\":\"\"}}");
        assertEquals("Serie registrieren", WorkoutCard.label(attrs, "done", "Log set"));
        assertEquals("Rest", WorkoutCard.label(attrs, "rest", "Rest"));
        assertNull(WorkoutCard.parse("not json"));
    }

    @Test
    public void theChipSaysHowFarAlongTheSessionIs() {
        assertEquals("3/12", WorkoutCard.chipText(3, 12));
        assertEquals("12/12", WorkoutCard.chipText(14, 12));
        assertEquals("0/5", WorkoutCard.chipText(-1, 5));
        assertEquals("", WorkoutCard.chipText(0, 0));
    }

    /* ---------- the live widget builder (v1.4.5) ---------- */

    private static JSONObject laid() throws Exception {
        JSONObject st = state();
        JSONObject cur = st.getJSONObject("cur");
        cur.put("tv", new JSONObject("{\"weight\":\"80 kg\",\"reps\":\"8\"}"));
        cur.put("adj", new JSONObject("{\"w\":{\"v\":[77.5,80,82.5],\"t\":[\"77.5 kg\",\"80 kg\",\"82.5 kg\"],\"i\":1},"
                + "\"e\":{\"v\":[-1,0,1,2],\"t\":[\"RIR \u2013\",\"RIR 0\",\"RIR 1\",\"RIR 2\"],\"i\":3}}"));
        st.put("lay", new JSONObject("{\"android\":{\"t\":[{\"k\":\"ex\"},{\"k\":\"weight\"},{\"k\":\"reps\"},{\"k\":\"hr\"},{\"k\":\"rest\"}],\"a\":[\"log\",\"wUp\",\"pause\"]}}"));
        st.put("tl", new JSONObject("{\"weight\":\"Weight\",\"reps\":\"Reps\",\"a.wUp\":\"More weight\"}"));
        return st;
    }

    @Test
    public void theTilesBecomeLinesWithTheirLabelsAndNothingEmpty() throws Exception {
        java.util.List<String> lines = WorkoutCard.lines(laid());
        assertEquals(java.util.Arrays.asList("Bench 0", "Weight 80 kg", "Reps 8"), lines);
        assertTrue(WorkoutCard.hasTile(laid(), "rest"));
        assertFalse(WorkoutCard.hasTile(state(), "rest"));
        assertNull(WorkoutCard.layout(state(), "t"));
    }

    @Test
    public void plusStepsTheWeightShowsItAndQueuesTheValue() throws Exception {
        WorkoutCard.Move m = WorkoutCard.adjust(laid(), "w1", "0:1", "w", 1, NOW);
        assertNotNull(m);
        assertEquals("adjust", m.event.getString("type"));
        assertEquals(82.5, m.event.getDouble("value"), 0.0001);
        assertEquals("82.5 kg", WorkoutCard.text(m.state, "weight"));
        // The top of the list: nothing more to step to.
        assertNull(WorkoutCard.adjust(m.state, "w1", "0:1", "w", 1, NOW));
        // From a card that moved on, or for a list the set does not have.
        assertNull(WorkoutCard.adjust(laid(), "w1", "0:2", "w", 1, NOW));
        assertNull(WorkoutCard.adjust(laid(), "w1", "0:1", "r", 1, NOW));
    }

    @Test
    public void effortGoesRoundThroughNotRated() throws Exception {
        WorkoutCard.Move m = WorkoutCard.adjust(laid(), "w1", "0:1", "e", 1, NOW);
        assertNotNull(m);
        assertEquals(-1, m.event.getDouble("value"), 0.0001);
        assertEquals("RIR \u2013", WorkoutCard.text(m.state, "effort"));
    }

    @Test
    public void plusFifteenMovesTheRestOnlyWhileOneRuns() throws Exception {
        assertNull(WorkoutCard.addRest(laid(), "w1", 15, NOW));
        WorkoutCard.Move log = WorkoutCard.logSet(laid(), "w1", "0:1", NOW);
        WorkoutCard.Move m = WorkoutCard.addRest(log.state, "w1", 15, NOW + 10_000);
        assertNotNull(m);
        assertEquals(NOW + 105_000, m.state.getLong("restEndsAt"));
        assertEquals(95_000, m.restMs);
        assertEquals(15, m.event.getInt("sec"));
    }

    @Test
    public void pauseIsQueuedAsTheStateAskedForAndShowsAtOnce() throws Exception {
        WorkoutCard.Move m = WorkoutCard.queueOnly(laid(), "w1", "pause", NOW);
        assertTrue(m.event.getBoolean("on"));
        assertTrue(m.state.getBoolean("paused"));
        WorkoutCard.Move back = WorkoutCard.queueOnly(m.state, "w1", "pause", NOW);
        assertFalse(back.event.getBoolean("on"));
        assertEquals(0, WorkoutCard.queueOnly(laid(), "w1", "prev", NOW).event.getInt("fromEntryIdx"));
        assertNull(WorkoutCard.queueOnly(laid(), "w1", "launchRocket", NOW));
    }

    @Test
    public void onlyAPlainPictureInThePackageIsAStill() throws Exception {
        JSONObject st = laid();
        st.getJSONObject("cur").put("img", "exercise-media/still/0025.webp");
        assertEquals("exercise-media/still/0025.webp", WorkoutCard.stillPath(st));
        st.getJSONObject("cur").put("img", "../../secret.png");
        assertNull(WorkoutCard.stillPath(st));
        st.getJSONObject("cur").put("img", "exercise-media/gif/0025.mp4");
        assertNull(WorkoutCard.stillPath(st));
    }
}
