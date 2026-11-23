package ch.duartesantos.opengym;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.nfc.FormatException;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.Arrays;

/**
 * openGym's NFC stickers (lib/nfc.js, components/Nfc.jsx): writes one openGym link onto a sticker,
 * and passes on the link of a sticker that started or reached the app.
 *
 * Reading needs no session: the manifest's NDEF_DISCOVERED filter (https://opengym.ch/nfc...)
 * makes Android start the app for one of our stickers, with the app closed too, and the link goes
 * to the page as the `open` event (kept until the page listens, so a cold start arrives). An
 * opengym:// link from opengym.ch/nfc comes through the same way.
 *
 * Writing uses the adapter's reader mode while the page's sheet waits: the sticker comes straight
 * here, not to the system's tag dispatch, and is written as one NDEF URI record (a blank sticker
 * is NDEF-formatted first). Only NDEF stickers: no card emulation, nothing reads a gym's card.
 *
 * Reading for a machine (the scan sheet) uses reader mode too: `read` keeps it on and every sticker
 * that reaches it goes to the page as a `tag` event ({ uid, records: [{ type, value }] }) until
 * `stopRead`. Only the well-known URI and text records are passed on, as plain strings: a
 * sticker's content is untrusted, so nothing here opens, starts or acts on it. Reader mode takes
 * the stickers away from the system's dispatch, so an openGym sticker does not also fire `open`.
 *
 * Usage from JS:
 *   const NfcTags = registerPlugin('NfcTags')
 *   await NfcTags.isAvailable()               // { supported: true, enabled: true }
 *   await NfcTags.write({ url: 'https://opengym.ch/nfc?do=start' })
 *   await NfcTags.cancel()
 */
@CapacitorPlugin(name = "NfcTags")
public class NfcTagsPlugin extends Plugin {
    private PluginCall pending;
    private volatile boolean reading; // reader mode is on for a read (set on the UI thread, read on the adapter's)
    private boolean resumeRead; // a read was on when the app paused: it comes back on resume (UI thread)

