import type { CapacitorConfig } from "@capacitor/cli"
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard"

/**
 * Capacitor configuration for the Codeplane mobile app.
 *
 * The mobile app mirrors the desktop shell: it always starts on the
 * instance picker, then opens the selected Codeplane server's web UI
 * inside an in-app webview. We don't ship a backend — every instance
 * is a remote (or local-runtime) Codeplane server the user owns.
 *
 * `webDir` points at the Vite build output (the picker UI itself),
 * which is what Capacitor packages into the native app bundle. The
 * actual instance UIs are loaded over the network at runtime.
 */
const config: CapacitorConfig = {
  appId: "cc.codeplane.mobile",
  appName: "Codeplane",
  webDir: "dist",
  ios: {
    // `never` lets WKWebView extend edge-to-edge under the safe areas so
    // the picker's own `--background-base` paints the whole screen (incl.
    // the home-indicator zone). Anything else (`always`, `automatic`)
    // makes the scroll-view paint its own backgroundColor in the inset
    // region — with our dark `backgroundColor` below, that showed up as
    // a black bar across the bottom of the screen. The CSS already keeps
    // content out of the unsafe regions via env(safe-area-inset-*).
    contentInset: "never",
    scheme: "Codeplane",
    backgroundColor: "#0b0d10",
    limitsNavigationsToAppBoundDomains: false,
    handleApplicationNotifications: true,
    overrideUserAgent: undefined,
    appendUserAgent: "Codeplane/Mobile",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    backgroundColor: "#0b0d10",
    appendUserAgent: "Codeplane/Mobile",
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
    iosScheme: "codeplane",
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      launchFadeOutDuration: 240,
      backgroundColor: "#0b0d10",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // The renderer follows `prefers-color-scheme` for both the picker
      // and the embedded instance UI, so the bar foreground has to flip
      // with the OS theme. `DEFAULT` lets iOS pick the appropriate
      // contrast based on the device's current appearance for the
      // initial paint; `MobileShell` then explicitly re-syncs the bar
      // on each scheme change while the app is running. (Note that
      // Capacitor's `LIGHT`/`DARK` here name the *background* the
      // style is meant to sit over — `DARK` = light-content icons.)
      style: "DEFAULT",
      // No fixed background on iOS — `overlaysWebView` lets the
      // WKWebView's `--background-base` paint through, so it adapts to
      // the active theme automatically. On Android `setBackgroundColor`
      // is called from `MobileShell` to mirror the same value.
      overlaysWebView: true,
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      // The keyboard chrome itself follows the system appearance; we
      // ask iOS for that explicitly so a user on light mode doesn't
      // get a dark keyboard popping up over a light picker.
      style: KeyboardStyle.Default,
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon",
      // The picker is monochrome — Android notification icons follow
      // suit. Near-white (`#ededed`, the dark-mode `--icon-strong-base`)
      // sits well on Android's dark notification shade and on the
      // Lock-Screen widget glyph treatment.
      iconColor: "#ededed",
    },
    App: {
      // Receive codeplane:// deep links so users can be sent directly to
      // a particular instance (mirrors how desktop handles custom URL
      // schemes). Hosts are configured per-platform in Info.plist /
      // AndroidManifest.xml — see resources/.
    },
    CapacitorHttp: {
      // We use the native HTTP client so per-instance auth headers and
      // self-signed certs can be handled outside the WKWebView/WebView
      // sandbox, matching the desktop's per-session header injection.
      enabled: true,
    },
  },
}

export default config
