package ch.duartesantos.opengym;

import static org.junit.Assert.*;

import org.junit.Test;

/** What the page may name for a Wear OS watch's Overview stills (WatchBridgePlugin.sendClips). */
public class WatchStillsTest {
    @Test
    public void anExerciseIdIsAPlainFileName() {
        assertTrue(WatchBridgePlugin.safeId("0025"));
        assertTrue(WatchBridgePlugin.safeId("custom_ab-12"));
        assertFalse(WatchBridgePlugin.safeId(null));
        assertFalse(WatchBridgePlugin.safeId(""));
        assertFalse(WatchBridgePlugin.safeId("../0025"));
        assertFalse(WatchBridgePlugin.safeId("a/b"));
        assertFalse(WatchBridgePlugin.safeId("x".repeat(65)));
    }

    @Test
    public void aStillIsAPictureInsideTheAppPackage() {
        assertTrue(WatchBridgePlugin.inPackage("exercise-media/still/0001.webp"));
        assertTrue(WatchBridgePlugin.inPackage("exercise-media/still/f0001.png"));
        assertFalse(WatchBridgePlugin.inPackage(null));
        assertFalse(WatchBridgePlugin.inPackage("/data/data/x/secret.webp"));
        assertFalse(WatchBridgePlugin.inPackage("exercise-media/../../secret.webp"));
        assertFalse(WatchBridgePlugin.inPackage("https://example.com/a.webp"));
        assertFalse(WatchBridgePlugin.inPackage("exercise-media/clip/0001.mp4"));
    }

    @Test
    public void aClipIsAnAnimatedWebPInsideTheAppPackage() {
        assertTrue(WatchBridgePlugin.clipInPackage("exercise-media/clip/0001.webp"));
        assertFalse("an MP4 build: the still only", WatchBridgePlugin.clipInPackage("exercise-media/clip/0001.mp4"));
        assertFalse(WatchBridgePlugin.clipInPackage(null));
        assertFalse(WatchBridgePlugin.clipInPackage("/data/data/x/secret.webp"));
        assertFalse(WatchBridgePlugin.clipInPackage("exercise-media/../../secret.webp"));
        assertFalse(WatchBridgePlugin.clipInPackage("https://example.com/a.webp"));
    }
}
