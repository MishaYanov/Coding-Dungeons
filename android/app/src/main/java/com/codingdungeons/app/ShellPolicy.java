package com.codingdungeons.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class ShellPolicy {
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    static final int MAX_BACKUP_BYTES = 16 * 1024 * 1024;
    static final int MAX_BOOK_BYTES = 128 * 1024 * 1024;
    private static final Set<String> BOOKS = new HashSet<>(Arrays.asList(
            "book/ferrum-expedition.pdf", "book/ferrum-field-kit.zip",
            "book/javascript/book.pdf", "book/javascript/field-kit.zip",
            "book/typescript/book.pdf", "book/typescript/field-kit.zip",
            "book/csharp/book.pdf", "book/csharp/field-kit.zip",
            "book/go/book.pdf", "book/go/field-kit.zip"));

    private ShellPolicy() {}

    private static URI parse(String text) {
        try { return text == null ? null : new URI(text); }
        catch (URISyntaxException invalid) { return null; }
    }

    static boolean isTrustedOrigin(String text) {
        URI uri = parse(text);
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getRawAuthority());
    }

    static String assetPath(String text) {
        if (!isTrustedOrigin(text)) return null;
        String path = parse(text).getRawPath();
        if (path == null || path.isEmpty() || "/".equals(path)) return "index.html";
        // Packaged filenames are ASCII. Reject encoded separators and dot segments before resolving assets.
        if (!path.startsWith("/") || !path.matches("/[A-Za-z0-9._/-]+")) return null;
        String relative = path.substring(1);
        for (String part : relative.split("/", -1)) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return null;
        }
        return relative;
    }

    static boolean isGameDocument(String text) { return "index.html".equals(assetPath(text)); }

    static boolean isExternalHttps(String text) {
        URI uri = parse(text);
        return uri != null && "https".equals(uri.getScheme()) && uri.getHost() != null
                && uri.getRawUserInfo() == null && !isTrustedOrigin(text);
    }

    static boolean isContentUri(String text) {
        URI uri = parse(text);
        return uri != null && "content".equals(uri.getScheme()) && uri.getRawAuthority() != null
                && !uri.getRawAuthority().isEmpty() && uri.getRawUserInfo() == null;
    }

    static String bookAsset(String text) {
        String path = assetPath(text);
        return BOOKS.contains(path) ? path : null;
    }

    static String mime(String path) {
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        if (path.endsWith(".pdf")) return "application/pdf";
        if (path.endsWith(".zip")) return "application/zip";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    static boolean validBackupName(String filename) {
        return filename != null && filename.length() <= 128
                && filename.matches("[A-Za-z0-9][A-Za-z0-9._-]*\\.json");
    }

    static boolean validRequestId(String id) {
        if (id == null || id.isEmpty() || id.length() > 128) return false;
        for (int i = 0; i < id.length(); i++) if (Character.isISOControl(id.charAt(i))) return false;
        return true;
    }

    static boolean validSnapshotName(String name) {
        return name != null && name.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.json");
    }

    static byte[] backupBytes(String text) {
        if (text == null || text.length() > MAX_BACKUP_BYTES) throw new IllegalArgumentException("Backup too large");
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BACKUP_BYTES) throw new IllegalArgumentException("Backup too large");
        return bytes;
    }

    static void copyBounded(InputStream input, OutputStream output, int maximum) throws IOException {
        byte[] buffer = new byte[8192];
        int total = 0;
        for (int count; (count = input.read(buffer)) != -1;) {
            if (count == 0) continue;
            if (count > maximum - total) throw new IOException("Document exceeds the size limit");
            output.write(buffer, 0, count);
            total += count;
        }
        output.flush();
    }
}