    @Override
    public void load() {
        Activity a = getActivity();
        if (a != null) passOn(a.getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        passOn(intent);
    }

    /** Whether `uri` is one of the links openGym puts on a sticker (or opengym.ch/nfc hands over). */
    static boolean isOurLink(Uri uri) {
        if (uri == null || uri.getScheme() == null) return false;
        String scheme = uri.getScheme().toLowerCase();
        if (scheme.equals("opengym")) return true;
        if (!scheme.equals("https") && !scheme.equals("http")) return false;
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (host.startsWith("www.")) host = host.substring(4);
        String path = uri.getPath() == null ? "" : uri.getPath();
        return host.equals("opengym.ch") && (path.equals("/nfc") || path.equals("/nfc/") || path.equals("/nfc.html"));
    }

    private void passOn(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action) && !Intent.ACTION_VIEW.equals(action)) return;
        Uri uri = intent.getData();
        if (!isOurLink(uri)) return;
        JSObject ev = new JSObject();
        ev.put("url", uri.toString());
        notifyListeners("open", ev, true);
    }

    private NfcAdapter adapter() {
        return getActivity() == null ? null : NfcAdapter.getDefaultAdapter(getActivity());
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        NfcAdapter a = adapter();
        JSObject r = new JSObject();
        r.put("supported", a != null);
        r.put("enabled", a != null && a.isEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty() || url.length() > 512) {
            call.reject("url is required", "failed");
            return;
        }
        NfcAdapter a = adapter();
        if (a == null) {
            call.reject("this phone has no NFC", "unsupported");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("NFC is disabled", "disabled");
            return;
        }
        final NdefMessage message = new NdefMessage(new NdefRecord[] { NdefRecord.createUri(url) });
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            if (pending != null) pending.reject("replaced by a newer write", "cancelled");
            reading = false; // one reader callback at a time: this write takes over from a read
            resumeRead = false;
            pending = call;
            int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F
                    | NfcAdapter.FLAG_READER_NFC_V | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
            a.enableReaderMode(act, tag -> writeTo(tag, message, call), flags, null);
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        NfcAdapter a = adapter();
        if (a == null) {
            call.reject("this phone has no NFC", "unsupported");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("NFC is disabled", "disabled");
            return;
        }
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            if (pending != null) {
                pending.reject("replaced by a read", "cancelled");
                pending = null;
            }
            resumeRead = false;
            startReading(a, act);
            call.resolve(); // reading goes on; the stickers arrive as `tag` events
        });
    }

    /** On the UI thread: reader mode for a machine read. */
    private void startReading(NfcAdapter a, Activity act) {
        reading = true;
        // No FLAG_READER_SKIP_NDEF_CHECK: the cached NDEF message is read for us.
        int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F
                | NfcAdapter.FLAG_READER_NFC_V | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
        a.enableReaderMode(act, this::onReadTag, flags, null);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        resumeRead = false;
        stopReader();
        if (pending != null) {
            pending.reject("cancelled", "cancelled");
            pending = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void stopRead(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            resumeRead = false;
            // Only a read's own reader mode: a write that took over keeps its.
            if (reading) {
                reading = false;
                stopReader();
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // Reader mode belongs to a resumed activity; a read or a write left waiting ends with it.
        // A read comes back on resume (the scan sheet is still open); a write does not.
        resumeRead = reading;
        reading = false;
        if (pending != null) {
            pending.reject("cancelled", "cancelled");
            pending = null;
        }
        stopReader();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (!resumeRead) return;
        resumeRead = false;
        if (pending != null) return; // a write that started meanwhile keeps the reader
        Activity act = getActivity();
        NfcAdapter a = adapter();
        if (act == null || a == null || !a.isEnabled()) return;
        try {
            startReading(a, act);
        } catch (IllegalStateException e) {
            reading = false; // the activity was not resumed after all: the sheet can be opened again
        }
    }

    /** On the adapter's own thread: one sticker for a machine read, as text only (never acted on). */
    private void onReadTag(Tag tag) {
        if (!reading) return;
        JSArray records = new JSArray();
        try {
            Ndef ndef = Ndef.get(tag);
            NdefMessage message = ndef == null ? null : ndef.getCachedNdefMessage();
            NdefRecord[] all = message == null ? null : message.getRecords();
            if (all != null) {
                for (NdefRecord r : all) {
                    if (records.length() >= 8) break;
                    if (r == null || r.getTnf() != NdefRecord.TNF_WELL_KNOWN) continue;
                    String type, value;
                    if (Arrays.equals(r.getType(), NdefRecord.RTD_URI)) {
                        type = "uri";
                        value = NfcRecords.uriFromPayload(r.getPayload());
                    } else if (Arrays.equals(r.getType(), NdefRecord.RTD_TEXT)) {
                        type = "text";
                        value = NfcRecords.textFromPayload(r.getPayload());
                    } else continue;
                    if (value.isEmpty() || value.length() > 512) continue;
                    JSObject rec = new JSObject();
                    rec.put("type", type);
                    rec.put("value", value);
                    records.put(rec);
                }
            }
        } catch (RuntimeException e) {
            // A sticker that answered oddly: it still has its uid, with no records.
        }
        JSObject ev = new JSObject();
        ev.put("uid", NfcRecords.hex(tag.getId()));
        ev.put("records", records);
        notifyListeners("tag", ev);
    }

    private void stopReader() {
        Activity act = getActivity();
        NfcAdapter a = adapter();
        if (act == null || a == null) return;
        act.runOnUiThread(() -> {
            try { a.disableReaderMode(act); } catch (Exception ignored) { /* not on */ }
        });
    }

    /** On the adapter's own thread: one sticker, written or refused, ends the write. */
    private void writeTo(Tag tag, NdefMessage message, PluginCall call) {
        if (call != pending) return;
        String code = null, why = null;
        try {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                ndef.connect();
                try {
                    if (!ndef.isWritable()) { code = "read-only"; why = "the sticker is read-only"; }
                    else if (ndef.getMaxSize() < message.getByteArrayLength()) { code = "too-small"; why = "the sticker is too small"; }
                    else ndef.writeNdefMessage(message);
                } finally {
                    try { ndef.close(); } catch (IOException ignored) { /* gone already */ }
                }
            } else {
                NdefFormatable blank = NdefFormatable.get(tag);
                if (blank == null) { code = "unsupported"; why = "the sticker cannot hold NDEF"; }
                else {
                    blank.connect();
                    try { blank.format(message); }
                    finally { try { blank.close(); } catch (IOException ignored) { /* gone already */ } }
                }
            }
        } catch (IOException | FormatException | RuntimeException e) {
            // Moved away too soon, or a sticker that answered oddly: the sheet offers to try again.
            code = "failed";
            why = String.valueOf(e.getMessage());
        }
        stopReader();
        pending = null;
        if (code != null) call.reject(why, code);
        else {
            JSObject r = new JSObject();
            r.put("written", true);
            call.resolve(r);
        }
    }
}
