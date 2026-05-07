//  CodeplaneCacheSchemeHandler.swift
//
//  WKURLSchemeHandler implementation that powers the `codeplane-cache:`
//  scheme. Static UI assets are read off disk from the directory tree
//  the JS-side `asset-cache.ts` writes; everything else (API calls,
//  auth probes, server-sent events) is proxied to the live origin so
//  the user's actual API session keeps working while their UI bytes
//  come from the cache.
//
//  Drop into `ios/App/App/plugins/OfflineCachePlugin/` alongside
//  `OfflineCachePlugin.swift`.
//
//  ── Status ────────────────────────────────────────────────────────
//  Skeleton — every method below is structured to make the phase-2b
//  fill-in mechanical. Top-of-file constants point at the same paths
//  + extension table the JS module uses; copy-paste from the desktop
//  `ui-host.ts` MIME table for parity.

import Foundation
import WebKit

@available(iOS 11.0, *)
final class CodeplaneCacheSchemeHandler: NSObject, WKURLSchemeHandler {
    /// `<Filesystem.Directory.Cache>/codeplane-ui/<instanceId>/<version>/`
    let rootDir: URL
    /// Live origin (`https://codeplane.example.com`) for the proxy
    /// fall-through. We append the request path to this.
    let originUrl: URL
    /// Per-instance auth headers from the OS keychain. Forwarded on
    /// every proxied request, same model as the desktop's per-session
    /// header injection.
    let authHeaders: [String: String]

    /// In-flight proxy tasks, keyed by the WKURLSchemeTask's request
    /// hash so `webView(_:stop:)` can cancel them.
    private var inFlight: [ObjectIdentifier: URLSessionDataTask] = [:]
    private let lock = NSLock()

    init(rootDir: URL, originUrl: URL, authHeaders: [String: String]) {
        self.rootDir = rootDir
        self.originUrl = originUrl
        self.authHeaders = authHeaders
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        // codeplane-cache://<instanceId>/<path...>
        // Treat the host as a sanity-check (must match this handler's
        // instanceId) and the path as either a static asset or an API
        // route.
        let path = url.path.isEmpty ? "/" : url.path
        let staticTarget = staticPath(for: path)

        if FileManager.default.fileExists(atPath: staticTarget.path) {
            // TODO(phase 2b):
            //   - Read bytes (use `Data(contentsOf:options: .mappedIfSafe)` for big bundles)
            //   - Build HTTPURLResponse with statusCode 200 and Content-Type from `mimeType(forPath:)`
            //   - urlSchemeTask.didReceive(response)
            //   - urlSchemeTask.didReceive(data)
            //   - urlSchemeTask.didFinish()
            urlSchemeTask.didFailWithError(NSError(
                domain: "CodeplaneOfflineCache",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "phase 2b not yet implemented (static path)"]
            ))
            return
        }

        // Proxy fall-through.
        // TODO(phase 2b):
        //   - Build URLRequest against `originUrl.appendingPathComponent(path)`
        //   - Copy method, headers, and body from `urlSchemeTask.request`
        //   - Add `authHeaders`
        //   - Add cookies from WKWebsiteDataStore.default().httpCookieStore
        //   - URLSession.shared.dataTask { ... } streaming back via didReceive
        //   - On Set-Cookie response, sync back into WKWebsiteDataStore
        urlSchemeTask.didFailWithError(NSError(
            domain: "CodeplaneOfflineCache",
            code: -1,
            userInfo: [NSLocalizedDescriptionKey: "phase 2b not yet implemented (proxy path)"]
        ))
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask)
        lock.lock()
        let task = inFlight.removeValue(forKey: key)
        lock.unlock()
        task?.cancel()
    }

    // ── Helpers ───────────────────────────────────────────────────

    /// Resolve `path` against the cache root. Empty path / "/" maps to
    /// `index.html` — same fallback the desktop's `staticFile` uses.
    private func staticPath(for path: String) -> URL {
        let cleaned = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let target = cleaned.isEmpty ? "index.html" : cleaned
        return rootDir.appendingPathComponent(target)
    }

    /// Content-Type by extension. Mirror this from desktop's
    /// `MIME_TYPES` map in `ui-host.ts` so parity is byte-for-byte.
    private func mimeType(forPath path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html":      return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css":       return "text/css; charset=utf-8"
        case "json":      return "application/json; charset=utf-8"
        case "svg":       return "image/svg+xml"
        case "png":       return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif":       return "image/gif"
        case "ico":       return "image/x-icon"
        case "webp":      return "image/webp"
        case "avif":      return "image/avif"
        case "woff":      return "font/woff"
        case "woff2":     return "font/woff2"
        case "ttf":       return "font/ttf"
        case "txt":       return "text/plain; charset=utf-8"
        case "webm":      return "video/webm"
        default:          return "application/octet-stream"
        }
    }
}
