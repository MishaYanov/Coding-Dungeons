package com.codingdungeons.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.JsonReader;
import android.util.JsonToken;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.StringReader;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

final class DocumentExchange {
    private static final int SAVE_DOCUMENT = 4101;
    private static final int OPEN_BACKUP = 4102;
    private final Activity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private ValueCallback<Uri[]> fileCallback;
    private Export pendingExport;
    private boolean busy;
    private boolean closed;
    private boolean rejectingBusy;

    private static final class Export {
        final String id, filename, asset;
        final byte[] backup;
        final JavaScriptReplyProxy reply;
        Export(String id, String filename, byte[] backup, String asset, JavaScriptReplyProxy reply) {
            this.id = id; this.filename = filename; this.backup = backup; this.asset = asset; this.reply = reply;
        }
    }

    DocumentExchange(Activity activity) { this.activity = activity; }

    void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin,
                   boolean mainFrame, JavaScriptReplyProxy reply) {
        if (closed || !mainFrame || !ShellPolicy.isTrustedOrigin(sourceOrigin.toString())
                || !ShellPolicy.isGameDocument(view.getUrl())) return;
        String raw;
        try { raw = message.getData(); }
        catch (IllegalStateException wrongType) { return; }
        // JSON escaping can expand a valid text payload to six times its UTF-8 size.
        if (raw == null || raw.length() > ShellPolicy.MAX_BACKUP_BYTES * 6 + 4096) return;
        if (busy || fileCallback != null) { rejectBusy(raw, reply); return; }
        busy = true;
        decoder.execute(() -> {
            String id = null;
            Export request = null;
            try {
                JSONObject object = new JSONObject(raw);
                Object candidateId = object.opt("id");
                if (candidateId instanceof String && ShellPolicy.validRequestId((String) candidateId)) id = (String) candidateId;
                if (id == null || object.length() != 4 || !"save-backup".equals(object.opt("type"))
                        || !(object.opt("filename") instanceof String) || !(object.opt("text") instanceof String)
                        || !ShellPolicy.validBackupName((String) object.opt("filename"))) throw new JSONException("Invalid request");
                request = new Export(id, (String) object.opt("filename"),
                        ShellPolicy.backupBytes((String) object.opt("text")), null, reply);
            } catch (JSONException | IllegalArgumentException invalid) {
                // Only the bounded request ID is ever reflected into a reply.
            }
            Export parsed = request;
            String requestId = id;
            activity.runOnUiThread(() -> {
                if (closed) { busy = false; return; }
                if (parsed == null) {
                    busy = false;
                    respond(reply, requestId, "error");
                } else openSaveDialog(parsed);
            });
        });
    }

    private void rejectBusy(String raw, JavaScriptReplyProxy reply) {
        // At most one rejection is queued; a blocked document provider cannot stall this reply.
        if (rejectingBusy) return;
        rejectingBusy = true;
        decoder.execute(() -> {
            String id = requestId(raw);
            activity.runOnUiThread(() -> {
                rejectingBusy = false;
                if (!closed) respond(reply, id, "error");
            });
        });
    }

    private static String requestId(String raw) {
        try (JsonReader reader = new JsonReader(new StringReader(raw))) {
            reader.beginObject();
            while (reader.hasNext()) {
                if ("id".equals(reader.nextName()) && reader.peek() == JsonToken.STRING) {
                    String id = reader.nextString();
                    return ShellPolicy.validRequestId(id) ? id : null;
                }
                reader.skipValue();
            }
        } catch (IOException | RuntimeException invalid) { /* No safe ID to acknowledge. */ }
        return null;
    }

    void downloadBook(String url) {
        String path = ShellPolicy.bookAsset(url);
        if (path == null || closed || busy || fileCallback != null) return;
        busy = true;
        String name = path.substring(path.lastIndexOf('/') + 1);
        openSaveDialog(new Export(null, name, null, path, null));
    }

    private void openSaveDialog(Export request) {
        pendingExport = request;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(request.asset == null ? "application/json" : ShellPolicy.mime(request.asset))
                .putExtra(Intent.EXTRA_TITLE, request.filename);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { activity.startActivityForResult(intent, SAVE_DOCUMENT); }
        catch (ActivityNotFoundException | SecurityException unavailable) {
            pendingExport = null;
            complete(request, "error");
        }
    }

    boolean chooseBackup(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams parameters) {
        if (closed || busy || fileCallback != null || parameters.getMode() != WebChromeClient.FileChooserParams.MODE_OPEN) {
            callback.onReceiveValue(null);
            return true;
        }
        fileCallback = callback;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { activity.startActivityForResult(intent, OPEN_BACKUP); }
        catch (ActivityNotFoundException | SecurityException unavailable) {
            fileCallback = null;
            callback.onReceiveValue(null);
            toast("No document picker is available.");
        }
        return true;
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == SAVE_DOCUMENT) {
            Export request = pendingExport;
            pendingExport = null;
            if (request == null) return;
            if (resultCode != Activity.RESULT_OK) { complete(request, "canceled"); return; }
            Uri uri = data == null ? null : data.getData();
            if (uri == null || !ShellPolicy.isContentUri(uri.toString())) { complete(request, "error"); return; }
            io.execute(() -> writeDocument(request, uri));
        } else if (requestCode == OPEN_BACKUP) {
            ValueCallback<Uri[]> callback = fileCallback;
            if (callback == null || busy) return;
            Uri uri = data == null ? null : data.getData();
            if (resultCode != Activity.RESULT_OK || uri == null || !ShellPolicy.isContentUri(uri.toString())
                    || (data.getClipData() != null && data.getClipData().getItemCount() > 1)) {
                fileCallback = null;
                callback.onReceiveValue(null);
                return;
            }
            busy = true;
            io.execute(() -> {
                Uri snapshot = null;
                try {
                    if (validBackupDocument(uri)) snapshot = ImportSnapshotProvider.capture(activity, uri);
                } catch (IOException | RuntimeException invalid) { /* The actual bytes must fit, regardless of provider metadata. */ }
                Uri accepted = snapshot;
                activity.runOnUiThread(() -> {
                    if (fileCallback != callback) return; // Closing the activity already canceled this callback.
                    fileCallback = null;
                    busy = false;
                    callback.onReceiveValue(accepted != null && !closed ? new Uri[]{accepted} : null);
                    if (accepted == null && !closed) toast("Choose one JSON backup no larger than 16 MiB.");
                });
            });
        }
    }

    private boolean validBackupDocument(Uri uri) {
        try (Cursor cursor = activity.getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return false;
            int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
            int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
            String name = nameColumn < 0 ? null : cursor.getString(nameColumn);
            if (name == null || !name.toLowerCase(Locale.ROOT).endsWith(".json")) return false;
            return sizeColumn < 0 || cursor.isNull(sizeColumn) || cursor.getLong(sizeColumn) <= ShellPolicy.MAX_BACKUP_BYTES;
        } catch (RuntimeException unavailable) { return false; }
    }

    private void writeDocument(Export request, Uri uri) {
        try (InputStream input = request.asset == null ? new ByteArrayInputStream(request.backup)
                    : activity.getAssets().open("game/" + request.asset);
             OutputStream output = activity.getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IOException("Document is not writable");
            ShellPolicy.copyBounded(input, output, request.asset == null ? ShellPolicy.MAX_BACKUP_BYTES : ShellPolicy.MAX_BOOK_BYTES);
        } catch (IOException | RuntimeException failure) {
            activity.runOnUiThread(() -> complete(request, "error"));
            return;
        }
        // The save is acknowledged only after the stream has closed without error.
        activity.runOnUiThread(() -> complete(request, "saved"));
    }

    private void complete(Export request, String status) {
        busy = false;
        if (closed) return;
        if (request.reply != null) respond(request.reply, request.id, status);
        else if ("saved".equals(status)) toast("Saved " + request.filename);
        else if ("error".equals(status)) toast("The document could not be saved.");
    }

    private static void respond(JavaScriptReplyProxy reply, String id, String status) {
        if (!ShellPolicy.validRequestId(id) || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try {
            reply.postMessage(new JSONObject().put("id", id).put("status", status).toString());
        } catch (JSONException | IllegalStateException detachedPage) {
            // The originating page may have closed while the document picker was open.
        }
    }

    private void toast(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }

    void close() {
        if (closed) return;
        closed = true;
        busy = false;
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (pendingExport != null && pendingExport.reply != null) respond(pendingExport.reply, pendingExport.id, "canceled");
        pendingExport = null;
        io.execute(() -> {
            try { ImportSnapshotProvider.clear(activity); }
            catch (IOException unavailable) { /* App-private cache remains bounded and is retried on the next import. */ }
        });
        decoder.shutdown();
        io.shutdown();
    }
}
