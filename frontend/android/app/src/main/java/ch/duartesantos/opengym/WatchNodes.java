package ch.duartesantos.opengym;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The Wear OS watches as Settings → Wear OS watch lists them (WatchBridgePlugin.status), from what
 * the Data Layer says: the nodes connected now, the nodes that have the watch app (connected or
 * not), and those of them in reach. Pure, so it is tested on the JVM (WatchNodesTest).
 *
 *   [{ id, name, connected, installed, reachable }]   connected ones first, then by name
 *
 * A watch with the app from another source (a Play watch app next to the sideloaded phone APK, or
 * the other way round) does not show as installed: the Data Layer only links two apps with the
 * same package name and the same signing key. The page says so in words.
 */
public final class WatchNodes {
    private WatchNodes() {}

    /** Each list holds { id, displayName } pairs. */
    public static JSArray list(List<String[]> connected, List<String[]> withApp, List<String[]> reachable) {
        Map<String, JSObject> byId = new LinkedHashMap<>();
        for (String[] n : connected) row(byId, n).put("connected", true);
        for (String[] n : withApp) row(byId, n).put("installed", true);
        for (String[] n : reachable) { JSObject r = row(byId, n); r.put("installed", true); r.put("reachable", true); }
        java.util.ArrayList<JSObject> rows = new java.util.ArrayList<>(byId.values());
        rows.sort((a, b) -> {
            int c = Boolean.compare(b.optBoolean("connected"), a.optBoolean("connected"));
            return c != 0 ? c : a.optString("name").compareToIgnoreCase(b.optString("name"));
        });
        JSArray out = new JSArray();
        for (JSObject r : rows) out.put(r);
        return out;
    }

    private static JSObject row(Map<String, JSObject> byId, String[] n) {
        String id = n == null || n.length == 0 || n[0] == null ? "" : n[0];
        JSObject r = byId.get(id);
        if (r == null) {
            r = new JSObject();
            r.put("id", id);
            r.put("name", n != null && n.length > 1 && n[1] != null ? n[1] : "");
            r.put("connected", false);
            r.put("installed", false);
            r.put("reachable", false);
            byId.put(id, r);
        } else if (r.optString("name").isEmpty() && n.length > 1 && n[1] != null) r.put("name", n[1]);
        return r;
    }
}
