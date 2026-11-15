package com.codingdungeons.app;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.ActivityTestRule;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONTokener;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;

/** Uses the real WebView bridge, Activity SAF callbacks, and ContentResolver file I/O. */
@SuppressWarnings("deprecation")
public class DocumentExchangeTest {
    @Rule public final ActivityTestRule<MainActivity> activityRule = new ActivityTestRule<>(MainActivity.class);
    private final List<Instrumentation.ActivityMonitor> monitors = new ArrayList<>();
    private Instrumentation instrumentation;
    private ContentResolver resolver;
    private WebView webView;

    @Before public void setUp() throws Exception {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        resolver = instrumentation.getTargetContext().getContentResolver();
        resolver.call(ExchangeFixtureProvider.SOURCE, "prepare", null, null);
        instrumentation.runOnMainSync(() -> webView = findWebView(activityRule.getActivity().getWindow().getDecorView()));
        assertNotNull("MainActivity must contain a functioning WebView", webView);
        awaitScript("typeof window.dungeonsSave?.postMessage === 'function'", Boolean.TRUE);
        script("window.__exchangeReplies = []; window.dungeonsSave.onmessage = event => { window.__exchangeReplies.push(JSON.parse(event.data)); }; true");
    }

    @After public void tearDown() {
        if (instrumentation != null) for (Instrumentation.ActivityMonitor monitor : monitors) instrumentation.removeMonitor(monitor);
        if (resolver != null) resolver.call(ExchangeFixtureProvider.SOURCE, "cleanup", null, null);
    }

    @Test public void backupBridgeSavesExactlyTheSubmittedUtf8BytesAndAcknowledgesCompletion() throws Exception {
        Instrumentation.ActivityMonitor picker = resultFor(Intent.ACTION_CREATE_DOCUMENT, Activity.RESULT_OK, ExchangeFixtureProvider.SAVED);
        String text = "{\"hero\":\"雪 🧙\",\"answers\":[\"a\\nb\"]}";
        submit("save-confirmed", text);
        awaitStatus("save-confirmed", "saved");
        assertEquals(1, picker.getHits());
        assertEquals(text, readText(ExchangeFixtureProvider.SAVED));
    }

    @Test public void cancelingTheSavePickerReturnsCanceledAndDoesNotWrite() throws Exception {
        Instrumentation.ActivityMonitor picker = resultFor(Intent.ACTION_CREATE_DOCUMENT, Activity.RESULT_CANCELED, null);
        submit("save-canceled", "{\"hero\":\"must not be saved\"}");
        awaitStatus("save-canceled", "canceled");
        assertEquals(1, picker.getHits());
        assertEquals("", readText(ExchangeFixtureProvider.SAVED));
    }

    @Test public void aBusyNativeSaveRejectsTheNewRequestAndCanBeCanceledThenRetried() throws Exception {
        // A blocking monitor without a result holds the native request at the open-picker stage.
        Instrumentation.ActivityMonitor held = instrumentation.addMonitor(pickerFilter(Intent.ACTION_CREATE_DOCUMENT), null, true);
        monitors.add(held);
        submit("held-save", "{}");
        long deadline = SystemClock.elapsedRealtime() + 10_000;
        while (held.getHits() == 0 && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50);
        assertEquals("The first request must reach the picker", 1, held.getHits());
        submit("busy-save", "{}");
        awaitStatus("busy-save", "error");
        instrumentation.runOnMainSync(() -> activityRule.getActivity().onActivityResult(4101, Activity.RESULT_CANCELED, null));
        awaitStatus("held-save", "canceled");
        instrumentation.removeMonitor(held);
        monitors.remove(held);
        resultFor(Intent.ACTION_CREATE_DOCUMENT, Activity.RESULT_OK, ExchangeFixtureProvider.SAVED);
        submit("retried-save", "{\"retry\":true}");
        awaitStatus("retried-save", "saved");
        assertEquals("{\"retry\":true}", readText(ExchangeFixtureProvider.SAVED));
    }

    @Test public void importingCreatesAReadOnlySnapshotIndependentOfTheOriginalProvider() throws Exception {
        Uri[] selected = importResult(ExchangeFixtureProvider.SOURCE);
        assertNotNull(selected);
        assertEquals(1, selected.length);
        Uri snapshot = selected[0];
        assertNotEquals(ExchangeFixtureProvider.SOURCE, snapshot);
        assertEquals(instrumentation.getTargetContext().getPackageName() + ".imports", snapshot.getAuthority());
        String original = "{\"hero\":\"before snapshot\"}";
        assertEquals(original, readText(snapshot));
        resolver.call(ExchangeFixtureProvider.SOURCE, "change-source", null, null);
        assertEquals("An imported file must not change after validation", original, readText(snapshot));
        try (OutputStream ignored = resolver.openOutputStream(snapshot, "wt")) {
            fail("Imported snapshots must not be writable through their content URI");
        } catch (java.io.FileNotFoundException | SecurityException expected) {
            // The production provider deliberately supports reading only.
        }
        Uri traversal = Uri.parse("content://" + snapshot.getAuthority() + "/../private.json");
        try (InputStream ignored = resolver.openInputStream(traversal)) {
            fail("The snapshot provider must reject non-token paths");
        } catch (java.io.FileNotFoundException | SecurityException expected) {
            // No arbitrary app-private files can be exposed.
        }
    }

