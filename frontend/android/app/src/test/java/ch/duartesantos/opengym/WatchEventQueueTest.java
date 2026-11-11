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

    /** Two watches on one phone (a Wear OS watch and a Garmin): each numbers its own events from 1. */
    @Test
    public void twoWatchesWithTheSameNumbersBothStay_eachInItsOwnOrder() {
        JSONArray q = new JSONArray();
        q = WatchEventQueue.add(q, ev("wear-2"), 2);
        q = WatchEventQueue.add(q, ev("garmin-1"), 1);
        q = WatchEventQueue.add(q, ev("wear-1"), 1);
        q = WatchEventQueue.add(q, ev("garmin-2"), 2);
        JSONArray events = WatchEventQueue.events(q);
        assertEquals(4, events.length());
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (int i = 0; i < events.length(); i++) ids.add(events.optJSONObject(i).optString("id"));
        assertEquals(true, ids.indexOf("wear-1") < ids.indexOf("wear-2"));
        assertEquals(true, ids.indexOf("garmin-1") < ids.indexOf("garmin-2"));
    }

    /** The app killed between the page's drain and its ack: the next drain hands the same events over again. */
    @Test
    public void whatWasDrainedButNeverAckedIsStillThere() {
        JSONArray q = new JSONArray();
        q = WatchEventQueue.add(q, ev("a"), 1);
        q = WatchEventQueue.add(q, ev("b"), 2);
        String onDisk = q.toString();
        assertEquals(2, WatchEventQueue.events(WatchEventQueue.parse(onDisk)).length());
        // the watch sends "a" again meanwhile (it has not heard): still once
        JSONArray again = WatchEventQueue.add(WatchEventQueue.parse(onDisk), ev("a"), 1);
        assertEquals(2, WatchEventQueue.events(again).length());
        // acked, then resent by the watch once more: it is back in the queue (the page knows its id and skips it)
        JSONArray acked = WatchEventQueue.ack(again, Arrays.asList("a", "b"));
        assertEquals(0, acked.length());
        assertEquals(1, WatchEventQueue.add(acked, ev("a"), 1).length());
    }

    /** The phone's clock set back an hour: the next snapshot's stamp is still newer than the last one's. */
    @Test
    public void theSnapshotStampNeverGoesBack() {
        assertEquals(2000L, WatchEventQueue.nextStamp(1000L, 2000L));
        assertEquals(1001L, WatchEventQueue.nextStamp(1000L, 1000L));
        assertEquals(3_600_001L, WatchEventQueue.nextStamp(3_600_000L, 5L));
        assertEquals(5L, WatchEventQueue.nextStamp(0L, 5L));
    }
}
