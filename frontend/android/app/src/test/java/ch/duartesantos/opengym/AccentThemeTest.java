package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AccentThemeTest {
    @Test
    public void presetKeysMapToThemselves() {
        for (int i = 0; i < AccentTheme.NAMES.length; i++) assertEquals(i, AccentTheme.presetFor(AccentTheme.NAMES[i]));
    }

    @Test
    public void ownColourTakesTheClosestPreset() {
        assertEquals(1, AccentTheme.presetFor("#0066ff"));   // a blue: sky
        assertEquals(0, AccentTheme.presetFor("#22cc55"));   // a green: lime
        assertEquals(7, AccentTheme.presetFor("#FFE000"));   // a yellow: gold, case does not matter
    }

    @Test
    public void anythingElseIsNoAccent() {
        assertEquals(-1, AccentTheme.presetFor(null));
        assertEquals(-1, AccentTheme.presetFor("#abc"));
        assertEquals(-1, AccentTheme.presetFor("url(x)"));
    }
}
