package ch.duartesantos.opengym;

import static org.junit.Assert.*;

import org.junit.Test;

/** How much of a system bar lies over the page (MainActivity.overlapTop/overlapBottom, #573). */
public class SystemBarsOverlapTest {
    @Test
    public void edgeToEdgeThePageIsUnderTheWholeBar() {
        assertEquals(84, MainActivity.overlapTop(84, 0));
        assertEquals(63, MainActivity.overlapBottom(63, 2400, 2400));
    }

    @Test
    public void aWindowThatStopsAtTheBarsHasNothingUnderThem() {
        assertEquals(0, MainActivity.overlapTop(84, 84));
        assertEquals(0, MainActivity.overlapBottom(63, 2337, 2400));
    }

    @Test
    public void partlyUnderPassesThePartOnly() {
        assertEquals(24, MainActivity.overlapTop(84, 60));
        assertEquals(13, MainActivity.overlapBottom(63, 2350, 2400));
        assertEquals(0, MainActivity.overlapTop(0, 0));
    }
}
