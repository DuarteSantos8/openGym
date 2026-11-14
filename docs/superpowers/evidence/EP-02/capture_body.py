# Screenshot capture with fatal route, heading and theme assertions. Env: BASE, OUT, SHA, EXTRAS=1 (final build only).
OUT = os.environ['OUT']; SHA = os.environ['SHA']; os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.png') or f == 'manifest.json': os.remove(os.path.join(OUT, f))
open_blocked(); drain_events()
manifest = []
def shot(name, w, h, theme, expect):
    viewport(w, h)
    o = observed()
    bright = lum(o['bg'])
    ok = (o['hash'] == expect['hash'] and o['theme'] == theme and (bright < .3 if theme == 'dark' else bright > .7)
          and (o['h1'] == expect['h1'] if expect.get('h1') else expect['text'] in o['text'])
          and o['dir'] == expect.get('dir', 'ltr') and (expect.get('selector') is None or js("!!document.querySelector(%s)" % json.dumps(expect['selector']))))
    if not ok:
        raise SystemExit("MISLABELLED CAPTURE refused: %s expected %s theme=%s observed hash=%s theme=%s bg=%s h1=%r dir=%s" % (name, expect, theme, o['hash'], o['theme'], o['bg'], o['h1'], o['dir']))
    capture_screenshot(os.path.join(OUT, name))
    o.pop('text')
    manifest.append(dict(file=name, sha=SHA, base=BASE, requestedTheme=theme, viewport=[w, h], expected=expect, observed=o, bytes=os.path.getsize(os.path.join(OUT, name))))
PAGES = [("home", "#/home", {"hash": "#/home", "h1": "openGym"}), ("stats", "#/stats", {"hash": "#/stats", "h1": "Stats"}), ("settings", "#/settings", {"hash": "#/settings", "h1": "Settings"})]
for theme in ("dark", "light"):
    for w, h in ((320, 640), (390, 844), (1280, 800)):
        seed(theme); viewport(w, h)
        for name, hs, exp in PAGES:
            goto(hs); shot("%s-%s-%d.png" % (name, theme, w), w, h, theme, exp)
        goto("#/home")
        wait_for("!!document.querySelector('.tag.acc')", 8)
        real_click("document.querySelector('.tag.acc')"); wait_for("location.hash=='#/workout'", 15)
        wait_for("document.body.innerText.includes('Barbell Bench Press')")
        shot("workout-%s-%d.png" % (theme, w), w, h, theme, {"hash": "#/workout", "text": "Barbell Bench Press"})
if os.environ.get('EXTRAS') == '1':
    for theme in ("dark", "light"):
        for w in (320, 390):
            seed(theme); viewport(w, 640); goto("#/home"); wait_for("!!document.querySelector('.metric')")
            js("document.querySelector('.metric').scrollIntoView({block:'center'})"); time.sleep(.4)
            shot("bodyweight-%s-%d.png" % (theme, w), w, 640, theme, {"hash": "#/home", "text": "Body weight", "selector": ".metric"})
    seed("dark", lang="ar"); viewport(320, 640); goto("#/home"); wait_for("!!document.querySelector('.metric')")
    js("document.querySelector('.metric').scrollIntoView({block:'center'})"); time.sleep(.4)
    shot("rtl-ar-bodyweight-320.png", 320, 640, "dark", {"hash": "#/home", "text": "", "selector": ".metric", "dir": "rtl"})
    seed("dark"); viewport(320, 640); goto("#/home"); wait_for("!!document.querySelector('.metric')")
    js("document.documentElement.style.fontSize='200%'"); time.sleep(.5)
    js("document.querySelector('.metric').scrollIntoView({block:'center'})"); time.sleep(.4)
    shot("zoom200-bodyweight-320.png", 320, 640, "dark", {"hash": "#/home", "text": "Body weight", "selector": ".metric"})
    z = manifest[-1]['observed']; assert z['fontSize'] == '32px', z['fontSize']   # 200% of 16px
errs = errors_from(drain_events())
expected = [e for e in errs if is_expected(e)]
unexpected = [e for e in errs if e not in expected]
json.dump(dict(sha=SHA, base=BASE, manifest=manifest, expectedConsole=len(expected), unexpectedErrors=unexpected), open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
try: close_tab()
except Exception: pass
print(len(manifest), "shots; expected console entries:", len(expected), "; unexpected errors:", unexpected)
if unexpected: sys.exit(1)
