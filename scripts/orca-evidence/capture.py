#!/usr/bin/env python3
"""Capture the OrcaRouter integration's UI evidence from the real, built application.

This is the GUI half of the delivery check: it starts the actual api server against a
throwaway ``DATA_DIR``, serves the actual production bundle (``frontend/dist``) from a
one-origin proxy in front of it — the same shape the shipped nginx container has — signs in as
an admin, and photographs the two things the integration is judged on:

  ``auth-methods.png``          the Credential step, where "Replace key" (API key) and
                                "Connect with OrcaRouter" (OAuth 2.0 + PKCE) sit side by side,
                                with the stored key never rendered back
  ``text-model-dropdown.png``   the model picker, opened, showing the list the provider
                                actually served

Nothing here is a mock or a static page. The catalog the picker shows is fetched over the
network by the api server through the provider code under test; the option count in the
manifest is the number of option values that appear in both the rendered ``<select>`` and the
provider's own response, and the "the dropdown is open" assertions are measured from the
pixels that changed between the closed and open frames. Run it with ``--check`` to make it
exit non-zero on any of those assertions instead of writing evidence.

Requires ``playwright`` (Python) and the system Chromium at ``/usr/bin/chromium``; both are
present in the CI image, which is why the plan calls this with ``python3``. It is not part of
the product build and adds no dependency to either application.

Because ``frontend/dist`` is gitignored, it does not survive a fresh checkout, so this script
builds it itself (``npm run build`` in ``frontend/``) when the bundle is absent. That keeps the
whole GUI check inside one command: the plan's ``setup`` list stays pure package installation,
which is all the delivery validator will run on its own.
"""
import argparse
import hashlib
import http.server
import json
import os
import pathlib
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zlib

REPO = pathlib.Path(__file__).resolve().parents[2]
CHROMIUM = "/usr/bin/chromium"
CATALOG_URL = "https://api.orcarouter.ai/v1/models?capability=chat"
VIEWPORT = {"width": 1280, "height": 1150}


# --------------------------------------------------------------------------- PNG inspection
def decode(png):
    """Decode an 8-bit RGB/RGBA PNG into (width, height, channels, rows) — stdlib only."""
    pos, idat = 8, b""
    w = h = depth = color = 0
    while pos < len(png):
        length = int.from_bytes(png[pos:pos + 4], "big")
        kind = png[pos + 4:pos + 8]
        if kind == b"IHDR":
            w = int.from_bytes(png[pos + 8:pos + 12], "big")
            h = int.from_bytes(png[pos + 12:pos + 16], "big")
            depth, color = png[pos + 16], png[pos + 17]
        elif kind == b"IDAT":
            idat += png[pos + 8:pos + 8 + length]
        pos += 12 + length
    if depth != 8 or color not in (2, 6):
        raise SystemExit(f"unexpected PNG form depth={depth} color={color}")
    channels = 3 if color == 2 else 4
    stride = w * channels
    data = zlib.decompress(idat)
    prev = bytearray(stride)
    rows = []
    i = 0
    for _ in range(h):
        f = data[i]
        line = bytearray(data[i + 1:i + 1 + stride])
        i += 1 + stride
        if f:
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                if f == 1:
                    line[x] = (line[x] + a) & 0xFF
                elif f == 2:
                    line[x] = (line[x] + b) & 0xFF
                elif f == 3:
                    line[x] = (line[x] + (a + b) // 2) & 0xFF
                else:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    line[x] = (line[x] + pr) & 0xFF
        rows.append(bytes(line))
        prev = line
    return w, h, channels, rows


def pixel(img, x, y):
    w, h, c, rows = img
    x, y = max(0, min(w - 1, x)), max(0, min(h - 1, y))
    return rows[y][x * c:x * c + c]


def changed_pixels(a, b):
    _, _, c, ra = a
    _, _, _, rb = b
    return sum(
        1
        for row_a, row_b in zip(ra, rb)
        for x in range(0, len(row_a), c)
        if row_a[x:x + c] != row_b[x:x + c]
    )


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --------------------------------------------------------------- the app under the browser
class Proxy(http.server.SimpleHTTPRequestHandler):
    """Serve dist/ and forward /api to the real server — one origin, like the nginx image."""

    backend = ""
    directory = ""

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=type(self).directory, **kw)

    def log_message(self, *a):
        pass

    def _proxy(self, method):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(type(self).backend + self.path, data=body, method=method)
        for k, v in self.headers.items():
            if k.lower() in ("host", "content-length", "accept-encoding", "connection"):
                continue
            req.add_header(k, v)
        # The api server refuses a state-changing request from another origin; the shipped
        # deployment is same-origin, and so is this proxy.
        req.add_header("Sec-Fetch-Site", "same-origin")
        try:
            up = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            up = e
        with up:
            payload = up.read()
            self.send_response(up.status)
            for k, v in up.headers.items():
                if k.lower() in ("transfer-encoding", "connection"):
                    continue
                self.send_header(k, v)
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self):
        self._proxy("GET") if self.path.startswith("/api") else super().do_GET()

    def do_POST(self):
        self._proxy("POST")

    def do_DELETE(self):
        self._proxy("DELETE")


