package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Test;

/** What goes over the Garmin link (GarminLink, docs/GARMIN.md): the snapshot out, the events in. */
public class GarminMessagesTest {
    @Test
    @SuppressWarnings("unchecked")
    public void theSnapshotGoesOutAsMapsAndLists() {
        String json = "{\"v\":1,\"unit\":\"kg\",\"restSec\":90,\"active\":{\"id\":\"w-1\",\"startedAt\":1761743100000,"
            + "\"entries\":[{\"id\":\"0025\",\"i\":3,\"step\":2.5,\"sets\":[{\"w\":62.5,\"r\":8,\"done\":true}]}]},"
            + "\"ready\":null,\"streak\":{\"weeks\":4,\"thisWeekDone\":false},\"acked\":[\"g1\",\"g2\"]}";
        Map<String, Object> m = GarminMessages.toMonkey(json);
        assertEquals(1, m.get("v"));
        assertEquals("kg", m.get("unit"));
        // null is left out: the watch reads a missing key as null
        assertFalse(m.containsKey("ready"));
        Map<String, Object> a = (Map<String, Object>) m.get("active");
        // ms times do not fit an Integer: a Long, as the watch's toMs expects
        assertEquals(1761743100000L, a.get("startedAt"));
        Map<String, Object> e = (Map<String, Object>) ((List<Object>) a.get("entries")).get(0);
        assertEquals(3, e.get("i"));
        assertEquals(2.5, (Double) e.get("step"), 0);
        Map<String, Object> set = (Map<String, Object>) ((List<Object>) e.get("sets")).get(0);
        assertEquals(62.5, (Double) set.get("w"), 0);
        assertEquals(8, set.get("r"));
        assertEquals(Boolean.TRUE, set.get("done"));
        assertEquals(Arrays.asList("g1", "g2"), m.get("acked"));
        assertEquals(Boolean.FALSE, ((Map<String, Object>) m.get("streak")).get("thisWeekDone"));
    }

    @Test
    public void notASnapshotIsNothing() {
        assertNull(GarminMessages.toMonkey(null));
        assertNull(GarminMessages.toMonkey("[1,2]"));
        assertNull(GarminMessages.toMonkey("not json"));
    }

    private static Map<String, Object> setDone(String id) {
        Map<String, Object> ev = new HashMap<>();
        ev.put("id", id);
        ev.put("type", "setDone");
        ev.put("wid", "w-1");
        ev.put("exId", "0025");
        ev.put("entryIdx", 3);
        ev.put("setIdx", 1);
        ev.put("w", 62.5f);
        ev.put("r", 8);
        ev.put("at", 1761743100000L);
        Map<String, Object> hr = new HashMap<>();
        hr.put("avg", 128);
        hr.put("max", 141);
        ev.put("hr", hr);
        return ev;
    }

    @Test
    public void theWatchesEventsComeBackAsTheOtherWatchesJson() throws Exception {
        Map<String, Object> msg = new HashMap<>();
        msg.put("events", new ArrayList<Object>(Arrays.asList(setDone("g1"), setDone("g2"))));
        List<String> out = GarminMessages.events(new ArrayList<Object>(Arrays.asList(msg)));
        assertEquals(2, out.size());
        JSONObject e = new JSONObject(out.get(0));
        assertEquals("g1", e.getString("id"));
        assertEquals("setDone", e.getString("type"));
        assertEquals(3, e.getInt("entryIdx"));
        assertEquals(62.5, e.getDouble("w"), 0.0001);
        assertEquals(1761743100000L, e.getLong("at"));
        assertEquals(141, e.getJSONObject("hr").getInt("max"));
        assertEquals("g2", new JSONObject(out.get(1)).getString("id"));
        // the queue keeps them in the watch's order, by the watch's own time
        assertEquals(1761743100000L, GarminMessages.seqOf(out.get(0), 7));
    }

    @Test
    public void skipsWhatIsNotAnEvent() {
        Map<String, Object> noId = new HashMap<>();
        noId.put("type", "setDone");
        Map<String, Object> msg = new HashMap<>();
        msg.put("events", new ArrayList<Object>(Arrays.asList(noId, "junk", 4)));
        List<Object> message = new ArrayList<>(Arrays.asList(msg, "other", new HashMap<String, Object>()));
        assertTrue(GarminMessages.events(message).isEmpty());
        assertTrue(GarminMessages.events(null).isEmpty());
    }

    @Test
    public void helloIsForTheBridgeOnly() {
        assertTrue(GarminMessages.isHello("{\"id\":\"g9\",\"type\":\"hello\",\"at\":1}"));
        assertFalse(GarminMessages.isHello("{\"id\":\"g9\",\"type\":\"setDone\"}"));
        assertFalse(GarminMessages.isHello("nope"));
        assertEquals(5, GarminMessages.seqOf("{\"id\":\"x\"}", 5));
    }

    @Test
    public void aGarminEventGoesIntoTheSameQueueOnce() {
        Map<String, Object> msg = new HashMap<>();
        msg.put("events", new ArrayList<Object>(Arrays.asList(setDone("g1"))));
        String json = GarminMessages.events(new ArrayList<Object>(Arrays.asList(msg))).get(0);
        org.json.JSONArray q = WatchEventQueue.add(new org.json.JSONArray(), json, GarminMessages.seqOf(json, 1));
        assertEquals(1, WatchEventQueue.events(q).length());
        // sent again by the watch (it had not heard the phone has it): the same queue back
        assertTrue(q == WatchEventQueue.add(q, json, GarminMessages.seqOf(json, 2)));
    }

    @Test
    public void theSnapshotSaysWhenItLeaves() {
        Map<String, Object> m = GarminMessages.toMonkey("{\"now\":1761743100000,\"active\":null,\"unit\":\"kg\"}");
        Map<String, Object> out = GarminMessages.stamped(m, 1761743400000L);
        assertEquals(1761743400000L, out.get("now"));
        assertEquals("kg", out.get("unit"));
        // the one kept to send again is not changed
        assertEquals(1761743100000L, m.get("now"));
        // a snapshot without a clock (an older page) goes as it is
        Map<String, Object> old = GarminMessages.toMonkey("{\"unit\":\"kg\"}");
        assertTrue(GarminMessages.stamped(old, 5L) == old);
        assertNull(GarminMessages.stamped(null, 5L));
    }
}
