package ch.duartesantos.opengym;

/**
 * The end-of-rest tone the native side plays while the app is in the background or the screen
 * is off, as 16-bit mono samples. Plain Java with no Android classes, so it has a unit test.
 *
 * The page plays the same choices through Web Audio (frontend/src/lib/sound.js chime()):
 * the chime, high, low, then high and long, held near full scale in a bright timbre, and the
 * classic three beeps. Until v1.3.11 this side only knew the classic beeps, so a locked phone
 * played the quiet old sound however Settings → Sound was set. #306 added a bell, a beep-beep,
 * a whistle and a soft one; their notes, peaks, holds and timbres are copied from
 * frontend/src/lib/rest-sounds.js REST_SOUNDS and rendered the way the chime is.
 */
final class RestTone {
    static final int RATE = 22050;

    /**
     * Silence after the tone. The player is let go once the mixer has taken every sample, but
     * Bluetooth earbuds and the screen-off low-power output still hold up to a few hundred
     * milliseconds of audio by then; without this tail the last, longest note got cut.
     */
    static final double TAIL_SEC = 0.6;

    /** lib/sound.js CHIME_PEAK, CHIME and the 0.6 hold. */
    static final double CHIME_PEAK = 0.9;
    private static final double[][] CHIME = {{1319, 0.16, 0}, {988, 0.16, 0.22}, {1319, 0.5, 0.44}};
    private static final double CHIME_HOLD = 0.6;
    /** lib/sound.js TIMBRES: the strengths of the fundamental and its harmonics. A sine is {1}. */
    private static final double[] BRIGHT = {1, 0.6, 0.35, 0.2};
    private static final double[] BELL = {1, 0.25, 0.5, 0.1, 0.3};
    private static final double[] SINE = {1};

    /** lib/rest-sounds.js REST_SOUNDS: notes of {freq, dur, when} or {freq, dur, when, glideTo}. */
    private static final double[][] BELL_NOTES = {{1319, 0.9, 0}, {1047, 1.3, 0.4}};
    private static final double[][] BEEP_NOTES = {{1760, 0.08, 0}, {1760, 0.08, 0.13}, {1760, 0.08, 0.4}, {1760, 0.08, 0.53}};
    private static final double[][] WHISTLE_NOTES = {{1300, 0.16, 0, 2100}, {1500, 0.42, 0.22, 2500}};
    private static final double[][] SOFT_NOTES = {{659, 0.4, 0}, {784, 0.4, 0.2}, {988, 0.8, 0.4}};

    /** Every name Settings → Sound can hand over (lib/rest-sounds.js REST_SOUND_IDS). */
    static final String[] KINDS = {"chime", "classic", "bell", "beep", "whistle", "soft"};

    private RestTone() {}

    static short[] render(boolean classic) {
        return render(classic ? "classic" : "chime");
    }

    /** The sound named `kind`, with its silent tail; a name it does not know plays the chime. */
    static short[] render(String kind) {
        String k = kind == null ? "chime" : kind;
        switch (k) {
            case "classic": return withTail(renderBeeps());
            case "bell": return withTail(renderNotes(BELL_NOTES, 0.55, 0, BELL));
            case "beep": return withTail(renderNotes(BEEP_NOTES, 0.8, 0.8, BRIGHT));
            case "whistle": return withTail(renderNotes(WHISTLE_NOTES, 0.7, 0.55, SINE));
            case "soft": return withTail(renderNotes(SOFT_NOTES, 0.3, 0, SINE));
            default: return withTail(renderChime());
        }
    }

    /**
     * The chime as the page renders it: each note ramps up from silence in 20 ms, holds its peak
     * for 60% of the note, then falls away exponentially, in a wave normalised to a peak of 1 as
     * Web Audio normalises a periodic wave.
     */
    static short[] renderChime() {
        return renderNotes(CHIME, CHIME_PEAK, CHIME_HOLD, BRIGHT);
    }

