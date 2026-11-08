package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AccentThemeTest {
    @Test
    public void presetKeysMapToThemselves() {
        for (int i = 0; i < AccentTheme.NAMES.length; i++) assertEquals(i, AccentTheme.presetFor(AccentTheme.NAMES[i]));
    }

    @Test
    public void ownColourTakesTheClosestPreset() {
        assertEquals(2, AccentTheme.presetFor("#0066ff"));   // a blue: sky
        assertEquals(1, AccentTheme.presetFor("#22cc55"));   // a green: lime
        assertEquals(0, AccentTheme.presetFor("#B0F040"));   // a light lime: the brand's green
        assertEquals(8, AccentTheme.presetFor("#FFE000"));   // a yellow: gold, case does not matter
    }

    @Test
    public void theBrandGreenComesFirst() {
        assertEquals("brand", AccentTheme.NAMES[0]);
        assertEquals(0xa3e635, AccentTheme.COLORS[0]);
        assertEquals("lime", AccentTheme.NAMES[1]);
    }

    @Test
    public void widgetDarkensALightAccentOnWhiteOnly() {
        int brand = 0xFFA3E635, white = 0xFFFFFFFF, card = 0xFF1C1C1E;
        int onWhite = OpenGymWidgetProvider.readableOn(brand, white);
        assertTrue(OpenGymWidgetProvider.contrast(onWhite, white) >= 3.0);
        assertEquals(brand, OpenGymWidgetProvider.readableOn(brand, card));
        assertEquals(0xFF0A84FF, OpenGymWidgetProvider.readableOn(0xFF0A84FF, white));   // blue already reads
    }

    @Test
    public void anythingElseIsNoAccent() {
        assertEquals(-1, AccentTheme.presetFor(null));
        assertEquals(-1, AccentTheme.presetFor("#abc"));
        assertEquals(-1, AccentTheme.presetFor("url(x)"));
    }
}
