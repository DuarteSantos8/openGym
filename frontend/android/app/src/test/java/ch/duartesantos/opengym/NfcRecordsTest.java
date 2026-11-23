package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;

import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class NfcRecordsTest {
    @Test
    public void uriTakesItsPrefixFromByteZero() {
        assertEquals("https://a.b", NfcRecords.uriFromPayload(new byte[] { 0x04, 'a', '.', 'b' }));
        assertEquals("http://www.a.b", NfcRecords.uriFromPayload(new byte[] { 0x01, 'a', '.', 'b' }));
        assertEquals("tel:123", NfcRecords.uriFromPayload(new byte[] { 0x05, '1', '2', '3' }));
        assertEquals("a.b", NfcRecords.uriFromPayload(new byte[] { 0x00, 'a', '.', 'b' }));
    }

    @Test
    public void uriWithAnUnknownCodeHasNoPrefix() {
        assertEquals("a.b", NfcRecords.uriFromPayload(new byte[] { 0x7F, 'a', '.', 'b' }));
        assertEquals("a.b", NfcRecords.uriFromPayload(new byte[] { (byte) 0xFF, 'a', '.', 'b' }));
    }

    @Test
    public void textSkipsTheLanguageCode() {
        assertEquals("Hi", NfcRecords.textFromPayload(new byte[] { 0x02, 'e', 'n', 'H', 'i' }));
    }

    @Test
    public void textDecodesUtf16WhenBitSevenIsSet() {
        byte[] t = "Hi".getBytes(StandardCharsets.UTF_16BE);
        byte[] p = new byte[3 + t.length];
        p[0] = (byte) 0x82;
        p[1] = 'e';
        p[2] = 'n';
        System.arraycopy(t, 0, p, 3, t.length);
        assertEquals("Hi", NfcRecords.textFromPayload(p));
    }

    @Test
    public void textWithALanguageLongerThanThePayloadIsEmpty() {
        assertEquals("", NfcRecords.textFromPayload(new byte[] { 0x05, 'e', 'n' }));
    }

    @Test
    public void hexIsLowerCaseAndKeepsLeadingZeros() {
        assertEquals("04a2", NfcRecords.hex(new byte[] { 0x04, (byte) 0xA2 }));
    }

    @Test
    public void nullAndEmptyGiveNothing() {
        assertEquals("", NfcRecords.uriFromPayload(null));
        assertEquals("", NfcRecords.uriFromPayload(new byte[0]));
        assertEquals("", NfcRecords.textFromPayload(null));
        assertEquals("", NfcRecords.textFromPayload(new byte[0]));
        assertEquals("", NfcRecords.hex(null));
        assertEquals("", NfcRecords.hex(new byte[0]));
    }
}
