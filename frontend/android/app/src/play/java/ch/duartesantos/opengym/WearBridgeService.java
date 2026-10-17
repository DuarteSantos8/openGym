package ch.duartesantos.opengym;

import android.net.Uri;
import androidx.annotation.NonNull;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;
import com.google.android.gms.wearable.WearableListenerService;

/**
 * Wakes the app's process when the watch sends something, even with the app closed: Play services
 * binds this service for the two filters in the manifest. It does no work of its own; it hands
 * what arrived to WearBridgePlugin, which tells the page when there is one and otherwise leaves a
 * notification to open the app by (the page is what turns a session into a workout).
 */
public class WearBridgeService extends WearableListenerService {

    @Override
    public void onDataChanged(@NonNull DataEventBuffer events) {
        for (DataEvent event : events) {
            Uri uri = event.getDataItem().getUri();
            String path = uri.getPath();
            if (path == null || !path.startsWith(WearPaths.SESSION)) continue;
            if (event.getType() == DataEvent.TYPE_DELETED) {
                // The watch took the session out once it saw the ack, so the ack has done its job.
                // It is this phone's own item, so this phone is the one that can remove it.
                forgetAck(path.substring(WearPaths.SESSION.length()));
                continue;
            }
            if (event.getType() != DataEvent.TYPE_CHANGED) continue;
            // Copied out here: the buffer is released when this method returns.
            byte[] data = event.getDataItem().getData();
            if (data != null) WearBridgePlugin.deliverSession(getApplicationContext(), data);
        }
    }

    private void forgetAck(String segment) {
        try {
            Uri ack = new Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(WearPaths.ACK + segment).build();
            Wearable.getDataClient(getApplicationContext()).deleteDataItems(ack);
        } catch (RuntimeException ignored) {
            // Left behind; it is a few bytes, and acking the same session again just replaces it.
        }
    }

    @Override
    public void onMessageReceived(@NonNull MessageEvent message) {
        if (WearPaths.REQUEST.equals(message.getPath())) {
            WearBridgePlugin.deliverRequest(getApplicationContext(), message.getData());
        }
    }
}
