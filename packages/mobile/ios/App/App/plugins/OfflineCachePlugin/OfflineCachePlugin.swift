//  OfflineCachePlugin.swift
//
//  Capacitor plugin that lets the in-app webview load a Codeplane
//  instance from the cached UI bytes the JS-side `asset-cache.ts`
//  module has already written to `Filesystem.Directory.Cache`.
//
//  Drop into `ios/App/App/plugins/OfflineCachePlugin/` after running
//  `bun run cap:add:ios`. The companion `OfflineCachePlugin.m`
//  registers the plugin under the JS name `CodeplaneOfflineCache`.
//
//  ── Responsibilities ───────────────────────────────────────────
//   • `isSupported()` — returns true on iOS 11+ (the WKURLSchemeHandler
//     API floor) so the JS picker can decide whether to use the
//     offline path or fall back to `@capgo/inappbrowser`.
//   • `openInstance(...)` — present a fullscreen modal with a
//     WKWebView whose configuration registers the
//     `CodeplaneCacheSchemeHandler` for the `codeplane-cache` scheme,
//     then navigate to `codeplane-cache://<instanceId>/`.
//   • `closeInstance(...)` — dismiss the active modal (also fires
//     `closeEvent` to JS listeners through Capacitor's standard
//     `notifyListeners`).
//
//  Cookies + auth: the WebView is configured with
//  `WKWebsiteDataStore.default()` — the same shared jar the existing
//  `@capgo/inappbrowser` modal uses — so SSO sessions established in
//  the InAppBrowser flow carry over to the offline modal and back.

import Capacitor
import Foundation
import UIKit
import WebKit

@objc(CodeplaneOfflineCachePlugin)
public class CodeplaneOfflineCachePlugin: CAPPlugin, CAPBridgedPlugin {
    // Capacitor 7 plugin discovery requires `CAPBridgedPlugin` —
    // see the matching block in `LiveActivitiesPlugin.swift` for the
    // full rationale. Without these properties the bridge silently
    // refuses to instantiate the plugin and the JS side falls
    // through to the web stub.
    public let identifier = "CodeplaneOfflineCachePlugin"
    public let jsName = "CodeplaneOfflineCache"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openInstance", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeInstance", returnType: CAPPluginReturnPromise),
    ]

    /// Active per-instance presentations, keyed by `instanceId`. Held
    /// strongly so ARC doesn't reap the view controller while the
    /// modal is on screen.
    private var presentations: [String: UIViewController] = [:]

    @objc public func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 11.0, *) {
            call.resolve([
                "supported": true,
                "minIOS": "11.0"
            ])
        } else {
            call.resolve([
                "supported": false,
                "reason": "WKURLSchemeHandler requires iOS 11 or newer"
            ])
        }
    }

    /// Open the cached UI for an instance.
    ///
    /// Input shape:
    /// ```
    /// {
    ///   instanceId:  string,
    ///   version:     string,        // matches assetCache rootPath
    ///   originUrl:   string,        // remote origin for proxied API
    ///   cacheDir:    string,        // absolute fs path to the cache root
    ///   authHeaders?: Record<string,string>,
    ///   toolbarColor?: string,      // hex; for status-bar background
    ///   title?: string,
    /// }
    /// ```
    @objc public func openInstance(_ call: CAPPluginCall) {
        guard #available(iOS 11.0, *) else {
            call.reject("CodeplaneOfflineCache requires iOS 11.0 or newer")
            return
        }

        guard
            let instanceId = call.getString("instanceId"),
            let version = call.getString("version"),
            let originString = call.getString("originUrl"),
            let cacheDir = call.getString("cacheDir"),
            let originUrl = URL(string: originString)
        else {
            call.reject("openInstance requires instanceId, version, originUrl, cacheDir")
            return
        }

        let authHeaders = (call.getObject("authHeaders") as? [String: String]) ?? [:]
        let toolbarColor = call.getString("toolbarColor")
        let title = call.getString("title") ?? originUrl.host ?? "Codeplane"

        let rootDir = URL(fileURLWithPath: cacheDir)
            .appendingPathComponent("codeplane-ui", isDirectory: true)
            .appendingPathComponent(instanceId, isDirectory: true)
            .appendingPathComponent(version, isDirectory: true)

        // Sanity check — if the cache directory doesn't exist, fail
        // out cleanly so the JS side falls back to the live-origin
        // InAppBrowser path. This keeps us from presenting an empty
        // modal that 404s on every request.
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: rootDir.path, isDirectory: &isDir), isDir.boolValue else {
            call.reject("Cache directory does not exist: \(rootDir.path)")
            return
        }
        let indexFile = rootDir.appendingPathComponent("index.html")
        guard FileManager.default.fileExists(atPath: indexFile.path) else {
            call.reject("Cache is missing index.html at \(indexFile.path)")
            return
        }

        // Plugin entry-point runs on the JS bridge thread; UI
        // mutations have to land on main.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            // Build the WebView configuration. The scheme handler is
            // registered BEFORE the WebView is constructed (you can't
            // add it later) and uses the SHARED website data store
            // so SSO cookies established via the existing InAppBrowser
            // flow carry over.
            let config = WKWebViewConfiguration()
            config.websiteDataStore = WKWebsiteDataStore.default()
            config.preferences.javaScriptCanOpenWindowsAutomatically = false

            let handler = CodeplaneCacheSchemeHandler(
                rootDir: rootDir,
                originUrl: originUrl,
                authHeaders: authHeaders
            )
            config.setURLSchemeHandler(handler, forURLScheme: "codeplane-cache")

            let webView = WKWebView(frame: .zero, configuration: config)
            // `Codeplane/Mobile` UA tag mirrors what the existing
            // InAppBrowser flow appends — the embedded UI checks for
            // it before exposing the live-activity toggle.
            let baseUA = webView.value(forKey: "userAgent") as? String ?? ""
            webView.customUserAgent = baseUA.isEmpty ? "Codeplane/Mobile" : "\(baseUA) Codeplane/Mobile"
            webView.allowsBackForwardNavigationGestures = true
            webView.scrollView.bounces = true
            webView.scrollView.alwaysBounceVertical = true
            // Inspectable so Safari → Develop → Simulator can attach
            // to the webview during dev.
            if #available(iOS 16.4, *) {
                webView.isInspectable = true
            }

            // Host the WebView in a plain UIViewController. We keep
            // it minimal — no toolbar, no nav bar — to match the
            // chromeless `@capgo/inappbrowser` BLANK presentation,
            // which is what the existing UX expects.
            let host = OfflineCacheHostController(
                webView: webView,
                background: parseHexColor(toolbarColor) ?? .systemBackground,
                title: title,
                onClose: { [weak self] in
                    self?.handleHostClosed(instanceId: instanceId)
                }
            )
            host.modalPresentationStyle = .fullScreen

            self.presentations[instanceId] = host

            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller to present from")
                return
            }
            presenter.present(host, animated: true) {
                // Navigate AFTER present so the transition starts
                // immediately and the first paint races the modal
                // animation in.
                let landing = URL(string: "codeplane-cache://\(instanceId)/")
                    ?? URL(string: "codeplane-cache:///")!
                webView.load(URLRequest(url: landing))
            }

            call.resolve([
                "id": instanceId,
                "scheme": "codeplane-cache",
                "rootDir": rootDir.path
            ])
        }
    }

    @objc public func closeInstance(_ call: CAPPluginCall) {
        let instanceId = call.getString("instanceId")
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let id = instanceId {
                if let controller = self.presentations.removeValue(forKey: id) {
                    controller.dismiss(animated: true) {
                        self.notifyListeners("closeEvent", data: ["id": id])
                    }
                }
            } else {
                let entries = self.presentations
                self.presentations.removeAll()
                for (id, controller) in entries {
                    controller.dismiss(animated: true) { [weak self] in
                        self?.notifyListeners("closeEvent", data: ["id": id])
                    }
                }
            }
            call.resolve()
        }
    }

    /// Internal — called by the host VC when the user taps the close
    /// pill OR when the modal is dismissed by interactive gesture.
    fileprivate func handleHostClosed(instanceId: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.presentations.removeValue(forKey: instanceId)
            self.notifyListeners("closeEvent", data: ["id": instanceId])
        }
    }

    /// `#RRGGBB` / `#RGB` parser. Defensive — bad input → nil so the
    /// caller can fall through to its default.
    private func parseHexColor(_ input: String?) -> UIColor? {
        guard let raw = input?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
        var hex = raw
        if hex.hasPrefix("#") { hex.removeFirst() }
        if hex.count == 3 {
            // expand `abc` → `aabbcc`
            hex = hex.map { "\($0)\($0)" }.joined()
        }
        guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
        let r = CGFloat((value >> 16) & 0xff) / 255
        let g = CGFloat((value >> 8) & 0xff) / 255
        let b = CGFloat(value & 0xff) / 255
        return UIColor(red: r, green: g, blue: b, alpha: 1.0)
    }
}

