package ch.duartesantos.opengym;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The background check itself (NudgeCheck): asks GET /api/nudge-check about each day whose
 * notifications fire within the next twelve hours and takes back what a workout or a day note on
 * another device made pointless. Offline, an error, an answer it cannot read: nothing changes.
 * Then it asks for the next run.
 */
public class NudgeCheckJob extends JobService {
    private volatile Thread worker;

    @Override
    public boolean onStartJob(JobParameters params) {
        final Context ctx = getApplicationContext();
        worker = new Thread(() -> {
            try { check(ctx); } catch (Exception ignored) { /* nothing changes */ }
            jobFinished(params, false);
        }, "nudge-check");
        worker.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread t = worker;
        if (t != null) t.interrupt();
        return false;   // the next run is asked for below, or by the next resync in the app
    }

    private static void check(Context ctx) throws Exception {
        JSONObject config = NudgeCheck.load(ctx);
        if (config == null) return;
        String server = config.optString("server", "");
        JSONObject headers = config.optJSONObject("headers");
        long now = System.currentTimeMillis();
        Set<String> settled = new HashSet<>();
        if (!server.isEmpty()) {
            for (JSONObject entry : NudgeCheck.upcoming(config, now)) {
                if (entry.optLong("at") - now > 12 * 3_600_000L) break;
                String date = entry.optString("date", "");
                JSONObject answer = ask(server, date, headers);
                List<Integer> ids = NudgeCheck.idsToCancel(entry, answer);
                if (!ids.isEmpty()) NudgeCheck.cancelScheduled(ctx, ids);
                if (answer != null && Boolean.TRUE.equals(answer.opt("done"))) settled.add(date);
            }
        }
        // A day settled is not checked again; the rest is asked about again closer to its time.
        JSONArray left = new JSONArray();
        for (JSONObject e : NudgeCheck.upcoming(config, System.currentTimeMillis())) {
            if (!settled.contains(e.optString("date", ""))) left.put(e);
        }
        config.put("entries", left);
        NudgeCheck.save(ctx, config);
        NudgeCheck.schedule(ctx, config);
    }

    /** The server's answer, or null for anything that is not a 200 with JSON. */
    private static JSONObject ask(String server, String date, JSONObject headers) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(server + "/api/nudge-check?date=" + URLEncoder.encode(date, "UTF-8"));
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(15_000);
            if (headers != null) {
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String k = it.next();
                    c.setRequestProperty(k, headers.optString(k));
                }
            }
            if (c.getResponseCode() != 200) return null;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[1024];
                for (int n; (n = in.read(buf)) > 0 && out.size() < 4096; ) out.write(buf, 0, n);
                return new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
