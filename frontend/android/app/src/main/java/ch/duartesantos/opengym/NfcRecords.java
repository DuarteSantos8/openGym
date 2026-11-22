package ch.duartesantos.opengym;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * The bytes of an NDEF well-known record, as text (NfcTagsPlugin's read). Pure Java, no android.*,
 * so a unit test runs it. A sticker's content is untrusted: every method answers "" for a null,
 * empty or malformed payload and never throws.
 */
final class NfcRecords {
    private NfcRecords() {}

    /** NFC Forum URI record type: the identifier codes of byte 0, index = code. */
    private static final String[] URI_PREFIX = {
        "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
        "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://", "nfs://",
        "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:", "pop:", "sip:",
        "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://", "tcpobex://", "irdaobex://",
        "file://", "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:", "urn:epc:raw:", "urn:epc:",
        "urn:nfc:"
    };

    /** The link of a `U` record's payload: byte 0 is the prefix code (an unknown one adds none). */
    static String uriFromPayload(byte[] payload) {
        if (payload == null || payload.length == 0) return "";
        try {
            int code = payload[0] & 0xFF;
            String prefix = code < URI_PREFIX.length ? URI_PREFIX[code] : "";
            return prefix + new String(payload, 1, payload.length - 1, StandardCharsets.UTF_8);
        } catch (RuntimeException e) {
            return "";
        }
    }

    /** The text of a `T` record's payload: a status byte (bit 7 UTF-16, low 6 bits the language code's length). */
    static String textFromPayload(byte[] payload) {
        if (payload == null || payload.length == 0) return "";
        try {
            int status = payload[0] & 0xFF;
            int lang = status & 0x3F;
            int start = 1 + lang;
            if (start > payload.length) return "";
            Charset cs = (status & 0x80) != 0 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8;
            return new String(payload, start, payload.length - start, cs);
        } catch (RuntimeException e) {
            return "";
        }
    }

    /** A tag's id as lower-case hex. */
    static String hex(byte[] id) {
        if (id == null || id.length == 0) return "";
        StringBuilder sb = new StringBuilder(id.length * 2);
        for (byte b : id) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }
}
