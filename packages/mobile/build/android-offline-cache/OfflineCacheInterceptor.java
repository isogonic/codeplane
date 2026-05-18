// OfflineCacheInterceptor.java
//
// `WebViewClient.shouldInterceptRequest(...)` body. The Android offline
// path is structurally simpler than the iOS one because of an Android
// API limitation: `shouldInterceptRequest` does NOT expose the request
// body for non-GET methods. We can't proxy POST / PUT / PATCH / DELETE
// reliably without it (the body would silently disappear on the wire).
//
// So Android takes a different routing strategy than iOS:
//
//   • The host Activity navigates the WebView to the LIVE ORIGIN
//     (e.g. `https://codeplane.example.com/`), NOT a synthetic scheme.
//   • This interceptor short-circuits ONLY static GET requests for
//     paths whose extensions match the bundle (`.html` / `.js` /
//     `.css` / fonts / images / source maps / wasm) — those have a
//     1-to-1 correspondence with files on disk and the WebView never
//     leaks credentials into them.
//   • Everything else returns `null`, which means the WebView's own
//     network stack handles the request — POST bodies preserved, SSE
//     streamed natively, websockets upgraded normally. Cookies share
//     `CookieManager.getInstance()` with the InAppBrowser flow so SSO
//     keeps working.
//
// End user observation is identical to iOS: first paint is instant
// (HTML + JS + CSS off disk, no network), then the SPA hits the live
// API exactly the way it would have without the cache. The only
// network round-trip on a warm cache is the one for the data the user
// actually asked for. Auth headers from the OS keychain are layered
// on at the WebView level (the host Activity adds them via
// `WebView.loadUrl(url, headers)` for the initial navigation; later
// fetches inside the SPA inherit cookies + the static cache).
//
// Drop into `android/app/src/main/java/ai/codeplane/mobile/`.

package cc.codeplane.mobile;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

class OfflineCacheInterceptor {
    private static final String TAG = "OfflineCacheIntercept";

    /** Mirror of the iOS handler's MIME table — keep in sync so the
     *  bytes-on-disk parity stays byte-for-byte across platforms. */
    private static final Map<String, String> MIME_BY_EXT = new HashMap<>();
    static {
        MIME_BY_EXT.put("html", "text/html; charset=utf-8");
        MIME_BY_EXT.put("js",   "text/javascript; charset=utf-8");
        MIME_BY_EXT.put("mjs",  "text/javascript; charset=utf-8");
        MIME_BY_EXT.put("css",  "text/css; charset=utf-8");
        MIME_BY_EXT.put("json", "application/json; charset=utf-8");
        MIME_BY_EXT.put("map",  "application/json; charset=utf-8");
        MIME_BY_EXT.put("svg",  "image/svg+xml");
        MIME_BY_EXT.put("png",  "image/png");
        MIME_BY_EXT.put("jpg",  "image/jpeg");
        MIME_BY_EXT.put("jpeg", "image/jpeg");
        MIME_BY_EXT.put("gif",  "image/gif");
        MIME_BY_EXT.put("ico",  "image/x-icon");
        MIME_BY_EXT.put("webp", "image/webp");
        MIME_BY_EXT.put("avif", "image/avif");
        MIME_BY_EXT.put("woff", "font/woff");
        MIME_BY_EXT.put("woff2", "font/woff2");
        MIME_BY_EXT.put("ttf",  "font/ttf");
        MIME_BY_EXT.put("otf",  "font/otf");
        MIME_BY_EXT.put("txt",  "text/plain; charset=utf-8");
        MIME_BY_EXT.put("wasm", "application/wasm");
        MIME_BY_EXT.put("webm", "video/webm");
        MIME_BY_EXT.put("mp4",  "video/mp4");
    }

    private final File rootDir;
    /** Hostname of the live origin we navigated to. We only intercept
     *  requests whose host matches this — third-party assets (fonts /
     *  CDNs) the SPA references go straight to the network. */
    private final String originHost;

    OfflineCacheInterceptor(File rootDir, String originHost) {
        this.rootDir = rootDir;
        this.originHost = originHost;
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        if (request == null) return null;
        // GET only — POST / PUT / PATCH / DELETE bodies aren't visible
        // here on Android, so any attempt to proxy them would silently
        // drop the body. We let those pass through to the live origin
        // (the WebView's network stack handles them with full body +
        // shared cookies).
        String method = request.getMethod();
        if (method != null && !method.equalsIgnoreCase("GET")) return null;

        Uri uri = request.getUrl();
        if (uri == null) return null;
        String host = uri.getHost();
        if (host == null || !host.equalsIgnoreCase(originHost)) return null;

        String path = uri.getPath() == null || uri.getPath().isEmpty() ? "/" : uri.getPath();
        // Static asset on disk — serve.
        File staticTarget = staticPath(path);
        if (staticTarget != null && staticTarget.isFile() && hasKnownExt(path)) {
            return serveFile(staticTarget);
        }
        // SPA-shell fallthrough: serve index.html for non-API,
        // extension-less GETs (deep-routes the user might bookmark).
        // We DO NOT short-circuit /api/* or other API paths — the
        // WebView handles those natively against the live origin.
        if (path.equals("/") || (!hasKnownExt(path) && !looksLikeAPIPath(path))) {
            File index = new File(rootDir, "index.html");
            if (index.isFile()) {
                return serveFile(index);
            }
        }
        // Anything else (API, mutation, SSE, third-party-host) → let
        // the WebView's normal stack handle it.
        return null;
    }

    private File staticPath(String path) {
        String cleaned = path.startsWith("/") ? path.substring(1) : path;
        String target = cleaned.isEmpty() ? "index.html" : cleaned;
        return new File(rootDir, target);
    }

    private boolean hasKnownExt(String path) {
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        if (dot < 0 || dot < slash) return false;
        String ext = path.substring(dot + 1).toLowerCase();
        return MIME_BY_EXT.containsKey(ext);
    }

    /** Conservative API-path classifier so the SPA-shell fallback
     *  doesn't accidentally serve `index.html` for a server route the
     *  WebView meant to actually hit. Mirrors iOS. */
    private boolean looksLikeAPIPath(String path) {
        String lower = path.toLowerCase();
        return lower.startsWith("/api/")
                || lower.startsWith("/v2/")
                || lower.startsWith("/v3/")
                || lower.startsWith("/event")
                || lower.startsWith("/events")
                || lower.startsWith("/ws")
                || lower.startsWith("/websocket")
                || lower.startsWith("/socket")
                || lower.startsWith("/sync")
                || lower.startsWith("/global/")
                || lower.startsWith("/oauth/")
                || lower.startsWith("/cai/");
    }

    private String mimeType(File file) {
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = name.substring(dot + 1).toLowerCase();
        String hit = MIME_BY_EXT.get(ext);
        return hit == null ? "application/octet-stream" : hit;
    }

    private WebResourceResponse serveFile(File file) {
        try {
            String mime = mimeType(file);
            String charset = "utf-8";
            int semi = mime.indexOf(';');
            if (semi >= 0) {
                mime = mime.substring(0, semi).trim();
            }
            // The WebResourceResponse keeps a reference to the stream
            // and pumps it on the WebView's network thread; we only
            // need to open it once per request. `FileInputStream`
            // closes itself when the WebView finishes reading.
            InputStream input = new FileInputStream(file);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime, charset, 200, "OK", headers, input);
        } catch (IOException e) {
            Log.w(TAG, "static read failed: " + file.getAbsolutePath(), e);
            return null; // Let the network stack take a swing.
        }
    }
}
