package com.codingdungeons.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.ServiceWorkerWebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;

public final class MainActivity extends Activity {
    private WebView webView;
    private DocumentExchange documents;
    private FrameLayout root;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 24, 33));
        setContentView(root);
        configureInsets();
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView notice = new TextView(this);
            notice.setText(R.string.webview_required);
            notice.setTextColor(Color.WHITE);
            notice.setTextSize(18);
            notice.setPadding(24, 24, 24, 24);
            root.addView(notice);
            return;
        }

        OfflineAssets assets = new OfflineAssets(getAssets());
        configureServiceWorkers(assets);
        documents = new DocumentExchange(this);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 24, 33));
        configureWebView(webView, assets);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "dungeonsSave", Collections.singleton(ShellPolicy.ORIGIN), documents::onMessage);
        }
        if (state == null || webView.restoreState(state) == null || !ShellPolicy.isGameDocument(webView.getUrl())) {
            webView.loadUrl(ShellPolicy.ORIGIN + "/");
        }
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        }
    }

    private void configureServiceWorkers(OfflineAssets assets) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) return;
        ServiceWorkerControllerCompat controller = ServiceWorkerControllerCompat.getInstance();
        ServiceWorkerWebSettingsCompat settings = controller.getServiceWorkerWebSettings();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_FILE_ACCESS)) settings.setAllowFileAccess(false);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_CONTENT_ACCESS)) settings.setAllowContentAccess(false);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BLOCK_NETWORK_LOADS)) settings.setBlockNetworkLoads(true);
        controller.setServiceWorkerClient(new ServiceWorkerClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return assets.intercept(request);
            }
        });
    }

    // The packaged React game and compiler workers require JavaScript; remote documents are blocked.
    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    private void configureWebView(WebView view, OfflineAssets assets) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(false);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                return assets.intercept(request);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView web, String url) {
                return assets.intercept(Uri.parse(url));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (!request.isForMainFrame()) return !ShellPolicy.isGameDocument(url);
                if (ShellPolicy.isGameDocument(url)) return false;
                if (request.hasGesture()) {
                    if (ShellPolicy.bookAsset(url) != null) documents.downloadBook(url);
                    else if (ShellPolicy.isExternalHttps(url)) openBrowser(request.getUrl());
                }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView web, String url) {
                // This legacy callback cannot establish a user gesture for an external navigation.
                return !ShellPolicy.isGameDocument(url);
            }
            @Override public void onReceivedSslError(WebView web, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
            @Override public boolean onRenderProcessGone(WebView web, RenderProcessGoneDetail detail) {
                root.removeView(web);
                web.destroy();
                webView = null;
                documents.close();
                showRendererRecovery();
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView web, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (!ShellPolicy.isGameDocument(web.getUrl())) { callback.onReceiveValue(null); return true; }
                return documents.chooseBackup(callback, parameters);
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        view.setDownloadListener((url, agent, disposition, mime, size) -> documents.downloadBook(url));
    }

    private void openBrowser(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            Toast.makeText(this, "No browser is available to open this link.", Toast.LENGTH_LONG).show();
        }
    }

    private void configureInsets() {
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets visible = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(visible.left, visible.top, visible.right, visible.bottom);
                return WindowInsets.CONSUMED;
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets.consumeSystemWindowInsets();
        });
        root.requestApplyInsets();
    }

    private void showRendererRecovery() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(24, 24, 24, 24);
        TextView text = new TextView(this);
        text.setText("The game view stopped, possibly because this device ran out of memory. Saved heroes remain on this device.");
        text.setTextColor(Color.WHITE);
        text.setTextSize(18);
        Button reload = new Button(this);
        reload.setText("Reload game");
        reload.setOnClickListener(button -> recreate());
        panel.addView(text);
        panel.addView(reload);
        root.addView(panel);
    }

    private void navigateBack() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else moveTaskToBack(true);
    }

    // API 33+ registers OnBackInvokedDispatcher above; this override serves Android 8–12 only.
    @Override @SuppressLint("GestureBackNavigation") @SuppressWarnings("deprecation")
    public void onBackPressed() { navigateBack(); }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (documents != null) documents.onActivityResult(requestCode, resultCode, data);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (webView != null) webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        if (documents != null) documents.close();
        if (webView != null) { root.removeView(webView); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
