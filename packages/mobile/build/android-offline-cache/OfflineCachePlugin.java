// OfflineCachePlugin.java
//
// Android counterpart of the iOS `CodeplaneOfflineCachePlugin`. Same JS
// surface — `isSupported()` / `openInstance(...)` / `closeInstance(...)`
// — registered under the JS plugin name `CodeplaneOfflineCache` so the
// shared `packages/mobile/src/platform/offline-cache.ts` binding talks
// to either platform without branching.
//
// On iOS the offline path is a `WKURLSchemeHandler` for the synthetic
// `codeplane-cache:` scheme. Android has no equivalent API but
// `WebViewClient.shouldInterceptRequest(...)` gives us the SAME
// per-request hook with the SAME ability to either serve bytes off
// disk or proxy upstream — see `OfflineCacheInterceptor.java`.
//
// Drop into `android/app/src/main/java/ai/codeplane/mobile/` after
// running `bun run cap:add:android`. Capacitor 7 auto-discovers any
// `@CapacitorPlugin`-annotated class in the APK; no manual register
// call is needed in `MainActivity`.

package cc.codeplane.mobile;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "CodeplaneOfflineCache")
public class OfflineCachePlugin extends Plugin {
    /** Active presentations, keyed by `presentationId`. The Activity
     *  reports its own dismissal via `onCloseEvent(...)` below so the
     *  plugin can fire `closeEvent` to JS listeners. Held strongly so
     *  multiple in-flight modals don't lose their handle if the user
     *  background-foregrounds the app. */
    private static final Map<String, OfflineCachePlugin> liveInstances = new HashMap<>();
    private final Map<String, String> presentations = new HashMap<>();
    private String pluginInstanceId;

    @Override
    public void load() {
        super.load();
        // Capacitor instantiates the plugin once per Bridge — there is
        // exactly one, but we still register by id so the static map
        // works the same across hot-reload during dev.
        pluginInstanceId = UUID.randomUUID().toString();
        liveInstances.put(pluginInstanceId, this);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        liveInstances.remove(pluginInstanceId);
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        // The intercept API (`WebViewClient.shouldInterceptRequest`
        // returning a `WebResourceResponse`) has been on every Android
        // version we ship to — minSdk is 23 and the API is from 21.
        // Keeping the explicit gate here so the failure mode (if we
        // ever raise minSdk requirements again) is one error message
        // instead of a silent crash deep in the intercept layer.
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP;
        JSObject ret = new JSObject();
        ret.put("supported", supported);
        if (supported) {
            ret.put("minAndroid", "5.0");
        } else {
            ret.put("reason", "shouldInterceptRequest requires Android 5.0+");
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstance(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            call.reject("CodeplaneOfflineCache requires Android 5.0+");
            return;
        }
        String instanceId = call.getString("instanceId");
        String version = call.getString("version");
        String originUrl = call.getString("originUrl");
        String cacheDir = call.getString("cacheDir");
        if (instanceId == null || version == null || originUrl == null || cacheDir == null) {
            call.reject("openInstance requires instanceId, version, originUrl, cacheDir");
            return;
        }
        String title = call.getString("title", originUrl);
        String toolbarColor = call.getString("toolbarColor");

        // Auth headers — copy as a flat <String,String> map so the
        // intent extra can carry them over to the Activity (Bundle
        // serialisation only handles primitives + Parcelables).
        HashMap<String, String> authHeaders = new HashMap<>();
        JSObject authObj = call.getObject("authHeaders");
        if (authObj != null) {
            Iterator<String> keys = authObj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object value = authObj.opt(key);
                if (value instanceof String) {
                    authHeaders.put(key, (String) value);
                }
            }
        }

        Intent intent = new Intent(getContext(), OfflineCacheActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra(OfflineCacheActivity.EXTRA_PLUGIN_INSTANCE_ID, pluginInstanceId);
        intent.putExtra(OfflineCacheActivity.EXTRA_INSTANCE_ID, instanceId);
        intent.putExtra(OfflineCacheActivity.EXTRA_VERSION, version);
        intent.putExtra(OfflineCacheActivity.EXTRA_ORIGIN_URL, originUrl);
        intent.putExtra(OfflineCacheActivity.EXTRA_CACHE_DIR, cacheDir);
        intent.putExtra(OfflineCacheActivity.EXTRA_TITLE, title);
        if (toolbarColor != null) intent.putExtra(OfflineCacheActivity.EXTRA_TOOLBAR_COLOR, toolbarColor);
        intent.putExtra(OfflineCacheActivity.EXTRA_AUTH_HEADERS, authHeaders);

        // Build the full cache root path the Activity passes to the
        // intercept layer: `<cacheDir>/codeplane-ui/<instanceId>/<version>/`.
        // We resolve here (vs. in the activity) so we can sanity-check
        // it now and reject with a clear error before presenting an
        // empty modal.
        java.io.File rootDir = new java.io.File(cacheDir);
        java.io.File scoped = new java.io.File(new java.io.File(new java.io.File(rootDir, "codeplane-ui"), instanceId), version);
        if (!scoped.isDirectory()) {
            call.reject("Cache directory does not exist: " + scoped.getAbsolutePath());
            return;
        }
        java.io.File index = new java.io.File(scoped, "index.html");
        if (!index.isFile()) {
            call.reject("Cache is missing index.html at " + index.getAbsolutePath());
            return;
        }
        intent.putExtra(OfflineCacheActivity.EXTRA_ROOT_DIR, scoped.getAbsolutePath());

        String presentationId = "p-" + UUID.randomUUID().toString();
        intent.putExtra(OfflineCacheActivity.EXTRA_PRESENTATION_ID, presentationId);
        presentations.put(presentationId, instanceId);

        getContext().startActivity(intent);

        JSObject ret = new JSObject();
        ret.put("id", instanceId);
        ret.put("scheme", "https");
        ret.put("rootDir", scoped.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void closeInstance(PluginCall call) {
        // No direct Activity finish hook — broadcast a static action
        // the Activity listens for and finishes itself. The activity's
        // `finish()` triggers `onCloseEvent` below, which fans out to
        // listeners.
        Intent broadcast = new Intent(OfflineCacheActivity.ACTION_FINISH);
        String instanceId = call.getString("instanceId");
        if (instanceId != null) {
            broadcast.putExtra(OfflineCacheActivity.EXTRA_INSTANCE_ID, instanceId);
        }
        getContext().sendBroadcast(broadcast);
        call.resolve();
    }

    /** Called from `OfflineCacheActivity` when its modal is dismissed
     *  (back press, system-gesture, X-button, broadcast finish). Static
     *  to keep the Activity's plugin reference loose. */
    static void onCloseEvent(String pluginInstanceId, String presentationId, String instanceId) {
        OfflineCachePlugin self = liveInstances.get(pluginInstanceId);
        if (self == null) return;
        self.presentations.remove(presentationId);
        JSObject data = new JSObject();
        data.put("id", instanceId);
        self.notifyListeners("closeEvent", data);
    }
}
