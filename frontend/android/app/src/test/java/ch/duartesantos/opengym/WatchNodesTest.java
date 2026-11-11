package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSArray;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

/** The watches Settings → Wear OS watch lists: every state a watch can be in tells the user something. */
public class WatchNodesTest {
    private static String[] n(String id, String name) { return new String[] { id, name }; }
    private static final List<String[]> NONE = Collections.emptyList();

    @Test
    public void noWatchIsAnEmptyList() throws Exception {
        assertEquals(0, WatchNodes.list(NONE, NONE, NONE).length());
    }

    @Test
    public void aWatchWithoutTheAppIsConnectedButNotInstalled() throws Exception {
        JSONObject w = WatchNodes.list(Arrays.asList(n("a", "Galaxy Watch4 (R2D2)")), NONE, NONE).getJSONObject(0);
        assertEquals("Galaxy Watch4 (R2D2)", w.getString("name"));
        assertTrue(w.getBoolean("connected"));
        assertFalse(w.getBoolean("installed"));
        assertFalse(w.getBoolean("reachable"));
    }

    @Test
    public void aWatchWithTheAppInReach() throws Exception {
        List<String[]> a = Arrays.asList(n("a", "Pixel Watch"));
        JSONObject w = WatchNodes.list(a, a, a).getJSONObject(0);
        assertTrue(w.getBoolean("connected") && w.getBoolean("installed") && w.getBoolean("reachable"));
    }

    @Test
    public void aWatchWithTheAppOutOfReachIsStillListed() throws Exception {
        JSONObject w = WatchNodes.list(NONE, Arrays.asList(n("a", "Galaxy Watch4")), NONE).getJSONObject(0);
        assertFalse(w.getBoolean("connected"));
        assertTrue(w.getBoolean("installed"));
        assertFalse(w.getBoolean("reachable"));
    }

    @Test
    public void twoWatchesEachOnce_connectedFirst() throws Exception {
        List<String[]> connected = Arrays.asList(n("b", "Pixel Watch"));
        List<String[]> withApp = Arrays.asList(n("a", "Galaxy Watch4"), n("b", "Pixel Watch"));
        JSArray out = WatchNodes.list(connected, withApp, connected);
        assertEquals(2, out.length());
        assertEquals("b", out.getJSONObject(0).getString("id"));
        assertEquals("a", out.getJSONObject(1).getString("id"));
        assertFalse(out.getJSONObject(1).getBoolean("connected"));
    }

    @Test
    public void aNodeWithoutANameOrIdDoesNotBreakIt() throws Exception {
        JSArray out = WatchNodes.list(Arrays.asList(new String[] { "x", null }, new String[] { null, null }), NONE, NONE);
        assertEquals(2, out.length());
        assertEquals("", out.getJSONObject(0).getString("name"));
    }
}
