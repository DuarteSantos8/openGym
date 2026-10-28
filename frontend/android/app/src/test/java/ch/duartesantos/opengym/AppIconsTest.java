package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class AppIconsTest {
    @Test
    public void everyIdHasItsAlias() {
        assertEquals(AppIcons.IDS.length, AppIcons.ALIASES.length);
        assertEquals("IconDefault", AppIcons.aliasFor("default"));
        assertEquals("IconSky", AppIcons.aliasFor("sky"));
        assertEquals("IconHalloween", AppIcons.aliasFor("halloween"));
        assertEquals("IconChristmas", AppIcons.aliasFor("christmas"));
        assertNull(AppIcons.aliasFor("nope"));
        assertNull(AppIcons.aliasFor(null));
    }

    @Test
    public void untouchedAliasesMeanTheOriginal() {
        assertEquals("default", AppIcons.current(new boolean[AppIcons.ALIASES.length]));
    }

    @Test
    public void theAliasEnabledByHandIsTheIcon() {
        boolean[] on = new boolean[AppIcons.ALIASES.length];
        on[4] = true;
        assertEquals("sky", AppIcons.current(on));
        // Back to the original after a switch: IconDefault is enabled by hand, the rest disabled.
        on = new boolean[AppIcons.ALIASES.length];
        on[0] = true;
        assertEquals("default", AppIcons.current(on));
        // The last one, Christmas, counts too.
        on = new boolean[AppIcons.ALIASES.length];
        on[AppIcons.ALIASES.length - 1] = true;
        assertEquals("christmas", AppIcons.current(on));
    }
}
