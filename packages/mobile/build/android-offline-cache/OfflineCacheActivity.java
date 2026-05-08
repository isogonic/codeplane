// OfflineCacheActivity.java
//
// Fullscreen Activity hosting the WebView that loads the cached UI for
// a Codeplane instance. Mirror of the iOS `OfflineCacheHostController`
// but using Android conventions: an `Activity` started with
// `FLAG_ACTIVITY_NEW_TASK`, a `WebView` filling the safe-area, a
// floating ✕ pill on the top-right, system back button → finish().
//
// The Activity owns the `OfflineCacheInterceptor` and wires it into
// the WebView's `WebViewClient` before the first `loadUrl()`, so the
// very first request (the SPA shell) lands in the intercept layer
// rather than going out over the network.

package ai.codeplane.mobile;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import java.io.File;
import java.io.Serializable;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class OfflineCacheActivity extends Activity {
    private static final String TAG = "OfflineCacheActivity";

    static final String EXTRA_PLUGIN_INSTANCE_ID = "ai.codeplane.mobile.PLUGIN_INSTANCE_ID";
    static final String EXTRA_INSTANCE_ID = "ai.codeplane.mobile.INSTANCE_ID";
    static final String EXTRA_VERSION = "ai.codeplane.mobile.VERSION";
    static final String EXTRA_ORIGIN_URL = "ai.codeplane.mobile.ORIGIN_URL";
    static final String EXTRA_CACHE_DIR = "ai.codeplane.mobile.CACHE_DIR";
    static final String EXTRA_ROOT_DIR = "ai.codeplane.mobile.ROOT_DIR";
    static final String EXTRA_TITLE = "ai.codeplane.mobile.TITLE";
    static final String EXTRA_TOOLBAR_COLOR = "ai.codeplane.mobile.TOOLBAR_COLOR";
    static final String EXTRA_AUTH_HEADERS = "ai.codeplane.mobile.AUTH_HEADERS";
    static final String EXTRA_PRESENTATION_ID = "ai.codeplane.mobile.PRESENTATION_ID";

    static final String ACTION_FINISH = "ai.codeplane.mobile.OfflineCacheActivity.FINISH";

    // No synthetic host on Android. We load the LIVE origin and
    // intercept only static GETs — see the comment block at the top
    // of `OfflineCacheInterceptor` for the routing rationale and how
    // it differs from the iOS scheme-handler approach.

    private String pluginInstanceId;
    private String presentationId;
    private String instanceId;
    private boolean dispatchedClose = false;

    private final BroadcastReceiver finishReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String requestedInstance = intent.getStringExtra(EXTRA_INSTANCE_ID);
            if (requestedInstance == null || requestedInstance.equals(instanceId)) {
                finish();
            }
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        pluginInstanceId = intent.getStringExtra(EXTRA_PLUGIN_INSTANCE_ID);
        presentationId = intent.getStringExtra(EXTRA_PRESENTATION_ID);
        instanceId = intent.getStringExtra(EXTRA_INSTANCE_ID);
        String version = intent.getStringExtra(EXTRA_VERSION);
        String originUrlString = intent.getStringExtra(EXTRA_ORIGIN_URL);
        String rootDirPath = intent.getStringExtra(EXTRA_ROOT_DIR);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String toolbarColor = intent.getStringExtra(EXTRA_TOOLBAR_COLOR);

        Map<String, String> authHeaders = new HashMap<>();
        Serializable extra = intent.getSerializableExtra(EXTRA_AUTH_HEADERS);
        if (extra instanceof HashMap) {
            //noinspection unchecked
            authHeaders = (HashMap<String, String>) extra;
        }

        URL originUrl;
        try {
            originUrl = new URL(originUrlString);
        } catch (Exception e) {
            Log.e(TAG, "bad originUrl: " + originUrlString, e);
            finish();
            return;
        }

        File rootDir = new File(rootDirPath);
        if (!rootDir.isDirectory()) {
            Log.e(TAG, "root dir missing: " + rootDirPath);
            finish();
            return;
        }

        // Layout: a FrameLayout that holds the WebView + a floating
        // close pill. We configure the FrameLayout's background to the
        // requested toolbar colour so the safe-area inset doesn't
        // flash white when the modal slides in.
        FrameLayout root = new FrameLayout(this);
        int bg = parseHexColor(toolbarColor, Color.parseColor("#101010"));
        root.setBackgroundColor(bg);
        setContentView(root);

        WebView webView = new WebView(this);
        FrameLayout.LayoutParams webViewParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        );
        webView.setLayoutParams(webViewParams);
        webView.setBackgroundColor(Color.TRANSPARENT);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // `Codeplane/Mobile` UA tag matches what the InAppBrowser flow
        // appends — the embedded UI checks for it before exposing the
        // live-activity toggle.
        String baseUA = settings.getUserAgentString();
        settings.setUserAgentString((baseUA == null || baseUA.isEmpty() ? "" : baseUA + " ") + "Codeplane/Mobile");
        // Cookies share the system jar with every other Android
        // WebView (the InAppBrowser one included) so SSO carries over.
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookies.setAcceptThirdPartyCookies(webView, true);
        }

        OfflineCacheInterceptor interceptor = new OfflineCacheInterceptor(
                rootDir, originUrl.getHost()
        );

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse hit = interceptor.intercept(request);
                return hit != null ? hit : super.shouldInterceptRequest(view, request);
            }
        });

        root.addView(webView);

        // Floating close pill. Top-right, fixed pixel size (36 px) to
        // match iOS, with a subtle elevation shadow so it pops above
        // the WebView content.
        TextView closeBtn = new TextView(this);
        closeBtn.setText("✕");
        closeBtn.setTextSize(18f);
        closeBtn.setGravity(Gravity.CENTER);
        closeBtn.setTextColor(Color.parseColor("#1a1a1a"));
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        // Round white-translucent background.
        GradientDrawable round = new GradientDrawable();
        round.setShape(GradientDrawable.OVAL);
        round.setColor(Color.argb(217, 255, 255, 255)); // 0.85 alpha white
        closeBtn.setBackground(round);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            closeBtn.setElevation(8f);
        }
        int btnSize = (int) (36 * getResources().getDisplayMetrics().density);
        int margin = (int) (12 * getResources().getDisplayMetrics().density);
        FrameLayout.LayoutParams btnParams = new FrameLayout.LayoutParams(btnSize, btnSize);
        btnParams.gravity = Gravity.TOP | Gravity.END;
        btnParams.setMargins(margin, margin + getStatusBarHeight(), margin, margin);
        closeBtn.setLayoutParams(btnParams);
        root.addView(closeBtn);

        // Listen for the broadcast finish (from `closeInstance` API
        // call). Use the API-level-appropriate registration form.
        IntentFilter filter = new IntentFilter(ACTION_FINISH);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(finishReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(finishReceiver, filter);
        }

        // Navigate to the LIVE origin so relative-URL fetches inside
        // the SPA resolve against the real server. The interceptor
        // short-circuits static GETs to disk; everything else (POST
        // mutations, SSE, websocket-upgrade, third-party assets) goes
        // through the WebView's normal network stack with the shared
        // cookie jar carrying the SSO session.
        //
        // Auth headers travel on the INITIAL navigation only — the
        // server's response sets the per-instance cookies / session
        // tokens, and every subsequent request inside the WebView
        // uses those naturally. Same shape as the InAppBrowser flow.
        webView.loadUrl(originUrlString, authHeaders);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(finishReceiver);
        } catch (IllegalArgumentException ignored) {
            // Already unregistered (process restart edge case).
        }
        // Fire the close event back to JS — covers BOTH explicit close
        // taps, the system back button, AND the broadcast finish.
        if (!dispatchedClose) {
            dispatchedClose = true;
            OfflineCachePlugin.onCloseEvent(pluginInstanceId, presentationId, instanceId);
        }
    }

    private int getStatusBarHeight() {
        int resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return resId > 0 ? getResources().getDimensionPixelSize(resId) : 0;
    }

    private static int parseHexColor(String hex, int fallback) {
        if (hex == null) return fallback;
        try {
            String cleaned = hex.startsWith("#") ? hex : ("#" + hex);
            return Color.parseColor(cleaned);
        } catch (Exception e) {
            return fallback;
        }
    }
}
