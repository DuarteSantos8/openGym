package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** How a Huawei watch's messages are cut into frames and put together again (HuaweiFrames, wire in watch-huawei/test/frames.json). */
public class HuaweiFramesTest {
    private static String rep(String s, int n) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) b.append(s);
        return b.toString();
    }

    /** The watch's `961` case: a message one character over a frame. */
    private static final String TEXT_961 = "{\"a\":\"" + rep("x", 953) + "\"}";

    @Test
    public void aShortMessageIsOneFrame() {
        String text = "{\"events\":[{\"id\":\"h1-1-5\",\"type\":\"hello\",\"at\":1764000000000}]}";
        List<String> frames = HuaweiFrames.frames(text, "a");
        assertEquals(Arrays.asList("a.0.1|" + text), frames);
        assertEquals(text, new HuaweiFrames.Receiver().accept(frames.get(0)));
    }

    @Test
    public void textOutsideAsciiIsEscapedAndComesBack() throws Exception {
        String text = "{\"routineIds\":[\"Beine | R\u00fccken\",\"\u817f\"]}";
        List<String> frames = HuaweiFrames.frames(text, "a");
        assertEquals(Arrays.asList("a.0.1|{\"routineIds\":[\"Beine | R\\u00fccken\",\"\\u817f\"]}"), frames);
        JSONObject back = new JSONObject(new HuaweiFrames.Receiver().accept(frames.get(0)));
        assertEquals("Beine | R\u00fccken", back.getJSONArray("routineIds").getString(0));
        assertEquals("\u817f", back.getJSONArray("routineIds").getString(1));
        // a character outside the first 64k (a surrogate pair) goes as two escapes, as JSON has it
        assertEquals("\\ud83d\\udcaa", HuaweiFrames.escape("\ud83d\udcaa"));
    }

    @Test
    public void nineHundredSixtyIsOneFrameAndOneMoreIsTwo() {
        String t960 = "{\"a\":\"" + rep("x", 952) + "\"}";
        assertEquals(1, HuaweiFrames.frames(t960, "a").size());
        List<String> frames = HuaweiFrames.frames(TEXT_961, "a");
        assertEquals(2, frames.size());
        assertEquals("a.0.2|{\"a\":\"" + rep("x", 953) + "\"", frames.get(0));
        assertEquals("a.1.2|}", frames.get(1));
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept(frames.get(0)));
        assertEquals(TEXT_961, r.accept(frames.get(1)));
    }

    @Test
    public void aCutInsideAnEscapeJoinsAgain() throws Exception {
        String ues = rep("\u00fc", 400);
        String text = "{\"name\":\"" + ues + "\",\"note\":\"a|b.c\"}";
        List<String> frames = HuaweiFrames.frames(text, "a");
        String u = "\\u00fc";
        assertEquals(Arrays.asList(
            "a.0.3|{\"name\":\"" + rep(u, 158) + "\\u0",
            "a.1.3|0fc" + rep(u, 159) + "\\u0",
            "a.2.3|0fc" + rep(u, 81) + "\",\"note\":\"a|b.c\"}"), frames);
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept(frames.get(0)));
        assertNull(r.accept(frames.get(1)));
        JSONObject back = new JSONObject(r.accept(frames.get(2)));
        assertEquals(ues, back.getString("name"));
        assertEquals("a|b.c", back.getString("note"));
    }

    @Test
    public void framesOutOfOrderStillJoinInOrder() {
        List<String> frames = HuaweiFrames.frames(TEXT_961, "a");
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept(frames.get(1)));
        assertEquals(TEXT_961, r.accept(frames.get(0)));
    }

    @Test
    public void anotherIdDropsAHalfGatheredMessage() {
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept("a.0.2|{\"a\":\"1"));
        // b starts: a's first half is gone, so a's second half alone completes nothing
        assertNull(r.accept("b.0.1|[1]"));
        assertNull(r.accept("a.1.2|\"}"));
        assertEquals("{\"b\":2}", r.accept("b.0.1|{\"b\":2}"));
    }

    @Test
    public void anotherCountForTheSameIdStartsOver() {
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept("a.0.2|{\"a\":\"1"));
        assertNull(r.accept("a.1.3|x"));
        assertNull(r.accept("a.0.3|{\"a\":\"2"));
        assertNull(r.accept("a.1.3|2"));
        assertEquals("{\"a\":\"2222\"}", r.accept("a.2.3|22\"}"));
    }

    @Test
    public void theSameIndexTwiceTheLaterStands() {
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept("a.0.2|{\"a\":\"1"));
        assertNull(r.accept("a.0.2|{\"a\":\"2"));
        assertEquals("{\"a\":\"2\"}", r.accept("a.1.2|\"}"));
    }

    @Test
    public void aMessageIsForgottenOnceWhole() {
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertEquals("{}", r.accept("a.0.1|{}"));
        // the same frame again is a new message (the watch said it twice), not a leftover
        assertEquals("{}", r.accept("a.0.1|{}"));
    }

    @Test
    public void framesThatDoNotFitAreIgnored() {
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept("a.0.2|{\"a\":\"1"));
        String[] bad = {
            "", "hello", "a.0.1", "a.0.1{}", ".0.1|{}", "abcdefg.0.1|{}", "A.0.1|{}", "a.x.1|{}", "a.0.|{}",
            "a.0.0|{}", "a.0.17|{}", "a.2.2|{}", "a.1.1|{}", "a.0.99999999999|{}", "a.-1.2|{}",
        };
        for (String f : bad) assertNull(f, r.accept(f));
        // none of them dropped the half that was gathered
        assertEquals("{\"a\":\"12\"}", r.accept("a.1.2|2\"}"));
    }

    @Test
    public void aTextThatIsNotAnObjectIsIgnored() {
        HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
        assertNull(r.accept("a.0.1|[1,2]"));
        assertNull(r.accept("a.0.1|hello"));
        assertNull(r.accept("a.0.1|"));
    }

    @Test
    public void aMessageOfMoreThanSixteenPartsIsNotSent() {
        // 16 parts of 960 is the most: {"a":" + x + "} is 8 more than the x
        String most = "{\"a\":\"" + rep("x", 16 * 960 - 8) + "\"}";
        List<String> frames = HuaweiFrames.frames(most, "a");
        assertEquals(16, frames.size());
        assertTrue(frames.get(15).startsWith("a.15.16|"));
        assertTrue(HuaweiFrames.frames(most + " ", "a").isEmpty());
        // a character that escapes to six counts as six
        assertTrue(HuaweiFrames.frames("{\"a\":\"" + rep("\u00fc", 2561) + "\"}", "a").isEmpty());
    }

    /** The watch's own cases (watch-huawei/test/frames.json): both codecs must give exactly these frames and read them back. */
    @Test
    public void everyCaseOfTheWatchsFileHoldsBothWays() throws Exception {
        // Gradle runs the tests in the app module's folder; both codecs live in this repository, so a missing file is a mistake.
        Path file = Paths.get("../../../watch-huawei/test/frames.json");
        assertTrue("watch-huawei/test/frames.json not found", Files.exists(file));
        JSONArray cases = new JSONArray(new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
        assertTrue(cases.length() > 0);
        for (int k = 0; k < cases.length(); k++) {
            JSONObject c = cases.getJSONObject(k);
            String text = c.getString("text");
            List<String> want = new java.util.ArrayList<>();
            for (int i = 0; i < c.getJSONArray("frames").length(); i++) want.add(c.getJSONArray("frames").getString(i));
            assertEquals(c.getString("name"), want, HuaweiFrames.frames(text, "a"));
            HuaweiFrames.Receiver r = new HuaweiFrames.Receiver();
            String back = null;
            for (String f : want) back = r.accept(f);
            assertTrue(c.getString("name"), new JSONObject(back).similar(new JSONObject(text)));
        }
    }

    @Test
    public void aTwelveThousandCharacterSnapshotIsThirteenFramesAndFitsTheCap() {
        String text = "{\"a\":\"" + rep("x", 12000) + "\"}";
        assertTrue(HuaweiFrames.fits(text));
        assertEquals(13, HuaweiFrames.frames(text, "a").size());
        String most = "{\"a\":\"" + rep("x", 16 * 960 - 8) + "\"}";
        assertTrue(HuaweiFrames.fits(most));
        // one more character: not sent (fits says so before anything is kept or started)
        assertTrue(!HuaweiFrames.fits(most + " "));
    }
}
