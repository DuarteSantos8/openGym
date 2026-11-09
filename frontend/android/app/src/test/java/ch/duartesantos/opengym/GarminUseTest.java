package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;

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
}
