package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** When the Huawei link looks again for watches (HuaweiLook). */
public class HuaweiLookTest {
    @Test public void theWaitDoublesFromFiveSecondsToFiveMinutesAndStays() {
        long w = 0;
        long[] want = { 5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000 };
        for (long expect : want) { w = HuaweiLook.next(w); assertEquals(expect, w); }
    }

    @Test public void itLooksOnlyWhileUpAndDeaf() {
        assertTrue(HuaweiLook.deaf(true, 0));
        assertFalse(HuaweiLook.deaf(true, 1));
        assertFalse(HuaweiLook.deaf(false, 0));
    }
}
