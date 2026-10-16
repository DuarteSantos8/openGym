# Connect the AI Coach with your ChatGPT subscription

This feature uses the official Codex CLI device-code sign-in and does not require an OpenAI Platform API key. Use it only on a server you control and trust. Your ChatGPT account must have Codex access; requests consume that account's Codex allowance and remain subject to its plan and workspace limits.

## Sign in

1. Follow [SELF_HOSTING.md](SELF_HOSTING.md) to build the API's `coach` target, keeping the `./coach-auth:/coach-auth` mount. The default image does not include the Codex CLI.
2. Using your own administrator profile, go to Settings -> Admin -> AI Coach, enable the Coach, and select Codex.
3. Choose **Sign in with ChatGPT** -> **Start device sign-in**. If a Codex API key is already configured, explicitly remove it first.
4. Open the displayed official OpenAI URL in a trusted browser and enter the short-lived code. You can complete this step on another device. If required, first enable device-code sign-in in your ChatGPT security settings. Do not enter your ChatGPT password in openGym.
5. After authorization, choose **Test the Coach** to verify a real model response. Successful sign-in means the CLI completed authorization; it does not guarantee model access or remaining allowance.

openGym displays only the fixed OpenAI verification URL, a short-lived code, and status. It does not expose raw CLI output or OAuth tokens. The profile that starts sign-in immediately becomes the only profile allowed to use this personal subscription, including through the administrator test action. Existing API-key authentication and other providers remain supported. API usage is billed separately from a ChatGPT subscription.

## Storage and sign-out

Codex manages refreshable credentials in `/coach-auth/auth.json`; `coach.json` stores only the credential type, timestamp, and profile binding. Keep `coach-auth` outside `data`, mount it only into the API, exclude it from Git, and keep it out of ordinary fitness-data backups. Restarts reuse this dedicated cache without reading the host's Codex login.

Closing the sign-in dialog or choosing **Cancel sign-in** cancels an unfinished attempt. The server also enforces a ten-minute timeout. Switching providers or disabling the Coach cancels a pending attempt. To disconnect a completed sign-in, choose **Credential -> Remove**; this runs Codex logout and removes the dedicated cache. Remove the current credential before switching between an API key and a subscription to avoid silently changing billing sources.

If authorization is revoked or the model reports an authentication error, remove the credential and sign in again. A cache file alone does not prove that authorization is still valid online. Restarting terminates pending attempts; an unbound cache never automatically authorizes a profile.

## Attribution

Adapted from [alexpcosta/opengym's device-code sign-in implementation](https://github.com/alexpcosta/opengym/blob/678bf5bf10446e8997a77d43e89c9b2721d8d0fc/api/coach/oauth.js), retaining the current per-provider configuration and personal-subscription isolation. Official documentation: [Codex authentication](https://learn.chatgpt.com/docs/auth).
