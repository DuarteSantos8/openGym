package cn.litaku.gym;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {

    private static final String TARGET_URL = "https://gym.litaku.cn";
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PasskeyBridge passkeyBridge;

    // 断网自动重试
    private boolean showingOffline = false;
    private BroadcastReceiver networkReceiver;
    private ConnectivityManager.NetworkCallback networkCallback;

    // 双击返回退出
    private long lastBackPress = 0;

    // 缓存 polyfill 内容，避免 shouldInterceptRequest 每次读文件
    private String cachedPolyfill = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(0x00000000);
        setContentView(webView);
        setupWebView();
        passkeyBridge = new PasskeyBridge(this, webView);
        webView.addJavascriptInterface(passkeyBridge, "__PasskeyBridge");

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(TARGET_URL);
        }

        setupNetworkMonitor();
    }

    // ── 网络状态 ──────────────────────────────────────────────────

    @SuppressWarnings("deprecation")
    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.net.Network net = cm.getActiveNetwork();
            if (net == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        }
        NetworkInfo ni = cm.getActiveNetworkInfo();
        return ni != null && ni.isConnected();
    }

    private void setupNetworkMonitor() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            // API 24+：用 NetworkCallback，不需要广播
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return;
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(android.net.Network network) {
                    if (showingOffline) {
                        showingOffline = false;
                        runOnUiThread(() -> webView.loadUrl(TARGET_URL));
                    }
                }
            };
            cm.registerDefaultNetworkCallback(networkCallback);
        } else {
            // API 21–23：用广播
            networkReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (showingOffline && isNetworkAvailable()) {
                        showingOffline = false;
                        webView.loadUrl(TARGET_URL);
                    }
                }
            };
            //noinspection deprecation
            registerReceiver(networkReceiver,
                new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));
        }
    }

    // ── WebView 配置 ──────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        // 预加载 polyfill（shouldInterceptRequest 在后台线程调用，提前加载好）
        try { cachedPolyfill = readAssetToString("passkey_polyfill.js"); }
        catch (IOException ignored) {}

        WebSettings s = webView.getSettings();

        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);

        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        // 在线时遵守 HTTP 缓存头（服务端控制新鲜度），断网时用本地缓存
        s.setCacheMode(isNetworkAvailable()
                ? WebSettings.LOAD_DEFAULT
                : WebSettings.LOAD_CACHE_ELSE_NETWORK);

        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        // 禁用缩放
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        // 去掉 UA 中的 "wv" 标记，避免网站检测为不支持 passkey 的 WebView
        String ua = s.getUserAgentString();
        ua = ua.replaceAll("; wv\\)", ")").replaceAll(" wv ", " ").replaceAll("Version/4\\.0 ", "");
        s.setUserAgentString(ua);

        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (url.startsWith("https://gym.litaku.cn") || url.startsWith("http://gym.litaku.cn")) {
                    return false;
                }
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (Exception ignored) {}
                return true;
            }

            // ② 最可靠的注入时机：在 HTML 响应里直接插入 <script>，比 evaluateJavascript 更早
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return injectPolyfillIntoHtml(request);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // 备用：SPA 内部路由切换不会触发 shouldInterceptRequest，这里补一次
                injectJsFile(view, "passkey_polyfill.js");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                injectJsFile(view, "passkey_bridge.js");
            }

            @Override
            public void onReceivedError(WebView view, int code, String desc, String failingUrl) {
                showingOffline = true;
                view.loadUrl("file:///android_asset/offline.html");
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {}

            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });
    }

    // ── Passkey polyfill 注入到 HTML 响应 ────────────────────────

    private WebResourceResponse injectPolyfillIntoHtml(WebResourceRequest request) {
        if (cachedPolyfill == null) return null;
        if (!request.getMethod().equals("GET")) return null;
        String url = request.getUrl().toString();
        if (!url.contains("gym.litaku.cn")) return null;
        Map<String, String> headers = request.getRequestHeaders();
        String accept = headers != null ? headers.get("Accept") : null;
        if (accept == null || !accept.contains("text/html")) return null;

        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            if (headers != null) {
                for (Map.Entry<String, String> h : headers.entrySet()) {
                    if (!h.getKey().equalsIgnoreCase("Host")) {
                        conn.setRequestProperty(h.getKey(), h.getValue());
                    }
                }
            }
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) conn.setRequestProperty("Cookie", cookie);

            String ct = conn.getContentType();
            if (ct == null || !ct.contains("text/html")) return null;

            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append('\n');

            // 把 polyfill 注入到 <head> 之后，确保在任何页面 JS 之前执行
            String script = "<script>" +
                    cachedPolyfill.replace("\\", "\\\\").replace("$", "\\$") +
                    "</script>";
            String html = sb.toString().replaceFirst("(?i)<head([^>]*)>", "<head$1>" + script);

            return new WebResourceResponse("text/html", "UTF-8",
                    conn.getResponseCode(), "OK", new HashMap<>(),
                    new ByteArrayInputStream(html.getBytes("UTF-8")));
        } catch (Exception e) {
            return null; // 降级：让 WebView 自行处理
        }
    }

    // ── JS 工具 ──────────────────────────────────────────────────

    private String readAssetToString(String filename) throws IOException {
        InputStream is = getAssets().open(filename);
        BufferedReader reader = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line).append('\n');
        is.close();
        return sb.toString();
    }

    private void injectJsFile(WebView view, String filename) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        try {
            view.evaluateJavascript(readAssetToString(filename), null);
        } catch (IOException ignored) {}
    }

    // ── 导航 ────────────────────────────────────────────────────

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                long now = System.currentTimeMillis();
                if (now - lastBackPress < 2000) {
                    finish();
                } else {
                    lastBackPress = now;
                    Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
                }
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // ── 生命周期 ─────────────────────────────────────────────────

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        webView.saveState(out);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            Uri[] results = (res == RESULT_OK && data != null)
                    ? WebChromeClient.FileChooserParams.parseResult(res, data) : null;
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override protected void onResume() { super.onResume(); webView.onResume(); }
    @Override protected void onPause()  { super.onPause();  webView.onPause(); }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && networkCallback != null) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm != null) cm.unregisterNetworkCallback(networkCallback);
        } else if (networkReceiver != null) {
            unregisterReceiver(networkReceiver);
        }
        if (webView != null) { webView.stopLoading(); webView.destroy(); }
        super.onDestroy();
    }
}
