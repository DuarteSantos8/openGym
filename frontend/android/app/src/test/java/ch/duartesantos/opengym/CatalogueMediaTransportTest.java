package ch.duartesantos.opengym;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.CookieHandler;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public class CatalogueMediaTransportTest {
    @Test public void cookieIsolationDelegatesOtherThreadsAndResetsAfterRequest() throws Exception {
        CookieHandler before = CookieHandler.getDefault();
        AtomicInteger writes = new AtomicInteger();
        Map<String, List<String>> secret = Collections.singletonMap("Cookie", Collections.singletonList("session=private"));
        URI url = new URI("https://media.example/objects/a.webp");
        CookieHandler original = new CookieHandler() {
            @Override public Map<String, List<String>> get(URI uri, Map<String, List<String>> headers) { return secret; }
            @Override public void put(URI uri, Map<String, List<String>> headers) { writes.incrementAndGet(); }
        };
        try {
            CookieHandler.setDefault(original);
            CatalogueMediaPlugin.CatalogueCookies.enter();
            CookieHandler isolated = CookieHandler.getDefault();
            assertTrue(isolated.get(url, Collections.emptyMap()).isEmpty());
            isolated.put(url, secret);
            assertEquals(0, writes.get());
            CatalogueMediaPlugin.CatalogueCookies.enter();
            assertSame(isolated, CookieHandler.getDefault());
            AtomicReference<Map<String, List<String>>> other = new AtomicReference<>();
            Thread thread = new Thread(() -> { try { other.set(isolated.get(url, Collections.emptyMap())); } catch (IOException e) { throw new RuntimeException(e); } });
            thread.start(); thread.join();
            assertEquals(secret, other.get());
            CatalogueMediaPlugin.CatalogueCookies.leave();
            assertEquals(secret, isolated.get(url, Collections.emptyMap()));
            isolated.put(url, secret);
            assertEquals(1, writes.get());
        } finally {
            CatalogueMediaPlugin.CatalogueCookies.leave();
            CookieHandler.setDefault(before);
        }
    }

    @Test public void copyRejectsExcessBeforeWritingAndIncompleteResponses() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try {
            CatalogueMediaPlugin.copyBounded(new ByteArrayInputStream(new byte[20]), output, 10, n -> {});
            fail("oversized response accepted");
        } catch (CatalogueMediaPlugin.Failure e) { assertEquals("size", e.code); }
        assertEquals(0, output.size());
        try {
            CatalogueMediaPlugin.copyBounded(new ByteArrayInputStream(new byte[5]), output, 10, n -> {});
            fail("incomplete response accepted");
        } catch (CatalogueMediaPlugin.Failure e) { assertEquals("size", e.code); }
        output.reset();
        assertEquals(10, CatalogueMediaPlugin.copyBounded(new ByteArrayInputStream(new byte[10]), output, 10, n -> {}));
        assertEquals(10, output.size());
    }

    @Test public void networkReadFailureIsRetriableButDiskFailureStaysIo() throws Exception {
        InputStream timedOut = new InputStream() { @Override public int read() throws IOException { throw new SocketTimeoutException("read timed out"); } };
        try {
            CatalogueMediaPlugin.copyBounded(timedOut, new ByteArrayOutputStream(), 10, n -> {});
            fail("timeout accepted");
        } catch (CatalogueMediaPlugin.Failure e) { assertEquals("timeout", e.code); }
        OutputStream disk = new OutputStream() { @Override public void write(int value) throws IOException { throw new IOException("ENOSPC: no space left on device"); } };
        try {
            CatalogueMediaPlugin.copyBounded(new ByteArrayInputStream(new byte[10]), disk, 10, n -> {});
            fail("disk error accepted");
        } catch (IOException e) { assertEquals("no-space", CatalogueMediaPlugin.classify(e)); }
    }

    @Test public void urlPolicyRejectsDowngradesCredentialsAndCrossOriginRedirects() throws Exception {
        URI approved = CatalogueMediaPlugin.secureUrl("https://media.example/objects/a.webp");
        assertTrue(CatalogueMediaPlugin.sameOrigin(approved, CatalogueMediaPlugin.secureUrl("https://MEDIA.example:443/new/a.webp")));
        assertFalse(CatalogueMediaPlugin.sameOrigin(approved, CatalogueMediaPlugin.secureUrl("https://other.example/a.webp")));
        assertFalse(CatalogueMediaPlugin.sameOrigin(approved, CatalogueMediaPlugin.secureUrl("https://media.example:444/a.webp")));
        for (String url : new String[] { "http://media.example/a.webp", "https://secret@media.example/a.webp", "https://media.example/a.webp#fragment" }) {
            try { CatalogueMediaPlugin.secureUrl(url); fail("unsafe URL accepted"); }
            catch (CatalogueMediaPlugin.Failure e) { assertEquals("redirect", e.code); }
        }
    }

    @Test public void retryAfterSupportsSecondsDatesAndRejectsInvalidValues() {
        assertEquals(Long.valueOf(9000), CatalogueMediaPlugin.retryAfter("9", 0));
        assertEquals(Long.valueOf(1000), CatalogueMediaPlugin.retryAfter("Thu, 01 Jan 1970 00:00:01 GMT", 0));
        assertNull(CatalogueMediaPlugin.retryAfter("tomorrow", 0));
        assertNull(CatalogueMediaPlugin.retryAfter("-2", 0));
        assertNull(CatalogueMediaPlugin.retryAfter("99999999999999999999999", 0));
    }

    @Test public void signaturesRejectHtmlAndWrongMediaKinds() {
        assertTrue(CatalogueMediaPlugin.signature("RIFF0000WEBP".getBytes(StandardCharsets.US_ASCII), "webp"));
        assertTrue(CatalogueMediaPlugin.signature("0000ftypisom".getBytes(StandardCharsets.US_ASCII), "mp4"));
        assertFalse(CatalogueMediaPlugin.signature("<html>error</html>".getBytes(StandardCharsets.US_ASCII), "mp4"));
        assertFalse(CatalogueMediaPlugin.signature("0000ftypavif".getBytes(StandardCharsets.US_ASCII), "mp4"));
        assertFalse(CatalogueMediaPlugin.signature("RIFF0000WEBP".getBytes(StandardCharsets.US_ASCII), "mp4"));
    }
}