    @Test public void theActualWebFileInputReadsTheSnapshotWithGeneralFileAndContentAccessDisabled() throws Exception {
        Instrumentation.ActivityMonitor picker = resultFor(Intent.ACTION_OPEN_DOCUMENT, Activity.RESULT_OK, ExchangeFixtureProvider.SOURCE);
        instrumentation.runOnMainSync(() -> {
            assertFalse(webView.getSettings().getAllowFileAccess());
            assertFalse(webView.getSettings().getAllowContentAccess());
        });
        script("window.__domImport = 'waiting'; (() => { const input = document.createElement('input');"
                + "input.id = 'instrumentation-backup'; input.type = 'file'; input.accept = '.json,application/json';"
                + "input.style.cssText = 'position:fixed;left:24px;top:150px;width:240px;height:72px;z-index:2147483647;background:white;color:black;';"
                + "input.onchange = async () => { try { window.__domImport = input.files[0] ? await input.files[0].text() : 'missing file'; }"
                + "catch (error) { window.__domImport = 'read failed: ' + error.message; } };"
                + "document.body.appendChild(input); })(); true");
        try {
            JSONArray coordinates = new JSONArray((String) script("(() => { const box = document.getElementById('instrumentation-backup').getBoundingClientRect();"
                    + "return JSON.stringify([box.left + box.width / 2, box.top + box.height / 2, window.innerWidth]); })()"));
            int[] location = new int[3];
            instrumentation.runOnMainSync(() -> {
                int[] screen = new int[2];
                webView.getLocationOnScreen(screen);
                location[0] = screen[0];
                location[1] = screen[1];
                location[2] = webView.getWidth();
            });
            float scale = (float) (location[2] / coordinates.getDouble(2));
            float x = location[0] + (float) coordinates.getDouble(0) * scale;
            float y = location[1] + (float) coordinates.getDouble(1) * scale;
            long time = SystemClock.uptimeMillis();
            MotionEvent down = MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, x, y, 0);
            MotionEvent up = MotionEvent.obtain(time, time, MotionEvent.ACTION_UP, x, y, 0);
            try {
                instrumentation.sendPointerSync(down);
                instrumentation.sendPointerSync(up);
            } finally {
                down.recycle();
                up.recycle();
            }
            awaitScript("window.__domImport", "{\"hero\":\"before snapshot\"}");
            assertEquals("The real file input must request one SAF picker", 1, picker.getHits());
        } finally {
            script("document.getElementById('instrumentation-backup')?.remove(); true");
        }
    }

    @Test public void importRejectsActualOversizeBytesEvenWhenTheProviderClaimsOneByte() throws Exception {
        try (Cursor cursor = resolver.query(ExchangeFixtureProvider.OVERSIZE, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            assertNotNull(cursor);
            assertTrue(cursor.moveToFirst());
            assertEquals("The fixture must lie about its actual size", 1, cursor.getLong(0));
        }
        assertNull("A 16MiB + 1 byte stream must not reach the WebView", importResult(ExchangeFixtureProvider.OVERSIZE));
    }

    @Test public void importRejectsNonContentUrisAndSaveRejectsTraversalNames() throws Exception {
        assertNull(importResult(Uri.parse("file:///data/local/tmp/not-a-backup.json")));
        String request = new JSONObject().put("id", "unsafe-name").put("type", "save-backup")
                .put("filename", "../private.json").put("text", "{}").toString();
        script("window.dungeonsSave.postMessage(" + JSONObject.quote(request) + "); true");
        awaitStatus("unsafe-name", "error");
    }

    @Test public void aPendingImportRejectsAnotherChooserAndSaveUntilTheSnapshotCompletes() throws Exception {
        PendingImport original = beginImport(ExchangeFixtureProvider.BLOCKED);
        try {
            long deadline = SystemClock.elapsedRealtime() + 10_000;
            while (!resolver.call(ExchangeFixtureProvider.SOURCE, "blocked-state", null, null).getBoolean("reading")
                    && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50);
            assertTrue("The original import must be awaiting provider bytes",
                    resolver.call(ExchangeFixtureProvider.SOURCE, "blocked-state", null, null).getBoolean("reading"));
            CountDownLatch refused = new CountDownLatch(1);
            AtomicReference<Uri[]> secondSelection = new AtomicReference<>();
            instrumentation.runOnMainSync(() -> webView.getWebChromeClient().onShowFileChooser(webView, value -> {
                secondSelection.set(value);
                refused.countDown();
            }, chooserParameters()));
            assertTrue("A second chooser must be refused promptly", refused.await(2, TimeUnit.SECONDS));
            assertNull(secondSelection.get());
            assertEquals("Only the initial picker should open", 1, original.picker.getHits());
            Instrumentation.ActivityMonitor unexpectedSave = resultFor(Intent.ACTION_CREATE_DOCUMENT, Activity.RESULT_CANCELED, null);
            submit("save-during-import", "{}");
            awaitStatus("save-during-import", "error");
            assertEquals("A busy save must not open another picker", 0, unexpectedSave.getHits());
        } finally {
            resolver.call(ExchangeFixtureProvider.SOURCE, "release-blocked", null, null);
        }
        assertNotNull("The initial import must still finish", finishImport(original));
    }

    private static IntentFilter pickerFilter(String action) {
        IntentFilter filter = new IntentFilter(action);
        filter.addCategory(Intent.CATEGORY_OPENABLE);
        try { filter.addDataType("*/*"); }
        catch (IntentFilter.MalformedMimeTypeException impossible) { throw new AssertionError(impossible); }
        return filter;
    }

    private Instrumentation.ActivityMonitor resultFor(String action, int result, Uri uri) {
        Intent data = uri == null ? null : new Intent().setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        Instrumentation.ActivityMonitor monitor = instrumentation.addMonitor(pickerFilter(action),
                new Instrumentation.ActivityResult(result, data), true);
        monitors.add(monitor);
        return monitor;
    }

    private Uri[] importResult(Uri source) throws Exception {
        return finishImport(beginImport(source));
    }

    private static final class PendingImport {
        final CountDownLatch completed = new CountDownLatch(1);
        final AtomicReference<Uri[]> selection = new AtomicReference<>();
        final Instrumentation.ActivityMonitor picker;
        PendingImport(Instrumentation.ActivityMonitor picker) { this.picker = picker; }
    }

    private PendingImport beginImport(Uri source) {
        Instrumentation.ActivityMonitor picker = resultFor(Intent.ACTION_OPEN_DOCUMENT, Activity.RESULT_OK, source);
        PendingImport pending = new PendingImport(picker);
        instrumentation.runOnMainSync(() -> {
            boolean handled = webView.getWebChromeClient().onShowFileChooser(webView, value -> {
                pending.selection.set(value);
                pending.completed.countDown();
            }, chooserParameters());
            assertTrue("The app must implement file selection", handled);
        });
        return pending;
    }

    private Uri[] finishImport(PendingImport pending) throws Exception {
        assertTrue("Import must resolve its callback", pending.completed.await(30, TimeUnit.SECONDS));
        assertEquals(1, pending.picker.getHits());
        instrumentation.removeMonitor(pending.picker);
        monitors.remove(pending.picker);
        return pending.selection.get();
    }

    private static WebChromeClient.FileChooserParams chooserParameters() {
        return new WebChromeClient.FileChooserParams() {
            @Override public int getMode() { return MODE_OPEN; }
            @Override public String[] getAcceptTypes() { return new String[]{"application/json"}; }
            @Override public boolean isCaptureEnabled() { return false; }
            @Override public CharSequence getTitle() { return "Test backup import"; }
            @Override public String getFilenameHint() { return null; }
            @Override public Intent createIntent() { return new Intent(Intent.ACTION_OPEN_DOCUMENT); }
        };
    }

    private void submit(String id, String text) throws Exception {
        String request = new JSONObject().put("id", id).put("type", "save-backup")
                .put("filename", "coding-dungeons-world-1-backup.json").put("text", text).toString();
        script("window.dungeonsSave.postMessage(" + JSONObject.quote(request) + "); true");
    }

    private void awaitStatus(String id, String status) throws Exception {
        awaitScript("window.__exchangeReplies.find(reply => reply.id === " + JSONObject.quote(id) + ")?.status ?? null", status);
    }

    private void awaitScript(String expression, Object expected) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 30_000;
        Object actual;
        do {
            actual = script(expression);
            if (expected.equals(actual)) return;
            SystemClock.sleep(50);
        } while (SystemClock.elapsedRealtime() < deadline);
        assertEquals("JavaScript expression: " + expression, expected, actual);
    }

    private Object script(String expression) throws Exception {
        CountDownLatch evaluated = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> webView.evaluateJavascript(expression, value -> {
            result.set(value);
            evaluated.countDown();
        }));
        assertTrue("WebView evaluation must complete", evaluated.await(10, TimeUnit.SECONDS));
        return new JSONTokener(result.get()).nextValue();
    }

    private String readText(Uri uri) throws Exception {
        try (InputStream input = resolver.openInputStream(uri); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            assertNotNull(input);
            byte[] buffer = new byte[4096];
            for (int read; (read = input.read(buffer)) != -1;) {
                assertTrue("Test documents must remain small", bytes.size() + read <= 64 * 1024);
                bytes.write(buffer, 0, read);
            }
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView result = findWebView(group.getChildAt(i));
                if (result != null) return result;
            }
        }
        return null;
    }
}
