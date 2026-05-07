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
//  ── Status ────────────────────────────────────────────────────────
//  This is the SKELETON for phase 2b. The methods all reject with
//  `Not implemented` so the JS side knows to fall back to the
//  existing `@capgo/inappbrowser` path. Filling in the bodies is the
//  next concrete step — see README.md in this directory for the
//  exact shape.

import Capacitor
import Foundation
import WebKit

@objc(CodeplaneOfflineCachePlugin)
public class CodeplaneOfflineCachePlugin: CAPPlugin {
    /// Active per-instance presentations, keyed by `instanceId`. Held
    /// strongly here so ARC doesn't reap the view controller while the
    /// modal is on screen.
    private var presentations: [String: UIViewController] = [:]

    /// Probe for whether the offline path is available. Today it's
    /// always `false` (skeleton); once the scheme handler + presenter
    /// are wired we flip this to a runtime check (`#available` on
    /// WKURLSchemeHandler — iOS 11+ — and a sanity-check that the
    /// requested cache directory exists on disk).
    @objc public func isSupported(_ call: CAPPluginCall) {
        call.resolve([
            "supported": false,
            "reason": "phase 2b not yet wired"
        ])
    }

    /// Open the cached UI for an instance.
    ///
    /// JS-side input shape (kept stable now so the picker can call
    /// this once the implementation lands):
    /// ```
    /// {
    ///   instanceId: string,
    ///   version:    string,        // matches assetCache.rootPath()
    ///   originUrl:  string,        // remote origin for proxied API
    ///   authHeaders?: Record<string,string>,
    ///   toolbarColor?: string,     // hex; for status-bar background
    /// }
    /// ```
    ///
    /// Resolves with `{ id: string }` once the modal is on screen,
    /// fires `closeEvent` on dismiss (Capacitor's standard listener).
    @objc public func openInstance(_ call: CAPPluginCall) {
        // TODO(phase 2b):
        //   1. Read instanceId / version / originUrl from `call`.
        //   2. Build `Filesystem.Directory.Cache/codeplane-ui/<instanceId>/<version>` path.
        //   3. Construct WKWebViewConfiguration:
        //        config.setURLSchemeHandler(
        //          CodeplaneCacheSchemeHandler(rootDir:, originUrl:, authHeaders:),
        //          forURLScheme: "codeplane-cache"
        //        )
        //   4. Create UIViewController hosting the WKWebView, present
        //      from `bridge?.viewController`, store in `presentations`.
        //   5. Resolve with `{ id: instanceId }`.
        call.reject("CodeplaneOfflineCache.openInstance is not implemented yet")
    }

    /// Close any active offline presentation. JS callers also get
    /// notified via `closeEvent` — this is the explicit-API equivalent.
    @objc public func closeInstance(_ call: CAPPluginCall) {
        let instanceId = call.getString("instanceId")
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let id = instanceId {
                self.presentations.removeValue(forKey: id)?.dismiss(animated: true)
            } else {
                for (_, controller) in self.presentations {
                    controller.dismiss(animated: true)
                }
                self.presentations.removeAll()
            }
            call.resolve()
        }
    }
}
