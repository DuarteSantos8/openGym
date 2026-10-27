# Optional sync: cross-device sync with your own Firestore + Vercel

This is an optional add-on for people who do not want to run a server. The
normal openGym setup (Docker, your own instance) is unchanged by everything in
this guide: the add-on only activates in a build made with `VITE_FIREBASE=1`
and a full `VITE_FB_*` config, and every other build behaves exactly as
before.

It adds **cross-device sync and passkey sign-in**, using **your own** free
Firebase project and **your own** Vercel project. There is no shared backend:
your data lives in a Firebase project only you control, and nobody else ever
sees it. Total cost: **$0** (Firebase Spark free plan plus Vercel free tier).
No credit card, no Blaze upgrade. If any screen asks for billing, you are on
the wrong screen.

**The shape of it:** a Vercel project serves the app (the `sync-server/`
folder of this repo is its deploy root) and runs four tiny serverless
functions for the passkey ceremony, because Firebase Auth has no built-in
passkey sign-in. The build command in `sync-server/vercel.json` builds the app
from `frontend/` with sync switched on and copies the result next to the
functions. Firestore holds your data, and its security rules are what guard
it.

**The plan:** Part 1 in the Firebase console (about ten minutes of clicking),
Part 2 deploys to Vercel, Part 3 publishes the data rules, Part 4 is your
first sign-in. Do them in order.

---

## Part 1: Firebase console (https://console.firebase.google.com)

1. **Create the project.** Click "Add project", name it anything (for example
   `opengym-sync`), continue. Turn Google Analytics **off** (not needed), then
   Create project.
2. **Add the web app.** On the project home, click the web icon `</>`. App
   nickname: anything (for example `opengym-web`). Leave "Firebase Hosting"
   **unticked**. Click Register app. You now see a `firebaseConfig` block with
   values like `apiKey`, `projectId` and `appId`: keep this tab open, you paste
   three of them into Vercel in Part 2.
3. **Turn on Firestore.** Left menu: Build, then Firestore Database, then "Create
   database". Choose **Start in production mode**, pick a location (you cannot
   change it later, either offered region is fine), then Enable.
4. **Turn on Authentication.** Left menu: Build, then Authentication, then "Get
   started". You do not need to enable any sign-in provider in the list: the app
   signs in with custom tokens minted by the passkey functions. Just visiting
   this page once creates what we need.
5. **Make the service account key.** This is what lets the Vercel functions verify
   passkeys and mint login tokens. Top-left gear, Project settings, **Service
   accounts** tab, **Generate new private key**, Generate key. A `.json` file
   downloads. That file is a master key to your project: do not share it, do not
   put it in any repo or chat. You paste it once into Vercel in Part 2 and can
   then delete the download.

You now have everything Part 2 asks for. The full list, with placeholders:

```
FIREBASE_SERVICE_ACCOUNT=  the entire contents of the .json file from step 5, as one value
VITE_FB_API_KEY=           apiKey from the firebaseConfig block in step 2
VITE_FB_PROJECT_ID=        projectId from the firebaseConfig block in step 2
VITE_FB_APP_ID=            appId from the firebaseConfig block in step 2
WEBAUTHN_RP_ID=            your Vercel domain as a bare host, set in Part 2
WEBAUTHN_ORIGIN=           the same domain with https:// in front, set in Part 2
```

The `VITE_FB_*` values are **not** secret: they just name your project. The
service account JSON is the only secret, and it only ever goes into Vercel.

## Part 2: Deploy to Vercel

1. In Vercel, import this repo (your own fork or clone of it) as a new project.
2. **Root Directory:** set it to `sync-server`. That folder is self-contained:
   it holds the passkey functions, the build command and the preflight check.
3. **Project name:** the name you pick becomes your domain (for example
   `your-project.vercel.app`). Note the real domain for the next step.
4. **Environment variables:** add the six variables from Part 1. Paste the
   service account JSON and the three `VITE_FB_*` values as copied. For the
   last two, use the domain from step 3: `WEBAUTHN_RP_ID` is the bare host
   (for example `your-project.vercel.app`), `WEBAUTHN_ORIGIN` is the same
   with `https://` in front (for example `https://your-project.vercel.app`).
5. Click Deploy and wait for the build. The build checks the variables first
   (and stops with a plain message naming any that are missing), builds the
   app from `frontend/` with sync switched on, and serves it together with the
   passkey functions. If Vercel asks about deployment protection or SSO, turn
   it off for this project so the URL opens without a Vercel login.
6. If the final domain is not the one you put in the two `WEBAUTHN_*` values,
   fix them under Project, Settings, Environment Variables, then redeploy from
   the Deployments tab. Passkeys are registered against this domain and will
   not work on any other.

## Part 3: Publish the Firestore rules

The rules in `firestore.rules` (repo root) are what keep every user's data
private: a signed-in user can only touch their own documents, and the passkey
collections are closed to the app entirely. Publish them once:

```sh
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project YOUR_PROJECT_ID
```

Run from the repo root (that is where `firebase.json` and `firestore.rules`
live), and replace `YOUR_PROJECT_ID` with your `projectId` from Part 1.

No CLI? Same thing in the console: Firebase console, Firestore Database, Rules
tab, paste the contents of `firestore.rules`, Publish.

## Part 4: First sign-in

1. Open your Vercel URL (for example `https://your-project.vercel.app`).
2. Pick a **username**, then **Create account with passkey**, and confirm with
   Face ID, fingerprint or device PIN.
3. Done: you are signed in, and whatever is in the app on that device uploads as
   the starting cloud copy.
4. On your second device: same URL, same username, **Sign in with passkey**.
   Your plan and history arrive, and from then on all your devices stay in sync
   live.
5. Later, to add a passkey on another device: sign in there first, then
   Settings, Account, "Add a passkey on this device".

## Check it worked

- The Vercel URL opens the app directly, with no Vercel login screen in front.
- Settings, Account shows a passkey sign-in card. That card only exists in the
  sync build, so if you see it, the build picked up your variables.
- Log a workout on one device, sign in on a second device with the same
  username and passkey, and the workout is there.
- Firebase console, Firestore Database shows your data appearing under `users`,
  and your account under `passkeyUsers` and `passkeys`.
- If sign-in fails with an origin or RP error, the two `WEBAUTHN_*` values do
  not match the domain in the address bar. Fix them in the Vercel project
  settings and redeploy.

## One honest warning about the trust model

There are no passwords and no invite codes in this setup. The rule is:
**whoever first registers a passkey for a username owns that username**, and
after that, new passkeys can only be added while signed in. This is a
personal, small-scale setup: register your username in Part 4 as soon as it
deploys, before sharing your URL with anyone. If someone did beat you to your
name, the fix is Firebase console, Firestore Database, delete the
`passkeyUsers` and `passkeys` entries for that name, and register again.

Data layout, for the curious: Firestore, `users/{your-uid}` (settings and plan
doc) with `workouts`, `routines`, `exercises`, `bodyweight` and `measurements`
subcollections, one document per item. Passkey material lives in separate
collections the app itself can never read (the rules deny it): only the Vercel
functions can.
