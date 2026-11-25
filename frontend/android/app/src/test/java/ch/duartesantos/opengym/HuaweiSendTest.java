package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** One snapshot at a time to a Huawei watch (HuaweiSend). */
public class HuaweiSendTest {
    private static String snap(int now, String body) { return "{\"now\":" + now + ",\"v\":\"" + body + "\"}"; }

    @Test public void theFirstOneGoesAtOnce() {
        HuaweiSend s = new HuaweiSend();
        assertEquals(snap(1, "a"), s.want(snap(1, "a"), false, 0));
    }

    @Test public void aNewerOneWaitsAndOnlyTheNewestIsKept() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        assertNull(s.want(snap(2, "b"), false, 0));
        assertNull(s.want(snap(3, "c"), false, 0));
        assertEquals(snap(3, "c"), s.done(true, 0));
        assertNull(s.done(true, 0));
    }

    @Test public void aFailedOneLetsTheWaitingOneGo() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        s.want(snap(2, "b"), false, 0);
        assertEquals(snap(2, "b"), s.done(false, 0));
    }

    @Test public void theSameOneAsOnTheWayIsNotSentAgain() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        s.want(snap(2, "b"), false, 0);
        // the page is back to the one on its way (only `now` differs): the waiting one is dropped
        assertNull(s.want(snap(9, "a"), false, 0));
        assertNull(s.done(true, 0));
    }

    @Test public void theSameOneAsLastSentWholeIsNotSentAgain() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        s.done(true, 0);
        assertNull(s.want(snap(5, "a"), false, 0));
        assertEquals(snap(5, "b"), s.want(snap(5, "b"), false, 0));
    }

    @Test public void aFailedOneIsSentAgainWhenItComesAgain() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        s.done(false, 0);
        assertEquals(snap(2, "a"), s.want(snap(2, "a"), false, 0));
    }

    @Test public void aWatchThatAskedGetsItEvenIfItIsTheSame() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        s.done(true, 0);
        assertEquals(snap(2, "a"), s.want(snap(2, "a"), true, 0));
        // asked while the same one is on its way: it goes again after it
        assertNull(s.want(snap(3, "a"), true, 0));
        assertEquals(snap(3, "a"), s.done(false, 0));
    }

    @Test public void aWaitingOneEqualToWhatWentWholeIsDropped() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        s.want(snap(2, "b"), false, 0);
        s.want(snap(3, "a"), false, 0);
        assertNull(s.done(true, 0));
    }

    @Test public void aHelloDuringTheSameOneOnItsWayIsAnsweredWhateverHowItEnds() {
        // the watch app restarted mid-message and missed its head: it needs the whole snapshot again
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        assertNull(s.want(snap(2, "a"), true, 0));
        assertEquals(snap(2, "a"), s.done(true, 0));
        // and afterwards the same one from the page is not sent again
        s.done(true, 0);
        assertNull(s.want(snap(3, "a"), false, 0));
    }

    @Test public void aHelloDuringADifferentOneAlsoKeepsItsAsk() {
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 0);
        s.want(snap(2, "b"), true, 0);
        // the page's later plain snapshot replaces the waiting one but not the ask
        s.want(snap(3, "b"), false, 0);
        assertEquals(snap(3, "b"), s.done(true, 0));
    }

    @Test public void aMessageThatCouldNotBeFramedEndsAtOnceAndLeavesTheSlotFree() {
        // HuaweiLink ends a message it has no frames for with done(false): the waiting one goes, nothing stays busy
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "huge"), false, 0);
        s.want(snap(2, "small"), false, 0);
        assertEquals(snap(2, "small"), s.done(false, 0));
        assertNull(s.done(false, 0));
        assertEquals(snap(3, "next"), s.want(snap(3, "next"), false, 0));
    }

    @Test public void aBigSnapshotIsComparedWithoutItsClockToo() {
        // the Huawei string has the same `now` field, in the middle as well as first
        String body = "x";
        for (int i = 0; i < 12; i++) body += body;
        HuaweiSend s = new HuaweiSend();
        s.want("{\"v\":1,\"now\":111,\"d\":\"" + body + "\"}", false, 0);
        s.done(true, 0);
        assertNull(s.want("{\"v\":1,\"now\":999,\"d\":\"" + body + "\"}", false, 0));
    }

    @Test public void anIdenticalOneIsDroppedInABurstButGoesAgainAfterAWhile() {
        // the page resends the same snapshot when an event comes a second time: a watch does that 10 to 60 s later
        HuaweiSend s = new HuaweiSend();
        s.want(snap(1, "a"), false, 1000);
        s.done(true, 2000);
        assertNull(s.want(snap(2, "a"), false, 3000));
        assertNull(s.want(snap(3, "a"), false, 2000 + HuaweiSend.REPEAT_MS - 1));
        assertEquals(snap(4, "a"), s.want(snap(4, "a"), false, 2000 + HuaweiSend.REPEAT_MS));
    }
}
