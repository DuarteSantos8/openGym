package ch.duartesantos.opengym;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The phone's own screen lock, asked before the app deletes an account its pairing proves
 * (components/DeleteAccount.jsx, lib/device-auth.js). Android 10 and later show the system
 * BiometricPrompt, which takes a face or a fingerprint (strong or weak) and the PIN, pattern or
 * password; before that, the lock screen's own confirm. The platform's classes only: no
 * androidx.biometric dependency for one prompt.
 *
 * Usage from JS:
 *   const DeviceAuth = registerPlugin('DeviceAuth');
 *   await DeviceAuth.check();                 // { secure: true } when there is a lock to ask
 *   await DeviceAuth.verify({ reason: '…' }); // resolves once unlocked; rejects with the code
 *                                             // 'cancelled', 'not-secure' (no lock) or 'failed'
 */
@CapacitorPlugin(name = "DeviceAuth")
public class DeviceAuthPlugin extends Plugin {

    private KeyguardManager keyguard() {
        return (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
    }

    @PluginMethod
    public void check(PluginCall call) {
        KeyguardManager km = keyguard();
        JSObject ret = new JSObject();
        ret.put("secure", km != null && km.isDeviceSecure());
        call.resolve(ret);
    }

    @PluginMethod
    @SuppressWarnings("deprecation")   // createConfirmDeviceCredentialIntent: what Android 7 to 9 have
    public void verify(PluginCall call) {
        KeyguardManager km = keyguard();
        if (km == null || !km.isDeviceSecure()) {
            call.reject("no screen lock", "not-secure");
            return;
        }
        String reason = call.getString("reason", "Confirm it's you");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getActivity().runOnUiThread(() -> prompt(call, reason));
            return;
        }
        // Android 7 to 9: BiometricPrompt cannot fall back to the PIN there, the lock screen can.
        Intent intent = km.createConfirmDeviceCredentialIntent(reason, null);
        if (intent == null) {
            call.reject("no screen lock", "not-secure");
            return;
        }
        startActivityForResult(call, intent, "confirmResult");
    }

    @ActivityCallback
    private void confirmResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK) resolveVerified(call);
        else call.reject("cancelled", "cancelled");
    }

    @SuppressWarnings("deprecation")   // setDeviceCredentialAllowed: the only way on Android 10
    private void prompt(PluginCall call, String reason) {
        BiometricPrompt.Builder builder = new BiometricPrompt.Builder(getContext()).setTitle(reason);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG
                    | BiometricManager.Authenticators.BIOMETRIC_WEAK
                    | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        } else {
            builder.setDeviceCredentialAllowed(true);
        }
        BiometricPrompt prompt = builder.build();
        prompt.authenticate(new CancellationSignal(), getContext().getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                resolveVerified(call);
            }

            // A face or finger it did not know: the prompt stays up for another try, so this is
            // not the end of it. Only an error ends the call.
            @Override
            public void onAuthenticationFailed() {}

            @Override
            public void onAuthenticationError(int code, CharSequence message) {
                switch (code) {
                    case BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED:
                    case BiometricPrompt.BIOMETRIC_ERROR_CANCELED:
                        call.reject("cancelled", "cancelled");
                        break;
                    case BiometricPrompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL:
                        call.reject("no screen lock", "not-secure");
                        break;
                    default:
                        call.reject(message != null ? message.toString() : "failed", "failed");
                }
            }
        });
    }

    private void resolveVerified(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("verified", true);
        call.resolve(ret);
    }
}
