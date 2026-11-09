package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Spoken cues ask for the focus once and give it back after the last line, even a lost one. */
public class CueLinesTest {
    @Test
    public void asksOnceAndGivesBackAfterTheLastLine() {
        CueLines l = new CueLines();
        assertTrue(l.start("a", "Ten seconds", 1f, 0));
        assertFalse(l.start("b", "Rest is over", 1f, 10));
        assertFalse(l.finish("a"));
        assertTrue(l.finish("b"));
        assertFalse(l.finish("b"));
    }

    @Test
    public void endsInEitherOrder() {
        CueLines l = new CueLines();
        l.start("a", "x", 1f, 0);
        l.start("b", "y", 1f, 0);
        assertFalse(l.finish("b"));
        assertTrue(l.finish("a"));
    }

    @Test
    public void aLineTheEngineNeverFinishesLetsGo() {
        CueLines l = new CueLines();
        l.start("a", "Go", 1f, 0);
        assertFalse(l.expire(2_000));
        assertTrue(l.expire(3_200));
        assertTrue(l.isEmpty());
        assertFalse(l.expire(10_000));
    }

    @Test
    public void capIsBounded() {
        assertEquals(3_000, CueLines.capMs("", 1f));
        assertEquals(3_000, CueLines.capMs(null, Float.NaN));
        assertEquals(60_000, CueLines.capMs(new String(new char[5000]), 1f));
        assertTrue(CueLines.capMs(new String(new char[120]), 0.5f) > CueLines.capMs(new String(new char[120]), 2f));
    }
}
