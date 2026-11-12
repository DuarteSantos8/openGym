package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/**
 * The workout card's buttons (WorkoutNotification): Log set, Next exercise, Skip rest. Each moves
 * the card on here (WorkoutCard) and queues the tap for the page, which applies it through the
 * workout screen's own tick once it runs (lib/live-activity.js applyLiveEvents). Log set also
 * starts the rest after the set, so the countdown runs with the app closed. Never exported: only
 * the card's own PendingIntents reach it.
 */
public class WorkoutCardReceiver extends BroadcastReceiver {
    static final String LOG = "ch.duartesantos.opengym.card.LOG";
    static final String NEXT = "ch.duartesantos.opengym.card.NEXT";
    static final String SKIP = "ch.duartesantos.opengym.card.SKIP";
    // The live widget builder's buttons (v1.4.5): − + and effort, +15 s, and the queued ones.
    static final String ADJ = "ch.duartesantos.opengym.card.ADJ";
    static final String ADD_REST = "ch.duartesantos.opengym.card.ADD_REST";
    static final String QUEUE = "ch.duartesantos.opengym.card.QUEUE";
    static final String EXTRA_FIELD = "field";
    static final String EXTRA_DIR = "dir";
    static final String EXTRA_KIND = "kind";
    static final int REST_ADD_SEC = 15;
    static final String EXTRA_WID = "wid";
    static final String EXTRA_SET = "set";
    private static final Object LOCK = new Object();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        Context ctx = context.getApplicationContext();
        String wid = intent.getStringExtra(EXTRA_WID);
        String set = intent.getStringExtra(EXTRA_SET);
        long now = System.currentTimeMillis();
        WorkoutCard.Move move;
        boolean handedOff = false;
        synchronized (LOCK) {
            JSONObject attrs = WorkoutNotification.attributes(ctx);
            JSONObject state = WorkoutNotification.state(ctx);
            // A button from a card of a workout that is over, or one drawn before the last move.
            if (attrs == null || state == null || wid == null || !wid.equals(WorkoutNotification.wid(attrs))) return;
            switch (intent.getAction()) {
                case LOG: move = WorkoutCard.logSet(state, wid, set, now); break;
                case NEXT: move = WorkoutCard.nextExercise(state, wid, set, now); break;
                case SKIP: move = WorkoutCard.skipRest(state, wid, now); break;
                case ADJ: move = WorkoutCard.adjust(state, wid, set, String.valueOf(intent.getStringExtra(EXTRA_FIELD)), intent.getIntExtra(EXTRA_DIR, 1), now); break;
                case ADD_REST: move = WorkoutCard.addRest(state, wid, REST_ADD_SEC, now); break;
                case QUEUE: move = WorkoutCard.queueOnly(state, wid, String.valueOf(intent.getStringExtra(EXTRA_KIND)), now); break;
                default: return;
            }
            if (move == null) return;
            // Settings' "Try it" (attributes "pv"): the card moves along right here, but nothing is
            // queued for the page (no history) and no rest alarm or rest service starts.
            boolean preview = attrs.optBoolean("pv", false);
            if (!preview) WorkoutNotification.queue(ctx, move.event);
            WorkoutNotification.saveState(ctx, move.state);
            if (preview) {
                // nothing else: the card is redrawn below
            } else if (ADD_REST.equals(intent.getAction()) && move.restMs > 0) {
                RestAlert.scheduleLikeLast(ctx, now + move.restMs, move.restMs,
                        WorkoutCard.label(attrs, "restOver", "Rest\u2019s over. Next set!"));
            } else if (LOG.equals(intent.getAction()) && move.restMs > 0) {
                RestAlert.scheduleLikeLast(ctx, now + move.restMs, move.restMs,
                        WorkoutCard.label(attrs, "restOver", "Rest\u2019s over. Next set!"));
            } else if (LOG.equals(intent.getAction()) || SKIP.equals(intent.getAction())) {
                // No rest after this set (or it was skipped): the one running ends with its alarm,
                // and its service puts the card back as it goes.
                handedOff = RestTimerService.isRunning();
                RestAlert.cancel(ctx, RestAlert.NOTIFICATION_ID);
            }
        }
        if (!handedOff) WorkoutNotification.refresh(ctx);
        LiveActivityPlugin.eventQueued();
    }

    /**
     * The rest card's own Skip with the page away: the card leaves its rest too, and the page hears
     * of it from the queue. Nothing when no card is up or it shows no rest.
     */
    static void skipFromRest(Context ctx, long now) {
        synchronized (LOCK) {
            JSONObject attrs = WorkoutNotification.attributes(ctx);
            JSONObject state = WorkoutNotification.state(ctx);
            if (attrs == null || state == null) return;
            WorkoutCard.Move move = WorkoutCard.skipRest(state, WorkoutNotification.wid(attrs), now);
            if (move == null) return;
            WorkoutNotification.queue(ctx, move.event);
            WorkoutNotification.saveState(ctx, move.state);
        }
        LiveActivityPlugin.eventQueued();
    }
}
