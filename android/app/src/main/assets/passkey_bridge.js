// Passkey Bridge - intercepts navigator.credentials for WebView environments
(function() {
  // Ensure PublicKeyCredential exists (backup for onPageStarted injection)
  if (typeof window.PublicKeyCredential === 'undefined') {
    window.PublicKeyCredential = function PublicKeyCredential() {};
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = function() {
      return Promise.resolve(true);
    };
    window.PublicKeyCredential.isConditionalMediationAvailable = function() {
      return Promise.resolve(true);
    };
  }

  if (typeof window.__PasskeyBridge === 'undefined') return;

  window.__passkeyCallbacks = window.__passkeyCallbacks || {};

  function generateId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function bufferToBase64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function base64urlToBuffer(b64) {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const buf = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
    return buf;
  }

  // Convert PublicKeyCredentialCreationOptions to JSON
  function serializeCreationOptions(options) {
    return JSON.stringify({
      rp: options.rp,
      user: {
        id: bufferToBase64url(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      challenge: bufferToBase64url(options.challenge),
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      excludeCredentials: (options.excludeCredentials || []).map(c => ({
        id: bufferToBase64url(c.id), type: c.type, transports: c.transports
      })),
      authenticatorSelection: options.authenticatorSelection,
      attestation: options.attestation,
      extensions: options.extensions,
    });
  }

  // Convert PublicKeyCredentialRequestOptions to JSON
  function serializeRequestOptions(options) {
    return JSON.stringify({
      challenge: bufferToBase64url(options.challenge),
      timeout: options.timeout,
      rpId: options.rpId,
      allowCredentials: (options.allowCredentials || []).map(c => ({
        id: bufferToBase64url(c.id), type: c.type, transports: c.transports
      })),
      userVerification: options.userVerification,
      extensions: options.extensions,
    });
  }

  // Deserialize create response
  function deserializeCreateResponse(json) {
    const r = typeof json === 'string' ? JSON.parse(json) : json;
    return {
      id: r.id,
      rawId: base64urlToBuffer(r.rawId || r.id),
      type: 'public-key',
      response: {
        clientDataJSON: base64urlToBuffer(r.response.clientDataJSON),
        attestationObject: base64urlToBuffer(r.response.attestationObject),
      },
      getClientExtensionResults: () => ({}),
    };
  }

  // Deserialize get response
  function deserializeGetResponse(json) {
    const r = typeof json === 'string' ? JSON.parse(json) : json;
    return {
      id: r.id,
      rawId: base64urlToBuffer(r.rawId || r.id),
      type: 'public-key',
      response: {
        clientDataJSON: base64urlToBuffer(r.response.clientDataJSON),
        authenticatorData: base64urlToBuffer(r.response.authenticatorData),
        signature: base64urlToBuffer(r.response.signature),
        userHandle: r.response.userHandle ? base64urlToBuffer(r.response.userHandle) : null,
      },
      getClientExtensionResults: () => ({}),
    };
  }

  // Override navigator.credentials
  const originalCredentials = navigator.credentials;

  const passkeyCredentials = {
    create: function(options) {
      const pkOptions = options && options.publicKey;
      if (!pkOptions) return originalCredentials.create(options);

      return new Promise((resolve, reject) => {
        const id = generateId();
        window.__passkeyCallbacks[id] = { resolve, reject };
        try {
          window.__PasskeyBridge.createPasskey(serializeCreationOptions(pkOptions), id);
        } catch (e) {
          delete window.__passkeyCallbacks[id];
          reject(e);
        }
      }).then(r => deserializeCreateResponse(r));
    },

    get: function(options) {
      const pkOptions = options && options.publicKey;
      if (!pkOptions) return originalCredentials.get(options);

      return new Promise((resolve, reject) => {
        const id = generateId();
        window.__passkeyCallbacks[id] = { resolve, reject };
        try {
          window.__PasskeyBridge.getPasskey(serializeRequestOptions(pkOptions), id);
        } catch (e) {
          delete window.__passkeyCallbacks[id];
          reject(e);
        }
      }).then(r => deserializeGetResponse(r));
    },

    store: originalCredentials ? originalCredentials.store.bind(originalCredentials) : undefined,
    preventSilentAccess: originalCredentials ? originalCredentials.preventSilentAccess.bind(originalCredentials) : undefined,
  };

  try {
    Object.defineProperty(navigator, 'credentials', {
      value: passkeyCredentials,
      writable: false,
      configurable: false,
    });
    console.log('[PasskeyBridge] navigator.credentials patched successfully');
  } catch (e) {
    console.warn('[PasskeyBridge] Could not patch navigator.credentials:', e);
  }
})();
