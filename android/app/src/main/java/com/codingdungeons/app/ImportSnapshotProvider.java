package com.codingdungeons.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;

/** Serves only the bounded snapshot of the JSON document the user just selected. */
public final class ImportSnapshotProvider extends ContentProvider {
    private static File directory(Context context) { return new File(context.getCacheDir(), "backup-imports"); }

    static void clear(Context context) throws IOException {
        File directory = directory(context);
        if (!directory.exists()) return;
        File[] files = directory.listFiles();
        if (files == null) throw new IOException("Import cache is unavailable");
        for (File file : files) {
            if (ShellPolicy.validSnapshotName(file.getName()) && !file.delete()) throw new IOException("Import cache is busy");
        }
    }

    static Uri capture(Context context, Uri source) throws IOException {
        if (!ShellPolicy.isContentUri(source.toString())) throw new IOException("A document URI is required");
        File directory = directory(context);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Import cache is unavailable");
        clear(context);
        File target = new File(directory, UUID.randomUUID() + ".json");
        try {
            try (InputStream input = context.getContentResolver().openInputStream(source);
                 FileOutputStream output = new FileOutputStream(target)) {
                if (input == null) throw new IOException("Document is not readable");
                ShellPolicy.copyBounded(input, output, ShellPolicy.MAX_BACKUP_BYTES);
            }
            return new Uri.Builder().scheme("content").authority(context.getPackageName() + ".imports")
                    .appendPath(target.getName()).build();
        } catch (IOException | RuntimeException failure) {
            target.delete();
            throw failure;
        }
    }

    private File requireFile(Uri uri) throws FileNotFoundException {
        Context context = getContext();
        if (context == null || !(context.getPackageName() + ".imports").equals(uri.getAuthority())
                || !"content".equals(uri.getScheme()) || uri.getQuery() != null || uri.getFragment() != null) {
            throw new FileNotFoundException("Unknown import snapshot");
        }
        String path = uri.getEncodedPath();
        if (path == null || !path.startsWith("/") || !ShellPolicy.validSnapshotName(path.substring(1))) {
            throw new FileNotFoundException("Unknown import snapshot");
        }
        File file = new File(directory(context), path.substring(1));
        try {
            if (!file.isFile() || file.length() > ShellPolicy.MAX_BACKUP_BYTES
                    || !file.getCanonicalFile().getParentFile().equals(directory(context).getCanonicalFile())) {
                throw new FileNotFoundException("Unknown import snapshot");
            }
        } catch (IOException invalid) { throw new FileNotFoundException("Unknown import snapshot"); }
        return file;
    }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Import snapshots are read only");
        return ParcelFileDescriptor.open(requireFile(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns);
        try {
            File file = requireFile(uri);
            Object[] values = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = "coding-dungeons-import.json";
                else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = file.length();
            }
            cursor.addRow(values);
        } catch (FileNotFoundException missing) { /* An expired snapshot returns no rows. */ }
        return cursor;
    }

    @Override public String getType(Uri uri) {
        try { requireFile(uri); return "application/json"; }
        catch (FileNotFoundException missing) { return null; }
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
