package com.codingdungeons.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** A test-only document provider which can deliberately lie about a document's size. */
public final class ExchangeFixtureProvider extends ContentProvider {
    static final String AUTHORITY = "com.codingdungeons.test.documentexchange";
    static final Uri SOURCE = Uri.parse("content://" + AUTHORITY + "/source");
    static final Uri SAVED = Uri.parse("content://" + AUTHORITY + "/saved");
    static final Uri OVERSIZE = Uri.parse("content://" + AUTHORITY + "/oversize");
    static final Uri BLOCKED = Uri.parse("content://" + AUTHORITY + "/blocked");
    private volatile CountDownLatch unblock = new CountDownLatch(1);
    private volatile boolean readingBlocked;

    @Override public boolean onCreate() { return true; }

    private File fixture(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (!AUTHORITY.equals(uri.getAuthority()) || uri.getPathSegments().size() != 1 ||
                !("source".equals(name) || "saved".equals(name) || "oversize".equals(name) || "blocked".equals(name))) {
            throw new FileNotFoundException("Unknown test fixture");
        }
        return new File(getContext().getCacheDir(), "document-exchange-" + ("blocked".equals(name) ? "source" : name) + ".json");
    }

    @Override public Bundle call(String method, String arg, Bundle extras) {
        try {
            if ("prepare".equals(method)) {
                unblock.countDown();
                unblock = new CountDownLatch(1);
                readingBlocked = false;
                write(fixture(SOURCE), "{\"hero\":\"before snapshot\"}");
                write(fixture(SAVED), "");
                try (FileOutputStream output = new FileOutputStream(fixture(OVERSIZE))) {
                    byte[] chunk = new byte[8192];
                    for (int bytes = 0; bytes < 16 * 1024 * 1024; bytes += chunk.length) output.write(chunk);
                    output.write(1);
                }
            } else if ("change-source".equals(method)) {
                write(fixture(SOURCE), "{\"hero\":\"changed after snapshot\"}");
            } else if ("blocked-state".equals(method)) {
                Bundle state = new Bundle();
                state.putBoolean("reading", readingBlocked);
                return state;
            } else if ("release-blocked".equals(method)) {
                unblock.countDown();
            } else if ("cleanup".equals(method)) {
                unblock.countDown();
                fixture(SOURCE).delete();
                fixture(SAVED).delete();
                fixture(OVERSIZE).delete();
            } else throw new IllegalArgumentException("Unknown fixture operation");
            return new Bundle();
        } catch (IOException failure) {
            throw new IllegalStateException("Could not prepare test documents", failure);
        }
    }

    private static void write(File file, String text) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] arguments, String order) {
        try {
            File file = fixture(uri);
            String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns);
            MatrixCursor.RowBuilder row = cursor.newRow();
            for (String column : columns) {
                if (OpenableColumns.DISPLAY_NAME.equals(column)) row.add("fixture-backup.json");
                else if (OpenableColumns.SIZE.equals(column)) row.add(OVERSIZE.equals(uri) ? 1L : file.length());
                else row.add(null);
            }
            return cursor;
        } catch (FileNotFoundException invalid) { throw new IllegalArgumentException(invalid); }
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (BLOCKED.equals(uri)) {
            readingBlocked = true;
            try {
                if (!unblock.await(45, TimeUnit.SECONDS)) throw new FileNotFoundException("Test provider was not released");
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new FileNotFoundException("Test provider was interrupted");
            }
        }
        return ParcelFileDescriptor.open(fixture(uri), ParcelFileDescriptor.parseMode(mode));
    }
    @Override public String getType(Uri uri) { return "application/json"; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] arguments) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] arguments) { throw new UnsupportedOperationException(); }
}
