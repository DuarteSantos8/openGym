package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class GarminUseTest {
    @Test public void withoutGarminConnectItSaysSoAndKeepsSaying() {
        assertEquals("no-gcm", GarminUse.stateOnUse("off", false, false));
        // the page asks again 3 s later: still no-gcm, never "starting" (QA66: "Checking…" for good)
        assertEquals("no-gcm", GarminUse.stateOnUse("no-gcm", false, false));
    }

    @Test public void garminConnectInstalledLaterStartsTheSdk() {
        assertEquals("starting", GarminUse.stateOnUse("no-gcm", false, true));
        assertEquals("starting", GarminUse.stateOnUse("off", false, true));
    }

    @Test public void aRunningOrStartingLinkIsLeftAlone() {
        assertEquals("ready", GarminUse.stateOnUse("ready", true, true));
        assertEquals("starting", GarminUse.stateOnUse("starting", false, false));
        assertEquals("error", GarminUse.stateOnUse("error", false, true));
        assertEquals("no-gcm", GarminUse.stateOnUse("no-gcm", true, false));
    }

    @Test public void aStartThatNeverComesUpIsTriedAgainThenSaysSo() {
        // Garmin Connect's service did not answer: "Checking…" must end (retry, retry, error)
        assertEquals("retry", GarminUse.onStartTimeout(1));
        assertEquals("retry", GarminUse.onStartTimeout(2));
        assertEquals("error", GarminUse.onStartTimeout(GarminUse.MAX_TRIES));
        assertEquals("error", GarminUse.onStartTimeout(GarminUse.MAX_TRIES + 1));
    }

    @Test public void lookAgainStartsOverOnlyFromADeadEnd() {
        assertTrue(GarminUse.restartsOnLookAgain("error"));
        // Garmin Connect was too old and has been updated since: nobody tells the SDK
        assertTrue(GarminUse.restartsOnLookAgain("gcm-upgrade"));
        assertFalse(GarminUse.restartsOnLookAgain("ready"));
        assertFalse(GarminUse.restartsOnLookAgain("starting"));
        assertFalse(GarminUse.restartsOnLookAgain("no-gcm"));
        assertFalse(GarminUse.restartsOnLookAgain("off"));
    }

    @Test public void notInstalledOnlyCountsFromAWatchThatIsThere() {
        assertTrue(GarminUse.trustsNotInstalled(true));
        // out of reach: Garmin Connect cannot ask the watch, what was known before stands
        assertFalse(GarminUse.trustsNotInstalled(false));
    }

    @Test public void aSnapshotLostOnTheWayGoesOnceMore() {
        assertTrue(GarminUse.sendsAgain("FAILURE_DURING_TRANSFER", true));
        assertTrue(GarminUse.sendsAgain("FAILURE_UNKNOWN", true));
        // only once, and not what will never get through or a watch that is away
        assertFalse(GarminUse.sendsAgain("FAILURE_DURING_TRANSFER", false));
        assertFalse(GarminUse.sendsAgain("FAILURE_MESSAGE_TOO_LARGE", true));
        assertFalse(GarminUse.sendsAgain("FAILURE_DEVICE_NOT_CONNECTED", true));
        assertFalse(GarminUse.sendsAgain("SUCCESS", true));
        assertFalse(GarminUse.sendsAgain(null, true));
    }
}
