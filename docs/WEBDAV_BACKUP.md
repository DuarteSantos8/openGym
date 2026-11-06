# Backup to WebDAV

Settings → Integrations → **WebDAV backup** (also in Settings → Data & backup → Back up to WebDAV)
writes the same JSON backup as "Export backup (JSON)" to a folder on a WebDAV server of your own:
Nextcloud, ownCloud, a Synology or QNAP NAS, Koofr, Apache or nginx with WebDAV. It runs once a
day while the app is open, and whenever you tap **Back up now**. On a new phone, connect the same
folder and tap **Restore from a backup**: you pick the day, then choose whether it replaces what
is on the phone or merges with it (the same question as importing a backup file).

No openGym server is involved: the device talks to your WebDAV server directly. That is what makes
it useful for the phone apps without a server (#582).

## What it keeps, and where

| | Where |
|---|---|
| Folder address, user name, "Back up every day", last result | this device only (`localStorage`, `gym_webdav_v1`), never synced, never in a backup |
| Password | this device's secure storage: the Keychain on iPhone, the Android Keystore; a browser keeps it in its own site storage |
| Backups | your folder: `opengym-backup-YYYY-MM-DD.json`, one per day, the newest 14, plus `opengym-backups.json` (the list, so no PROPFIND is needed) |

Photos and videos are not in it (like the plain JSON export). Use "Export with photos & videos
(.zip)" for those, or a server, which keeps them.

Use an **app password** (Nextcloud: Settings → Security → Devices & sessions → Create new app
password), not your main one.

## The folder address

The address of the folder itself, for example:

- Nextcloud: `https://cloud.example.com/remote.php/dav/files/USERNAME/openGym/`
- ownCloud: `https://cloud.example.com/remote.php/webdav/openGym/`
- Synology: `https://nas.example.com:5006/home/openGym/`

openGym makes the last folder (`MKCOL`) when it is missing. Only `GET`, `PUT`, `DELETE` and that
one `MKCOL` are used.

## Browser (web app) and CORS

The phone apps (Android, iPhone) send these requests through native HTTP, where CORS does not
apply: any WebDAV server works.

In a **browser**, the WebDAV server has to allow requests from your openGym address (CORS), or the
browser blocks them and the sheet says it could not reach the server. Nextcloud and most NAS
systems do not allow that out of the box. Options:

- add the headers on the reverse proxy in front of the WebDAV server, for your openGym origin only:
  `Access-Control-Allow-Origin: https://gym.example.com`,
  `Access-Control-Allow-Methods: GET, PUT, DELETE, MKCOL, OPTIONS`,
  `Access-Control-Allow-Headers: Authorization, Content-Type`,
  `Access-Control-Allow-Credentials: true`, and answer `OPTIONS` with 204 without asking for a login;
- or serve WebDAV under the same origin as openGym (a path on the same host), which needs no CORS;
- or use the phone app for the backup.

A plain `http://` address only works where the page itself is not https (a browser blocks mixed
content), and on Android only for addresses the app allows in clear text. Use https.

## When it runs

"Back up every day" backs up when the app is open (or comes back to the screen) and the last good
backup is 20 hours old or more, checked every hour while it stays open. A phone app that is never
opened makes no backup: the operating systems do not let a web app wake itself up on a schedule.
A failed run says why on the card and in the sheet, and the next hour tries again.
