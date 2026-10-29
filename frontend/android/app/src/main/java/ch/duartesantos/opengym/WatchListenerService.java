package ch.duartesantos.opengym;

import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.WearableListenerService;

/**
 * The Wear OS watch's events reach the phone here, even with the app closed (the Apple Watch's
 * didReceiveUserInfo): each data item under /opengym/event/ is written to the queue file, then
 * deleted from the Data Layer, and a live page is told (WatchBridgePlugin "watchEvent").
 */
public class WatchListenerService extends WearableListenerService {
    @Override
    public void onDataChanged(DataEventBuffer events) {
        boolean any = false;
        for (DataEvent e : events) {
            if (e.getType() != DataEvent.TYPE_CHANGED) continue;
            if (WatchBridgePlugin.store(this, e.getDataItem())) any = true;
        }
        events.release();
        if (any) WatchBridgePlugin.notifyEvent();
    }
}