/// Plain `UIViewController` host for the offline WebView. We keep it
/// in this file because it's only used here and is small; pulling it
/// into its own file would add Xcode-target busywork without buying
/// anything.
@available(iOS 11.0, *)
final class OfflineCacheHostController: UIViewController {
    private let webView: WKWebView
    private let background: UIColor
    private let displayTitle: String
    private let onClose: () -> Void

    init(webView: WKWebView, background: UIColor, title: String, onClose: @escaping () -> Void) {
        self.webView = webView
        self.background = background
        self.displayTitle = title
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = background

        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.backgroundColor = background
        webView.isOpaque = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        // The chromeless `@capgo/inappbrowser` flow paints its own
        // close pill via `executeScript`; we do the same with a
        // straightforward floating button so users have an obvious
        // way out.
        let closeButton = UIButton(type: .system)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setTitle("✕", for: .normal)
        closeButton.titleLabel?.font = UIFont.systemFont(ofSize: 18, weight: .medium)
        closeButton.setTitleColor(.label, for: .normal)
        closeButton.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.85)
        closeButton.layer.cornerRadius = 18
        closeButton.layer.shadowColor = UIColor.black.cgColor
        closeButton.layer.shadowOpacity = 0.18
        closeButton.layer.shadowRadius = 8
        closeButton.layer.shadowOffset = CGSize(width: 0, height: 2)
        closeButton.accessibilityLabel = "Close \(displayTitle)"
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)
        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            closeButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            closeButton.widthAnchor.constraint(equalToConstant: 36),
            closeButton.heightAnchor.constraint(equalToConstant: 36),
        ])
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // Fire when the modal is gone — covers BOTH explicit close
        // taps and interactive-swipe dismissals.
        onClose()
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }
}
