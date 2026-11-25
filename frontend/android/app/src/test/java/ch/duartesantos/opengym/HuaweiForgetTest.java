package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.junit.Test;

/** When a Huawei watch is forgotten (HuaweiForget). */
public class HuaweiForgetTest {
    private static Set<String> set(String... ids) { return new HashSet<>(Arrays.asList(ids)); }

    @Test public void anEmptyListForgetsNothingAndCountsForNothing() {
        HuaweiForget f = new HuaweiForget();
        assertTrue(f.missing(set("a", "b"), Collections.<String>emptySet()).isEmpty());
        assertTrue(f.missing(set("a", "b"), Collections.<String>emptySet()).isEmpty());
        // one real miss after any number of empty answers is still only one
        assertTrue(f.missing(set("a", "b"), set("a")).isEmpty());
    }

    @Test public void aWatchMissingTwiceInARowIsForgotten() {
        HuaweiForget f = new HuaweiForget();
        assertTrue(f.missing(set("a", "b"), set("a")).isEmpty());
        assertEquals(set("b"), f.missing(set("a", "b"), set("a")));
    }

    @Test public void aWatchThatComesBackBetweenIsKept() {
        HuaweiForget f = new HuaweiForget();
        f.missing(set("a", "b"), set("a"));
        f.missing(set("a", "b"), set("a", "b"));
        assertTrue(f.missing(set("a", "b"), set("a")).isEmpty());
    }

    @Test public void emptyAnswersBetweenAreSkipped() {
        HuaweiForget f = new HuaweiForget();
        assertTrue(f.missing(set("a", "b"), set("a")).isEmpty());
        // an empty answer in between is skipped: the two real misses are still two in a row
        assertTrue(f.missing(set("a", "b"), Collections.<String>emptySet()).isEmpty());
        assertEquals(set("b"), f.missing(set("a", "b"), set("a")));
    }
}
