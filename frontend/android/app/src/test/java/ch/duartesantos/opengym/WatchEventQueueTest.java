package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import java.util.Arrays;
import org.json.JSONArray;
import org.junit.Test;

/** The Wear OS watch's events, waiting for the page: once each, in the watch's order, until acked. */
public class WatchEventQueueTest {
    private static String ev(String id) {
        return "{\"id\":\"" + id + "\",\"type\":\"setDone\",\"wid\":\"w-1\",\"exId\":\"0025\",\"entryIdx\":0,\"setIdx\":1,\"w\":62.5,\"r\":7,\"at\":1761743100000,\"hr\":{\"avg\":128,\"max\":141}}";
    }

    @Test
    public void keepsTheWatchesOrderNotTheDeliveryOrder() {
        JSONArray q = new JSONArray();
        q = WatchEventQueue.add(q, ev("b"), 2);
        q = WatchEventQueue.add(q, ev("a"), 1);
        q = WatchEventQueue.add(q, ev("c"), 3);
        JSONArray events = WatchEventQueue.events(q);
        assertEquals(3, events.length());
        assertEquals("a", events.optJSONObject(0).optString("id"));
        assertEquals("b", events.optJSONObject(1).optString("id"));
        assertEquals("c", events.optJSONObject(2).optString("id"));
    }

    @Test
    public void passesTheEventThroughUntouched() {
        JSONArray q = WatchEventQueue.add(new JSONArray(), ev("a"), 1);
        org.json.JSONObject e = WatchEventQueue.events(q).optJSONObject(0);
        assertEquals(62.5, e.optDouble("w"), 0);
        assertEquals(141, e.optJSONObject("hr").optInt("max"));
        assertEquals(1761743100000L, e.optLong("at"));
    }

    @Test
    public void storesAnEventOnce() {
        JSONArray q = WatchEventQueue.add(new JSONArray(), ev("a"), 1);
        assertSame(q, WatchEventQueue.add(q, ev("a"), 1));
        assertEquals(1, WatchEventQueue.events(q).length());
    }

    @Test
    public void refusesWhatIsNoEvent() {
        assertNull(WatchEventQueue.add(new JSONArray(), "{\"type\":\"setDone\"}", 1));
        assertNull(WatchEventQueue.add(new JSONArray(), "{\"id\":\"x\"}", 1));
        assertNull(WatchEventQueue.add(new JSONArray(), "nope", 1));
        assertNull(WatchEventQueue.add(new JSONArray(), null, 1));
    }

    @Test
    public void ackTakesOutOnlyWhatIsDone() {
        JSONArray q = new JSONArray();
        for (int i = 1; i <= 3; i++) q = WatchEventQueue.add(q, ev("e" + i), i);
        q = WatchEventQueue.ack(q, Arrays.asList("e1", "e3", "unknown"));
        JSONArray events = WatchEventQueue.events(q);
        assertEquals(1, events.length());
        assertEquals("e2", events.optJSONObject(0).optString("id"));
    }

    @Test
    public void capsAQueueNobodyDrained() {
        JSONArray q = new JSONArray();
        for (int i = 0; i < WatchEventQueue.MAX + 20; i++) q = WatchEventQueue.add(q, ev("e" + i), i);
        JSONArray events = WatchEventQueue.events(q);
        assertEquals(WatchEventQueue.MAX, events.length());
        assertEquals("e20", events.optJSONObject(0).optString("id"));
    }

    @Test
    public void aBrokenFileIsAnEmptyQueue() {
        assertEquals(0, WatchEventQueue.parse("{oops").length());
        assertEquals(0, WatchEventQueue.parse(null).length());
    }
}
