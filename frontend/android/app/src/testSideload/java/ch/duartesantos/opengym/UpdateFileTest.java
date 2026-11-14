package ch.duartesantos.opengym;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateFileTest {
    @Test
    public void onlyTheUpdatersOwnFileName() {
        assertTrue(UpdateFile.nameOk("opengym-update.apk"));
        assertTrue(UpdateFile.nameOk("opengym-update-360.apk"));
        assertFalse(UpdateFile.nameOk(null));
        assertFalse(UpdateFile.nameOk(""));
        assertFalse(UpdateFile.nameOk("../files/opengym-update.apk"));
        assertFalse(UpdateFile.nameOk("sub/opengym-update.apk"));
        assertFalse(UpdateFile.nameOk("opengym-update.apk/"));
        assertFalse(UpdateFile.nameOk("other.apk"));
        assertFalse(UpdateFile.nameOk("opengym-update.apk.sha256"));
        assertFalse(UpdateFile.nameOk("opengym-update-../x.apk"));
        assertFalse(UpdateFile.nameOk("opengym-update.apk\n"));
    }

    @Test
    public void aHashIsRequired() {
        assertTrue(UpdateFile.hashOk("0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789abcdef"));
        assertFalse(UpdateFile.hashOk(null));
        assertFalse(UpdateFile.hashOk(""));
        assertFalse(UpdateFile.hashOk("abc"));
        assertFalse(UpdateFile.hashOk("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg"));
        assertFalse(UpdateFile.hashOk("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0"));
    }
}
