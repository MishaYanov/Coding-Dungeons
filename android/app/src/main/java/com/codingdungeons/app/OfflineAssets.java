package com.codingdungeons.app;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

final class OfflineAssets {
    private final AssetManager assets;
    private final WebViewAssetLoader loader;

    OfflineAssets(AssetManager assets) {
        this.assets = assets;
        loader = new WebViewAssetLoader.Builder().setDomain(ShellPolicy.HOST)
                .setHttpAllowed(false).addPathHandler("/", this::openAsset).build();
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        if (!"GET".equals(request.getMethod())) return error(403, "Forbidden");
        return intercept(request.getUrl());
    }

    WebResourceResponse intercept(Uri uri) {
        // Never return null: WebView and service workers must not fall back to the network.
        if (ShellPolicy.assetPath(uri.toString()) == null) return error(403, "Forbidden");
        WebResourceResponse response = loader.shouldInterceptRequest(uri);
        return response == null ? error(404, "Not Found") : response;
    }

    private WebResourceResponse openAsset(String relative) {
        String path = ShellPolicy.assetPath(ShellPolicy.ORIGIN + "/" + relative);
        if (path == null) return error(403, "Forbidden");
        try {
            InputStream stream = assets.open("game/" + path, AssetManager.ACCESS_STREAMING);
            Map<String, String> headers = headers();
            headers.put("Cache-Control", "no-cache");
            if ("sw.js".equals(path)) headers.put("Service-Worker-Allowed", "/");
            return new WebResourceResponse(ShellPolicy.mime(path), null, 200, "OK", headers, stream);
        } catch (IOException missing) {
            return error(404, "Not Found");
        }
    }

    private static Map<String, String> headers() {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Referrer-Policy", "no-referrer");
        headers.put("Cross-Origin-Resource-Policy", "same-origin");
        return headers;
    }

    private static WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, headers(),
                new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }
}
