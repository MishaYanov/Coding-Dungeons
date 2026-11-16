package com.codingdungeons.app;

import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class ShellPolicyTest {
    @Test public void localAssetsRequireTheExactOriginAndSafePath() {
        assertEquals("index.html", ShellPolicy.assetPath(ShellPolicy.ORIGIN + "/"));
        assertEquals("runtime/rust/rustc.wasm", ShellPolicy.assetPath(ShellPolicy.ORIGIN + "/runtime/rust/rustc.wasm?v=1"));
        for (String url : new String[]{
                "http://appassets.androidplatform.net/", "https://appassets.androidplatform.net:443/",
                "https://appassets.androidplatform.net.evil.test/", "https://user@appassets.androidplatform.net/",
                "file:///android_asset/game/index.html", "content://provider/file", "javascript:alert(1)",
                ShellPolicy.ORIGIN + "/../private", ShellPolicy.ORIGIN + "/a/./file",
                ShellPolicy.ORIGIN + "/%2e%2e/private", ShellPolicy.ORIGIN + "/a%2fb",
                ShellPolicy.ORIGIN + "/%252e%252e/private", ShellPolicy.ORIGIN + "/a\\b",
                ShellPolicy.ORIGIN + "//private", ShellPolicy.ORIGIN + "/file%00.txt"}) {
            assertNull(url, ShellPolicy.assetPath(url));
        }
    }

    @Test public void onlyTheGameDocumentCanNavigateInsideTheWebView() {
        assertTrue(ShellPolicy.isGameDocument(ShellPolicy.ORIGIN + "/?world=rust#page=4"));
        assertTrue(ShellPolicy.isGameDocument(ShellPolicy.ORIGIN + "/index.html"));
        assertFalse(ShellPolicy.isGameDocument(ShellPolicy.ORIGIN + "/assets/main.js"));
        assertFalse(ShellPolicy.isGameDocument("https://example.com/"));
        assertTrue(ShellPolicy.isExternalHttps("https://doc.rust-lang.org/book/"));
        assertFalse(ShellPolicy.isExternalHttps(ShellPolicy.ORIGIN + "/"));
        assertFalse(ShellPolicy.isExternalHttps("https://user:password@example.com/"));
        assertFalse(ShellPolicy.isExternalHttps("intent://example.com/"));
    }

    @Test public void downloadsAreOnlyTheAuthoredBooksAndKits() {
        for (String path : new String[]{"book/ferrum-expedition.pdf", "book/ferrum-field-kit.zip",
                "book/javascript/book.pdf", "book/javascript/field-kit.zip", "book/typescript/book.pdf",
                "book/typescript/field-kit.zip", "book/csharp/book.pdf", "book/csharp/field-kit.zip",
                "book/go/book.pdf", "book/go/field-kit.zip"}) {
            assertEquals(path, ShellPolicy.bookAsset(ShellPolicy.ORIGIN + "/" + path));
        }
        assertNull(ShellPolicy.bookAsset(ShellPolicy.ORIGIN + "/runtime/rust/rustc.wasm"));
        assertNull(ShellPolicy.bookAsset(ShellPolicy.ORIGIN + "/book/other.pdf"));
        assertNull(ShellPolicy.bookAsset("https://example.com/book/go/book.pdf"));
        assertEquals("application/wasm", ShellPolicy.mime("runtime/go/compile.wasm"));
        assertEquals("application/javascript", ShellPolicy.mime("assets/worker.js"));
        assertEquals("application/pdf", ShellPolicy.mime("book/go/book.pdf"));
    }

    @Test public void backupNamesAndIdsCannotBecomePathsOrUnboundedReplies() {
        assertTrue(ShellPolicy.validBackupName("coding-dungeons-2026-11-15.json"));
        for (String name : new String[]{"../save.json", "C:\\save.json", ".json", "save.html", "a/b.json", "save.json\n"}) {
            assertFalse(name, ShellPolicy.validBackupName(name));
        }
        assertTrue(ShellPolicy.validRequestId("backup-1:ab_cd"));
        assertFalse(ShellPolicy.validRequestId(""));
        assertFalse(ShellPolicy.validRequestId("a\n"));
        assertFalse(ShellPolicy.validRequestId("a".repeat(129)));
        assertTrue(ShellPolicy.isContentUri("content://com.android.providers.downloads.documents/document/12"));
        assertFalse(ShellPolicy.isContentUri("file:///sdcard/save.json"));
        assertFalse(ShellPolicy.isContentUri("content:///missing-provider"));
    }

    @Test public void backupLimitsMeasureUtf8BytesRatherThanOnlyCharacters() {
        assertArrayEquals("{\"hero\":\"雪\"}".getBytes(StandardCharsets.UTF_8), ShellPolicy.backupBytes("{\"hero\":\"雪\"}"));
        assertEquals(ShellPolicy.MAX_BACKUP_BYTES, ShellPolicy.backupBytes("a".repeat(ShellPolicy.MAX_BACKUP_BYTES)).length);
        assertThrows(IllegalArgumentException.class, () -> ShellPolicy.backupBytes("a".repeat(ShellPolicy.MAX_BACKUP_BYTES + 1)));
        assertThrows(IllegalArgumentException.class, () -> ShellPolicy.backupBytes("雪".repeat(ShellPolicy.MAX_BACKUP_BYTES / 3 + 1)));
    }

    @Test public void importSnapshotsHaveOnlyOpaqueSingleFileNames() {
        assertTrue(ShellPolicy.validSnapshotName("a12f4567-1234-4abc-9234-123456789abc.json"));
        for (String name : new String[]{"../private.json", "backup.json", "a12f4567-1234-4abc-9234-123456789abc.json/extra",
                "a12f4567-1234-4abc-9234-123456789abc.json%00", "a12f4567-1234-4abc-9234-123456789abc.json?file=other"}) {
            assertFalse(name, ShellPolicy.validSnapshotName(name));
        }
    }

    @Test public void boundedCopyRejectsOversizeBeforeWritingTheExcess() throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ShellPolicy.copyBounded(new ByteArrayInputStream(new byte[]{1, 2, 3}), output, 3);
        assertArrayEquals(new byte[]{1, 2, 3}, output.toByteArray());
        ByteArrayOutputStream rejected = new ByteArrayOutputStream();
        assertThrows(IOException.class, () -> ShellPolicy.copyBounded(new ByteArrayInputStream(new byte[4]), rejected, 3));
        assertTrue(rejected.size() <= 3);
    }
}
