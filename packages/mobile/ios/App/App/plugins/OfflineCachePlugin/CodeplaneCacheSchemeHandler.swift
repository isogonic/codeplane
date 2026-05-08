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
//  ── How it routes a request ────────────────────────────────────
//  1. URL hits the scheme handler as `codeplane-cache://<instanceId>/<path>?<query>`.
//  2. If `<path>` resolves to a file under
//     `<rootDir>/<path>` (or `<rootDir>/index.html` for `/` and SPA
//     fallthrough): serve from disk with a real `Content-Type` and
//     the same Cache-Control the desktop's `ui-host` sets.
//  3. Otherwise treat the request as an API / SSE / proxied call.
//     Construct an HTTPS URL against `originUrl`, copy the WebKit
//     request 1:1 (method / headers / body), inject the per-instance
//     auth headers from the OS keychain, and stream the upstream
//     response back through the WKURLSchemeTask incrementally so SSE
//     and chunked responses don't buffer.
//
//  Cookies are handled by `WKWebsiteDataStore.default()` which the
//  presenting plugin attaches to the WebView's configuration — both
//  outbound requests and `Set-Cookie` responses flow through that
//  shared jar without us having to mirror them by hand. This is the
//  same model the desktop's `ui-host` HTTP proxy uses, only with
//  the cookie store living in WebKit instead of node-fetch.

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

    /// In-flight proxy tasks, keyed by the WKURLSchemeTask identity.
    /// `webView(_:stop:)` cancels them so a navigation away from the
    /// page kills any pending streaming response (SSE, large JSON,
    /// etc.) — without this an aborted nav would leak network IO and
    /// keep the WKWebView holding references into the JS bridge.
    private var inFlight: [ObjectIdentifier: URLSessionDataTask] = [:]
    private let lock = NSLock()

    /// Dedicated session so we can configure cookie storage to the
    /// shared `HTTPCookieStorage.shared` (which the WKWebsiteDataStore
    /// mirrors into / out of) and skip the URL cache (we have our own
    /// disk cache for static assets, and API responses shouldn't be
    /// cached opaquely by Foundation).
    private lazy var proxySession: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpCookieAcceptPolicy = .always
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 60
        // SSE + websocket-upgrade-as-HTTP can keep the connection open
        // for a long time — the user's session can sit idle for a
        // while between turns.
        config.timeoutIntervalForResource = 60 * 60
        return URLSession(configuration: config, delegate: nil, delegateQueue: nil)
    }()

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

        let path = url.path.isEmpty ? "/" : url.path
        let staticTarget = staticPath(for: path)

        // Static-asset path — serve from disk.
        if FileManager.default.fileExists(atPath: staticTarget.path) {
            serveFile(at: staticTarget, requestUrl: url, task: urlSchemeTask)
            return
        }

        // SPA fallthrough — any deep route the user might bookmark
        // (e.g. `/L1VzZXJz/session/abc123`) lands on `index.html` so
        // the SolidJS router can take over. Mirrors the desktop
        // `ui-host`'s `serveAppShell` rule.
        //
        // Be conservative about WHICH paths fall through: if the path
        // looks API-shaped (`/api`, `/v2`, `/v3`, `/event`, `/ws`,
        // `/socket`, `/sync`, `/global`), we DON'T serve index.html —
        // those need to hit the live origin.
        if !looksLikeAPIPath(path) {
            let indexFile = rootDir.appendingPathComponent("index.html")
            if FileManager.default.fileExists(atPath: indexFile.path) {
                serveFile(at: indexFile, requestUrl: url, task: urlSchemeTask)
                return
            }
        }

        // Proxy fall-through — every dynamic path goes upstream.
        proxyToOrigin(originPath: path, query: url.query, task: urlSchemeTask)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask)
        lock.lock()
        let task = inFlight.removeValue(forKey: key)
        lock.unlock()
        task?.cancel()
    }

    // ── File serving ──────────────────────────────────────────────

    /// Read bytes off disk, build an HTTPURLResponse with the right
    /// MIME + caching headers, hand it to the scheme task.
    private func serveFile(at file: URL, requestUrl: URL, task: WKURLSchemeTask) {
        do {
            // `mappedIfSafe` keeps the bundle .js / .css off the heap
            // — important because Codeplane bundles can be 5–10 MB
            // and the user might re-open the same instance many times.
            let data = try Data(contentsOf: file, options: [.mappedIfSafe])
            let mime = mimeType(forPath: file.path)
            let headers: [String: String] = [
                "Content-Type": mime,
                "Content-Length": String(data.count),
                // Same caching shape the desktop's ui-host emits:
                // hashed filenames are immutable, the SPA shell is
                // re-validated every time. We can't tell hashed-from-
                // -shell at this layer cheaply, so keep the
                // shell-safe `no-cache` and let the WKWebView's HTTP
                // cache handle re-fetch elision via ETag from the
                // file mtime.
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            ]
            guard
                let response = HTTPURLResponse(
                    url: requestUrl,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: headers
                )
            else {
                task.didFailWithError(URLError(.cannotParseResponse))
                return
            }
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        } catch {
            task.didFailWithError(error)
        }
    }

    // ── Proxy to live origin ──────────────────────────────────────

    /// Build an HTTPS request against `originUrl + path?query`, copy
    /// the inbound WebKit request, inject auth headers, kick off a
    /// streaming `URLSessionDataTask` and feed bytes back to the
    /// scheme task as they arrive.
    private func proxyToOrigin(originPath: String, query: String?, task: WKURLSchemeTask) {
        // Construct the upstream URL.
        var components = URLComponents(url: originUrl, resolvingAgainstBaseURL: false)
        // `originUrl.appendingPathComponent` would percent-encode slashes
        // inside the path; we need the path to land 1:1 (e.g.
        // `/api/v2/session/ses_…`) so we mutate components directly.
        let basePath = originUrl.path.hasSuffix("/")
            ? String(originUrl.path.dropLast())
            : originUrl.path
        components?.path = basePath + originPath
        components?.query = query

        guard let upstreamUrl = components?.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        var upstream = URLRequest(url: upstreamUrl)
        upstream.httpMethod = task.request.httpMethod ?? "GET"
        upstream.httpBody = task.request.httpBody

        // Copy inbound headers verbatim, then layer the per-instance
        // auth headers on top so they win over anything WebKit sent
        // by default. `Host` we always rewrite to the upstream host
        // — leaving the cache scheme's host header would confuse a
        // load balancer up front.
        if let inboundHeaders = task.request.allHTTPHeaderFields {
            for (key, value) in inboundHeaders {
                if key.lowercased() == "host" { continue }
                upstream.setValue(value, forHTTPHeaderField: key)
            }
        }
        if let host = upstreamUrl.host {
            upstream.setValue(host, forHTTPHeaderField: "Host")
        }
        for (key, value) in authHeaders {
            upstream.setValue(value, forHTTPHeaderField: key)
        }

        // Kick off and remember the in-flight task so `webView:stop:`
        // can cancel it.
        let key = ObjectIdentifier(task)
        var hasResponded = false
        var didFinish = false
        let dataTask = proxySession.dataTask(with: upstream) { [weak self] data, response, error in
            guard let self else { return }
            self.lock.lock()
            self.inFlight.removeValue(forKey: key)
            self.lock.unlock()

            if let error = error {
                if (error as NSError).code == NSURLErrorCancelled {
                    // Task was cancelled by `webView:stop:` — calling
                    // didFinish/didFailWithError on a stopped task is
                    // a WKWebView crash. Drop silently.
                    return
                }
                if !hasResponded {
                    task.didFailWithError(error)
                }
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                task.didFailWithError(URLError(.cannotParseResponse))
                return
            }

            if !hasResponded {
                // Strip headers WKWebView refuses to accept on a
                // synthesized response — `Content-Encoding` is the
                // big one (URLSession decompresses gzip/br for us, so
                // re-advertising it would mean WebKit tries to decompress
                // already-decompressed bytes).
                var headers: [String: String] = [:]
                for (rawKey, rawValue) in httpResponse.allHeaderFields {
                    guard let key = rawKey as? String, let value = rawValue as? String else { continue }
                    let lower = key.lowercased()
                    if lower == "content-encoding" { continue }
                    if lower == "content-length" { continue }
                    headers[key] = value
                }
                if let synthesized = HTTPURLResponse(
                    url: httpResponse.url ?? upstreamUrl,
                    statusCode: httpResponse.statusCode,
                    httpVersion: "HTTP/1.1",
                    headerFields: headers
                ) {
                    task.didReceive(synthesized)
                } else {
                    task.didReceive(httpResponse)
                }
                hasResponded = true
            }
            if let data = data, !data.isEmpty {
                task.didReceive(data)
            }
            if !didFinish {
                task.didFinish()
                didFinish = true
            }
        }
        lock.lock()
        inFlight[key] = dataTask
        lock.unlock()
        dataTask.resume()
    }

    // ── Helpers ───────────────────────────────────────────────────

    /// Resolve `path` against the cache root. Empty path / "/" maps to
    /// `index.html` — same fallback the desktop's `staticFile` uses.
    private func staticPath(for path: String) -> URL {
        let cleaned = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let target = cleaned.isEmpty ? "index.html" : cleaned
        return rootDir.appendingPathComponent(target)
    }

    /// Conservative API-path classifier so we don't accidentally serve
    /// `index.html` for a server route the WebView meant to actually
    /// hit the origin. Mirrors the prefix list the desktop's ui-host
    /// uses to decide proxy-vs-shell.
    private func looksLikeAPIPath(_ path: String) -> Bool {
        let lowered = path.lowercased()
        let prefixes = [
            "/api/", "/v2/", "/v3/", "/event", "/events",
            "/ws", "/websocket", "/socket", "/sync",
            "/global/", "/session/sync", "/oauth/", "/cai/"
        ]
        return prefixes.contains(where: { lowered.hasPrefix($0) })
    }

    /// Content-Type by extension. Mirrors the desktop's `MIME_TYPES`
    /// table in `ui-host.ts` so cache + live origin behave identically.
    private func mimeType(forPath path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html":      return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css":       return "text/css; charset=utf-8"
        case "json":      return "application/json; charset=utf-8"
        case "map":       return "application/json; charset=utf-8"
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
        case "otf":       return "font/otf"
        case "txt":       return "text/plain; charset=utf-8"
        case "wasm":      return "application/wasm"
        case "webm":      return "video/webm"
        case "mp4":       return "video/mp4"
        default:          return "application/octet-stream"
        }
    }
}
