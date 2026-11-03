# openGym on a Mac at home (Colima and Tailscale)

A way to run openGym on a spare Mac, with no Docker Desktop, no domain and no reverse proxy.
[Colima](https://github.com/abiosoft/colima) runs the containers, and
[Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) gives the server an `https://` address
that your phone can use for passkeys and pairing. The address only works inside your own tailnet
(your devices on Tailscale), so nothing is open to the internet.

This page only covers what is different on a Mac. The rest (users, backups, settings) is in
[SELF_HOSTING.md](./SELF_HOSTING.md).

## What you need

- A Mac that can stay on, with [Homebrew](https://brew.sh).
- A free [Tailscale](https://tailscale.com) account, with Tailscale installed on the Mac **and** on your phone.
- About 2 GB of RAM and 20 GB of disk to spare for the Colima VM.

## 1. Docker without Docker Desktop

```bash
brew install colima docker docker-compose
colima start --cpu 2 --memory 2 --disk 20    # once: the sizes are remembered
brew services start colima                     # starts it at login from now on
```

Homebrew's `docker-compose` is a CLI plugin. Tell the `docker` command where it is by adding this to
`~/.docker/config.json` (create the file if it does not exist):

```json
{ "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"] }
```

(`/usr/local/lib/docker/cli-plugins` on an Intel Mac.) Check with `docker compose version`.

## 2. Get openGym

Clone it somewhere that is **not** iCloud Drive or another synced folder (`~/Dev/opengym` works). The
`./data` folder is written all the time and does not like being synced.

```bash
git clone https://github.com/DuarteSantos8/openGym ~/Dev/opengym
cd ~/Dev/opengym
cp .env.example .env
```

## 3. Turn on HTTPS in Tailscale

Once per tailnet, in the [admin console](https://login.tailscale.com/admin/dns): make sure **MagicDNS** is
on, then under **HTTPS Certificates** choose **Enable HTTPS**.

Tailscale lists the names of your machines in public certificate logs when it does this. If your Mac's
name says something private, rename it first.

Your Mac's address is `https://<your-mac>.<your-tailnet>.ts.net`. You can read it in the Tailscale
menu, or in the output of `tailscale serve status` after the next step.

## 4. Point `.env` at that address

Edit `.env` and set the two values to your address, without a trailing slash:

```
RP_ID=<your-mac>.<your-tailnet>.ts.net
ORIGIN=https://<your-mac>.<your-tailnet>.ts.net
FIRST_USER_ADMIN=1
```

`RP_ID` is only the host name, `ORIGIN` is the full address. Passkeys are tied to `RP_ID`, so pick it now:
changing it later makes the existing passkeys useless (see
[the passkey requirement](./SELF_HOSTING.md#2-understand-the-passkey-requirement-important)).

Then start the server and publish it:

```bash
docker compose pull
docker compose up -d
tailscale serve --bg 8080
```

`--bg` keeps the Serve setting across reboots. `tailscale serve status` shows what is published, and
`tailscale serve reset` removes it. If you changed `WEB_PORT`, use that port instead of 8080.

Open your `https://` address in a browser **on a device with Tailscale on**, and create your profile.
The first profile becomes the admin. Once it exists, add `INVITE_ONLY=1` to `.env` and run
`docker compose up -d` again, so nobody else on your tailnet can add a profile
(see [Multiple users](./SELF_HOSTING.md#4-multiple-users)).

## 5. Pair the phone

1. On the phone, turn Tailscale on.
2. In the browser where you are signed in: Settings, Account, **Pair the mobile app**. You get an
   8-character code that lasts 5 minutes.
3. In the openGym app: Settings, Account, **Connect to my server**. Enter your `https://` address and the
   code.

More on pairing in [MOBILE.md](./MOBILE.md).

## 6. Updating

```bash
cd ~/Dev/opengym
git pull
docker compose pull
docker compose up -d
```

## Limits

- **The Mac has to be on and awake** for the phone to sync. Set it not to sleep when plugged in
  (System Settings, Energy). The phone keeps working without it and sends its changes when the server
  is back.
- **Only your tailnet can reach it.** Anyone you want to share with needs to be on your tailnet, or you
  need another way in (see [SELF_HOSTING.md](./SELF_HOSTING.md#3-expose-it-over-https-on-your-own-domain)).
  The phone needs Tailscale turned on to sync, also when you are at home.
- Docker still publishes port 8080 on the Mac itself, so it is also open as plain `http://` to your home
  network. Tailscale is not required for that, but passkeys will not work there.
- Back up `./data` as described in [Backups](./SELF_HOSTING.md#6-backups). The Colima VM itself holds nothing
  you need.