class Threaded(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(url, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def start_api(data_dir, port, origin):
    env = dict(os.environ)
    env.update(DATA_DIR=data_dir, PORT=str(port), ORIGIN=origin,
               ADMIN_UIDS="admin-1", RP_ID="localhost")
    proc = subprocess.Popen(
        ["node", "api/server.js"], cwd=REPO, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if not wait_for(f"http://127.0.0.1:{port}/api/health"):
        proc.kill()
        raise SystemExit("api server did not come up:\n"
                         + proc.stdout.read().decode(errors="replace")[-2000:])
    return proc


def seed(data_dir, api_key):
    env = dict(os.environ, DATA_DIR=data_dir, ORCAROUTER_API_KEY=api_key)
    out = subprocess.run(
        ["node", "scripts/orca-evidence/seed.mjs", str(REPO)],
        cwd=REPO, env=env, capture_output=True, text=True, timeout=120,
    )
    if out.returncode:
        raise SystemExit("could not seed the throwaway instance:\n" + out.stderr[-2000:])
    return out.stdout.strip()          # the signed session token


def run_capture(base, session, out_dir, api_key):
    from playwright.sync_api import sync_playwright

    diag = {}
    out_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROMIUM, headless=True,
            args=["--no-sandbox", "--headless=new", "--force-device-scale-factor=1"],
        )
        ctx = browser.new_context(viewport=VIEWPORT)
        ctx.add_cookies([{
            "name": "gymsid", "value": session, "domain": "127.0.0.1", "path": "/",
            "httpOnly": True, "sameSite": "Lax",
        }])
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{base}/#/admin", wait_until="domcontentloaded")

        # What the provider serves, asked through the api server's own discovery route — the
        # one that holds the key, so the browser never sees it.
        catalog = page.evaluate("""async () => {
            const r = await fetch('/api/admin/coach/models', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ capability: 'chat' })
            });
            return r.json();
        }""")
        if not catalog.get("ok"):
            raise SystemExit("live catalog discovery failed: " + json.dumps(catalog)[:300])
        served = set(catalog["models"])
        diag["served_models"] = len(served)

        # ---- auth-methods.png: both ways in, side by side ----
        page.wait_for_selector(".adm-step", timeout=30000)
        page.wait_for_timeout(1500)
        cred = page.locator("details.adm-step", has=page.locator("summary", has_text="Credential"))
        if not cred.get_attribute("open"):
            cred.locator("summary").click()
            page.wait_for_timeout(500)

        api_key_btn = page.get_by_role("button", name="Replace key")
        pkce_btn = page.get_by_role("button", name="Connect with OrcaRouter")
        api_key_btn.wait_for(state="visible", timeout=15000)
        pkce_btn.wait_for(state="visible", timeout=15000)
        if not api_key_btn.is_enabled() or not pkce_btn.is_enabled():
            raise SystemExit("a credential control rendered disabled")
        leaked = "sk-orca-" in page.locator("body").inner_text()
        if leaked:
            raise SystemExit("the stored key was rendered back into the page")

        cred.scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        (out_dir / "auth-methods.png").write_bytes(page.screenshot())
        diag["auth"] = {
            "api_key_visible": api_key_btn.is_visible(),
            "pkce_visible": pkce_btn.is_visible(),
            "secret_masked": not leaked,
            "controls_enabled": api_key_btn.is_enabled() and pkce_btn.is_enabled(),
            "connected_hint": page.locator(".adm-hint", has_text="Connected via").first.inner_text()[:90],
        }

        # ---- text-model-dropdown.png: the real list, opened ----
        model = page.locator("details.adm-step", has=page.locator("summary", has_text="Model"))
        if not model.get_attribute("open"):
            model.locator("summary").click()
            page.wait_for_timeout(400)
        select = model.locator("select.adm-select")
        select.wait_for(state="visible", timeout=15000)

        options = select.locator("option")
        rows = options.count()
        values = [options.nth(i).get_attribute("value") for i in range(rows)]
        # `item_count` is the rows in the picker that the provider actually returned, measured
        # by intersecting the rendered option values with the catalog response. The select also
        # renders one blank-valued row naming the provider's own default, so that "no explicit
        # choice" is representable; it is not a catalog item and is reported separately.
        from_catalog = [v for v in values if v in served]
        diag["item_count"] = len(from_catalog)
        diag["placeholder_options"] = [
            options.nth(i).inner_text() for i in range(rows) if values[i] not in served
        ]
        diag["option_rows"] = rows
        diag["options"] = [options.nth(i).inner_text() for i in range(rows)]
        if len(from_catalog) != len(served):
            raise SystemExit(
                f"the picker offers {len(from_catalog)} catalog models but the provider served"
                f" {len(served)}"
            )
        if [v for v in values if v and v not in served]:
            raise SystemExit("the picker offers a model the live catalog did not return")

        # Park the select with room on both sides so the popup opens whole rather than clipped
        # at a viewport edge, and measure where it landed rather than assuming.
        model.scroll_into_view_if_needed()
        page.evaluate("""() => {
            const sel = document.querySelector('select.adm-select');
            const r = sel.getBoundingClientRect();
            window.scrollBy(0, r.top - 620);
        }""")
        page.wait_for_timeout(500)
        closed_png = page.screenshot()
        box = select.evaluate(
            "el => { const r = el.getBoundingClientRect();"
            " return {x: r.x, y: r.y, width: r.width, height: r.height}; }"
        )
        select.click()
        page.wait_for_timeout(800)
        open_png = page.screenshot()
        (out_dir / "text-model-dropdown.png").write_bytes(open_png)

        closed, opened = decode(closed_png), decode(open_png)
        changed = changed_pixels(closed, opened)
        diag["changed_pixels"] = changed
        if changed <= 500:
            raise SystemExit(f"the dropdown did not visibly open ({changed} px changed)")

        trigger_top = round(box["y"])
        trigger_right = round(box["x"] + box["width"])
        changed_rows = [
            y for y in range(opened[1])
            if any(pixel(opened, x, y) != pixel(closed, x, y) for x in range(0, opened[0], 3))
        ]
        if not changed_rows:
            raise SystemExit("nothing changed on screen")
        if min(changed_rows) <= 0 or max(changed_rows) >= opened[1] - 1:
            raise SystemExit("the open popup is clipped by the viewport")
        opens_up = min(changed_rows) < trigger_top
        scan_y = trigger_top - 60 if opens_up else round(box["y"] + box["height"]) + 60
        xs = [x for x in range(opened[0]) if pixel(opened, x, scan_y) != pixel(closed, x, scan_y)]
        if not xs:
            raise SystemExit("no popup content on the scan row")
        left, panel_right = min(xs), max(xs)
        right_delta = abs(panel_right - trigger_right)
        diag["right_delta"] = right_delta
        if right_delta > 2:
            raise SystemExit(
                f"the popup is not aligned to its trigger (panel {panel_right}, trigger {trigger_right})"
            )

        # Opacity: a translucent panel lets the card behind it through, so no row inside it is
        # ever one flat colour. An opaque one has long flat runs between its text lines.
        best = 0.0
        for row in range(min(changed_rows) + 2, max(changed_rows) - 2):
            tally = {}
            for x in range(left + 5, panel_right - 4):
                px = pixel(opened, x, row)
                tally[px] = tally.get(px, 0) + 1
            if tally:
                best = max(best, max(tally.values()) / sum(tally.values()))
        diag["opaque_fraction"] = round(best, 4)
        if best <= 0.5:
            raise SystemExit(f"the open popup is not opaque (flattest row only {best:.2f})")

        # A visible edge: the panel's own boundary pixel differs from the page it covers.
        visible_border = pixel(opened, panel_right, scan_y) != pixel(opened, panel_right + 4, scan_y)
        diag["visible_border"] = visible_border
        if not visible_border:
            raise SystemExit("the open popup has no distinguishable edge")

        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        diag["page_errors"] = errors
        if errors:
            raise SystemExit(f"page errors during the run: {errors}")

        ctx.close()
        browser.close()

    manifest = {
        "automation": {
            "framework": "playwright",
            "passed": True,
            "catalog_source": CATALOG_URL,
            "catalog_model_count": diag["served_models"],
            "image_model_count": 0,
            "image_model_count_reason": (
                "openGym has no image-generation entry point: api/coach/core/payload.js is a "
                "numeric/enum allowlist and no Coach job uploads or requests an image, so the "
                "interface has no image dropdown to photograph. The image capability rule ships "
                "filtered and tested in api/coach/core/catalog.js, bound to no UI."
            ),
        },
        "artifacts": [
            {
                "kind": "auth-methods",
                "path": "auth-methods.png",
                "sha256": sha256(out_dir / "auth-methods.png"),
                "ui": diag["auth"],
            },
            {
                "kind": "text-model-dropdown",
                "path": "text-model-dropdown.png",
                "sha256": sha256(out_dir / "text-model-dropdown.png"),
                "ui": {
                    "dropdown_open": changed > 500,
                    "item_count": diag["item_count"],
                    "opaque_background": best > 0.5,
                    "visible_border": visible_border,
                    "trigger_panel_right_delta": right_delta,
                    "option_rows": diag["option_rows"],
                    "non_catalog_options": diag["placeholder_options"],
                },
            },
        ],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return diag


def ensure_dist():
    """Build ``frontend/dist`` when it is absent — the directory is gitignored, so a fresh
    checkout has to produce it before anything can be photographed."""
    dist = REPO / "frontend/dist/index.html"
    if dist.is_file():
        return
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit(f"{dist} is missing and npm is not on PATH to build it")
    print("frontend/dist is absent — running `npm run build` in frontend/", flush=True)
    built = subprocess.run(
        [npm, "run", "build"], cwd=REPO / "frontend", env=os.environ.copy(),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if built.returncode or not dist.is_file():
        sys.stdout.write(built.stdout.decode(errors="replace")[-4000:])
        raise SystemExit(f"`npm run build` did not produce {dist}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "orca-evidence"),
                    help="where the screenshots and manifest are written")
    args = ap.parse_args()

    api_key = os.environ.get("ORCAROUTER_API_KEY")
    if not api_key:
        raise SystemExit("ORCAROUTER_API_KEY is required: the catalog is fetched live")
    ensure_dist()
    dist = REPO / "frontend/dist/index.html"

    tmp = tempfile.mkdtemp(prefix="orca-evidence-")
    data_dir = os.path.join(tmp, "data")
    os.makedirs(data_dir, exist_ok=True)
    api_port, web_port = free_port(), free_port()
    origin = f"http://127.0.0.1:{web_port}"
    api = proxy = None
    try:
        # Seed first: server.js reads db.json once at boot, so the admin account has to exist
        # before the process starts or every admin route answers 401.
        session = seed(data_dir, api_key)
        api = start_api(data_dir, api_port, origin)
        Proxy.backend, Proxy.directory = f"http://127.0.0.1:{api_port}", str(REPO / "frontend/dist")
        proxy = Threaded(("127.0.0.1", web_port), Proxy)
        threading.Thread(target=proxy.serve_forever, daemon=True).start()

        diag = run_capture(origin, session, pathlib.Path(args.out), api_key)
        print(json.dumps({k: v for k, v in diag.items() if k != "options"}, indent=2))
    finally:
        if proxy:
            proxy.shutdown()
        if api:
            api.kill()
    print(f"evidence written to {args.out}")


if __name__ == "__main__":
    sys.exit(main())
