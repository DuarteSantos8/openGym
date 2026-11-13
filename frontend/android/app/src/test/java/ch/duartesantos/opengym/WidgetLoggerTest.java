package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The widget's set buttons (lib/widget-logger.js writes the logger block they walk through). */
public class WidgetLoggerTest {
    private static JSONObject logger() throws Exception {
        return new JSONObject("{\"wid\":\"w1\",\"more\":true,\"labels\":{\"logSet\":\"Log set\",\"allDone\":\"All sets done\",\"openApp\":\"Open openGym\"},"
                + "\"sets\":[{\"k\":\"w1:0:1\",\"exId\":\"0025\",\"entryIdx\":0,\"setIdx\":1,\"name\":\"Bench\",\"line\":\"Set 2 of 3\",\"mode\":\"reps\","
                + "\"w\":{\"v\":[57.5,60,62.5],\"t\":[\"57.5 kg\",\"60 kg\",\"62.5 kg\"],\"i\":1},\"r\":{\"v\":8,\"step\":2}},"
                + "{\"k\":\"w1:1:0\",\"exId\":\"plank\",\"entryIdx\":1,\"setIdx\":0,\"name\":\"Plank\",\"line\":\"Set 1 of 1\",\"mode\":\"time\",\"sec\":{\"v\":30,\"step\":5}}]}");
    }

    @Test
    public void startsAtTheSnapshotsSet() throws Exception {
        WidgetLogger.View v = WidgetLogger.view(logger(), WidgetLogger.stateFor(logger(), null));
        assertEquals("Bench", v.name);
        assertEquals("60 kg", v.wText);
        assertEquals("8", v.rText);
        assertTrue(v.weight && v.reps);
        assertFalse(v.time || v.allDone);
    }

    @Test
    public void buttonsWalkTheListsAndStopAtTheEnds() throws Exception {
        JSONObject lg = logger();
        JSONObject st = WidgetLogger.press(lg, null, "w+", "x", 0, null);
        st = WidgetLogger.press(lg, st, "w+", "x", 0, null);
        assertEquals("62.5 kg", WidgetLogger.view(lg, st).wText);
        st = WidgetLogger.press(lg, st, "r-", "x", 0, null);
        assertEquals("6", WidgetLogger.view(lg, st).rText);
        for (int i = 0; i < 9; i++) st = WidgetLogger.press(lg, st, "r-", "x", 0, null);
        assertEquals("0", WidgetLogger.view(lg, st).rText);
    }

    @Test
    public void logSetQueuesTheNumbersAndMovesOn() throws Exception {
        JSONObject lg = logger();
        JSONObject st = WidgetLogger.press(lg, null, "w-", "x", 0, null);
        JSONObject[] ev = new JSONObject[1];
        st = WidgetLogger.press(lg, st, "log", "ev1", 1234, ev);
        assertNotNull(ev[0]);
        assertEquals("ev1", ev[0].getString("id"));
        assertEquals("setDone", ev[0].getString("type"));
        assertEquals("w1", ev[0].getString("wid"));
        assertEquals(1, ev[0].getInt("setIdx"));
        assertEquals(57.5, ev[0].getDouble("w"), 1e-9);
        assertEquals(8, ev[0].getInt("r"));
        assertEquals(1234, ev[0].getLong("at"));
        WidgetLogger.View v = WidgetLogger.view(lg, st);
        assertEquals("Plank", v.name);
        assertTrue(v.time);
        assertEquals("30 s", v.secText);
        st = WidgetLogger.press(lg, st, "s-", "x", 0, null);
        st = WidgetLogger.press(lg, st, "s-", "x", 0, null);
        st = WidgetLogger.press(lg, st, "s-", "x", 0, null);
        st = WidgetLogger.press(lg, st, "s-", "x", 0, null);
        st = WidgetLogger.press(lg, st, "s-", "x", 0, null);
        st = WidgetLogger.press(lg, st, "s-", "x", 0, null);
        assertEquals("5 s", WidgetLogger.view(lg, st).secText);
        ev[0] = null;
        st = WidgetLogger.press(lg, st, "log", "ev2", 0, ev);
        assertEquals(5, ev[0].getInt("sec"));
        assertFalse(ev[0].has("w"));
        WidgetLogger.View done = WidgetLogger.view(lg, st);
        assertTrue(done.allDone);
        assertEquals("Open openGym", done.allDoneText);
        // Nothing left to log: Log set does nothing more.
        ev[0] = null;
        WidgetLogger.press(lg, st, "log", "ev3", 0, ev);
        assertNull(ev[0]);
    }

    @Test
    public void aNewSnapshotStartsOver() throws Exception {
        JSONObject lg = logger();
        JSONObject st = WidgetLogger.press(lg, null, "log", "e", 0, new JSONObject[1]);
        JSONObject next = new JSONObject(lg.toString());
        JSONArray sets = next.getJSONArray("sets");
        sets.remove(0);
        next.put("sets", sets);
        WidgetLogger.View v = WidgetLogger.view(next, WidgetLogger.stateFor(next, st));
        assertEquals("Plank", v.name);
        assertEquals(0, WidgetLogger.stateFor(next, st).getInt("pos"));
    }

    @Test
    public void theQueueKeepsTheNewestAndDropsAcked() throws Exception {
        JSONArray q = new JSONArray();
        for (int i = 0; i < WidgetLogger.EVENTS_MAX + 5; i++) q = WidgetLogger.append(q, new JSONObject().put("id", "e" + i));
        assertEquals(WidgetLogger.EVENTS_MAX, q.length());
        assertEquals("e5", q.getJSONObject(0).getString("id"));
        q = WidgetLogger.without(q, Collections.singleton("e5"));
        assertEquals("e6", q.getJSONObject(0).getString("id"));
    }
}
