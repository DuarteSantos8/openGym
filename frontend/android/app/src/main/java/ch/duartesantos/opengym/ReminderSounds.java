package ch.duartesantos.opengym;

/**
 * A sound for each kind of reminder (v1.4.5, lib/reminder-sounds.js): the workout day and the
 * missed-day nudge, the check-in (weigh-in, measurements, progress photo) and the gym reminder can
 * each ring with a sound of their own. On Android 8 and up the sound belongs to the notification
 * channel and a channel cannot change it once made, so each choice gets its own channel, named
 * after its kind and the choice: "reminder-workout-1a2b3c4d". Picking another sound makes a new
 * channel and deletes the old one of that kind (ReminderSoundPlugin).
 *
 * Plain Java, no Android classes, so it has a unit test (ReminderSoundsTest).
 */
final class ReminderSounds {
    static final String PREFIX = "reminder-";
    /** lib/reminder-sounds.js REMINDER_KINDS. */
    static final String[] KINDS = {"workout", "checkin", "gym"};

    private ReminderSounds() {}

    static boolean knownKind(String kind) {
        for (String k : KINDS) if (k.equals(kind)) return true;
        return false;
    }

    /**
     * The channel for `kind` ringing `tone` ("none", a built-in tone such as "chime", "u:<sha-256>"
     * for a sound of one's own, "sys" for one of the phone's, with its `uri`). The same choice
     * always gives the same id; `version` changes it when the same choice must be made anew
     * (a sound of one's own whose file changed has another hash anyway).
     */
    static String channelId(String kind, String tone, String uri) {
        String key = (tone == null ? "" : tone) + "|" + ("sys".equals(tone) && uri != null ? uri : "");
        return PREFIX + kind + "-" + String.format("%08x", fnv1a(key));
    }

    /** Whether `id` is one of this kind's channels (any choice). */
    static boolean ofKind(String id, String kind) {
        return id != null && id.startsWith(PREFIX + kind + "-");
    }

    /** The file name a tone is written to for a channel: built-in and own ones, never the phone's. */
    static String fileName(String tone) {
        if (tone == null) return null;
        String hash = RestTone.userHash(tone);
        if (hash != null) return "u-" + hash + ".wav";
        for (String k : RestTone.KINDS) if (k.equals(tone)) return "tone-" + k + ".wav";
        return null;
    }

    /** 32-bit FNV-1a: short, stable, good enough to tell a few choices apart. */
    static int fnv1a(String s) {
        int h = 0x811c9dc5;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i);
            h *= 0x01000193;
        }
        return h;
    }

    /** 16-bit mono PCM samples at `rate` as a WAV file. */
    static byte[] toWav(short[] samples, int rate) {
        int data = samples.length * 2;
        java.nio.ByteBuffer b = java.nio.ByteBuffer.allocate(44 + data).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        b.putInt(0x46464952).putInt(36 + data).putInt(0x45564157);   // "RIFF", size, "WAVE"
        b.putInt(0x20746d66).putInt(16).putShort((short) 1).putShort((short) 1)   // "fmt ", PCM, mono
                .putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16);
        b.putInt(0x61746164).putInt(data);   // "data"
        for (short s : samples) b.putShort(s);
        return b.array();
    }
}
