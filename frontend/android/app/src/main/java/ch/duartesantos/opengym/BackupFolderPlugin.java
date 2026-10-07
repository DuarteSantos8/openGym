package ch.duartesantos.opengym;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * The folder auto-backup writes into, chosen by the person (#161): a sync app's folder, an SD
 * card, anything the system folder picker offers. @capacitor/filesystem only knows its fixed
 * roots (Documents, Data, ...) and cannot write into a folder picked through the Storage Access
 * Framework, so this does the little that needs: pick a folder and keep the right to write it,
 * write one file into it by name, and prune the dated copies. Plain DocumentsContract, no
 * androidx.documentfile.
 *
 * The folder is a fact of this phone (lib/mobile.js keeps it in a private file, never in the
 * synced state): a content:// address means nothing on another device.
 *
 * Usage from JS (lib/mobile.js):
 *   const BackupFolder = registerPlugin('BackupFolder');
 *   const { uri, label } = await BackupFolder.pick();          // {} when cancelled
 *   const { ok } = await BackupFolder.check({ uri });          // still allowed to write there?
 *   await BackupFolder.write({ uri, name, data });
 *   await BackupFolder.prune({ uri, keep, pattern, written }); // keeps the newest `keep`
 *   await BackupFolder.release({ uri });
 */
@CapacitorPlugin(name = "BackupFolder")
public class BackupFolderPlugin extends Plugin {

    private static final int RW = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    // Writes and listings go through a content provider, which may be a cloud app: off the main
    // thread, and one at a time so two backups never race for the same name.
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(RW | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());   // cancelled: nothing changes
            return;
        }
        Uri tree = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, RW);
        } catch (SecurityException e) {
            call.reject("this folder cannot be kept for later writes", e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("label", labelOf(tree));
        call.resolve(ret);
    }

    @PluginMethod
    public void check(PluginCall call) {
        String uri = call.getString("uri");
        JSObject ret = new JSObject();
        ret.put("ok", uri != null && held(Uri.parse(uri)));
        call.resolve(ret);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String uri = call.getString("uri");
        String name = call.getString("name");
        String data = call.getString("data");
        if (uri == null || name == null || data == null) {
            call.reject("uri, name and data are required");
            return;
        }
        io.execute(() -> {
            try {
                Uri tree = Uri.parse(uri);
                ContentResolver cr = getContext().getContentResolver();
                Uri doc = childNamed(tree, name);
                if (doc == null) doc = DocumentsContract.createDocument(cr, root(tree), "application/json", name);
                if (doc == null) throw new IllegalStateException("the folder refused a new file");
                // "wt": truncate, so a shorter copy does not keep the tail of a longer one.
                try (OutputStream out = cr.openOutputStream(doc, "wt")) {
                    if (out == null) throw new IllegalStateException("the file cannot be opened for writing");
                    out.write(data.getBytes(StandardCharsets.UTF_8));
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("could not write to the backup folder: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void prune(PluginCall call) {
        String uri = call.getString("uri");
        String pattern = call.getString("pattern");
        String written = call.getString("written", "");
        int keep = call.getInt("keep", 14);
        if (uri == null || pattern == null || keep < 1) {
            call.reject("uri, pattern and keep are required");
            return;
        }
        io.execute(() -> {
            int deleted = 0;
            try {
                Uri tree = Uri.parse(uri);
                Pattern only = Pattern.compile(pattern);
                List<String[]> older = new ArrayList<>();   // { name, document id }
                for (String[] child : children(tree)) {
                    if (only.matcher(child[0]).matches() && !child[0].equals(written)) older.add(child);
                }
                // Newest first by the date in the name, as the Documents/openGym prune does.
                older.sort((a, b) -> b[0].compareTo(a[0]));
                ContentResolver cr = getContext().getContentResolver();
                for (int i = keep - 1; i < older.size(); i++) {
                    try {
                        if (DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, older.get(i)[1]))) deleted++;
                    } catch (Exception e) { /* one stuck file does not stop the rest */ }
                }
            } catch (Exception e) { /* pruning is housekeeping; the copy is already written */ }
            JSObject ret = new JSObject();
            ret.put("deleted", deleted);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        String uri = call.getString("uri");
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri), RW);
            } catch (Exception e) { /* already gone */ }
        }
        call.resolve();
    }

    private boolean held(Uri tree) {
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isWritePermission()) return true;
        }
        return false;
    }

    private static Uri root(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    /** The folder's name as the picker showed it ("Sync", "Backups"), for Settings. */
    private String labelOf(Uri tree) {
        try (Cursor c = getContext().getContentResolver().query(root(tree),
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) { /* fall through */ }
        return tree.getLastPathSegment();
    }

    /** Every child of the folder as { display name, document id }. */
    private List<String[]> children(Uri tree) {
        Uri list = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        List<String[]> out = new ArrayList<>();
        try (Cursor c = getContext().getContentResolver().query(list,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null)) {
            if (c == null) return Collections.emptyList();
            while (c.moveToNext()) {
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) continue;
                out.add(new String[] { c.getString(0), c.getString(1) });
            }
        }
        return out;
    }

    private Uri childNamed(Uri tree, String name) {
        for (String[] child : children(tree)) {
            if (name.equals(child[0])) return DocumentsContract.buildDocumentUriUsingTree(tree, child[1]);
        }
        return null;
    }
}
