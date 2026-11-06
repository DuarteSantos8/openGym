package ch.duartesantos.opengym;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ReminderSoundsTest {
    @Test
    public void oneChannelPerKindAndChoice() {
        String a = ReminderSounds.channelId("workout", "chime", null);
        assertEquals(a, ReminderSounds.channelId("workout", "chime", null));
        assertTrue(a.matches("reminder-workout-[0-9a-f]{8}"));
        assertNotEquals(a, ReminderSounds.channelId("workout", "bell", null));
        assertNotEquals(a, ReminderSounds.channelId("checkin", "chime", null));
        // the phone's own sounds differ by their address; a built-in ignores a stray one
        assertNotEquals(ReminderSounds.channelId("gym", "sys", "content://media/1"), ReminderSounds.channelId("gym", "sys", "content://media/2"));
        assertEquals(a, ReminderSounds.channelId("workout", "chime", "content://media/1"));
    }

    @Test
    public void channelsKnowTheirKind() {
        assertTrue(ReminderSounds.ofKind(ReminderSounds.channelId("gym", "none", null), "gym"));
        assertFalse(ReminderSounds.ofKind(ReminderSounds.channelId("gym", "none", null), "workout"));
        assertFalse(ReminderSounds.ofKind("rest-over", "workout"));
        assertFalse(ReminderSounds.ofKind(null, "workout"));
        assertTrue(ReminderSounds.knownKind("checkin"));
        assertFalse(ReminderSounds.knownKind("rest"));
    }

    @Test
    public void filesForBuiltInAndOwnTonesOnly() {
        assertEquals("tone-bell.wav", ReminderSounds.fileName("bell"));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 32; i++) sb.append("ab");
        String hash = sb.toString();
        assertEquals("u-" + hash + ".wav", ReminderSounds.fileName("u:" + hash));
        assertNull(ReminderSounds.fileName("sys"));
        assertNull(ReminderSounds.fileName("none"));
        assertNull(ReminderSounds.fileName("../../etc"));
    }

    @Test
    public void theWavRoundTripsThroughRestTone() {
        short[] s = {0, 1000, -1000, Short.MAX_VALUE, Short.MIN_VALUE};
        byte[] wav = ReminderSounds.toWav(s, RestTone.RATE);
        assertEquals(44 + s.length * 2, wav.length);
        assertArrayEquals(s, RestTone.fromWav(wav));
    }
}
