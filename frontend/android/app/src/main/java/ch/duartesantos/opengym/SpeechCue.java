package ch.duartesantos.opengym;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Spoken cues (Settings → Timer alerts → Spoken cues, lib/spoken-cues.js) in the phone's own
 * voice. Android's WebView has no speechSynthesis, so the page hands each line over here
 * (RestAlertPlugin.speak). Like the end tone (RestAlert.playNow), a line asks other apps to turn
 * down for it (AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) and gives the focus back once nothing is left
 * to say: music ducks, it never pauses.
 *
 * The engine starts the first time something is said; what arrives before it is ready waits.
 */
final class SpeechCue {
    private static final AudioAttributes ATTRS = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();

    private static TextToSpeech tts;
    private static boolean ready;
    private static boolean failed;
    private static Context app;
    private static final List<Line> waiting = new ArrayList<>();
    // The lines handed to the engine and not finished yet; the duck ends when this empties.
    private static final Set<String> open = new HashSet<>();
    private static Object focus;
    private static int seq;

    private static final class Line {
        final String text;
        final String lang;
        final float rate;
        final boolean flush;
        Line(String text, String lang, float rate, boolean flush) {
            this.text = text;
            this.lang = lang;
            this.rate = rate;
            this.flush = flush;
        }
    }

    private SpeechCue() { }

    /** Says `text` in `lang` (a BCP 47 tag, empty for the phone's default) at `rate` (1 is normal). */
    static synchronized boolean speak(Context ctx, String text, String lang, float rate, boolean flush) {
        if (failed || text == null || text.isEmpty()) return false;
        app = ctx.getApplicationContext();
        Line line = new Line(text, lang == null ? "" : lang, rate > 0 ? rate : 1f, flush);
        if (tts == null) {
            tts = new TextToSpeech(app, status -> started(status));
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { finished(id); }
                @Override @SuppressWarnings("deprecation") public void onError(String id) { finished(id); }
                @Override public void onStop(String id, boolean interrupted) { finished(id); }
            });
        }
        if (!ready) {
            if (flush) waiting.clear();
            waiting.add(line);
            return true;
        }
        say(line);
        return true;
    }

    /** Stops speaking now and forgets what was waiting. */
    static synchronized void hush() {
        waiting.clear();
        if (tts != null && ready) {
            try { tts.stop(); } catch (Exception ignored) { /* nothing was being said */ }
        }
        open.clear();
        release();
    }

    private static synchronized void started(int status) {
        if (status != TextToSpeech.SUCCESS) {
            failed = true;
            waiting.clear();
            return;
        }
        ready = true;
        try { tts.setAudioAttributes(ATTRS); } catch (Exception ignored) { /* the default stream then */ }
        List<Line> lines = new ArrayList<>(waiting);
        waiting.clear();
        for (Line l : lines) say(l);
    }

    private static void say(Line line) {
        try {
            if (!line.lang.isEmpty()) {
                Locale loc = Locale.forLanguageTag(line.lang);
                int ok = tts.setLanguage(loc);
                if (ok == TextToSpeech.LANG_MISSING_DATA || ok == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(new Locale(loc.getLanguage()));
            }
            tts.setSpeechRate(line.rate);
            if (line.flush) open.clear();
            if (open.isEmpty() && focus == null) {
                AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
                focus = RestAlert.duck(am, ATTRS);
            }
            String id = "cue" + (++seq);
            open.add(id);
            tts.speak(line.text, line.flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id);
        } catch (Exception e) {
            release();
        }
    }

    private static synchronized void finished(String id) {
        open.remove(id);
        if (open.isEmpty()) release();
    }

    private static void release() {
        if (focus == null || app == null) return;
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        RestAlert.unduck(am, focus);
        focus = null;
    }
}
