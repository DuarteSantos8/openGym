package cn.litaku.gym;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;

import java.util.concurrent.Executors;

/**
 * JavaScript 桥接：拦截 WebView 中的 WebAuthn 调用，转发到 Android Credential Manager。
 * 在 Android 9+ (API 28+) 上提供完整 Passkey 支持。
 */
public class PasskeyBridge {

    private static final String TAG = "PasskeyBridge";

    private final Activity activity;
    private final WebView webView;
    private final CredentialManager credentialManager;

    public PasskeyBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            this.credentialManager = CredentialManager.create(activity);
        } else {
            this.credentialManager = null;
        }
    }

    /** 网页调用 navigator.credentials.create() 时触发（注册新 Passkey） */
    @JavascriptInterface
    public void createPasskey(final String requestJson, final String callbackId) {
        if (credentialManager == null) {
            sendError(callbackId, "NOT_SUPPORTED", "Passkey requires Android 9+");
            return;
        }
        activity.runOnUiThread(() -> {
            CreatePublicKeyCredentialRequest request =
                    new CreatePublicKeyCredentialRequest(requestJson);
            credentialManager.createCredentialAsync(
                    activity,
                    request,
                    null,
                    Executors.newSingleThreadExecutor(),
                    new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                        @Override
                        public void onResult(CreateCredentialResponse result) {
                            String responseJson = result.getData()
                                    .getString("androidx.credentials.BUNDLE_KEY_REGISTRATION_RESPONSE_JSON", "{}");
                            sendResult(callbackId, responseJson);
                        }

                        @Override
                        public void onError(CreateCredentialException e) {
                            sendError(callbackId, e.getType(), e.getMessage());
                        }
                    });
        });
    }

    /** 网页调用 navigator.credentials.get() 时触发（使用 Passkey 登录） */
    @JavascriptInterface
    public void getPasskey(final String requestJson, final String callbackId) {
        if (credentialManager == null) {
            sendError(callbackId, "NOT_SUPPORTED", "Passkey requires Android 9+");
            return;
        }
        activity.runOnUiThread(() -> {
            GetPublicKeyCredentialOption option = new GetPublicKeyCredentialOption(requestJson);
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(option)
                    .build();
            credentialManager.getCredentialAsync(
                    activity,
                    request,
                    null,
                    Executors.newSingleThreadExecutor(),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse result) {
                            // PublicKeyCredential
                            String responseJson = result.getCredential().getData()
                                    .getString("androidx.credentials.BUNDLE_KEY_AUTHENTICATION_RESPONSE_JSON", "{}");
                            sendResult(callbackId, responseJson);
                        }

                        @Override
                        public void onError(GetCredentialException e) {
                            sendError(callbackId, e.getType(), e.getMessage());
                        }
                    });
        });
    }

    private void sendResult(final String callbackId, final String json) {
        final String escaped = json.replace("\\", "\\\\").replace("'", "\\'");
        activity.runOnUiThread(() ->
                webView.evaluateJavascript(
                        "__passkeyCallbacks['" + callbackId + "'].resolve(" + json + ");",
                        null));
    }

    private void sendError(final String callbackId, final String type, final String msg) {
        final String safeMsg = (msg == null ? "Unknown error" : msg)
                .replace("\\", "\\\\").replace("'", "\\'");
        activity.runOnUiThread(() ->
                webView.evaluateJavascript(
                        "__passkeyCallbacks['" + callbackId + "'].reject(new Error('" + safeMsg + "'));",
                        null));
    }
}
