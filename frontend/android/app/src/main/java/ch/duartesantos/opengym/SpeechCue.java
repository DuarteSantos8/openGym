package ch.duartesantos.opengym;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.util.ArrayList;
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
 *
 * Settings → Timer alerts → Voice (v1.4.5): one of the engine's voices by its name, and a pitch.
 * voices() lists them for the picker; a name the engine does not know is the default voice.
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
    // Who asked for the list of voices before the engine was ready.
    private static final List<VoicesCallback> askers = new ArrayList<>();

    interface VoicesCallback { void done(List<Voice> voices); }
    // The lines handed to the engine and not finished yet; the duck ends when this empties.
    private static final CueLines open = new CueLines();
    private static Handler main;
    private static Object focus;
    private static int seq;

    private static final class Line {
        final String text;
        final String lang;
        final float rate;
        final float pitch;
        final String voice;
        final boolean flush;
        Line(String text, String lang, float rate, float pitch, String voice, boolean flush) {
            this.text = text;
            this.lang = lang;
            this.rate = rate;
            this.pitch = pitch;
            this.voice = voice;
            this.flush = flush;
        }
    }

    private SpeechCue() { }

    /**
     * Says `text` in `lang` (a BCP 47 tag, empty for the phone's default) at `rate` and `pitch`
     * (1 is normal), in the voice named `voice` (empty for the language's default).
     */
    static synchronized boolean speak(Context ctx, String text, String lang, float rate, float pitch, String voice, boolean flush) {
        if (failed || text == null || text.isEmpty()) return false;
        Line line = new Line(text, lang == null ? "" : lang, rate > 0 ? rate : 1f, pitch > 0 ? pitch : 1f, voice == null ? "" : voice, flush);
        start(ctx);
        if (!ready) {
            if (flush) waiting.clear();
            waiting.add(line);
            return true;
        }
        say(line);
        return true;
    }

    /** The engine's voices, once it is ready; an empty list when there is no engine. */
    static synchronized void voices(Context ctx, VoicesCallback cb) {
        if (failed) { cb.done(new ArrayList<>()); return; }
        start(ctx);
        if (!ready) { askers.add(cb); return; }
        cb.done(listVoices());
    }

    private static List<Voice> listVoices() {
        List<Voice> out = new ArrayList<>();
        try {
            Set<Voice> all = tts.getVoices();
            if (all != null) out.addAll(all);
        } catch (Exception ignored) { /* an engine that cannot list them */ }
        return out;
    }

    private static void start(Context ctx) {
        app = ctx.getApplicationContext();
        if (tts == null) {
            tts = new TextToSpeech(app, status -> started(status));
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { finished(id); }
                @Override @SuppressWarnings("deprecation") public void onError(String id) { finished(id); }
                @Override public void onStop(String id, boolean interrupted) { finished(id); }
            });
        }
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
            List<VoicesCallback> cbs = new ArrayList<>(askers);
            askers.clear();
            for (VoicesCallback cb : cbs) cb.done(new ArrayList<>());
            return;
        }
        ready = true;
        try { tts.setAudioAttributes(ATTRS); } catch (Exception ignored) { /* the default stream then */ }
        List<Line> lines = new ArrayList<>(waiting);
        waiting.clear();
        for (Line l : lines) say(l);
        List<VoicesCallback> cbs = new ArrayList<>(askers);
        askers.clear();
        if (!cbs.isEmpty()) {
            List<Voice> vs = listVoices();
            for (VoicesCallback cb : cbs) cb.done(vs);
        }
    }

    private static void say(Line line) {
        try {
            if (!line.lang.isEmpty()) {
                Locale loc = Locale.forLanguageTag(line.lang);
                int ok = tts.setLanguage(loc);
                if (ok == TextToSpeech.LANG_MISSING_DATA || ok == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(new Locale(loc.getLanguage()));
            }
            // The voice picked in Settings, after the language (setLanguage picks that language's
            // default voice, which this then replaces). An unknown name keeps the default.
            if (!line.voice.isEmpty()) {
                for (Voice v : listVoices()) {
                    if (line.voice.equals(v.getName())) { tts.setVoice(v); break; }
                }
            }
            tts.setSpeechRate(line.rate);
            tts.setPitch(line.pitch);
            if (line.flush) open.clear();
            if (focus == null) {
                AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
                focus = RestAlert.duck(am, ATTRS);
            }
            String id = "cue" + (++seq);
            open.start(id, line.text, line.rate, SystemClock.elapsedRealtime());
            // A line the engine refused never calls back: it ends here, not never.
            if (tts.speak(line.text, line.flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id) == TextToSpeech.ERROR) {
                finished(id);
                return;
            }
            // And one it took but never reports done lets the music back up after its cap.
            if (main == null) main = new Handler(Looper.getMainLooper());
            main.postDelayed(SpeechCue::expire, CueLines.capMs(line.text, line.rate) + 50);
        } catch (Exception e) {
            open.clear();
            release();
        }
    }

    private static synchronized void expire() {
        if (open.expire(SystemClock.elapsedRealtime())) release();
    }

    private static synchronized void finished(String id) {
        if (open.finish(id)) release();
    }

    private static void release() {
        if (focus == null || app == null) return;
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        RestAlert.unduck(am, focus);
        focus = null;
    }
}