    /**
     * Notes the way lib/sound.js tone() plays them: each with the gain curve of `gain`, in the
     * timbre `harmonics` normalised to a peak of 1, a note with a fourth number sliding linearly
     * to that frequency by its end (Web Audio's linearRampToValueAtTime). Overlapping notes add
     * up; the sounds are tuned so they stay under full scale, and the sum is clamped all the same.
     */
    static short[] renderNotes(double[][] notes, double peak, double hold, double[] harmonics) {
        double end = 0;
        for (double[] n : notes) end = Math.max(end, n[2] + n[1]);
        double[] mix = new double[(int) Math.ceil(end * RATE)];
        double norm = wavePeak(harmonics);
        for (double[] n : notes) {
            double freq = n[0], dur = n[1], to = n.length > 3 ? n[3] : freq;
            int start = (int) Math.round(n[2] * RATE);
            int len = (int) (dur * RATE);
            for (int s = 0; s < len && start + s < mix.length; s++) {
                double t = s / (double) RATE;
                // the phase of a frequency rising linearly from `freq` to `to` over `dur`
                double cycles = freq * t + (to - freq) * t * t / (2 * dur);
                double wave = 0;
                for (int k = 0; k < harmonics.length; k++) wave += harmonics[k] * Math.sin(2 * Math.PI * cycles * (k + 1));
                mix[start + s] += wave / norm * gain(t, dur, peak, hold);
            }
        }
        short[] out = new short[mix.length];
        for (int i = 0; i < mix.length; i++) out[i] = (short) Math.max(-32767, Math.min(32767, Math.round(mix[i] * 32767)));
        return out;
    }

    /** The gain curve of lib/sound.js tone() with peak CHIME_PEAK and hold CHIME_HOLD. */
    static double chimeGain(double t, double dur) {
        return gain(t, dur, CHIME_PEAK, CHIME_HOLD);
    }

    /**
     * lib/sound.js tone()'s gain: up from 0.001 to `peak` in 20 ms, held until `hold` of the note
     * (never before the 20 ms are up, as Web Audio runs the ramps in order), then down to 0.001
     * by the end.
     */
    static double gain(double t, double dur, double peak, double hold) {
        double floor = 0.001, attack = 0.02, holdEnd = Math.max(attack, dur * hold);
        if (t < 0) return 0;
        if (t < attack) return floor * Math.pow(peak / floor, t / attack);
        if (t < holdEnd) return peak;
        if (t < dur) return peak * Math.pow(floor / peak, (t - holdEnd) / (dur - holdEnd));
        return 0;
    }

    private static double wavePeak(double[] harmonics) {
        double max = 0;
        for (int i = 0; i < 4096; i++) {
            double x = 2 * Math.PI * i / 4096;
            double v = 0;
            for (int k = 0; k < harmonics.length; k++) v += harmonics[k] * Math.sin((k + 1) * x);
            max = Math.max(max, Math.abs(v));
        }
        return max;
    }

    /**
     * The classic beeps (880, 880, 1320). Flat at 0.85 of full scale rather than the page's fade
     * from 0.35: this is what the locked phone has always played for "Classic".
     */
    static short[] renderBeeps() {
        int[] freq = {880, 880, 1320};
        double[] dur = {0.15, 0.15, 0.40};
        double[] gap = {0.10, 0.10, 0};
        int total = 0;
        for (int i = 0; i < freq.length; i++) total += (int) (RATE * (dur[i] + gap[i]));
        short[] out = new short[total];
        int pos = 0;
        for (int i = 0; i < freq.length; i++) {
            int n = (int) (RATE * dur[i]);
            int g = (int) (RATE * gap[i]);
            int fade = Math.max(1, RATE / 200);
            for (int s = 0; s < n; s++) {
                double env = 1;
                if (s < fade) env = s / (double) fade;
                else if (s > n - fade) env = (n - s) / (double) fade;
                double wave = Math.sin(2 * Math.PI * freq[i] * s / RATE);
                out[pos++] = (short) Math.max(-32767, Math.min(32767, wave * env * 0.85 * 32767));
            }
            pos += g;
        }
        return out;
    }

    static short[] withTail(short[] tone) {
        short[] out = new short[tone.length + (int) (TAIL_SEC * RATE)];
        System.arraycopy(tone, 0, out, 0, tone.length);
        return out;
    }
}
