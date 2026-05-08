//  MainViewController.swift
//
//  Custom Capacitor bridge view controller that registers our
//  in-binary plugins (`CodeplaneLiveActivities`, `CodeplaneOfflineCache`)
//  with the bridge as soon as it's loaded.
//
//  Why this exists: Capacitor 7 builds its plugin registry from
//  `capacitor.config.json#packageClassList`, which is auto-populated
//  by `npx cap sync` from `npm`-installed Capacitor plugins. Plugins
//  whose source lives INSIDE the App target (rather than in a Pod)
//  aren't auto-discovered — even with `CAPBridgedPlugin` conformance,
//  even with `-ObjC` linking the symbols into the main binary, even
//  with `ENABLE_DEBUG_DYLIB = NO` keeping them out of the side dylib.
//  The bridge just doesn't know they exist unless something hands
//  them to it. That's what `capacitorDidLoad()` is for.
//
//  Wired in via `Main.storyboard` — the root scene's `customClass`
//  points at this file instead of `CAPBridgedViewController` so iOS
//  instantiates this subclass as the root view controller.
//
//  Survives `cap sync`: this file is in the App target's `Sources/`
//  and the storyboard reference is committed; cap sync only
//  regenerates `capacitor.config.json` and the Pods xcconfigs, both
//  of which we've stopped depending on for plugin discovery.

import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // The bridge is non-nil here (Capacitor sets it up before
        // calling this hook). `registerPluginInstance` matches the
        // signature each pod-based plugin uses internally — same
        // codepath, just driven by us instead of the auto-loader.
        guard let bridge = bridge else {
            // eslint-disable-next-line no-console
            print("[MainViewController] capacitorDidLoad fired without a bridge — not registering custom plugins. " +
                  "This shouldn't happen in normal Capacitor lifecycle.")
            return
        }

        // Live Activities — drives the iOS Lock Screen / Dynamic Island
        // activity for opted-in sessions. JS side: `CodeplaneLiveActivities`.
        bridge.registerPluginInstance(CodeplaneLiveActivitiesPlugin())

        // Offline cache — serves the cached UI bytes from
        // `Filesystem.Directory.Cache` via a custom `codeplane-cache://`
        // scheme handler. JS side: `CodeplaneOfflineCache`.
        bridge.registerPluginInstance(CodeplaneOfflineCachePlugin())

        print("[MainViewController] registered CodeplaneLiveActivities + CodeplaneOfflineCache")
    }
}
