// Early polyfill - injected in onPageStarted before React hydration.
// Makes the site think passkeys are supported so it doesn't show the fallback message.
(function() {
  if (typeof window.PublicKeyCredential !== 'undefined') return;
  window.PublicKeyCredential = function PublicKeyCredential() {};
  window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = function() {
    return Promise.resolve(true);
  };
  window.PublicKeyCredential.isConditionalMediationAvailable = function() {
    return Promise.resolve(true);
  };
  console.log('[PasskeyPolyfill] PublicKeyCredential defined early');
})();
