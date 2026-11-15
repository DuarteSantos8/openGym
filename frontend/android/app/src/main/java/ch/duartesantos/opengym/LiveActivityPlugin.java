package ch.duartesantos.opengym;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;

/**
 * The running workout's notification for the page (lib/live-activity.js), under the iPhone's plugin
 * name so the page side is one: update / end / drain / ack, and "liveActivityEvent" when a button
 * queued a tap. The card itself is WorkoutNotification; its buttons are WorkoutCardReceiver.
 *
 * Notification permission is the page's to ask for (the first rest does, lib/rest-alert.js); without
 * it nothing is posted, and the next update after a grant shows the card.
 */
@CapacitorPlugin(name = "LiveActivity")
public class LiveActivityPlugin extends Plugin {
    private static LiveActivityPlugin instance;

    @Override
    public void load() {
        instance = this;
        super.load();
    }

    /** A button queued a tap: a page that is awake drains it now. */
    static void eventQueued() {
        LiveActivityPlugin p = instance;
        if (p != null) p.notifyListeners("liveActivityEvent", new JSObject());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        // Always: a permission granted later must not need an app restart to show the card.
        r.put("supported", true);
        Context ctx = getContext();
        r.put("allowed", ctx != null && WorkoutNotification.allowed(ctx));
        call.resolve(r);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        String attributes = call.getString("attributes");
        String state = call.getString("state");
        if (ctx == null || WorkoutCard.parse(attributes) == null || WorkoutCard.parse(state) == null) {
            call.reject("attributes and state are required");
            return;
        }
        // A button was tapped after the page drained (`seen`: the ids it had then): the card already
        // shows that tap and this state is from before it. Saving it would put the logged set back
        // for a moment. The page drains, applies and sends again. Without `seen` (Settings' "Try
        // it", a page before this) nothing is checked. Checked and saved in one go
        // (WorkoutNotification.saveUnlessUnseen), so no tap slips in between the two.
        JSArray seenIds = call.getArray("seen");
        Set<String> seen = null;
        if (seenIds != null) {
            seen = new HashSet<>();
            for (int i = 0; i < seenIds.length(); i++) seen.add(seenIds.optString(i, ""));
        }
        if (!WorkoutNotification.saveUnlessUnseen(ctx, attributes, state, seen)) {
            JSObject stale = new JSObject();
            stale.put("shown", WorkoutNotification.allowed(ctx));
            stale.put("stale", true);
            call.resolve(stale);
            return;
        }
        WorkoutNotification.refresh(ctx.getApplicationContext());
        JSObject r = new JSObject();
        r.put("shown", WorkoutNotification.allowed(ctx));
        call.resolve(r);
    }

    @PluginMethod
    public void end(PluginCall call) {
        Context ctx = getContext();
        if (ctx != null) WorkoutNotification.clear(ctx.getApplicationContext());
        call.resolve();
    }

    @PluginMethod
    public void drain(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("events", ctx == null ? new JSArray() : WorkoutNotification.events(ctx));
        call.resolve(r);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        Context ctx = getContext();
        JSArray ids = call.getArray("ids");
        if (ctx != null && ids != null) {
            Set<String> done = new HashSet<>();
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.optString(i, "");
                if (!id.isEmpty()) done.add(id);
            }
            WorkoutNotification.ack(ctx, done);
        }
        call.resolve();
    }
}
