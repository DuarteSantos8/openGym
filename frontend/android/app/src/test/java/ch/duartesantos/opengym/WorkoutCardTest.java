package ch.duartesantos.opengym;

import static org.junit.Assert.*;

import org.junit.Test;

/** The workout card's Log set while the page sleeps (WorkoutCard, #760). */
public class WorkoutCardTest {
    private static WorkoutCard.SetInfo set(String exId, int entryIdx, int setIdx, int restAfter) {
        WorkoutCard.SetInfo s = new WorkoutCard.SetInfo();
        s.exId = exId;
        s.entryIdx = entryIdx;
        s.setIdx = setIdx;
        s.restAfter = restAfter;
        return s;
    }

    private static WorkoutCard card() {
        WorkoutCard c = new WorkoutCard();
        c.cur = set("bench", 0, 1, 90);
        c.ahead.add(set("bench", 0, 2, 120));
        c.ahead.add(set("row", 1, 0, 0));
        c.done = 1;
        c.total = 6;
        return c;
    }

    @Test
    public void logSetMovesOnAndStartsTheRestOfTheSetJustDone() {
        WorkoutCard c = card();
        assertEquals(90_000, c.tick());
        assertEquals(2, c.cur.setIdx);
        assertEquals(1, c.ahead.size());
        assertEquals(2, c.done);
    }

    @Test
    public void aSetWithoutRestGoesStraightToTheNextOne() {
        WorkoutCard c = card();
        c.cur.restAfter = 0;
        assertEquals(0, c.tick());
        assertEquals(2, c.cur.setIdx);
    }

    @Test
    public void onlyTheSetShownIsTicked() {
        WorkoutCard c = card();
        assertTrue(c.shows("bench", 0, 1));
        assertFalse(c.shows("bench", 0, 2));
        assertFalse(c.shows("row", 0, 1));
        c.tick();
        // The same button tapped twice: the second tap is about the set already done.
        assertFalse(c.shows("bench", 0, 1));
    }

    @Test
    public void pastTheSetsCarriedThereIsNoSetAndNoRest() {
        WorkoutCard c = card();
        c.tick();
        c.tick();
        assertEquals(0, c.tick());
        assertNull(c.cur);
        assertEquals(4, c.done);
        assertFalse(c.shows("row", 1, 0));
        c.done = c.total;
        c.ahead.add(set("x", 2, 0, 60));
        c.cur = set("y", 3, 0, 60);
        c.tick();
        assertEquals(6, c.done);
    }
}
